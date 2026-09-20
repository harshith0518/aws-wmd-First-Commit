import { ownershipFixture as setup } from './ownership-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OwnershipService } from '../src/ownership.js';
import { WorkflowService } from '../src/workflow.js';
import { DiscussionService } from '../src/discussion.js';
import { canReadPost, postAccessSchema } from '../src/policy.js';
import { ApiError } from '../src/errors.js';
import { issueFixture } from './issue-fixture.js';
import { keys } from '../src/data/keys.js';
import { handler } from '../src/workers/workflow.js';
const code = (name: string) => (e: unknown) => e instanceof ApiError && e.code === name;
test('collaborator assignment requires scoped lead and grants/removes current post, staff-note and feed access', async () => {
  const f = await setup(),
    o = f.ownership;
  await assert.rejects(
    o.assign(
      f.user,
      f.campus,
      f.post.id,
      {
        expectedVersion: f.post.version,
        collaboratorIds: [f.bob],
        reason: 'Student forged assignment',
      },
      randomUUID(),
    ),
    code('ASSIGNMENT_FORBIDDEN'),
  );
  await assert.rejects(
    o.assign(
      f.owner,
      f.campus,
      f.post.id,
      {
        expectedVersion: f.post.version,
        primaryOwnerId: f.bob,
        collaboratorIds: [],
        reason: 'Skip acceptance',
      },
      randomUUID(),
    ),
    code('TRANSFER_REQUIRED'),
  );
  let post = await o.assign(
    f.owner,
    f.campus,
    f.post.id,
    { expectedVersion: f.post.version, collaboratorIds: [f.bob], reason: 'Joint investigation' },
    randomUUID(),
  );
  assert.equal(post.detail.collaborators[0]?.id, f.bob);
  assert.ok(
    (await f.issues.getIssue(f.bob, f.campus, post.id)).capabilities.includes('MANAGE_ISSUE'),
  );
  const note = await new DiscussionService(f.issues).create(
    f.bob,
    f.campus,
    post.id,
    { body: 'Joint staff finding', scope: 'STAFF' },
    randomUUID(),
  );
  post = await f.issues.getIssue(f.owner, f.campus, post.id);
  await o.assign(
    f.owner,
    f.campus,
    post.id,
    { expectedVersion: post.version, collaboratorIds: [], reason: 'Work complete' },
    randomUUID(),
  );
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, post.id), code('NOT_FOUND'));
  await assert.rejects(
    new DiscussionService(f.issues).get(f.bob, f.campus, post.id, note.id),
    code('NOT_FOUND'),
  );
  const candidates = await o.candidates(f.owner, f.campus, post.id, f.nextUnit, 25);
  assert.equal(
    candidates.items.some((p) => p.id === f.bob),
    true,
  );
  await assert.rejects(
    o.candidates(f.user, f.campus, post.id, f.nextUnit, 25),
    code('ASSIGNMENT_FORBIDDEN'),
  );
});
test('transfer keeps owner/age/deadlines until recipient accepts, switches queue and removes old handler access', async () => {
  const f = await setup(),
    o = f.ownership,
    input = {
      expectedVersion: f.post.version,
      action: 'propose-transfer',
      toUnitId: f.nextUnit,
      toOwnerId: f.bob,
      reason: 'Maintenance owns the switch',
    },
    key = randomUUID();
  const results = await Promise.all([
    o.command(f.owner, f.campus, f.post.id, input, key),
    o.command(f.owner, f.campus, f.post.id, input, key),
  ]);
  assert.ok('detail' in results[0]! && 'detail' in results[1]!);
  const proposed = results[0];
  assert.equal(proposed.detail.primaryOwner.id, f.owner);
  assert.equal(
    proposed.detail.pendingTransfer?.transferId,
    results[1].detail.pendingTransfer?.transferId,
  );
  assert.equal(proposed.createdAt, f.post.createdAt);
  assert.equal(proposed.detail.ackDueAt, f.post.detail.ackDueAt);
  assert.ok(
    (await f.issues.getIssue(f.bob, f.campus, f.post.id)).capabilities.includes('RESPOND_TRANSFER'),
  );
  assert.equal(
    (await f.issues.getIssue(f.bob, f.campus, f.post.id)).capabilities.includes('MANAGE_ISSUE'),
    false,
  );
  await assert.rejects(
    new DiscussionService(f.issues).create(
      f.bob,
      f.campus,
      f.post.id,
      { scope: 'STAFF', body: 'Not assigned yet' },
      randomUUID(),
    ),
    code('STAFF_NOTE_FORBIDDEN'),
  );
  await assert.rejects(
    o.command(
      f.owner,
      f.campus,
      f.post.id,
      {
        expectedVersion: proposed.version,
        action: 'accept-transfer',
        transferId: proposed.detail.pendingTransfer!.transferId,
      },
      randomUUID(),
    ),
    code('TRANSFER_RECIPIENT_REQUIRED'),
  );
  const accept = {
      expectedVersion: proposed.version,
      action: 'accept-transfer',
      transferId: proposed.detail.pendingTransfer!.transferId,
    },
    acceptKey = randomUUID(),
    accepted = await o.command(f.bob, f.campus, f.post.id, accept, acceptKey);
  assert.ok('detail' in accepted);
  assert.equal(accepted.detail.primaryOwner.id, f.bob);
  assert.equal(accepted.detail.unitId, f.nextUnit);
  assert.equal(accepted.detail.pendingTransfer, undefined);
  assert.equal(accepted.detail.ackDueAt, f.post.detail.ackDueAt);
  assert.equal(
    (await f.issues.canonical(f.campus, f.post.id)).gsi2pk,
    `C#${f.campus}#QUEUE#${f.nextUnit}`,
  );
  await assert.rejects(f.issues.getIssue(f.owner, f.campus, f.post.id), code('NOT_FOUND'));
  assert.equal(
    (await o.command(f.bob, f.campus, f.post.id, accept, acceptKey)).version,
    accepted.version,
  );
});
test('rejecting transfer revokes temporary group access and retry returns only an access-ended acknowledgement', async () => {
  const f = await setup(),
    o = f.ownership,
    p = await o.command(
      f.owner,
      f.campus,
      f.post.id,
      {
        expectedVersion: f.post.version,
        action: 'propose-transfer',
        toUnitId: f.nextUnit,
        toOwnerId: f.bob,
        reason: 'Review handover',
      },
      randomUUID(),
    );
  assert.ok('detail' in p);
  const input = {
      expectedVersion: p.version,
      action: 'reject-transfer',
      transferId: p.detail.pendingTransfer!.transferId,
      reason: 'Wrong destination',
    },
    key = randomUUID(),
    result = await o.command(f.bob, f.campus, f.post.id, input, key);
  assert.deepEqual(Object.keys(result).sort(), ['accessEnded', 'postId', 'version']);
  assert.deepEqual(await o.command(f.bob, f.campus, f.post.id, input, key), result);
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, f.post.id), code('NOT_FOUND'));
  assert.equal(
    (await f.issues.getIssue(f.owner, f.campus, f.post.id)).detail.primaryOwner.id,
    f.owner,
  );
});
test('48-hour expiry denies access immediately, is retry-safe and never resets service age', async () => {
  const f = await setup(),
    o = f.ownership,
    p = await o.command(
      f.owner,
      f.campus,
      f.post.id,
      {
        expectedVersion: f.post.version,
        action: 'propose-transfer',
        toUnitId: f.nextUnit,
        toOwnerId: f.bob,
        reason: 'Expiry scenario',
      },
      randomUUID(),
    );
  assert.ok('detail' in p);
  const at = Date.parse(p.detail.pendingTransfer!.expiresAt) + 1,
    canonical = await f.issues.canonical(f.campus, p.id),
    bob = (await f.service.member(f.bob, f.campus)).member;
  assert.equal(canReadPost(bob, postAccessSchema.parse(canonical), at), false);
  await Promise.all([o.expire(at), o.expire(at)]);
  const after = await f.issues.getIssue(f.owner, f.campus, p.id);
  assert.equal(after.detail.pendingTransfer, undefined);
  assert.equal(after.detail.primaryOwner.id, f.owner);
  assert.equal(after.detail.ackDueAt, f.post.detail.ackDueAt);
  assert.equal(
    [...f.store.items.values()].filter((i) => i.eventType === 'ISSUE_TRANSFER_EXPIRED').length,
    1,
  );
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, p.id), code('NOT_FOUND'));
});
test('restricted transfer requires sensitive role, preserves narrow ACL and recipient revocation prevents acceptance', async () => {
  const f = await setup(true),
    o = f.ownership;
  const p = await o.command(
    f.owner,
    f.campus,
    f.post.id,
    {
      expectedVersion: f.post.version,
      action: 'propose-transfer',
      toUnitId: f.nextUnit,
      toOwnerId: f.bob,
      reason: 'Sensitive specialist',
    },
    randomUUID(),
  );
  assert.ok('detail' in p);
  const bob = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...bob,
    roles: (bob.roles as { role: string }[]).filter((g) => g.role !== 'SENSITIVE_HANDLER'),
    version: 2,
  });
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, p.id), code('NOT_FOUND'));
  await assert.rejects(
    o.command(
      f.bob,
      f.campus,
      p.id,
      {
        expectedVersion: p.version,
        action: 'accept-transfer',
        transferId: p.detail.pendingTransfer!.transferId,
      },
      randomUUID(),
    ),
    code('NOT_FOUND'),
  );
  assert.equal((await f.issues.getIssue(f.owner, f.campus, p.id)).detail.primaryOwner.id, f.owner);
});
test('recipient revocation at commit rejects assignment atomically and transfer scheduler rejects untrusted event', async () => {
  const f = await setup(),
    original = f.store.transact.bind(f.store),
    bob = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
  f.store.transact = async (writes) => {
    if (writes.some((w) => w.item?.eventType === 'ISSUE_COLLABORATORS_CHANGED'))
      f.store.seed(f.config.CORE_TABLE, { ...bob, status: 'REVOKED', version: 2 });
    return original(writes);
  };
  await assert.rejects(
    f.ownership.assign(
      f.owner,
      f.campus,
      f.post.id,
      { expectedVersion: f.post.version, collaboratorIds: [f.bob], reason: 'Race' },
      randomUUID(),
    ),
    code('VERSION_CONFLICT'),
  );
  assert.deepEqual(
    (await f.issues.getIssue(f.owner, f.campus, f.post.id)).detail.collaborators,
    [],
  );
  await assert.rejects(
    handler({
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      account: '000000000000',
      region: 'ap-south-1',
      resources: [],
    }),
  );
});

test('resolution proposal cancels temporary handover access and stale expiry cannot change completed ownership', async () => {
  const f = await setup(),
    w = new WorkflowService(f.issues),
    next = { nextAction: 'Inspect', nextUpdateAt: new Date(Date.now() + 86400000).toISOString() };
  let p = await w.command(
    f.owner,
    f.campus,
    f.post.id,
    { expectedVersion: f.post.version, action: 'acknowledge', ...next },
    randomUUID(),
  );
  p = await w.command(
    f.owner,
    f.campus,
    p.id,
    { expectedVersion: p.version, action: 'start', ...next },
    randomUUID(),
  );
  const transfer = await f.ownership.command(
    f.owner,
    f.campus,
    p.id,
    {
      expectedVersion: p.version,
      action: 'propose-transfer',
      toUnitId: f.nextUnit,
      toOwnerId: f.bob,
      reason: 'Temporary specialist handover',
    },
    randomUUID(),
  );
  assert.ok('detail' in transfer);
  const expires = Date.parse(transfer.detail.pendingTransfer!.expiresAt) + 1;
  p = await w.command(
    f.owner,
    f.campus,
    p.id,
    {
      expectedVersion: transfer.version,
      action: 'propose-resolution',
      resolution: {
        symptom: 'Fault',
        action: 'Repaired',
        outcome: 'Verified',
        evidenceOmissionReason: 'Synthetic proof not required',
      },
    },
    randomUUID(),
  );
  assert.equal(p.detail.pendingTransfer, undefined);
  await assert.rejects(f.issues.getIssue(f.bob, f.campus, p.id), code('NOT_FOUND'));
  await f.ownership.expire(expires);
  assert.equal((await f.issues.getIssue(f.owner, f.campus, p.id)).version, p.version);
});

test('same-unit proposed lead cannot assign collaborators before accepting accountability', async () => {
  const f = await setup(),
    bob = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...bob,
    roles: [
      ...(bob.roles as object[]),
      {
        id: randomUUID(),
        role: 'UNIT_LEAD',
        scope: 'UNIT',
        scopeId: f.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const p = await f.ownership.command(
    f.owner,
    f.campus,
    f.post.id,
    {
      expectedVersion: f.post.version,
      action: 'propose-transfer',
      toUnitId: f.unit,
      toOwnerId: f.bob,
      reason: 'Same-unit duty change',
    },
    randomUUID(),
  );
  assert.ok('detail' in p);
  assert.equal(
    (await f.issues.getIssue(f.bob, f.campus, p.id)).capabilities.includes('ASSIGN'),
    false,
  );
  await assert.rejects(
    f.ownership.assign(
      f.bob,
      f.campus,
      p.id,
      { expectedVersion: p.version, collaboratorIds: [], reason: 'Not accepted' },
      randomUUID(),
    ),
    code('ASSIGNMENT_FORBIDDEN'),
  );
});
