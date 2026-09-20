import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { readConfig } from '../src/config.js';
import { DynamoStore } from '../src/data/dynamo.js';
import { IdentityService } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { IssueService } from '../src/issues.js';
import { WorkflowService } from '../src/workflow.js';
import { ApiError } from '../src/errors.js';
import { ownershipFixture } from '../test/ownership-fixture.js';
test(
  'DynamoDB Local: reciprocal duplicate links cannot form a cycle; priority/decline persist atomically',
  { timeout: 60000 },
  async () => {
    const prefix = `campusfix-test-${randomUUID()}`,
      config = readConfig({
        APP_ENV: 'test',
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
        CORE_TABLE: prefix + '-core',
        DISCOVERY_TABLE: prefix + '-discovery',
        JOBS_TABLE: prefix + '-jobs',
      }),
      store = new DynamoStore(config),
      created: string[] = [];
    try {
      const tables = JSON.parse(
        await readFile(new URL('../../../specs/dynamodb-tables.json', import.meta.url), 'utf8'),
      ) as CreateTableCommandInput[];
      for (const t of tables) {
        const name = t.TableName!.replace('campusfix-local', prefix);
        await store.client.send(new CreateTableCommand({ ...t, TableName: name }));
        created.push(name);
      }
      const f = await ownershipFixture();
      const seeded = [...f.store.items.entries()]
        .filter(([k]) => JSON.parse(k)[0] === f.config.CORE_TABLE)
        .map(([, v]) => v);
      await store.transact(
        seeded.map((item) => ({
          table: config.CORE_TABLE,
          key: { pk: item.pk, sk: item.sk },
          guard: { kind: 'absent' as const },
          item,
        })),
      );
      const identity = new IdentityService(
          store,
          config,
          new CursorCodec('ownership-integration-secret-at-least-32-characters'),
        ),
        issues = new IssueService(identity),
        w = new WorkflowService(issues);
      const a = f.post;
      const b = await issues.publish(f.user, f.campus, f.input, randomUUID());
      const results = await Promise.allSettled([
        w.command(
          f.owner,
          f.campus,
          a.id,
          {
            expectedVersion: a.version,
            action: 'duplicate',
            targetPostId: b.id,
            reason: 'Shared network fault',
          },
          randomUUID(),
        ),
        w.command(
          f.owner,
          f.campus,
          b.id,
          {
            expectedVersion: b.version,
            action: 'duplicate',
            targetPostId: a.id,
            reason: 'Shared network fault',
          },
          randomUUID(),
        ),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const current = await Promise.all([
        issues.getIssue(f.owner, f.campus, a.id),
        issues.getIssue(f.owner, f.campus, b.id),
      ]);
      const root = current.find((i) => i.detail.status === 'SUBMITTED')!,
        child = current.find((i) => i.detail.status === 'DUPLICATE')!;
      assert.equal(child.detail.duplicateOf, root.id);
      await assert.rejects(
        w.command(
          f.owner,
          f.campus,
          root.id,
          {
            expectedVersion: root.version,
            action: 'duplicate',
            targetPostId: child.id,
            reason: 'Attempt cycle',
          },
          randomUUID(),
        ),
        (e) => e instanceof ApiError && e.code === 'DUPLICATE_CYCLE',
      );
      const high = await w.command(
        f.owner,
        f.campus,
        root.id,
        {
          expectedVersion: root.version,
          action: 'set-priority',
          severity: 'HIGH',
          reason: 'Multiple students affected',
        },
        randomUUID(),
      );
      const declined = await w.command(
        f.owner,
        f.campus,
        root.id,
        {
          expectedVersion: high.version,
          action: 'decline',
          reason: 'Outside current service',
          appealContact: 'Independent campus review',
        },
        randomUUID(),
      );
      assert.equal(declined.detail.status, 'DECLINED');
      assert.equal(declined.detail.ackDueAt, root.detail.ackDueAt);
      assert.ok(
        (await w.history(f.user, f.campus, root.id, 25)).items.some(
          (e) => e.eventType === 'ISSUE_DECLINE',
        ),
      );
    } finally {
      for (const name of created) {
        assert.ok(name.startsWith(prefix + '-'));
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
