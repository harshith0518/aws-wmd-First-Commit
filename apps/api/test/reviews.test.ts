import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reviewFixture } from './review-fixture.js';
import { keys } from '../src/data/keys.js';
import { ApiError } from '../src/errors.js';
import { WorkflowService } from '../src/workflow.js';
import { OwnershipService } from '../src/ownership.js';
import { ReviewService } from '../src/reviews.js';
const code = (name: string) => (e: unknown) => e instanceof ApiError && e.code === name;
const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
test('service review selects independent fallback, uses its own private history and cannot be read by source owner or other campus', async () => {
  const f = await reviewFixture(),
    review = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  assert.equal(review.reviewer?.id, f.reviewer);
  assert.equal(review.state, 'OPEN');
  assert.equal((await f.reviews.list(f.reviewer, f.campus, 25)).items[0]?.id, review.id);
  assert.equal((await f.reviews.list(f.owner, f.campus, 25)).items.length, 0);
  await assert.rejects(f.reviews.get(f.owner, f.campus, review.id), code('NOT_FOUND'));
  await assert.rejects(f.reviews.get(f.user, f.otherCampus, review.id), code('NOT_FOUND'));
  await assert.rejects(f.issues.getIssue(f.reviewer, f.campus, f.post.id), code('NOT_FOUND'));
  const history = await new WorkflowService(f.issues).history(f.owner, f.campus, f.post.id, 25);
  assert.equal(
    history.items.some((e) => e.eventType.startsWith('SERVICE_REVIEW')),
    false,
  );
  assert.equal(
    [...f.store.items.values()].find((i) => i.kind === 'SERVICE_REVIEW_CREATED')?.sourceKind,
    'REVIEW',
  );
});
test('conflicted or unconfigured reviewer stays escalated and named subjects cannot be selected', async () => {
  const f = await reviewFixture(false),
    r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  assert.equal(r.state, 'ESCALATED');
  assert.equal(r.reviewer, undefined);
  const another = await reviewFixture();
  const excluded = await another.reviews.create(
    another.user,
    another.campus,
    { ...another.reviewInput, subjectId: another.reviewer },
    randomUUID(),
  );
  assert.equal(excluded.state, 'ESCALATED');
  await assert.rejects(
    another.reviews.get(another.reviewer, another.campus, excluded.id),
    code('NOT_FOUND'),
  );
});
test('active review uniqueness, concurrent idempotency, quota and duplicate bodies remain atomic', async () => {
  const f = await reviewFixture(),
    key = randomUUID(),
    rs = await Promise.all([
      f.reviews.create(f.user, f.campus, f.reviewInput, key),
      f.reviews.create(f.user, f.campus, f.reviewInput, key),
    ]);
  assert.equal(rs[0]!.id, rs[1]!.id);
  assert.equal(
    [...f.store.items.values()].filter((i) => i.entityType === 'SERVICE_REVIEW').length,
    1,
  );
  await assert.rejects(
    f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID()),
    code('ACTIVE_REVIEW_EXISTS'),
  );
  await assert.rejects(
    f.reviews.create(f.user, f.campus, { ...f.reviewInput, description: 'Changed' }, key),
    code('IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    f.reviews.create(f.user, f.campus, { ...f.reviewInput, reviewerId: f.user }, randomUUID()),
  );
});
test('complainant responses and reviewer notes stay separate; revocation removes current and replay access', async () => {
  const f = await reviewFixture(),
    r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  await f.reviews.respond(
    f.user,
    f.campus,
    r.id,
    { body: 'Additional description', visibility: 'COMPLAINANT_REVIEWERS' },
    randomUUID(),
  );
  const input = { body: 'Private independent analysis', visibility: 'REVIEWERS' },
    key = randomUUID();
  await f.reviews.respond(f.reviewer, f.campus, r.id, input, key);
  assert.equal((await f.reviews.children(f.user, f.campus, r.id, 'RESPONSE', 25)).items.length, 1);
  assert.equal(
    (await f.reviews.children(f.reviewer, f.campus, r.id, 'RESPONSE', 25)).items.length,
    2,
  );
  assert.equal((await f.reviews.children(f.user, f.campus, r.id, 'EVENT', 25)).items.length, 2);
  await assert.rejects(
    f.reviews.respond(f.user, f.campus, r.id, input, randomUUID()),
    code('REVIEWER_REQUIRED'),
  );
  const m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.reviewer)))!;
  f.store.seed(f.config.CORE_TABLE, { ...m, roles: [], version: 2 });
  await assert.rejects(
    f.reviews.respond(f.reviewer, f.campus, r.id, input, key),
    code('NOT_FOUND'),
  );
});
test('independent decisions require review state, reason and appeal window; closure permits a later concern', async () => {
  const f = await reviewFixture();
  let r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  await assert.rejects(
    f.reviews.command(
      f.user,
      f.campus,
      r.id,
      { expectedVersion: r.version, action: 'begin', nextUpdateAt: future() },
      randomUUID(),
    ),
    code('REVIEWER_REQUIRED'),
  );
  await assert.rejects(
    f.reviews.command(
      f.reviewer,
      f.campus,
      r.id,
      {
        expectedVersion: r.version,
        action: 'decide',
        decisionOutcome: 'RESPONSE_UPHELD',
        decisionReason: 'Checked',
        appealDeadline: future(15),
      },
      randomUUID(),
    ),
    code('INVALID_TRANSITION'),
  );
  r = await f.reviews.command(
    f.reviewer,
    f.campus,
    r.id,
    { expectedVersion: r.version, action: 'begin', nextUpdateAt: future() },
    randomUUID(),
  );
  await assert.rejects(
    f.reviews.command(
      f.reviewer,
      f.campus,
      r.id,
      {
        expectedVersion: 1,
        action: 'decide',
        decisionOutcome: 'RESPONSE_UPHELD',
        decisionReason: 'Checked',
        appealDeadline: future(15),
      },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  await assert.rejects(
    f.reviews.command(
      f.reviewer,
      f.campus,
      r.id,
      {
        expectedVersion: r.version,
        action: 'decide',
        decisionOutcome: 'RESPONSE_UPHELD',
        decisionReason: 'Checked',
        appealDeadline: future(1),
      },
      randomUUID(),
    ),
    code('INVALID_APPEAL_DEADLINE'),
  );
  r = await f.reviews.command(
    f.reviewer,
    f.campus,
    r.id,
    {
      expectedVersion: r.version,
      action: 'decide',
      decisionOutcome: 'INSUFFICIENT_EVIDENCE',
      decisionReason: 'Independent verification could not establish the concern.',
      appealDeadline: future(15),
    },
    randomUUID(),
  );
  assert.equal(r.state, 'CLOSED');
  assert.equal(r.decisionOutcome, 'INSUFFICIENT_EVIDENCE');
  assert.equal(
    [...f.store.items.values()].filter((i) => i.entityType === 'REVIEW_DECISION').length,
    1,
  );
  await assert.rejects(
    f.reviews.respond(
      f.user,
      f.campus,
      r.id,
      { body: 'Too late', visibility: 'COMPLAINANT_REVIEWERS' },
      randomUUID(),
    ),
    code('REVIEW_CLOSED'),
  );
  assert.equal(
    (await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID())).state,
    'OPEN',
  );
});
test('upheld concern preserves corrective action and independent remedy verification as separate decisions', async () => {
  const f = await reviewFixture();
  let r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  r = await f.reviews.command(
    f.reviewer,
    f.campus,
    r.id,
    { expectedVersion: r.version, action: 'begin', nextUpdateAt: future() },
    randomUUID(),
  );
  r = await f.reviews.command(
    f.reviewer,
    f.campus,
    r.id,
    {
      expectedVersion: r.version,
      action: 'require-action',
      decisionOutcome: 'COMPLAINT_UPHELD',
      decisionReason: 'Repair incomplete',
      correctiveAction: 'Inspect the second access point and verify connectivity.',
      correctiveOwnerId: f.owner,
      dueAt: future(2),
    },
    randomUUID(),
  );
  assert.equal(r.state, 'ACTION_REQUIRED');
  await assert.rejects(f.reviews.get(f.owner, f.campus, r.id), code('NOT_FOUND'));
  r = await f.reviews.command(
    f.reviewer,
    f.campus,
    r.id,
    {
      expectedVersion: r.version,
      action: 'close',
      decisionReason: 'Verified both access points with the complainant.',
      appealDeadline: future(15),
    },
    randomUUID(),
  );
  assert.equal(r.decisionOutcome, 'COMPLAINT_UPHELD');
  assert.equal(r.state, 'CLOSED');
  assert.equal(
    [...f.store.items.values()].filter((i) => i.entityType === 'REVIEW_DECISION').length,
    2,
  );
});
test('past handlers remain excluded after reassignment and a newly assigned handler cannot decide an existing review', async () => {
  const f = await reviewFixture(),
    m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.reviewer)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...m,
    roles: [
      ...(m.roles as object[]),
      {
        id: randomUUID(),
        role: 'HANDLER',
        scope: 'UNIT',
        scopeId: f.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID()),
    o = new OwnershipService(f.issues);
  let p = await o.assign(
    f.owner,
    f.campus,
    f.post.id,
    { expectedVersion: f.post.version, collaboratorIds: [f.reviewer], reason: 'Now involved' },
    randomUUID(),
  );
  await assert.rejects(f.reviews.get(f.reviewer, f.campus, r.id), code('NOT_FOUND'));
  p = await o.assign(
    f.owner,
    f.campus,
    p.id,
    { expectedVersion: p.version, collaboratorIds: [], reason: 'No longer assigned' },
    randomUUID(),
  );
  await assert.rejects(f.reviews.get(f.reviewer, f.campus, r.id), code('NOT_FOUND'));
  assert.equal((await f.reviews.get(f.user, f.campus, r.id)).state, 'OPEN');
});
test('reviewer revocation at decision commit prevents all decision/history changes', async () => {
  const f = await reviewFixture();
  let r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  const m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.reviewer)))!,
    original = f.store.transact.bind(f.store);
  f.store.transact = async (writes) => {
    if (writes.some((w) => w.item?.eventType === 'SERVICE_REVIEW_BEGIN'))
      f.store.seed(f.config.CORE_TABLE, { ...m, status: 'REVOKED', version: 2 });
    return original(writes);
  };
  await assert.rejects(
    f.reviews.command(
      f.reviewer,
      f.campus,
      r.id,
      { expectedVersion: r.version, action: 'begin', nextUpdateAt: future() },
      randomUUID(),
    ),
    code('NOT_FOUND'),
  );
  assert.equal((await f.reviews.get(f.user, f.campus, r.id)).state, 'OPEN');
});

test('only the independent reviewer can discover eligible corrective handlers through the private case', async () => {
  const f = await reviewFixture(),
    r = await f.reviews.create(f.user, f.campus, f.reviewInput, randomUUID());
  assert.equal((await f.reviews.candidates(f.reviewer, f.campus, r.id, 25)).items[0]?.id, f.owner);
  await assert.rejects(f.reviews.candidates(f.user, f.campus, r.id, 25), code('REVIEWER_REQUIRED'));
  await assert.rejects(f.reviews.candidates(f.owner, f.campus, r.id, 25), code('NOT_FOUND'));
});
