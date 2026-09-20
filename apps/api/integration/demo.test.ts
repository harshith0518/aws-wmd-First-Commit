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
import { KnowledgeService } from '../src/knowledge.js';
import { ReviewService } from '../src/reviews.js';
import {
  demoActors,
  demoIds,
  demoRecords,
  demoScenarios,
  type DemoActor,
} from '../../../scripts/aws/seed-data.js';
test(
  'DynamoDB Local: actual cloud demo seed runs, replays and enforces group/campus/reviewer isolation',
  { timeout: 60000 },
  async () => {
    const prefix = `campusfix-test-${randomUUID()}`,
      config = readConfig({
        APP_ENV: 'test',
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
        CORE_TABLE: prefix + '-core',
        DISCOVERY_TABLE: prefix + '-discovery',
        JOBS_TABLE: prefix + '-jobs',
      });
    const store = new DynamoStore(config),
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
      const users = Object.fromEntries(demoActors.map((a) => [a.key, randomUUID()])) as Record<
        DemoActor,
        string
      >;
      const date = new Date().toISOString();
      await store.transact(
        demoRecords(users, date).map((item) => ({
          table: config.CORE_TABLE,
          key: { pk: item.pk, sk: item.sk },
          guard: { kind: 'absent' as const },
          item,
        })),
      );
      const identity = new IdentityService(
        store,
        config,
        new CursorCodec('demo-integration-cursor-at-least-32-characters'),
      );
      const result = await demoScenarios(identity, users, date);
      assert.deepEqual(
        await demoScenarios(identity, users, date),
        result,
        'repeat seeding must not duplicate sample reports',
      );
      const issues = new IssueService(identity),
        k = new KnowledgeService(issues),
        reviews = new ReviewService(issues);
      assert.equal(
        (await issues.configuration(users['student-a'], demoIds.campus)).categories.length,
        4,
      );
      assert.equal(
        (
          await issues.getIssue(users['student-a'], demoIds.campus, result.groupIssue)
        ).title.includes('[Demo]'),
        true,
      );
      await assert.rejects(issues.getIssue(users['student-b'], demoIds.campus, result.groupIssue));
      await assert.rejects(issues.getIssue(users.outsider, demoIds.campus, result.campusIssue));
      assert.equal(
        (await k.get(users['student-b'], demoIds.campus, result.knowledge)).state,
        'ACTIVE',
      );
      const review = await reviews.create(
        users['student-a'],
        demoIds.campus,
        {
          issueId: result.groupIssue,
          reasonCode: 'NO_RESPONSE',
          description: 'Synthetic test of independent review routing.',
        },
        randomUUID(),
      );
      assert.equal(review.reviewer?.id, users.reviewer);
      await assert.rejects(reviews.get(users.owner, demoIds.campus, review.id));
      assert.equal((await reviews.get(users.reviewer, demoIds.campus, review.id)).id, review.id);
    } finally {
      for (const name of created) {
        assert.ok(name.startsWith(prefix + '-'));
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
