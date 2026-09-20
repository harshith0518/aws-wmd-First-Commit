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
import { knowledgeFixture } from '../test/knowledge-fixture.js';
import { KnowledgeService, knowledgeKey } from '../src/knowledge.js';
import { knowledgeQuerySchema } from '@campusfix/contracts';
test(
  'DynamoDB Local: knowledge curation race, conditional discovery deletion/restoration and source reopening',
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
      const f = await knowledgeFixture(false);
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
      const k = new KnowledgeService(issues),
        key = randomUUID();
      const [a, b] = await Promise.all([
        k.create(f.owner, f.campus, f.knowledgeInput, key),
        k.create(f.owner, f.campus, f.knowledgeInput, key),
      ]);
      assert.equal(a.id, b.id);
      const q = knowledgeQuerySchema.parse({ categoryId: f.category });
      assert.equal((await k.search(f.user, f.campus, q)).items[0]?.id, a.id);
      const stale = await k.command(
        f.user,
        f.campus,
        a.id,
        { action: 'mark-stale', expectedVersion: a.version, reason: 'Review replacement model' },
        randomUUID(),
      );
      assert.equal(stale.state, 'STALE');
      assert.equal((await k.search(f.user, f.campus, q)).items.length, 0);
      const groupPk = `C#${f.campus}#KNOW#${f.category}#AUD#GROUP#${f.hostel}`;
      assert.equal(
        (await store.query({ table: config.DISCOVERY_TABLE, pk: groupPk, limit: 25 })).items.length,
        0,
      );
      const reviewed = await k.command(
        f.owner,
        f.campus,
        a.id,
        {
          action: 'review',
          expectedVersion: stale.version,
          reason: 'Current confirmed fix verified',
          reviewDueAt: f.knowledgeInput.reviewDueAt,
        },
        randomUUID(),
      );
      assert.equal(reviewed.state, 'ACTIVE');
      assert.equal(
        (await store.query({ table: config.DISCOVERY_TABLE, pk: groupPk, limit: 25 })).items.length,
        1,
      );
      await assert.rejects(k.get(f.bob, f.campus, a.id));
      await w.command(
        f.user,
        f.campus,
        f.post.id,
        { action: 'reopen', expectedVersion: f.post.version, reason: 'The fix did not persist' },
        randomUUID(),
      );
      await assert.rejects(k.get(f.user, f.campus, a.id));
      assert.equal((await k.search(f.user, f.campus, q)).items.length, 0);
    } finally {
      for (const name of created) {
        assert.ok(name.startsWith(prefix + '-'));
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
