import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { replyQuerySchema } from '@campusfix/contracts';
import { DiscussionService } from '../src/discussion.js';
import { WorkflowService } from '../src/workflow.js';
import { ApiError } from '../src/errors.js';
import { issueFixture } from './issue-fixture.js';
import { keys } from '../src/data/keys.js';
import { createApp } from '../src/app.js';
const code = (name: string) => (e: unknown) => e instanceof ApiError && e.code === name;
async function setup(campusWide = false) {
  const f = issueFixture(),
    discussion = new DiscussionService(f.issues),
    post = await f.issues.publish(
      f.user,
      f.campus,
      { ...f.input, ...(campusWide ? { audience: { kind: 'CAMPUS' } } : {}) },
      randomUUID(),
    );
  return { ...f, discussion, post };
}
test('public replies inherit hostel access, preserve one nesting level and do not accept spoofed authors', async () => {
  const f = await setup(),
    d = f.discussion,
    reply = await d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'The same area is affected.', scope: 'PUBLIC', mentionIds: [f.owner] },
      randomUUID(),
    );
  assert.equal(reply.author?.id, f.user);
  assert.equal(reply.mentions[0]?.id, f.owner);
  const child = await d.create(
    f.owner,
    f.campus,
    f.post.id,
    { body: 'We will inspect it.', scope: 'PUBLIC', parentReplyId: reply.id },
    randomUUID(),
  );
  assert.equal(child.roleAtPosting, 'UNIT_LEAD');
  assert.equal(
    (await d.list(f.owner, f.campus, f.post.id, replyQuerySchema.parse({}))).items.length,
    1,
  );
  assert.equal(
    (await d.list(f.user, f.campus, f.post.id, replyQuerySchema.parse({ parentReplyId: reply.id })))
      .items[0]?.id,
    child.id,
  );
  await assert.rejects(
    d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'Too deep', scope: 'PUBLIC', parentReplyId: child.id },
      randomUUID(),
    ),
    code('REPLY_NESTING'),
  );
  await assert.rejects(d.get(f.bob, f.campus, f.post.id, reply.id), code('NOT_FOUND'));
  await assert.rejects(d.get(f.user, f.otherCampus, f.post.id, reply.id), code('NOT_FOUND'));
  await assert.rejects(
    d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'Spoofed', scope: 'PUBLIC', authorId: f.owner },
      randomUUID(),
    ),
  );
  await assert.rejects(
    d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'Ineligible mention', scope: 'PUBLIC', mentionIds: [f.bob] },
      randomUUID(),
    ),
    code('MENTION_NOT_ALLOWED'),
  );
});
test('staff notes, their children, revisions and history require a current assigned handler', async () => {
  const f = await setup(),
    d = f.discussion,
    note = await d.create(
      f.owner,
      f.campus,
      f.post.id,
      { body: 'Private staff diagnostic', scope: 'STAFF' },
      randomUUID(),
    );
  await assert.rejects(
    d.create(f.user, f.campus, f.post.id, { body: 'Forged note', scope: 'STAFF' }, randomUUID()),
    code('STAFF_NOTE_FORBIDDEN'),
  );
  assert.equal(
    (await d.list(f.user, f.campus, f.post.id, replyQuerySchema.parse({}))).items.length,
    0,
  );
  await assert.rejects(
    d.list(f.user, f.campus, f.post.id, replyQuerySchema.parse({ scope: 'STAFF' })),
    code('NOT_FOUND'),
  );
  await assert.rejects(d.get(f.user, f.campus, f.post.id, note.id), code('NOT_FOUND'));
  await assert.rejects(
    d.create(
      f.owner,
      f.campus,
      f.post.id,
      { body: 'Leaky nesting', scope: 'PUBLIC', parentReplyId: note.id },
      randomUUID(),
    ),
    code('REPLY_NESTING'),
  );
  await assert.rejects(
    d.create(
      f.owner,
      f.campus,
      f.post.id,
      { body: 'Leaky mention', scope: 'STAFF', mentionIds: [f.user] },
      randomUUID(),
    ),
    code('MENTION_NOT_ALLOWED'),
  );
  await d.change(
    f.owner,
    f.campus,
    f.post.id,
    note.id,
    { expectedVersion: 1, body: 'Updated private diagnostic', reason: 'Added finding' },
    randomUUID(),
  );
  await assert.rejects(d.revisions(f.user, f.campus, f.post.id, note.id, 25), code('NOT_FOUND'));
  assert.equal(
    (await d.revisions(f.owner, f.campus, f.post.id, note.id, 25)).items[0]?.body,
    'Private staff diagnostic',
  );
  const history = await new WorkflowService(f.issues).history(f.user, f.campus, f.post.id, 25);
  assert.equal(
    history.items.some((e) => e.eventType.startsWith('REPLY_')),
    false,
  );
  const owner = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
  f.store.seed(f.config.CORE_TABLE, { ...owner, roles: [], version: 2 });
  await assert.rejects(d.get(f.owner, f.campus, f.post.id, note.id), code('NOT_FOUND'));
});
test('reply edit/remove records revisions, protects removed text and retains its attributed placeholder', async () => {
  const f = await setup(true),
    d = f.discussion,
    r = await d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'First description', scope: 'PUBLIC' },
      randomUUID(),
    );
  await assert.rejects(
    d.change(
      f.bob,
      f.campus,
      f.post.id,
      r.id,
      { expectedVersion: 1, body: 'Changed by someone else', reason: 'Invalid' },
      randomUUID(),
    ),
    code('REPLY_AUTHOR_REQUIRED'),
  );
  const edited = await d.change(
    f.user,
    f.campus,
    f.post.id,
    r.id,
    { expectedVersion: 1, body: 'Corrected description', reason: 'Corrected location' },
    randomUUID(),
  );
  assert.equal(edited.version, 2);
  assert.equal(
    (await d.revisions(f.bob, f.campus, f.post.id, r.id, 25)).items[0]?.body,
    'First description',
  );
  await assert.rejects(
    d.change(
      f.user,
      f.campus,
      f.post.id,
      r.id,
      { expectedVersion: 1, body: 'Stale', reason: 'Old version' },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  await d.change(
    f.user,
    f.campus,
    f.post.id,
    r.id,
    { expectedVersion: 2, reason: 'Withdraw personal detail' },
    randomUUID(),
    true,
  );
  const removed = await d.get(f.bob, f.campus, f.post.id, r.id);
  assert.equal(removed.body, '');
  assert.ok(removed.removedAt);
  assert.equal(removed.author?.id, f.user);
  assert.equal((await d.revisions(f.bob, f.campus, f.post.id, r.id, 25)).items.length, 0);
  assert.equal((await d.revisions(f.user, f.campus, f.post.id, r.id, 25)).items.length, 2);
});
test('reply retries create one body, quota increment, event and outbox; conflicting replay fails', async () => {
  const f = await setup(),
    d = f.discussion,
    key = randomUUID(),
    input = { body: 'One retry-safe reply', scope: 'PUBLIC' };
  const results = await Promise.all([
    d.create(f.user, f.campus, f.post.id, input, key),
    d.create(f.user, f.campus, f.post.id, input, key),
  ]);
  assert.equal(results[0]?.id, results[1]?.id);
  const records = [...f.store.items.values()];
  assert.equal(records.filter((i) => i.entityType === 'REPLY').length, 1);
  assert.equal(records.filter((i) => i.kind === 'REPLY_CREATED').length, 1);
  assert.equal(records.filter((i) => i.eventType === 'REPLY_CREATED').length, 1);
  assert.equal(records.find((i) => i.sk.startsWith('REPLY#HOUR#'))?.count, 1);
  await assert.rejects(
    d.create(f.user, f.campus, f.post.id, { ...input, body: 'Changed' }, key),
    code('IDEMPOTENCY_CONFLICT'),
  );
});
test('support is unique per member, concurrent toggles count once, equivalent PUT is safe and stale conflicts do not decrement twice', async () => {
  const f = await setup(true),
    d = f.discussion,
    key = randomUUID(),
    input = { expectedVersion: f.post.version, enabled: true };
  const results = await Promise.all([
    d.support(f.bob, f.campus, f.post.id, input, key),
    d.support(f.bob, f.campus, f.post.id, input, key),
  ]);
  assert.equal(results[0]?.supportCount, 1);
  assert.equal(results[1]?.supportCount, 1);
  const equivalent = await d.support(f.bob, f.campus, f.post.id, input, randomUUID());
  assert.equal(equivalent.version, results[0]?.version);
  assert.equal(equivalent.supportCount, 1);
  await assert.rejects(
    d.support(f.bob, f.campus, f.post.id, { expectedVersion: 1, enabled: false }, randomUUID()),
    code('VERSION_CONFLICT'),
  );
  const state = await d.supportState(f.bob, f.campus, f.post.id);
  const removed = await d.support(
    f.bob,
    f.campus,
    f.post.id,
    { expectedVersion: state.version, enabled: false },
    randomUUID(),
  );
  assert.equal(removed.supportCount, 0);
  assert.equal(
    (
      await d.support(
        f.bob,
        f.campus,
        f.post.id,
        { expectedVersion: 1, enabled: false },
        randomUUID(),
      )
    ).supportCount,
    0,
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'SUPPORT').length, 1);
  f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2 });
  await assert.rejects(d.supportState(f.user, f.campus, f.post.id), code('NOT_FOUND'));
});
test('reply and support writes fail atomically when membership is revoked at commit, and reply cursors bind scope', async () => {
  const f = await setup(true),
    d = f.discussion;
  for (let i = 0; i < 3; i++)
    await d.create(
      f.user,
      f.campus,
      f.post.id,
      { body: `Reply ${i}`, scope: 'PUBLIC' },
      randomUUID(),
    );
  const page = await d.list(f.owner, f.campus, f.post.id, replyQuerySchema.parse({ limit: 1 }));
  assert.ok(page.nextCursor);
  await assert.rejects(
    d.list(
      f.owner,
      f.campus,
      f.post.id,
      replyQuerySchema.parse({ limit: 1, scope: 'STAFF', cursor: page.nextCursor }),
    ),
    code('INVALID_CURSOR'),
  );
  const original = f.store.transact.bind(f.store);
  f.store.transact = async (writes) => {
    if (writes.some((w) => w.item?.entityType === 'SUPPORT'))
      f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2 });
    return original(writes);
  };
  const latest = await f.issues.getIssue(f.user, f.campus, f.post.id);
  await assert.rejects(
    d.support(
      f.user,
      f.campus,
      f.post.id,
      { expectedVersion: latest.version, enabled: true },
      randomUUID(),
    ),
    code('NOT_FOUND'),
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'SUPPORT').length, 0);
});
test('discussion HTTP endpoints keep authentication/idempotency/input validation and enforce configured write quotas', async () => {
  const f = await setup(),
    d = f.discussion,
    campus = (await f.store.get(f.config.CORE_TABLE, keys.campus(f.campus)))!;
  f.store.seed(f.config.CORE_TABLE, { ...campus, quotas: { repliesPerHour: 1 } });
  await d.create(
    f.user,
    f.campus,
    f.post.id,
    { body: 'Allowed once', scope: 'PUBLIC' },
    randomUUID(),
  );
  await assert.rejects(
    d.create(f.user, f.campus, f.post.id, { body: 'Too many', scope: 'PUBLIC' }, randomUUID()),
    code('REPLY_QUOTA_REACHED'),
  );
  const app = createApp({
      identity: f.service,
      auth: {
        authenticate: async () => ({ sub: f.user, token: 'synthetic' }),
        identity: async () => ({ sub: f.user, email: 'alice@example.test', emailVerified: true }),
      },
    }),
    url = `/api/v1/campuses/${f.campus}/posts/${f.post.id}/replies`;
  assert.equal(
    (
      await app.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'No key', scope: 'PUBLIC' }),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await app.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ body: 'Spoofed', scope: 'PUBLIC', authorId: f.owner }),
      })
    ).status,
    422,
  );
  assert.equal((await app.request(url)).status, 200);
});

test('reply commit rejects revoked author without writing body, quota or event', async () => {
  const f = await setup(),
    original = f.store.transact.bind(f.store),
    before = [...f.store.items.values()].length;
  f.store.transact = async (writes) => {
    if (writes.some((w) => w.item?.entityType === 'REPLY'))
      f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2 });
    return original(writes);
  };
  await assert.rejects(
    f.discussion.create(
      f.user,
      f.campus,
      f.post.id,
      { body: 'Should never commit', scope: 'PUBLIC' },
      randomUUID(),
    ),
    code('NOT_FOUND'),
  );
  assert.equal([...f.store.items.values()].length, before);
  assert.equal(
    [...f.store.items.values()].some((i) => i.entityType === 'REPLY'),
    false,
  );
});
