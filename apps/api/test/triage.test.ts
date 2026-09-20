import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { issueFixture } from './issue-fixture.js';
import { ownershipFixture } from './ownership-fixture.js';
import { WorkflowService } from '../src/workflow.js';
import { keys } from '../src/data/keys.js';
import { ApiError } from '../src/errors.js';
import { queueQuerySchema } from '@campusfix/contracts';
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;
async function setup() {
  const f = issueFixture(),
    w = new WorkflowService(f.issues);
  const a = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  return { ...f, w, a };
}
test('decline retains submission and deadlines, requires review route, leaves history and removes active queue entry', async () => {
  const f = await setup();
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.a.id,
      { action: 'decline', expectedVersion: 1, reason: 'Outside this service' },
      randomUUID(),
    ),
  );
  const input = {
      action: 'decline',
      expectedVersion: 1,
      reason: 'This request is outside the supported service.',
      appealContact: 'Request an independent review from this report.',
    },
    key = randomUUID();
  const a = await f.w.command(f.owner, f.campus, f.a.id, input, key);
  assert.equal(a.detail.status, 'DECLINED');
  assert.equal(a.createdAt, f.a.createdAt);
  assert.equal(a.detail.ackDueAt, f.a.detail.ackDueAt);
  assert.equal(a.detail.appealContact, input.appealContact);
  assert.ok(a.capabilities.includes('REQUEST_REVIEW'));
  assert.equal(a.capabilities.includes('DECLINE'), false);
  assert.equal((await f.w.command(f.owner, f.campus, f.a.id, input, key)).version, a.version);
  assert.equal((await f.w.queue(f.owner, f.campus, queueQuerySchema.parse({}))).items.length, 0);
  assert.equal(
    (await f.w.history(f.user, f.campus, a.id, 25)).items.filter(
      (e) => e.eventType === 'ISSUE_DECLINE',
    ).length,
    1,
  );
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      a.id,
      { action: 'set-priority', expectedVersion: 2, severity: 'HIGH', reason: 'Late' },
      randomUUID(),
    ),
    code('INVALID_TRANSITION'),
  );
});
test('priority has an attributed reason and preserves clocks; requester and ordinary collaborator cannot triage', async () => {
  const f = await ownershipFixture(),
    w = new WorkflowService(f.issues);
  let a = await f.ownership.assign(
    f.owner,
    f.campus,
    f.post.id,
    { expectedVersion: 1, collaboratorIds: [f.bob], reason: 'Joint diagnosis' },
    randomUUID(),
  );
  for (const actor of [f.user, f.bob])
    for (const input of [
      { action: 'decline', appealContact: 'Review team' },
      { action: 'set-priority', severity: 'HIGH' },
      { action: 'duplicate', targetPostId: randomUUID() },
    ])
      await assert.rejects(
        w.command(
          actor,
          f.campus,
          a.id,
          { ...input, expectedVersion: a.version, reason: 'Test reason' },
          randomUUID(),
        ),
        code('ACTION_FORBIDDEN'),
      );
  a = await w.command(
    f.owner,
    f.campus,
    a.id,
    {
      expectedVersion: a.version,
      action: 'set-priority',
      severity: 'URGENT',
      reason: 'Whole study block is affected.',
    },
    randomUUID(),
  );
  assert.equal(a.detail.severity, 'URGENT');
  assert.equal(a.detail.status, 'SUBMITTED');
  assert.equal(a.detail.updateDueAt, f.post.detail.updateDueAt);
  assert.ok(
    (await w.history(f.user, f.campus, a.id, 25)).items.some((e) =>
      e.changes?.some((c) => c.field === 'severity' && c.after === 'URGENT'),
    ),
  );
});
test('duplicate target identity is filtered for source readers without current target access', async () => {
  const f = await setup(),
    b = await f.issues.publish(
      f.bob,
      f.campus,
      { ...f.input, audience: { kind: 'GROUPS', groupIds: [f.otherHostel] } },
      randomUUID(),
    );
  const a = await f.w.command(
    f.owner,
    f.campus,
    f.a.id,
    {
      expectedVersion: 1,
      action: 'duplicate',
      targetPostId: b.id,
      reason: 'The same shared equipment serves both reports.',
    },
    randomUUID(),
  );
  assert.equal(a.detail.duplicateOf, b.id);
  assert.equal(a.createdAt, f.a.createdAt);
  assert.equal(a.detail.ackDueAt, f.a.detail.ackDueAt);
  assert.equal((await f.issues.getIssue(f.user, f.campus, a.id)).detail.duplicateOf, undefined);
  assert.equal(JSON.stringify(await f.w.history(f.user, f.campus, a.id, 25)).includes(b.id), false);
  const t = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, b.id)))!;
  f.store.seed(f.config.CORE_TABLE, { ...t, publication: 'REMOVED', version: 2 });
  assert.equal((await f.issues.getIssue(f.owner, f.campus, a.id)).detail.duplicateOf, undefined);
});
test('duplicate links reject self, missing targets and cycles; simultaneous reciprocal links have one winner', async () => {
  const f = await setup(),
    b = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  const cmd = (id: string, target: string) =>
    f.w.command(
      f.owner,
      f.campus,
      id,
      { expectedVersion: 1, action: 'duplicate', targetPostId: target, reason: 'Same equipment' },
      randomUUID(),
    );
  await assert.rejects(cmd(f.a.id, f.a.id), code('DUPLICATE_CYCLE'));
  await assert.rejects(cmd(f.a.id, randomUUID()));
  const results = await Promise.allSettled([cmd(f.a.id, b.id), cmd(b.id, f.a.id)]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  const a = await f.issues.getIssue(f.owner, f.campus, f.a.id),
    bb = await f.issues.getIssue(f.owner, f.campus, b.id);
  const root = a.detail.status === 'DUPLICATE' ? bb : a,
    child = root.id === a.id ? bb : a;
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      root.id,
      {
        expectedVersion: root.version,
        action: 'duplicate',
        targetPostId: child.id,
        reason: 'Cycle attempt',
      },
      randomUUID(),
    ),
    code('DUPLICATE_CYCLE'),
  );
});
test('target permission narrowing at duplicate commit rolls back the complete command', async () => {
  const f = await setup(),
    b = await f.issues.publish(f.user, f.campus, f.input, randomUUID()),
    original = f.store.transact.bind(f.store);
  let intercepted = false;
  f.store.transact = async (writes) => {
    if (!intercepted) {
      intercepted = true;
      const t = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, b.id)))!;
      f.store.seed(f.config.CORE_TABLE, { ...t, version: 2, publication: 'REMOVED' });
    }
    return original(writes);
  };
  await assert.rejects(
    f.w.command(
      f.owner,
      f.campus,
      f.a.id,
      { expectedVersion: 1, action: 'duplicate', targetPostId: b.id, reason: 'Same problem' },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  assert.equal((await f.issues.getIssue(f.user, f.campus, f.a.id)).detail.status, 'SUBMITTED');
  assert.equal(
    [...f.store.items.values()].filter((i) => i.eventType === 'ISSUE_DUPLICATE').length,
    0,
  );
});
test('declining cancels temporary transfer access while retaining the accountable owner', async () => {
  const f = await ownershipFixture(),
    w = new WorkflowService(f.issues);
  const p = await f.ownership.command(
    f.owner,
    f.campus,
    f.post.id,
    {
      action: 'propose-transfer',
      expectedVersion: 1,
      toUnitId: f.nextUnit,
      toOwnerId: f.bob,
      reason: 'Specialist needed',
    },
    randomUUID(),
  );
  assert.ok('detail' in p);
  const a = await w.command(
    f.owner,
    f.campus,
    f.post.id,
    {
      action: 'decline',
      expectedVersion: p.version,
      reason: 'Unsupported service',
      appealContact: 'Request independent review',
    },
    randomUUID(),
  );
  assert.equal(a.detail.pendingTransfer, undefined);
  assert.equal(a.detail.primaryOwner.id, f.owner);
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, a.id));
});

test('duplicate creation cannot cross campuses or point to an issue the actor cannot read', async () => {
  const f = await ownershipFixture(),
    w = new WorkflowService(f.issues);
  const b = await f.issues.publish(
    f.bob,
    f.campus,
    { ...f.input, unitId: f.nextUnit, audience: { kind: 'GROUPS', groupIds: [f.otherHostel] } },
    randomUUID(),
  );
  await assert.rejects(
    w.command(
      f.owner,
      f.campus,
      f.post.id,
      {
        action: 'duplicate',
        expectedVersion: 1,
        targetPostId: b.id,
        reason: 'Must not reveal another audience',
      },
      randomUUID(),
    ),
    (e) => e instanceof ApiError && e.status === 404,
  );
  const foreignId = randomUUID(),
    original = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, b.id)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...original,
    ...keys.post(f.otherCampus, foreignId),
    campusId: f.otherCampus,
    id: foreignId,
  });
  await assert.rejects(
    w.command(
      f.owner,
      f.campus,
      f.post.id,
      {
        action: 'duplicate',
        expectedVersion: 1,
        targetPostId: foreignId,
        reason: 'Must not reveal another campus',
      },
      randomUUID(),
    ),
    (e) => e instanceof ApiError && e.status === 404,
  );
  assert.equal((await f.issues.getIssue(f.user, f.campus, f.post.id)).version, 1);
});
