import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName } from 'pdf-lib';
import { issueFixture } from './issue-fixture.js';
import { FileService } from '../src/files/service.js';
import { TestEvidenceStorage } from './evidence-storage.js';
import { EvidenceWorker } from '../src/files/worker.js';
import { sanitizeEvidence, sha256 } from '../src/files/validation.js';
import { fileKey } from '../src/files/policy.js';
import { ApiError } from '../src/errors.js';
import { keys } from '../src/data/keys.js';
const code = (name: string) => (e: unknown) => e instanceof ApiError && e.code === name;
async function setup() {
  const f = issueFixture(),
    storage = new TestEvidenceStorage(),
    files = new FileService(f.issues, storage);
  const draft = await f.issues.createDraft(
    f.user,
    f.campus,
    { type: 'ISSUE', title: 'Evidence draft' },
    randomUUID(),
  );
  const parent = { parentKind: 'POST' as const, parentId: draft.id };
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#336699' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  return { ...f, storage, files, draft, parent, bytes };
}
async function reserve(
  f: Awaited<ReturnType<typeof setup>>,
  scope: 'PUBLIC' | 'REPORTER_HANDLERS' = 'PUBLIC',
) {
  const request = {
    ...f.parent,
    scope,
    originalName: 'proof.jpg',
    mime: 'image/jpeg',
    bytes: f.bytes.length,
    sha256: sha256(f.bytes),
  };
  const reservation = await f.files.reserve(f.user, f.campus, request, randomUUID());
  const file = (await f.store.get(
    f.config.CORE_TABLE,
    fileKey(f.campus, f.draft.id, reservation.attachment.id),
  ))!;
  return { request, reservation, file };
}
async function upload(
  f: Awaited<ReturnType<typeof setup>>,
  scope: 'PUBLIC' | 'REPORTER_HANDLERS' = 'PUBLIC',
) {
  const r = await reserve(f, scope);
  const object = f.storage.put(String(r.file.generatedObjectKey), f.bytes, 'image/jpeg');
  await f.files.complete(
    f.user,
    f.campus,
    f.parent,
    r.file.id as string,
    { expectedVersion: 1, sha256: r.request.sha256 },
    randomUUID(),
  );
  return { ...r, object };
}
test('evidence is disabled without storage; source ACL applies even to an empty attachment list', async () => {
  const f = await setup(),
    disabled = new FileService(f.issues);
  assert.equal((await disabled.list(f.user, f.campus, f.parent)).uploadsEnabled, false);
  await assert.rejects(
    disabled.reserve(f.user, f.campus, {}, randomUUID()),
    code('UPLOADS_UNAVAILABLE'),
  );
  const post = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  await assert.rejects(
    f.files.list(f.bob, f.campus, { parentKind: 'POST', parentId: post.id }),
    code('NOT_FOUND'),
  );
  assert.throws(
    () =>
      new FileService(
        { ...f.issues, config: { ...f.config, APP_ENV: 'production' } } as never,
        f.storage,
      ),
    /forbidden/,
  );
});
test('immutable upload requires clean scan AND validation, strips metadata, publishes selected proof and reauthorizes downloads', async () => {
  const f = await setup(),
    u = await upload(f);
  const id = String(u.file.id);
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'SCANNING');
  assert.equal(
    (await f.store.get(f.config.CORE_TABLE, fileKey(f.campus, f.draft.id, id)))!.expiresAt,
    undefined,
  );
  await assert.rejects(
    f.files.download(f.user, f.campus, f.parent, id, 'SANITIZED'),
    code('FILE_NOT_READY'),
  );
  await f.files.recordScan(
    f.campus,
    f.draft.id,
    id,
    'some-other-version',
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'SCANNING');
  // A later object at the same key must not replace the version finalized above.
  f.storage.put(
    String(u.file.generatedObjectKey),
    Buffer.from('not the accepted image'),
    'image/jpeg',
  );
  await f.files.recordScan(
    f.campus,
    f.draft.id,
    id,
    u.object.version,
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  const file = (await f.store.get(f.config.CORE_TABLE, fileKey(f.campus, f.draft.id, id)))!;
  assert.equal(file.state, 'CLEAN');
  assert.equal(file.scanObjectVersion, u.object.version);
  const refs = file.cleanObjects as Record<string, { key: string; version: string }>;
  const image = await sharp(await f.storage.read(refs.SANITIZED!)).metadata();
  assert.equal(image.exif, undefined);
  assert.equal(image.format, 'png');
  await assert.rejects(
    f.files.download(f.user, f.campus, f.parent, id, 'ORIGINAL'),
    code('ORIGINAL_FORBIDDEN'),
  );
  const draft = await f.issues.getDraft(f.user, f.campus, f.draft.id);
  const published = await f.issues.publish(
    f.user,
    f.campus,
    { expectedVersion: draft.version, payload: { ...f.input, attachmentIds: [id] } },
    randomUUID(),
    draft.id,
  );
  assert.deepEqual(published.attachmentIds, [id]);
  assert.ok((await f.files.download(f.owner, f.campus, f.parent, id, 'ORIGINAL')).url);
  await assert.rejects(
    f.files.download(f.bob, f.campus, f.parent, id, 'SANITIZED'),
    code('NOT_FOUND'),
  );
  f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2 });
  await assert.rejects(
    f.files.download(f.user, f.campus, f.parent, id, 'SANITIZED'),
    code('NOT_FOUND'),
  );
  assert.ok([...f.store.items.values()].some((i) => i.eventType === 'EVIDENCE_ORIGINAL_ACCESSED'));
});
test('narrow file scopes do not leak through public report DTOs or downloads', async () => {
  const f = await setup(),
    u = await upload(f, 'REPORTER_HANDLERS'),
    id = String(u.file.id);
  await f.files.recordScan(
    f.campus,
    f.draft.id,
    id,
    u.object.version,
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  const draft = await f.issues.getDraft(f.user, f.campus, f.draft.id);
  await f.issues.publish(
    f.user,
    f.campus,
    {
      expectedVersion: draft.version,
      payload: { ...f.input, audience: { kind: 'CAMPUS' }, attachmentIds: [id] },
    },
    randomUUID(),
    draft.id,
  );
  assert.deepEqual((await f.issues.getIssue(f.bob, f.campus, draft.id)).attachmentIds, []);
  assert.deepEqual((await f.files.list(f.bob, f.campus, f.parent)).items, []);
  await assert.rejects(
    f.files.download(f.bob, f.campus, f.parent, id, 'SANITIZED'),
    code('NOT_FOUND'),
  );
  assert.ok((await f.files.download(f.owner, f.campus, f.parent, id, 'SANITIZED')).url);
});
test('duplicate processing keeps accepted objects; removal while processing cannot resurrect evidence', async () => {
  const f = await setup(),
    u = await upload(f),
    id = String(u.file.id);
  await Promise.all([
    f.files.recordScan(
      f.campus,
      f.draft.id,
      id,
      u.object.version,
      'NO_THREATS_FOUND',
      'same-event',
    ),
    f.files.recordScan(
      f.campus,
      f.draft.id,
      id,
      u.object.version,
      'NO_THREATS_FOUND',
      'same-event',
    ),
  ]);
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'CLEAN');
  assert.ok((await f.files.download(f.user, f.campus, f.parent, id, 'SANITIZED')).url);
  const g = await setup(),
    v = await upload(g),
    other = String(v.file.id);
  const write = g.storage.write.bind(g.storage);
  let once = true;
  g.storage.write = async (...args) => {
    const ref = await write(...args);
    if (once) {
      once = false;
      const state = await g.files.status(g.user, g.campus, g.parent, other);
      await g.files.remove(
        g.user,
        g.campus,
        g.parent,
        other,
        { expectedVersion: state.version, reason: 'Withdraw this proof' },
        randomUUID(),
      );
    }
    return ref;
  };
  await g.files.recordScan(
    g.campus,
    g.draft.id,
    other,
    v.object.version,
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  await assert.rejects(g.files.status(g.user, g.campus, g.parent, other), code('NOT_FOUND'));
  assert.equal(
    [...g.storage.objects.values()].filter((o) => o.receipt.key.startsWith('clean/')).length,
    0,
  );
  await new EvidenceWorker(g.files).reconcile();
  assert.equal(g.storage.objects.size, 0);
  assert.equal(
    (await g.store.get(g.config.JOBS_TABLE, { pk: `C#${g.campus}#STORAGE`, sk: 'UPLOAD_BYTES' }))
      ?.bytes,
    0,
  );
});
test('scan failures, mismatched bytes and nested active PDFs never become downloadable', async () => {
  for (const verdict of ['THREATS_FOUND', 'UNSUPPORTED', 'FAILED']) {
    const f = await setup(),
      u = await upload(f),
      id = String(u.file.id);
    await f.files.recordScan(f.campus, f.draft.id, id, u.object.version, verdict, randomUUID());
    assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'REJECTED');
    await assert.rejects(
      f.files.download(f.user, f.campus, f.parent, id, 'SANITIZED'),
      code('FILE_NOT_READY'),
    );
  }
  const f = await setup(),
    u = await upload(f),
    id = String(u.file.id);
  f.storage.objects.get(`${u.object.key}@${u.object.version}`)!.bytes = Buffer.from('tampered');
  await f.files.recordScan(
    f.campus,
    f.draft.id,
    id,
    u.object.version,
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'REJECTED');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.node.set(
    PDFName.of('Annots'),
    pdf.context.obj([{ A: { S: 'JavaScript', JS: 'app.alert(1)' } }]),
  );
  await assert.rejects(sanitizeEvidence(await pdf.save(), 'application/pdf'));
  const normal = await PDFDocument.create();
  normal.addPage();
  assert.equal(
    (await sanitizeEvidence(await normal.save(), 'application/pdf')).mime,
    'application/pdf',
  );
  await assert.rejects(sanitizeEvidence(Buffer.from('<svg/>'), 'image/png'));
});
test('upload reservations are idempotent, bounded, quota protected and unfinished draft evidence stays private', async () => {
  const f = await setup(),
    r = await reserve(f);
  const retried = await f.files.reserve(f.user, f.campus, r.request, 'new-key-just-for-retry');
  assert.notEqual(retried.attachment.id, r.file.id);
  const key = randomUUID(),
    third = await f.files.reserve(f.user, f.campus, r.request, key);
  assert.equal(
    (await f.files.reserve(f.user, f.campus, r.request, key)).attachment.id,
    third.attachment.id,
  );
  await assert.rejects(
    f.files.reserve(f.user, f.campus, r.request, randomUUID()),
    code('FILE_LIMIT'),
  );
  assert.equal(
    [...f.store.items.values()].some((i) => JSON.stringify(i).includes('synthetic-upload')),
    false,
  );
  const draft = await f.issues.getDraft(f.user, f.campus, f.draft.id);
  await f.issues.publish(
    f.user,
    f.campus,
    { expectedVersion: draft.version, payload: f.input },
    randomUUID(),
    draft.id,
  );
  f.storage.put(String(r.file.generatedObjectKey), f.bytes, 'image/jpeg');
  await assert.rejects(
    f.files.complete(
      f.user,
      f.campus,
      f.parent,
      String(r.file.id),
      { expectedVersion: 1, sha256: r.request.sha256 },
      randomUUID(),
    ),
    code('DRAFT_ALREADY_PUBLISHED'),
  );
  const g = await setup(),
    campus = (await g.store.get(g.config.CORE_TABLE, keys.campus(g.campus)))!;
  g.store.seed(g.config.CORE_TABLE, { ...campus, quotas: { storageBytes: 1 } });
  await assert.rejects(reserve(g), code('UPLOAD_QUOTA_REACHED'));
});
test('worker rejects forged events, binds exact object versions and expires incomplete uploads', async () => {
  const f = await setup(),
    u = await upload(f),
    id = String(u.file.id);
  Object.assign(f.config, {
    QUARANTINE_BUCKET: 'campusfix-quarantine-test',
    GUARD_DUTY_PLAN_ARN:
      'arn:aws:guardduty:ap-south-1:123456789012:malware-protection-plan/example',
  });
  const worker = new EvidenceWorker(f.files);
  const event = {
    id: randomUUID(),
    source: 'aws.guardduty',
    'detail-type': 'GuardDuty Malware Protection Object Scan Result',
    account: '123456789012',
    region: 'ap-south-1',
    resources: [f.config.GUARD_DUTY_PLAN_ARN],
    detail: {
      schemaVersion: '1.0',
      resourceType: 'S3_OBJECT',
      scanStatus: 'COMPLETED',
      s3ObjectDetails: {
        bucketName: f.config.QUARANTINE_BUCKET,
        objectKey: u.file.generatedObjectKey,
        versionId: u.object.version,
      },
      scanResultDetails: { scanResultStatus: 'NO_THREATS_FOUND' },
    },
  };
  await assert.rejects(worker.handle({ ...event, account: '999999999999' }), /Untrusted/);
  await assert.rejects(worker.handle({ ...event, resources: [] }), /Unexpected/);
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'SCANNING');
  await worker.handle(event);
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).state, 'CLEAN');
  const g = await setup(),
    r = await reserve(g);
  g.store.seed(g.config.CORE_TABLE, {
    ...r.file,
    uploadExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  await g.files.process(g.campus, g.draft.id, String(r.file.id));
  assert.equal(
    (await g.files.status(g.user, g.campus, g.parent, String(r.file.id))).rejectionCode,
    'EXPIRED',
  );
});
test('revoking uploader membership during sanitation prevents clean publication', async () => {
  const f = await setup(),
    u = await upload(f),
    id = String(u.file.id),
    write = f.storage.write.bind(f.storage);
  f.storage.write = async (...args) => {
    f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2 });
    return write(...args);
  };
  await f.files.recordScan(
    f.campus,
    f.draft.id,
    id,
    u.object.version,
    'NO_THREATS_FOUND',
    randomUUID(),
  );
  assert.notEqual(
    (await f.store.get(f.config.CORE_TABLE, fileKey(f.campus, f.draft.id, id)))!.state,
    'CLEAN',
  );
  assert.equal(
    [...f.storage.objects.values()].filter((o) => o.receipt.key.startsWith('clean/')).length,
    0,
  );
});

test('scan timeout stays unreadable, preservation holds defer deletion and exhausted jobs remain discoverable', async () => {
  const f = await setup(),
    u = await upload(f),
    id = String(u.file.id),
    key = fileKey(f.campus, f.draft.id, id),
    pending = (await f.store.get(f.config.CORE_TABLE, key))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...pending,
    scanDeadline: new Date(Date.now() - 1).toISOString(),
  });
  await f.files.process(f.campus, f.draft.id, id);
  assert.equal((await f.files.status(f.user, f.campus, f.parent, id)).rejectionCode, 'SCAN_ERROR');
  const rejected = (await f.store.get(f.config.CORE_TABLE, key))!;
  f.store.seed(f.config.CORE_TABLE, { ...rejected, holdId: randomUUID() });
  await f.files.process(f.campus, f.draft.id, id);
  assert.equal(f.storage.objects.size, 1);
  assert.notEqual((await f.store.get(f.config.CORE_TABLE, key))!.storageReleased, true);
  const g = await setup(),
    r = await reserve(g),
    worker = new EvidenceWorker(g.files);
  g.files.process = async () => {
    throw new Error('Synthetic dependency failure');
  };
  let now = Date.now() + 6 * 60000;
  for (let i = 0; i < 4; i++) {
    await worker.reconcile(now);
    now += 30 * 60000;
  }
  await assert.rejects(worker.reconcile(now), /exhausted retries/);
  const job = (await g.store.get(
    g.config.JOBS_TABLE,
    g.files.jobKey(g.campus, String(r.file.id)),
  ))!;
  assert.equal(job.state, 'FAILED');
  assert.equal(job.attempts, 5);
  assert.ok(String(job.readyPk).startsWith('FILES_FAILED#'));
});
test('AWS signing produces exact upload constraints and a 60-second versioned attachment download without a cloud request', async () => {
  const { S3Client } = await import('@aws-sdk/client-s3'),
    { S3EvidenceStorage } = await import('../src/files/s3.js'),
    { uploadReservationSchema } = await import('@campusfix/contracts');
  const client = new S3Client({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'synthetic-test-key', secretAccessKey: 'synthetic-test-secret' },
  });
  try {
    const s = new S3EvidenceStorage(
        'ap-south-1',
        'campusfix-test-quarantine',
        'campusfix-test-evidence',
        client,
      ),
      digest = sha256(Buffer.from('test'));
    const signed = await s.reserve('evidence/test-reservation', 'image/png', 4, digest, 300);
    const policy = JSON.parse(Buffer.from(signed.fields.Policy!, 'base64').toString('utf8'));
    assert.ok(
      policy.conditions.some(
        (c: unknown) => JSON.stringify(c) === JSON.stringify(['content-length-range', 4, 4]),
      ),
    );
    assert.equal(signed.fields['Content-Type'], 'image/png');
    assert.equal(
      signed.fields['x-amz-checksum-sha256'],
      Buffer.from(digest, 'hex').toString('base64'),
    );
    assert.ok(uploadReservationSchema.shape.fields.safeParse(signed.fields).success);
    const url = new URL(
      await s.download(
        { key: 'clean/test-file', version: 'immutable-test-version' },
        'image/png',
        'unsafe\r\nname.png',
      ),
    );
    assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(url.searchParams.get('versionId'), 'immutable-test-version');
    assert.match(url.searchParams.get('response-content-disposition')!, /^attachment;/);
    assert.equal(url.searchParams.get('response-content-disposition')!.includes('\r'), false);
  } finally {
    client.destroy();
  }
});
