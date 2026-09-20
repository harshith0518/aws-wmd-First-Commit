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
import { OwnershipService } from '../src/ownership.js';
import { ApiError } from '../src/errors.js';
import { ownershipFixture } from '../test/ownership-fixture.js';
test(
  'DynamoDB Local: collaborator grants, concurrent handover acceptance/rejection and deterministic expiry',
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
        o = new OwnershipService(issues);
      let post = await o.assign(
        f.owner,
        f.campus,
        f.post.id,
        { expectedVersion: f.post.version, collaboratorIds: [f.bob], reason: 'Joint diagnosis' },
        randomUUID(),
      );
      assert.ok(
        (await issues.getIssue(f.bob, f.campus, post.id)).capabilities.includes('MANAGE_ISSUE'),
      );
      post = await o.assign(
        f.owner,
        f.campus,
        post.id,
        { expectedVersion: post.version, collaboratorIds: [], reason: 'Transfer instead' },
        randomUUID(),
      );
      await assert.rejects(
        issues.getIssue(f.bob, f.campus, post.id),
        (e) => e instanceof ApiError && e.status === 404,
      );
      const input = {
          expectedVersion: post.version,
          action: 'propose-transfer',
          toUnitId: f.nextUnit,
          toOwnerId: f.bob,
          reason: 'Specialist accountability',
        },
        key = randomUUID(),
        ps = await Promise.all([
          o.command(f.owner, f.campus, post.id, input, key),
          o.command(f.owner, f.campus, post.id, input, key),
        ]);
      assert.ok('detail' in ps[0]! && 'detail' in ps[1]!);
      const proposed = ps[0],
        transfer = proposed.detail.pendingTransfer!;
      assert.equal(transfer.transferId, ps[1].detail.pendingTransfer!.transferId);
      const races = await Promise.allSettled([
        o.command(
          f.bob,
          f.campus,
          post.id,
          {
            expectedVersion: proposed.version,
            action: 'accept-transfer',
            transferId: transfer.transferId,
          },
          randomUUID(),
        ),
        o.command(
          f.bob,
          f.campus,
          post.id,
          {
            expectedVersion: proposed.version,
            action: 'reject-transfer',
            transferId: transfer.transferId,
            reason: 'Competing response',
          },
          randomUUID(),
        ),
      ]);
      assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
      const current = await issues.getIssue(f.user, f.campus, post.id);
      assert.equal(current.detail.pendingTransfer, undefined);
      const count = (
        await store.query({
          table: config.CORE_TABLE,
          pk: `C#${f.campus}#POST#${post.id}`,
          prefix: 'EVENT#',
          limit: 25,
        })
      ).items.filter((i) =>
        ['ISSUE_ACCEPT_TRANSFER', 'ISSUE_REJECT_TRANSFER'].includes(String(i.eventType)),
      ).length;
      assert.equal(count, 1);
      await o.expire(Date.parse(transfer.expiresAt) + 1);
      assert.equal((await issues.getIssue(f.user, f.campus, post.id)).version, current.version);
      const reporter = await issues.publish(f.user, f.campus, f.input, randomUUID()),
        exp = await o.command(
          f.owner,
          f.campus,
          reporter.id,
          {
            expectedVersion: reporter.version,
            action: 'propose-transfer',
            toUnitId: f.nextUnit,
            toOwnerId: f.bob,
            reason: 'Expiry example',
          },
          randomUUID(),
        );
      assert.ok('detail' in exp);
      await Promise.all([
        o.expire(Date.parse(exp.detail.pendingTransfer!.expiresAt) + 1),
        o.expire(Date.parse(exp.detail.pendingTransfer!.expiresAt) + 1),
      ]);
      assert.equal(
        (await issues.getIssue(f.user, f.campus, reporter.id)).detail.pendingTransfer,
        undefined,
      );
      assert.equal(
        (
          await store.query({
            table: config.CORE_TABLE,
            pk: `C#${f.campus}#POST#${reporter.id}`,
            prefix: 'EVENT#',
            limit: 25,
          })
        ).items.filter((i) => i.eventType === 'ISSUE_TRANSFER_EXPIRED').length,
        1,
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
