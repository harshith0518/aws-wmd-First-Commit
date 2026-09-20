import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { knowledgeFixture } from './knowledge-fixture.js';
import { knowledgeKey, keywords, overlap } from '../src/knowledge.js';
import { keys } from '../src/data/keys.js';
import { ApiError } from '../src/errors.js';
import { knowledgeQuerySchema } from '@campusfix/contracts';
import { createApp } from '../src/app.js';
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;
test('library curator creation requires confirmed source and current role; retries preserve one card, history and outbox', async () => {
  const f = await knowledgeFixture(false),
    key = randomUUID();
  await assert.rejects(
    f.k.create(f.user, f.campus, f.knowledgeInput, randomUUID()),
    code('CURATION_FORBIDDEN'),
  );
  const [a, b] = await Promise.all([
    f.k.create(f.owner, f.campus, f.knowledgeInput, key),
    f.k.create(f.owner, f.campus, f.knowledgeInput, key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.state, 'ACTIVE');
  await assert.rejects(
    f.k.create(f.owner, f.campus, f.knowledgeInput, randomUUID()),
    code('KNOWLEDGE_EXISTS'),
  );
  await assert.rejects(
    f.k.create(f.owner, f.campus, { ...f.knowledgeInput, fix: 'Changed' }, key),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'KNOWLEDGE').length, 1);
  assert.equal([...f.store.items.values()].filter((i) => i.kind === 'KNOWLEDGE_CREATED').length, 1);
  assert.equal(
    (await f.w.history(f.user, f.campus, f.post.id, 25)).items.some(
      (e) => e.eventType === 'KNOWLEDGE_CREATED',
    ),
    false,
  );
});
test('knowledge direct reads, search and cursors obey current source campus/group/revocation checks', async () => {
  const f = await knowledgeFixture(),
    q = knowledgeQuerySchema.parse({ categoryId: f.category, query: 'router adapter' });
  assert.equal((await f.k.search(f.user, f.campus, q)).items[0]?.id, f.card!.id);
  assert.equal((await f.k.search(f.bob, f.campus, q)).items.length, 0);
  await assert.rejects(f.k.get(f.bob, f.campus, f.card!.id));
  await assert.rejects(f.k.get(f.user, f.otherCampus, f.card!.id));
  const m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.user)))!;
  f.store.seed(f.config.CORE_TABLE, { ...m, version: 2, authVersion: 2, status: 'REVOKED' });
  await assert.rejects(f.k.get(f.user, f.campus, f.card!.id));
  await assert.rejects(f.k.search(f.user, f.campus, q));
});
test('student stale flag withdraws discovery pointers; curator review restores one current set and retirement cannot be undone', async () => {
  const f = await knowledgeFixture();
  let card = f.card!;
  const count = () =>
    [...f.store.items.values()].filter((i) => i.canonicalPk === knowledgeKey(f.campus, card.id).pk)
      .length;
  assert.equal(count(), 3);
  card = await f.k.command(
    f.user,
    f.campus,
    card.id,
    {
      action: 'mark-stale',
      expectedVersion: card.version,
      reason: 'The adapter model has changed.',
    },
    randomUUID(),
  );
  assert.equal(card.state, 'STALE');
  assert.equal(count(), 0);
  await assert.rejects(
    f.k.command(
      f.user,
      f.campus,
      card.id,
      {
        action: 'review',
        expectedVersion: card.version,
        reason: 'Attempt',
        reviewDueAt: f.knowledgeInput.reviewDueAt,
      },
      randomUUID(),
    ),
    code('CURATION_FORBIDDEN'),
  );
  card = await f.k.command(
    f.owner,
    f.campus,
    card.id,
    {
      action: 'review',
      expectedVersion: card.version,
      reason: 'Checked the current replacement specification.',
      reviewDueAt: f.knowledgeInput.reviewDueAt,
    },
    randomUUID(),
  );
  assert.equal(card.state, 'ACTIVE');
  assert.equal(count(), 3);
  card = await f.k.command(
    f.owner,
    f.campus,
    card.id,
    { action: 'retire', expectedVersion: card.version, reason: 'Equipment removed permanently.' },
    randomUUID(),
  );
  assert.equal(card.state, 'REVOKED');
  assert.equal(count(), 0);
  await assert.rejects(
    f.k.command(
      f.owner,
      f.campus,
      card.id,
      {
        action: 'review',
        expectedVersion: card.version,
        reason: 'Attempt revive',
        reviewDueAt: f.knowledgeInput.reviewDueAt,
      },
      randomUUID(),
    ),
    code('INVALID_TRANSITION'),
  );
});
test('reopened, changed and expired resolutions are excluded before search output', async () => {
  const f = await knowledgeFixture(),
    q = knowledgeQuerySchema.parse({ categoryId: f.category });
  const key = knowledgeKey(f.campus, f.card!.id),
    row = (await f.store.get(f.config.CORE_TABLE, key))!;
  f.store.seed(f.config.CORE_TABLE, { ...row, reviewDueAt: '2000-01-01T00:00:00Z' });
  assert.equal((await f.k.get(f.user, f.campus, f.card!.id)).state, 'STALE');
  assert.equal((await f.k.search(f.user, f.campus, q)).items.length, 0);
  f.store.seed(f.config.CORE_TABLE, row);
  await f.w.command(
    f.user,
    f.campus,
    f.post.id,
    { action: 'reopen', expectedVersion: f.post.version, reason: 'Fault returned' },
    randomUUID(),
  );
  await assert.rejects(f.k.get(f.user, f.campus, f.card!.id));
  assert.equal((await f.k.search(f.user, f.campus, q)).items.length, 0);
  await assert.rejects(f.k.create(f.owner, f.campus, f.knowledgeInput, randomUUID()));
});
test('source mutation during curation and revocation during response serialization fail closed', async () => {
  const f = await knowledgeFixture(false),
    transact = f.store.transact.bind(f.store);
  let intercepted = false;
  f.store.transact = async (writes) => {
    if (!intercepted) {
      intercepted = true;
      const p = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, f.post.id)))!;
      f.store.seed(f.config.CORE_TABLE, { ...p, version: Number(p.version) + 1 });
    }
    return transact(writes);
  };
  await assert.rejects(
    f.k.create(f.owner, f.campus, f.knowledgeInput, randomUUID()),
    code('VERSION_CONFLICT'),
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'KNOWLEDGE').length, 0);
  const g = await knowledgeFixture(),
    dto = g.k.dto.bind(g.k);
  g.k.dto = async (...args) => {
    const output = await dto(...args);
    const m = (await g.store.get(g.config.CORE_TABLE, keys.member(g.campus, g.user)))!;
    g.store.seed(g.config.CORE_TABLE, { ...m, status: 'REVOKED', version: 2, authVersion: 2 });
    return output;
  };
  await assert.rejects(g.k.get(g.user, g.campus, g.card!.id));
});
test('rereview follows canonical version changes and replaces old review-date pointers without growing the index', async () => {
  const f = await knowledgeFixture(),
    post = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, f.post.id)))!;
  f.store.seed(f.config.CORE_TABLE, { ...post, version: Number(post.version) + 1 });
  assert.equal((await f.k.get(f.owner, f.campus, f.card!.id)).state, 'STALE');
  const a = await f.k.command(
    f.owner,
    f.campus,
    f.card!.id,
    {
      expectedVersion: 1,
      action: 'review',
      reviewDueAt: f.knowledgeInput.reviewDueAt,
      reason: 'Verified after metadata change.',
    },
    randomUUID(),
  );
  assert.equal(a.sourceVersion, Number(post.version) + 1);
  assert.equal(a.state, 'ACTIVE');
  assert.equal(
    [...f.store.items.values()].filter((i) => i.canonicalPk === knowledgeKey(f.campus, a.id).pk)
      .length,
    3,
  );
});
test('library pagination binds filters/actor, revalidates each page and bounds discovery to 100 candidates', async () => {
  const f = await knowledgeFixture(),
    card = (await f.store.get(f.config.CORE_TABLE, knowledgeKey(f.campus, f.card!.id)))!;
  // Historical synthetic cards share one valid source for this pagination stress test only.
  for (let i = 0; i < 110; i++) {
    const id = randomUUID(),
      key = knowledgeKey(f.campus, id),
      date = new Date(Date.now() + i + 1).toISOString();
    f.store.seed(f.config.CORE_TABLE, { ...card, ...key, id, createdAt: date, reviewedAt: date });
    f.store.seed(f.config.DISCOVERY_TABLE, {
      pk: `C#${f.campus}#KNOW#${f.category}#AUD#GROUP#${f.hostel}`,
      sk: `${date}#${id}`,
      canonicalPk: key.pk,
      canonicalSk: 'META',
      version: 1,
    });
  }
  let examined = 0;
  const query = f.store.query.bind(f.store);
  f.store.query = async (q) => {
    const p = await query(q);
    if (q.table === f.config.DISCOVERY_TABLE) examined += p.items.length;
    return p;
  };
  const q = knowledgeQuerySchema.parse({ categoryId: f.category, limit: 1 }),
    a = await f.k.search(f.user, f.campus, q);
  assert.ok(a.nextCursor);
  assert.equal(a.candidateLimitReached, true);
  assert.ok(examined <= 100);
  await assert.rejects(
    f.k.search(f.owner, f.campus, { ...q, cursor: a.nextCursor! }),
    code('INVALID_CURSOR'),
  );
  await assert.rejects(
    f.k.search(f.user, f.campus, { ...q, query: 'Changed', cursor: a.nextCursor! }),
    code('INVALID_CURSOR'),
  );
  const b = await f.k.search(f.user, f.campus, { ...q, cursor: a.nextCursor! });
  assert.notEqual(a.items[0]?.id, b.items[0]?.id);
  await f.w.command(
    f.user,
    f.campus,
    f.post.id,
    {
      action: 'reopen',
      expectedVersion: f.post.version,
      reason: 'Source invalidated between pages',
    },
    randomUUID(),
  );
  assert.equal(
    (await f.k.search(f.user, f.campus, { ...q, cursor: a.nextCursor! })).items.length,
    0,
  );
});
test('library HTTP operations validate authentication contracts and reject spoofed curator fields', async () => {
  const f = await knowledgeFixture(false),
    app = createApp({
      identity: f.service,
      auth: {
        authenticate: async () => ({ sub: f.owner, token: 'synthetic' }),
        identity: async () => ({ sub: f.owner, email: 'owner@example.test', emailVerified: true }),
      },
    }),
    url = `/api/v1/campuses/${f.campus}/knowledge`;
  const call = (body: unknown) =>
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(body),
    });
  assert.equal((await call({ ...f.knowledgeInput, reviewerId: f.user })).status, 422);
  assert.equal((await call(f.knowledgeInput)).status, 201);
  assert.equal((await app.request(`${url}?categoryId=${f.category}`)).status, 200);
  assert.deepEqual([...keywords('The ＲＯＵＴＥＲ and router')], ['router']);
  assert.equal(overlap('router power', 'Router power supply failed'), 2);
});
