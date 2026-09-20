import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { replyQuerySchema } from '@campusfix/contracts';
import { readConfig } from '../src/config.js';
import { DynamoStore } from '../src/data/dynamo.js';
import { IdentityService } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { IssueService } from '../src/issues.js';
import { DiscussionService } from '../src/discussion.js';
import { ApiError } from '../src/errors.js';
import { keys } from '../src/data/keys.js';
import { issueFixture } from '../test/issue-fixture.js';
test(
  'DynamoDB Local: reply/mention transaction deduplication, revisions, private notes and concurrent support',
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
          new CursorCodec('discussion-integration-secret-at-least-32-characters'),
        ),
        issues = new IssueService(identity),
        d = new DiscussionService(issues),
        post = await issues.publish(
          f.user,
          f.campus,
          { ...f.input, audience: { kind: 'CAMPUS' } },
          randomUUID(),
        );
      const key = randomUUID(),
        body = {
          body: 'Synthetic discussion integration',
          scope: 'PUBLIC',
          mentionIds: [f.user, f.owner],
        };
      const replies = await Promise.all([
        d.create(f.user, f.campus, post.id, body, key),
        d.create(f.user, f.campus, post.id, body, key),
      ]);
      assert.equal(replies[0]!.id, replies[1]!.id);
      const reply = replies[0]!;
      assert.equal(reply.mentions.length, 2);
      assert.equal(
        (await d.list(f.bob, f.campus, post.id, replyQuerySchema.parse({}))).items.length,
        1,
      );
      const note = await d.create(
        f.owner,
        f.campus,
        post.id,
        { body: 'Private synthetic staff finding', scope: 'STAFF' },
        randomUUID(),
      );
      assert.equal(
        (await d.list(f.bob, f.campus, post.id, replyQuerySchema.parse({}))).items.length,
        1,
      );
      await assert.rejects(
        d.get(f.bob, f.campus, post.id, note.id),
        (e) => e instanceof ApiError && e.status === 404,
      );
      const child = await d.create(
        f.owner,
        f.campus,
        post.id,
        { body: 'Inspection planned', scope: 'PUBLIC', parentReplyId: reply.id },
        randomUUID(),
      );
      assert.equal(
        (
          await d.list(
            f.user,
            f.campus,
            post.id,
            replyQuerySchema.parse({ parentReplyId: reply.id }),
          )
        ).items[0]?.id,
        child.id,
      );
      await d.change(
        f.user,
        f.campus,
        post.id,
        reply.id,
        { expectedVersion: 1, body: 'Corrected synthetic description', reason: 'Corrected detail' },
        randomUUID(),
      );
      assert.equal(
        (await d.revisions(f.bob, f.campus, post.id, reply.id, 25)).items[0]?.body,
        body.body,
      );
      await d.change(
        f.user,
        f.campus,
        post.id,
        reply.id,
        { expectedVersion: 2, reason: 'Remove synthetic detail' },
        randomUUID(),
        true,
      );
      assert.equal((await d.get(f.bob, f.campus, post.id, reply.id)).body, '');
      assert.equal((await d.revisions(f.bob, f.campus, post.id, reply.id, 25)).items.length, 0);
      assert.equal((await d.revisions(f.owner, f.campus, post.id, reply.id, 25)).items.length, 2);
      const before = await d.supportState(f.bob, f.campus, post.id),
        supportKey = randomUUID(),
        toggle = { expectedVersion: before.version, enabled: true };
      const supported = await Promise.all([
        d.support(f.bob, f.campus, post.id, toggle, supportKey),
        d.support(f.bob, f.campus, post.id, toggle, supportKey),
      ]);
      assert.equal(supported[0]!.supportCount, 1);
      assert.equal(supported[1]!.supportCount, 1);
      const v = supported[0]!.version,
        races = await Promise.allSettled([
          d.support(f.user, f.campus, post.id, { expectedVersion: v, enabled: true }, randomUUID()),
          d.support(
            f.owner,
            f.campus,
            post.id,
            { expectedVersion: v, enabled: true },
            randomUUID(),
          ),
        ]);
      assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = races.find((r) => r.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof ApiError &&
          rejected.reason.status === 409,
      );
      assert.equal((await d.supportState(f.user, f.campus, post.id)).supportCount, 2);
      let state = await d.supportState(f.bob, f.campus, post.id);
      await d.support(
        f.bob,
        f.campus,
        post.id,
        { expectedVersion: state.version, enabled: false },
        randomUUID(),
      );
      state = await d.supportState(f.bob, f.campus, post.id);
      assert.equal(state.supportCount, 1);
      assert.equal(state.supported, false);
      const stored = await store.get(config.CORE_TABLE, {
        pk: keys.post(f.campus, post.id).pk,
        sk: `SUPPORT#${f.bob}`,
      });
      assert.equal(stored?.gsi1pk, undefined);
      assert.equal(stored?.enabled, false);
      const member = (await store.get(config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
      await store.transact([
        {
          table: config.CORE_TABLE,
          key: keys.member(f.campus, f.bob),
          guard: { kind: 'version', version: Number(member.version) },
          item: { ...member, status: 'REVOKED', version: Number(member.version) + 1 },
        },
      ]);
      await assert.rejects(
        d.support(f.bob, f.campus, post.id, toggle, supportKey),
        (e) => e instanceof ApiError && e.status === 404,
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
