import { WorkflowService } from '../src/workflow.js';
import { queueQuerySchema } from '@campusfix/contracts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { issueFeedQuerySchema } from '@campusfix/contracts';
import { readConfig } from '../src/config.js';
import { DynamoStore } from '../src/data/dynamo.js';
import { IdentityService } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { IssueService } from '../src/issues.js';
import { issueFixture } from '../test/issue-fixture.js';
import { keys } from '../src/data/keys.js';
test(
  'DynamoDB Local: publication, owner/reporter resolution cycle, concurrency, queue, scoped history and revocation',
  { timeout: 60000 },
  async () => {
    const suffix = randomUUID(),
      prefix = `campusfix-test-${suffix}`;
    const config = readConfig({
      APP_ENV: 'test',
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
      CORE_TABLE: `${prefix}-core`,
      DISCOVERY_TABLE: `${prefix}-discovery`,
      JOBS_TABLE: `${prefix}-jobs`,
    });
    const store = new DynamoStore(config);
    const created: string[] = [];
    try {
      const tables = JSON.parse(
        await readFile(new URL('../../../specs/dynamodb-tables.json', import.meta.url), 'utf8'),
      ) as CreateTableCommandInput[];
      for (const table of tables) {
        const name = table.TableName!.replace('campusfix-local', prefix);
        await store.client.send(new CreateTableCommand({ ...table, TableName: name }));
        created.push(name);
      }
      const f = issueFixture();
      await store.transact(
        [...f.store.items.values()].map((item) => ({
          table: config.CORE_TABLE,
          key: { pk: item.pk, sk: item.sk },
          guard: { kind: 'absent' as const },
          item,
        })),
      );
      const identity = new IdentityService(
          store,
          config,
          new CursorCodec('integration-issue-secret-at-least-32-characters'),
        ),
        issues = new IssueService(identity);
      assert.equal((await issues.configuration(f.user, f.campus)).categories.length, 1);
      const draft = await issues.createDraft(
        f.user,
        f.campus,
        { type: 'ISSUE', title: 'Saved for later' },
        'integration-draft-key',
      );
      assert.equal((await issues.drafts(f.user, f.campus, 25)).items[0]?.id, draft.id);
      const results = await Promise.all([
        issues.publish(
          f.user,
          f.campus,
          { expectedVersion: 1, payload: f.input },
          'integration-publish-key',
          draft.id,
        ),
        issues.publish(
          f.user,
          f.campus,
          { expectedVersion: 1, payload: f.input },
          'integration-publish-key',
          draft.id,
        ),
      ]);
      assert.equal(results[0]?.id, results[1]?.id);
      assert.equal(
        (await issues.getIssue(f.owner, f.campus, draft.id)).detail.primaryOwner.id,
        f.owner,
      );
      await assert.rejects(issues.getIssue(f.bob, f.campus, draft.id));
      assert.equal(
        (await issues.feed(f.user, f.campus, issueFeedQuerySchema.parse({ limit: 1 }))).items[0]
          ?.id,
        draft.id,
      );
      assert.equal(
        (await issues.feed(f.bob, f.campus, issueFeedQuerySchema.parse({}))).items.length,
        0,
      );
      const workflow = new WorkflowService(issues);
      const next = {
        nextAction: 'Inspect shared access point',
        nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
      };
      const ack = { expectedVersion: 2, action: 'acknowledge', ...next };
      const acknowledgements = await Promise.all([
        workflow.command(f.owner, f.campus, draft.id, ack, 'integration-acknowledge-key'),
        workflow.command(f.owner, f.campus, draft.id, ack, 'integration-acknowledge-key'),
      ]);
      assert.equal(acknowledgements[0]!.version, 3);
      assert.equal(acknowledgements[1]!.version, 3);
      let updated = await workflow.command(
        f.owner,
        f.campus,
        draft.id,
        { expectedVersion: 3, action: 'start', ...next },
        randomUUID(),
      );
      updated = await workflow.command(
        f.owner,
        f.campus,
        draft.id,
        {
          expectedVersion: updated.version,
          action: 'propose-resolution',
          resolution: {
            symptom: 'No connection',
            action: 'Replaced the access point',
            outcome: 'Connection works',
            evidenceOmissionReason: 'Synthetic text-only integration test',
          },
        },
        randomUUID(),
      );
      assert.equal(
        (
          await workflow.queue(
            f.owner,
            f.campus,
            queueQuerySchema.parse({ unitId: f.unit, tab: 'AWAITING_CONFIRMATION' }),
          )
        ).items[0]?.id,
        draft.id,
      );
      updated = await workflow.command(
        f.user,
        f.campus,
        draft.id,
        {
          expectedVersion: updated.version,
          action: 'confirm',
          resolutionId: updated.detail.currentResolution!.id,
        },
        randomUUID(),
      );
      assert.equal(
        (await workflow.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: f.unit }))).items
          .length,
        0,
      );
      updated = await workflow.command(
        f.user,
        f.campus,
        draft.id,
        { expectedVersion: updated.version, action: 'reopen', reason: 'Connection dropped again' },
        randomUUID(),
      );
      assert.equal(updated.detail.status, 'REOPENED');
      assert.equal(
        (await workflow.resolutions(f.user, f.campus, draft.id, 25)).items[0]!.state,
        'INVALIDATED',
      );
      assert.equal(
        (await workflow.history(f.owner, f.campus, draft.id, 25)).items.filter(
          (e) => e.eventType === 'ISSUE_ACKNOWLEDGE',
        ).length,
        1,
      );
      const member = (await store.get(config.CORE_TABLE, keys.member(f.campus, f.user)))!;
      await store.transact([
        {
          table: config.CORE_TABLE,
          key: keys.member(f.campus, f.user),
          guard: { kind: 'version', version: 1 },
          item: { ...member, status: 'REVOKED', version: 2, authVersion: 2 },
        },
      ]);
      await assert.rejects(issues.getIssue(f.user, f.campus, draft.id));
      await assert.rejects(
        issues.publish(
          f.user,
          f.campus,
          { expectedVersion: 1, payload: f.input },
          'integration-publish-key',
          draft.id,
        ),
      );
    } finally {
      for (const name of created) {
        if (!name.startsWith(prefix + '-')) throw new Error('Unsafe test cleanup.');
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
