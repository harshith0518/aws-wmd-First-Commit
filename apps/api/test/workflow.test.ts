import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { issueFixture } from './issue-fixture.js';
import { WorkflowService } from '../src/workflow.js';
import { keys } from '../src/data/keys.js';
import { queueQuerySchema, type Issue, type IssueCommand } from '@campusfix/contracts';
import { ApiError } from '../src/errors.js';
import { createApp } from '../src/app.js';
const next = () => ({
  nextAction: 'Inspect the access point.',
  nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
});
const resolution = {
  symptom: 'Shared Wi-Fi unavailable.',
  action: 'Replaced the failed access point.',
  outcome: 'Connection verified by the owner.',
  evidenceOmissionReason: 'No safe attachment is available in this text-only test.',
};
async function setup() {
  const f = issueFixture();
  const w = new WorkflowService(f.issues);
  const issue = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  return { ...f, w, issue };
}
async function advance(f: Awaited<ReturnType<typeof setup>>) {
  let i = await f.w.command(
    f.owner,
    f.campus,
    f.issue.id,
    { expectedVersion: f.issue.version, action: 'acknowledge', ...next() },
    randomUUID(),
  );
  i = await f.w.command(
    f.owner,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'start', ...next() },
    randomUUID(),
  );
  return f.w.command(
    f.owner,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'propose-resolution', resolution },
    randomUUID(),
  );
}
const code = (expected: string) => (e: unknown) => e instanceof ApiError && e.code === expected;
test('owner-to-reporter resolution loop preserves deadlines, history and invalidated prior attempts', async () => {
  const f = await setup(),
    ackDue = f.issue.detail.ackDueAt;
  let i = await advance(f);
  assert.equal(i.detail.status, 'PROPOSED_RESOLVED');
  assert.equal(i.detail.nextAction, 'Reporter to review the proposed resolution.');
  assert.equal(i.detail.nextUpdateAt, undefined);
  assert.equal(i.detail.ackDueAt, ackDue);
  assert.ok((await f.issues.getIssue(f.user, f.campus, i.id)).capabilities.includes('CONFIRM'));
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      i.id,
      {
        expectedVersion: i.version,
        action: 'confirm',
        resolutionId: i.detail.currentResolution!.id,
      },
      randomUUID(),
    ),
    code('ACTION_FORBIDDEN'),
  );
  const first = i.detail.currentResolution!.id;
  i = await f.w.command(
    f.user,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'confirm', resolutionId: first },
    randomUUID(),
  );
  assert.equal(i.detail.status, 'CONFIRMED_CLOSED');
  assert.equal(i.detail.nextAction, undefined);
  assert.equal(i.detail.nextUpdateAt, undefined);
  assert.equal(i.detail.currentResolution!.confirmedBy?.id, f.user);
  assert.equal(
    (await f.w.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: f.unit }))).items.length,
    0,
  );
  i = await f.w.command(
    f.user,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'reopen', reason: 'The problem returned after an hour.' },
    randomUUID(),
  );
  assert.equal(i.detail.currentResolution!.state, 'INVALIDATED');
  assert.equal(i.detail.ackDueAt, ackDue);
  assert.equal(
    (await f.w.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: f.unit }))).items.length,
    1,
  );
  i = await f.w.command(
    f.owner,
    f.campus,
    i.id,
    {
      expectedVersion: i.version,
      action: 'propose-resolution',
      resolution: { ...resolution, action: 'Replaced the faulty power supply.' },
    },
    randomUUID(),
  );
  assert.notEqual(i.detail.currentResolution!.id, first);
  const attempts = await f.w.resolutions(f.user, f.campus, i.id, 25);
  assert.equal(attempts.items.length, 2);
  assert.equal(attempts.items.find((r) => r.id === first)!.state, 'INVALIDATED');
  const history = await f.w.history(f.user, f.campus, i.id, 25);
  assert.equal(history.items.length, 7);
  assert.equal(history.items.find((e) => e.eventType === 'ISSUE_CONFIRM')!.actor!.id, f.user);
  assert.ok(history.items.some((e) => e.reason === 'The problem returned after an hour.'));
});
test('workflow rejects wrong actor, wrong state, stale version, expired times, unknown fields and unavailable evidence', async () => {
  const f = await setup();
  await assert.rejects(
    f.w.command(
      f.user,
      f.campus,
      f.issue.id,
      { expectedVersion: 1, action: 'acknowledge', ...next() },
      randomUUID(),
    ),
    code('ACTION_FORBIDDEN'),
  );
  await assert.rejects(
    f.w.command(
      f.bob,
      f.campus,
      f.issue.id,
      { expectedVersion: 1, action: 'acknowledge', ...next() },
      randomUUID(),
    ),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      { expectedVersion: 1, action: 'start', ...next() },
      randomUUID(),
    ),
    code('INVALID_TRANSITION'),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      { expectedVersion: 2, action: 'acknowledge', ...next() },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      {
        expectedVersion: 1,
        action: 'acknowledge',
        ...next(),
        nextUpdateAt: '2000-01-01T00:00:00Z',
      },
      randomUUID(),
    ),
    code('INVALID_NEXT_UPDATE'),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      { expectedVersion: 1, action: 'acknowledge', ...next(), primaryOwnerId: f.bob },
      randomUUID(),
    ),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      {
        expectedVersion: 1,
        action: 'progress',
        ...next(),
        update: 'Inspecting',
        attachmentIds: [randomUUID()],
      },
      randomUUID(),
    ),
    code('FILE_NOT_READY'),
  );
  assert.equal((await f.issues.getIssue(f.user, f.campus, f.issue.id)).version, 1);
});
test('wait, resume and progress retain accountability and original deadlines', async () => {
  const f = await setup();
  let i = await f.w.command(
    f.owner,
    f.campus,
    f.issue.id,
    { expectedVersion: 1, action: 'acknowledge', ...next() },
    randomUUID(),
  );
  i = await f.w.command(
    f.owner,
    f.campus,
    i.id,
    {
      expectedVersion: i.version,
      action: 'wait',
      reason: 'Replacement part is pending.',
      nextUpdateAt: next().nextUpdateAt,
    },
    randomUUID(),
  );
  assert.equal(i.detail.status, 'WAITING');
  assert.equal(i.detail.waitingReason, 'Replacement part is pending.');
  i = await f.w.command(
    f.owner,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'progress', update: 'Part dispatched.', ...next() },
    randomUUID(),
  );
  assert.equal(i.detail.status, 'WAITING');
  i = await f.w.command(
    f.owner,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'resume', ...next() },
    randomUUID(),
  );
  assert.equal(i.detail.status, 'IN_PROGRESS');
  assert.equal(i.detail.waitingReason, undefined);
  assert.equal(i.detail.updateDueAt, f.issue.detail.updateDueAt);
  const h = await f.w.history(f.user, f.campus, i.id, 25);
  assert.ok(
    h.items.some((e) =>
      e.changes?.some((c) => c.field === 'progress' && c.after === 'Part dispatched.'),
    ),
  );
});
test('concurrent command replay has one event/outbox; conflicting stale commands cannot both win', async () => {
  const f = await setup(),
    key = randomUUID(),
    data = { expectedVersion: 1, action: 'acknowledge', ...next() };
  const [a, b] = await Promise.all([
    f.w.command(f.owner, f.campus, f.issue.id, data, key),
    f.w.command(f.owner, f.campus, f.issue.id, data, key),
  ]);
  assert.equal(a.version, 2);
  assert.equal(b.version, 2);
  assert.equal(
    (await f.w.history(f.user, f.campus, a.id, 25)).items.filter(
      (e) => e.eventType === 'ISSUE_ACKNOWLEDGE',
    ).length,
    1,
  );
  assert.equal([...f.store.items.values()].filter((i) => i.kind === 'ISSUE_ACKNOWLEDGE').length, 1);
  await assert.rejects(
    f.w.command(f.owner, f.campus, a.id, { ...data, nextAction: 'Different' }, key),
    code('IDEMPOTENCY_CONFLICT'),
  );
  const results = await Promise.allSettled([
    f.w.command(
      f.owner,
      f.campus,
      a.id,
      { expectedVersion: 2, action: 'start', ...next() },
      randomUUID(),
    ),
    f.w.command(
      f.owner,
      f.campus,
      a.id,
      {
        expectedVersion: 2,
        action: 'wait',
        reason: 'Dependency',
        nextUpdateAt: next().nextUpdateAt,
      },
      randomUUID(),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('role revocation during workflow commit prevents source, event and resolution mutation', async () => {
  const f = await setup(),
    original = f.store.transact.bind(f.store);
  let intercepted = false;
  f.store.transact = async (writes) => {
    if (!intercepted) {
      intercepted = true;
      const m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
      f.store.seed(f.config.CORE_TABLE, { ...m, version: 2, authVersion: 2, roles: [] });
    }
    return original(writes);
  };
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.issue.id,
      { expectedVersion: 1, action: 'acknowledge', ...next() },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  assert.equal((await f.issues.getIssue(f.user, f.campus, f.issue.id)).version, 1);
  assert.equal(
    [...f.store.items.values()].filter((i) => i.eventType === 'ISSUE_ACKNOWLEDGE').length,
    0,
  );
});
test('resolution confirmation binds the current attempt and requires an evidence omission explanation', async () => {
  const f = await setup();
  let i = await advance(f);
  await assert.rejects(
    f.w.command(
      f.user,
      f.campus,
      i.id,
      { expectedVersion: i.version, action: 'confirm', resolutionId: randomUUID() },
      randomUUID(),
    ),
    code('RESOLUTION_CHANGED'),
  );
  i = await f.w.command(
    f.user,
    f.campus,
    i.id,
    { expectedVersion: i.version, action: 'reopen', reason: 'Still broken' },
    randomUUID(),
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      i.id,
      {
        expectedVersion: i.version,
        action: 'propose-resolution',
        resolution: { symptom: 'No connection', action: 'Restarted', outcome: 'Online' },
      },
      randomUUID(),
    ),
    code('EVIDENCE_REASON_REQUIRED'),
  );
  assert.equal((await f.w.resolutions(f.user, f.campus, i.id, 25)).items[0]!.state, 'INVALIDATED');
});
test('history skips private draft events for handlers, binds cursors and rechecks narrowed access', async () => {
  const f = issueFixture(),
    w = new WorkflowService(f.issues);
  const d = await f.issues.createDraft(
    f.user,
    f.campus,
    { type: 'ISSUE', title: 'Private notes' },
    randomUUID(),
  );
  const i = await f.issues.publish(
    f.user,
    f.campus,
    { expectedVersion: 1, payload: f.input },
    randomUUID(),
    d.id,
  );
  assert.equal(
    (await w.history(f.owner, f.campus, i.id, 25)).items.some(
      (e) => e.eventType === 'DRAFT_CREATED',
    ),
    false,
  );
  assert.equal(
    (await w.history(f.user, f.campus, i.id, 25)).items.some(
      (e) => e.eventType === 'DRAFT_CREATED',
    ),
    true,
  );
  const first = await w.history(f.user, f.campus, i.id, 1);
  assert.ok(first.nextCursor);
  await assert.rejects(
    w.history(f.owner, f.campus, i.id, 1, first.nextCursor!),
    code('INVALID_CURSOR'),
  );
  await assert.rejects(w.history(f.bob, f.campus, i.id, 25));
  await assert.rejects(w.resolutions(f.bob, f.campus, i.id, 25));
});
test('queue checks active scoped roles, canonical membership and current owner/state', async () => {
  const f = await setup();
  assert.equal(
    (await f.w.queue(f.owner, f.campus, queueQuerySchema.parse({}))).items[0]?.id,
    f.issue.id,
  );
  await assert.rejects(
    f.w.queue(f.user, f.campus, queueQuerySchema.parse({ unitId: f.unit })),
    code('QUEUE_FORBIDDEN'),
  );
  await assert.rejects(
    f.w.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: randomUUID() })),
    code('QUEUE_FORBIDDEN'),
  );
  assert.equal(
    (await f.w.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: f.unit, tab: 'OVERDUE' })))
      .items.length,
    0,
  );
  await advance(f);
  assert.equal(
    (
      await f.w.queue(
        f.owner,
        f.campus,
        queueQuerySchema.parse({ unitId: f.unit, tab: 'AWAITING_CONFIRMATION' }),
      )
    ).items.length,
    1,
  );
  const m = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
  f.store.seed(f.config.CORE_TABLE, { ...m, roles: [], version: 2, authVersion: 2 });
  await assert.rejects(
    f.w.queue(f.owner, f.campus, queueQuerySchema.parse({ unitId: f.unit })),
    code('QUEUE_FORBIDDEN'),
  );
});
test('command HTTP route rejects spoofing and missing idempotency then serializes the real transition', async () => {
  const f = await setup();
  const app = createApp({
    identity: f.service,
    auth: {
      authenticate: async () => ({ sub: f.owner, token: 'synthetic' }),
      identity: async () => ({ sub: f.owner, email: 'owner@example.test', emailVerified: true }),
    },
  });
  const url = `/api/v1/campuses/${f.campus}/issues/${f.issue.id}/commands`;
  const body = { expectedVersion: 1, action: 'acknowledge', ...next() };
  assert.equal(
    (
      await app.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await app.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ ...body, actorId: f.user }),
      })
    ).status,
    422,
  );
  const response = await app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as Issue).detail.status, 'ACKNOWLEDGED');
});
