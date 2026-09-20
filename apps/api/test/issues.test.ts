import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { issueFeedQuerySchema } from '@campusfix/contracts';
import { issueFixture } from './issue-fixture.js';
import { ApiError } from '../src/errors.js';
import { keys } from '../src/data/keys.js';
import { discoveryKey } from '../src/issues.js';
import { workingDeadline } from '../src/calendar.js';
const code = (name: string) => (e: unknown) => e instanceof ApiError && e.code === name;
test('draft save, versioned revision and publish preserve one identity and an accountable owner', async () => {
  const f = issueFixture();
  const configuration = await f.issues.configuration(f.user, f.campus);
  assert.equal(configuration.categories[0]?.name, 'Network connectivity');
  assert.equal('verifiedDomains' in configuration, false);
  const draft = await f.issues.createDraft(
    f.user,
    f.campus,
    { type: 'ISSUE', title: 'First thought' },
    'draft-create-123456',
  );
  assert.equal((await f.issues.drafts(f.user, f.campus, 25)).items[0]?.id, draft.id);
  await assert.rejects(f.issues.getDraft(f.bob, f.campus, draft.id), code('NOT_FOUND'));
  const revised = await f.issues.updateDraft(
    f.user,
    f.campus,
    draft.id,
    { expectedVersion: 1, body: 'Revised body' },
    'draft-revise-123456',
  );
  assert.equal(revised.version, 2);
  await assert.rejects(
    f.issues.updateDraft(
      f.user,
      f.campus,
      draft.id,
      { expectedVersion: 1, title: 'Stale' },
      'draft-revise-stale',
    ),
    code('VERSION_CONFLICT'),
  );
  const result = await f.issues.publish(
    f.user,
    f.campus,
    { expectedVersion: 2, payload: f.input },
    'draft-publish-123456',
    draft.id,
  );
  assert.equal(result.id, draft.id);
  assert.equal(result.version, 3);
  assert.equal(result.detail.primaryOwner.id, f.owner);
  assert.equal(result.detail.status, 'SUBMITTED');
  assert.equal((await f.issues.drafts(f.user, f.campus, 25)).items.length, 0);
  assert.equal((await f.issues.getIssue(f.owner, f.campus, result.id)).id, result.id);
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, result.id), code('NOT_FOUND'));
  await assert.rejects(f.issues.getIssue(f.user, f.otherCampus, result.id), code('NOT_FOUND'));
  assert.equal('pk' in result, false);
  assert.equal('authorId' in result, false);
  assert.equal('primaryOwnerId' in result.detail, false);
});
test('publish retries create one post, event, outbox and each audience pointer', async () => {
  const f = issueFixture();
  const results = await Promise.all([
    f.issues.publish(f.user, f.campus, f.input, 'same-publish-key-123'),
    f.issues.publish(f.user, f.campus, f.input, 'same-publish-key-123'),
  ]);
  assert.equal(results[0]?.id, results[1]?.id);
  const items = [...f.store.items.values()];
  assert.equal(items.filter((i) => i.entityType === 'POST').length, 1);
  assert.equal(items.filter((i) => i.eventType === 'ISSUE_PUBLISHED').length, 1);
  assert.equal(items.filter((i) => i.kind === 'ISSUE_PUBLISHED').length, 1);
  assert.equal(items.filter((i) => i.canonicalPk).length, 3);
  await assert.rejects(
    f.issues.publish(f.user, f.campus, { ...f.input, title: 'Changed' }, 'same-publish-key-123'),
    code('IDEMPOTENCY_CONFLICT'),
  );
  f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2, authVersion: 2 });
  await assert.rejects(
    f.issues.publish(f.user, f.campus, f.input, 'same-publish-key-123'),
    code('NOT_FOUND'),
  );
});
test('publication rejects unauthorized groups, cross-campus references, unavailable files and ownerless teams', async () => {
  const f = issueFixture();
  await assert.rejects(
    f.issues.publish(
      f.user,
      f.campus,
      { ...f.input, audience: { kind: 'GROUPS', groupIds: [f.otherHostel] } },
      'bad-audience-123456',
    ),
    code('AUDIENCE_FORBIDDEN'),
  );
  await assert.rejects(
    f.issues.publish(
      f.user,
      f.campus,
      { ...f.input, categoryId: randomUUID() },
      'bad-category-123456',
    ),
    code('INVALID_DIRECTORY_REFERENCE'),
  );
  await assert.rejects(
    f.issues.publish(
      f.user,
      f.campus,
      { ...f.input, attachmentIds: [randomUUID()] },
      'bad-evidence-123456',
    ),
    code('UPLOADS_UNAVAILABLE'),
  );
  const owner = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
  f.store.seed(f.config.CORE_TABLE, { ...owner, status: 'REVOKED', version: 2 });
  await assert.rejects(
    f.issues.publish(f.user, f.campus, f.input, 'bad-owner-123456'),
    code('OWNER_UNAVAILABLE'),
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'POST').length, 0);
});
test('membership revocation during commit prevents the post and its derived records atomically', async () => {
  const f = issueFixture();
  const original = f.store.transact.bind(f.store);
  f.store.transact = async (writes) => {
    if (writes.some((w) => w.item?.publication === 'PUBLISHED'))
      f.store.seed(f.config.CORE_TABLE, {
        ...f.member,
        status: 'REVOKED',
        version: 2,
        authVersion: 2,
      });
    return original(writes);
  };
  await assert.rejects(
    f.issues.publish(f.user, f.campus, f.input, 'revocation-race-key'),
    code('NOT_FOUND'),
  );
  assert.equal(
    [...f.store.items.values()].filter(
      (i) => i.entityType === 'POST' || i.canonicalPk || i.eventType === 'ISSUE_PUBLISHED',
    ).length,
    0,
  );
});
test('restricted cases never enter campus/group feeds and never grant a general admin access', async () => {
  const f = issueFixture();
  const campus = (await f.store.get(f.config.CORE_TABLE, keys.campus(f.campus)))!;
  f.store.seed(f.config.CORE_TABLE, { ...campus, featureFlags: { sensitiveCases: true } });
  const owner = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...owner,
    roles: [
      {
        id: randomUUID(),
        role: 'SENSITIVE_HANDLER',
        scope: 'UNIT',
        scopeId: f.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const bob = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...bob,
    roles: [
      { id: randomUUID(), role: 'ADMIN', scope: 'CAMPUS', expiresAt: '2099-01-01T00:00:00Z' },
    ],
  });
  const post = await f.issues.publish(
    f.user,
    f.campus,
    { ...f.input, audience: { kind: 'RESTRICTED' } },
    'sensitive-case-key',
  );
  assert.equal(post.publication, 'RESTRICTED');
  assert.equal((await f.issues.getIssue(f.owner, f.campus, post.id)).id, post.id);
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, post.id), code('NOT_FOUND'));
  assert.ok(
    [...f.store.items.values()]
      .filter((i) => i.canonicalPk)
      .every((i) => i.pk.includes('#AUD#USER#')),
  );
});
test('feed merges overlapping scopes without duplicates or skipped pages and binds cursors to authorization', async () => {
  const f = issueFixture();
  const original = await f.issues.publish(
    f.user,
    f.campus,
    { ...f.input, audience: { kind: 'CAMPUS' } },
    'base-feed-post-key',
  );
  const raw = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, original.id)))!;
  for (let i = 0; i < 31; i++) {
    const id = randomUUID(),
      createdAt = new Date(Date.parse(f.now) + i * 1000).toISOString();
    const post = { ...raw, ...keys.post(f.campus, id), id, createdAt };
    f.store.seed(f.config.CORE_TABLE, post);
    for (const scope of ['CAMPUS', `USER#${f.user}`, `GROUP#${f.hostel}`])
      f.store.seed(f.config.DISCOVERY_TABLE, {
        pk: discoveryKey(f.campus, scope),
        sk: `${createdAt}#${id}`,
        canonicalPk: post.pk,
        canonicalSk: post.sk,
        sourceVersion: 1,
      });
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  let firstCursor = '';
  for (let page = 0; page < 30; page++) {
    const result = await f.issues.feed(
      f.user,
      f.campus,
      issueFeedQuerySchema.parse({ limit: 4, ...(cursor ? { cursor } : {}) }),
    );
    seen.push(...result.items.map((i) => i.id));
    if (!firstCursor && result.nextCursor) firstCursor = result.nextCursor;
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  assert.equal(seen.length, 32);
  assert.equal(new Set(seen).size, 32);
  await assert.rejects(
    f.issues.feed(f.bob, f.campus, issueFeedQuerySchema.parse({ limit: 4, cursor: firstCursor })),
    code('INVALID_CURSOR'),
  );
  f.store.seed(f.config.CORE_TABLE, { ...f.member, version: 2, authVersion: 2 });
  await assert.rejects(
    f.issues.feed(f.user, f.campus, issueFeedQuerySchema.parse({ limit: 4, cursor: firstCursor })),
    code('INVALID_CURSOR'),
  );
});
test('feed ignores stale pointers after canonical audience narrows', async () => {
  const f = issueFixture();
  const post = await f.issues.publish(
    f.user,
    f.campus,
    { ...f.input, audience: { kind: 'CAMPUS' } },
    'stale-scope-key-123',
  );
  const raw = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, post.id)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...raw,
    version: 2,
    aclVersion: 2,
    audience: { kind: 'GROUPS', groupIds: [f.hostel] },
  });
  assert.equal(
    (await f.issues.feed(f.bob, f.campus, issueFeedQuerySchema.parse({}))).items.length,
    0,
  );
});
test('creation quotas are atomic with writes and replay does not consume another quota', async () => {
  const f = issueFixture();
  for (let i = 0; i < 5; i++)
    await f.issues.createDraft(f.user, f.campus, { type: 'ISSUE' }, `draft-quota-key-${i}`);
  await f.issues.createDraft(f.user, f.campus, { type: 'ISSUE' }, 'draft-quota-key-0');
  await assert.rejects(
    f.issues.createDraft(f.user, f.campus, { type: 'ISSUE' }, 'draft-quota-key-5'),
    code('POST_QUOTA_REACHED'),
  );
  assert.equal([...f.store.items.values()].filter((i) => i.entityType === 'POST').length, 5);
});
test('working deadlines honor open hours, weekends, holidays and timezone offset changes', () => {
  const calendar = {
    timezone: 'Asia/Kolkata',
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const,
    opensAt: '09:00',
    closesAt: '17:00',
    holidays: [],
  };
  const c = { ...calendar, workingDays: [...calendar.workingDays] };
  assert.equal(workingDeadline('2026-09-18T10:30:00Z', 1, c), '2026-09-21T10:30:00.000Z');
  assert.equal(workingDeadline('2026-09-20T10:30:00Z', 1, c), '2026-09-21T11:30:00.000Z');
  assert.equal(
    workingDeadline('2026-09-18T10:30:00Z', 1, { ...c, holidays: ['2026-09-21'] }),
    '2026-09-22T10:30:00.000Z',
  );
  assert.equal(
    workingDeadline('2026-03-06T21:00:00Z', 1, { ...c, timezone: 'America/New_York' }),
    '2026-03-09T20:00:00.000Z',
  );
});

test('same-key publish recovers if another request commits between receipt lookup and draft validation', async () => {
  const f = issueFixture();
  const draft = await f.issues.createDraft(
    f.user,
    f.campus,
    { type: 'ISSUE' },
    'late-race-draft-key',
  );
  const original = f.issues.authorDraft.bind(f.issues);
  let intercept = true;
  f.issues.authorDraft = async (actor, campus, id) => {
    if (intercept) {
      intercept = false;
      await f.issues.publish(
        f.user,
        f.campus,
        { expectedVersion: 1, payload: f.input },
        'late-race-publish-key',
        draft.id,
      );
    }
    return original(actor, campus, id);
  };
  const result = await f.issues.publish(
    f.user,
    f.campus,
    { expectedVersion: 1, payload: f.input },
    'late-race-publish-key',
    draft.id,
  );
  assert.equal(result.id, draft.id);
  assert.equal(result.version, 2);
});

test('a staff member can report to their own unit without duplicate transaction actions', async () => {
  const f = issueFixture();
  const issue = await f.issues.publish(
    f.owner,
    f.campus,
    { ...f.input, audience: { kind: 'CAMPUS' } },
    'owner-as-reporter-key',
  );
  assert.equal(issue.author?.id, f.owner);
  assert.equal(issue.detail.primaryOwner.id, f.owner);
});

test('bounded feed pages return continuation after 200 filtered candidates and do not lose the remaining matches', async () => {
  const f = issueFixture();
  const first = await f.issues.publish(
    f.user,
    f.campus,
    { ...f.input, audience: { kind: 'CAMPUS' } },
    'candidate-base-key',
  );
  const raw = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, first.id)))!;
  // One scope avoids spending the candidate budget on duplicate references in this test.
  for (const [key, item] of f.store.items) if (item.canonicalPk) f.store.items.delete(key);
  for (let i = 0; i < 215; i++) {
    const id = randomUUID(),
      createdAt = new Date(Date.parse(f.now) + i * 1000).toISOString();
    const post = {
      ...raw,
      ...keys.post(f.campus, id),
      id,
      createdAt,
      title: i < 5 ? 'match me' : 'filtered',
    };
    f.store.seed(f.config.CORE_TABLE, post);
    f.store.seed(f.config.DISCOVERY_TABLE, {
      pk: discoveryKey(f.campus, 'CAMPUS'),
      sk: `${createdAt}#${id}`,
      canonicalPk: post.pk,
      canonicalSk: post.sk,
    });
  }
  const page = await f.issues.feed(
    f.user,
    f.campus,
    issueFeedQuerySchema.parse({ query: 'match me' }),
  );
  assert.equal(page.items.length, 0);
  assert.equal(page.candidateLimitReached, true);
  assert.ok(page.nextCursor);
  const next = await f.issues.feed(
    f.user,
    f.campus,
    issueFeedQuerySchema.parse({ query: 'match me', cursor: page.nextCursor }),
  );
  assert.equal(next.items.length, 5);
  assert.equal(next.nextCursor, null);
});
