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
import { ReviewService } from '../src/reviews.js';
import { ApiError } from '../src/errors.js';
import { reviewFixture } from '../test/review-fixture.js';
test(
  'DynamoDB Local: private independent review, concurrent create, private notes and competing decisions',
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
      const f = await reviewFixture(),
        seeded = [...f.store.items.entries()]
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
          new CursorCodec('review-integration-secret-at-least-32-characters'),
        ),
        issues = new IssueService(identity),
        reviews = new ReviewService(issues),
        key = randomUUID();
      const results = await Promise.all([
        reviews.create(f.user, f.campus, f.reviewInput, key),
        reviews.create(f.user, f.campus, f.reviewInput, key),
      ]);
      assert.equal(results[0]!.id, results[1]!.id);
      let review = results[0]!;
      assert.equal(review.reviewer?.id, f.reviewer);
      assert.equal((await reviews.list(f.reviewer, f.campus, 25)).items[0]?.id, review.id);
      await assert.rejects(
        reviews.get(f.owner, f.campus, review.id),
        (e) => e instanceof ApiError && e.status === 404,
      );
      await assert.rejects(
        reviews.create(f.user, f.campus, f.reviewInput, randomUUID()),
        (e) => e instanceof ApiError && e.code === 'ACTIVE_REVIEW_EXISTS',
      );
      await reviews.respond(
        f.reviewer,
        f.campus,
        review.id,
        { body: 'Private reviewer analysis', visibility: 'REVIEWERS' },
        randomUUID(),
      );
      assert.equal(
        (await reviews.children(f.user, f.campus, review.id, 'RESPONSE', 25)).items.length,
        0,
      );
      assert.equal(
        (await reviews.children(f.reviewer, f.campus, review.id, 'RESPONSE', 25)).items.length,
        1,
      );
      review = await reviews.get(f.reviewer, f.campus, review.id);
      review = await reviews.command(
        f.reviewer,
        f.campus,
        review.id,
        {
          expectedVersion: review.version,
          action: 'begin',
          nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
        },
        randomUUID(),
      );
      const decision = {
          expectedVersion: review.version,
          action: 'decide',
          decisionReason: 'Independent synthetic verification complete.',
          appealDeadline: new Date(Date.now() + 15 * 86400000).toISOString(),
        },
        races = await Promise.allSettled([
          reviews.command(
            f.reviewer,
            f.campus,
            review.id,
            { ...decision, decisionOutcome: 'RESPONSE_UPHELD' },
            randomUUID(),
          ),
          reviews.command(
            f.reviewer,
            f.campus,
            review.id,
            { ...decision, decisionOutcome: 'INSUFFICIENT_EVIDENCE' },
            randomUUID(),
          ),
        ]);
      assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
      const final = await reviews.get(f.user, f.campus, review.id);
      assert.equal(final.state, 'CLOSED');
      assert.equal(
        (
          await store.query({
            table: config.CORE_TABLE,
            pk: `C#${f.campus}#REVIEW#${review.id}`,
            prefix: 'DECISION#',
            limit: 25,
          })
        ).items.length,
        1,
      );
      assert.equal(
        (await reviews.create(f.user, f.campus, f.reviewInput, randomUUID())).state,
        'OPEN',
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
