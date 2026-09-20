import { z } from 'zod';
import { idSchema } from '@campusfix/contracts';
import { FileService } from './service.js';
import { fileKey } from './policy.js';
import { WriteConflict, type Item } from '../data/store.js';
import { ApiError } from '../errors.js';
const envelope = z.object({
  id: z.string().min(1).max(200),
  source: z.string(),
  'detail-type': z.string(),
  account: z.string().regex(/^\d{12}$/),
  region: z.string(),
  resources: z.array(z.string()).max(10).default([]),
  detail: z.unknown(),
});
const scanDetail = z.object({
  schemaVersion: z.literal('1.0'),
  resourceType: z.literal('S3_OBJECT'),
  scanStatus: z.enum(['COMPLETED', 'SKIPPED', 'FAILED']),
  s3ObjectDetails: z.object({
    bucketName: z.string(),
    objectKey: z.string(),
    versionId: z.string().min(1).max(1024),
  }),
  scanResultDetails: z.object({
    scanResultStatus: z.enum([
      'NO_THREATS_FOUND',
      'THREATS_FOUND',
      'UNSUPPORTED',
      'ACCESS_DENIED',
      'FAILED',
    ]),
  }),
});
const objectDetail = z.object({
  bucket: z.object({ name: z.string() }),
  object: z.object({ key: z.string(), 'version-id': z.string().min(1).max(1024) }),
});
export class EvidenceWorker {
  constructor(readonly files: FileService) {}
  async handle(input: unknown) {
    const e = envelope.parse(input),
      c = this.files.config;
    if (
      !c.GUARD_DUTY_PLAN_ARN ||
      e.region !== c.AWS_REGION ||
      e.account !== c.GUARD_DUTY_PLAN_ARN.split(':')[4]
    )
      throw new Error('Untrusted evidence event.');
    if (e.source === 'aws.events' && e['detail-type'] === 'Scheduled Event') {
      if (!c.FILE_SCHEDULE_ARN || !e.resources.includes(c.FILE_SCHEDULE_ARN))
        throw new Error('Untrusted evidence schedule.');
      return this.reconcile();
    }
    if (
      e.source === 'aws.guardduty' &&
      e['detail-type'] === 'GuardDuty Malware Protection Object Scan Result'
    ) {
      if (!e.resources.includes(c.GUARD_DUTY_PLAN_ARN))
        throw new Error('Unexpected malware protection plan.');
      const d = scanDetail.parse(e.detail),
        o = d.s3ObjectDetails;
      if (o.bucketName !== c.QUARANTINE_BUCKET) throw new Error('Unexpected quarantine bucket.');
      const f = await this.lookup(o.objectKey);
      if (!f) return;
      return this.files.recordScan(
        String(f.campusId),
        String(f.parentId),
        String(f.id),
        o.versionId,
        d.scanStatus === 'COMPLETED' ? d.scanResultDetails.scanResultStatus : 'FAILED',
        e.id,
      );
    }
    if (e.source === 'aws.s3' && e['detail-type'] === 'Object Created') {
      const d = objectDetail.parse(e.detail);
      if (
        d.bucket.name !== c.QUARANTINE_BUCKET ||
        !e.resources.includes(`arn:aws:s3:::${c.QUARANTINE_BUCKET}`)
      )
        throw new Error('Unexpected object event.');
      const f = await this.lookup(d.object.key);
      if (!f) return;
      if (f.state === 'RESERVED')
        try {
          await this.files.complete(
            String(f.ownerId),
            String(f.campusId),
            { parentKind: 'POST', parentId: String(f.parentId) },
            String(f.id),
            { expectedVersion: f.version, sha256: f.sha256 },
            `system-receipt-${f.id}`,
            d.object['version-id'],
          );
        } catch (e) {
          if (!(e instanceof ApiError && [404, 409, 422].includes(e.status))) throw e;
        }
      await this.files.process(String(f.campusId), String(f.parentId), String(f.id));
      return;
    }
    throw new Error('Unsupported evidence event.');
  }
  async lookup(key: string) {
    const parts = key.split('/');
    if (
      parts.length !== 5 ||
      parts[0] !== 'evidence' ||
      !parts.slice(1).every((p) => idSchema.safeParse(p).success)
    )
      return;
    const f = await this.files.store.get(
      this.files.config.CORE_TABLE,
      fileKey(parts[1]!, parts[2]!, parts[3]!),
    );
    return f?.generatedObjectKey === key ? f : undefined;
  }
  async reconcile(now = Date.now()) {
    let processed = 0,
      failed = 0;
    for (let shard = 0; shard < 4; shard++) {
      const page = await this.files.store.query({
        table: this.files.config.JOBS_TABLE,
        index: 'ready',
        pk: `FILES#${shard}`,
        sortAtMost: `${new Date(now).toISOString()}#~`,
        limit: 10,
      });
      for (const pointer of page.items) {
        const job = await this.files.store.get(this.files.config.JOBS_TABLE, {
          pk: pointer.pk,
          sk: pointer.sk,
        });
        if (
          !job ||
          job.kind !== 'FILE_RECONCILE' ||
          !['PENDING', 'RUNNING'].includes(String(job.state)) ||
          Date.parse(String(job.runAt)) > now ||
          Number(job.leaseUntil ?? 0) > now
        )
          continue;
        const claimed = {
          ...job,
          version: Number(job.version) + 1,
          state: 'RUNNING',
          leaseUntil: now + 300000,
        };
        try {
          await this.save(job, claimed);
        } catch (e) {
          if (e instanceof WriteConflict) continue;
          throw e;
        }
        let error = false;
        try {
          await this.files.process(String(job.campusId), String(job.parentId), String(job.id));
        } catch {
          error = true;
        }
        const file = await this.files.store.get(
          this.files.config.CORE_TABLE,
          fileKey(String(job.campusId), String(job.parentId), String(job.id)),
        );
        const done =
          !file ||
          file.state === 'CLEAN' ||
          (['DELETED', 'REJECTED'].includes(String(file.state)) && file.storageReleased === true);
        const attempts = Number(job.attempts ?? 0) + (error ? 1 : 0),
          exhausted = error && attempts >= 5;
        const next: Item = {
          ...claimed,
          version: Number(claimed.version) + 1,
          leaseUntil: 0,
          attempts,
          state: done ? 'DONE' : exhausted ? 'FAILED' : 'PENDING',
          runAt: new Date(
            now +
              (file?.holdId ? 86400000 : error ? Math.min(900000, 30000 * 2 ** attempts) : 60000),
          ).toISOString(),
        };
        if (done || exhausted) {
          if (exhausted) {
            next.readyPk = `FILES_FAILED#${shard}`;
            next.readySk = `${new Date(now).toISOString()}#${job.id}`;
          } else {
            delete next.readyPk;
            delete next.readySk;
          }
          if (done) next.expiresAt = Math.floor(now / 1000) + 7 * 86400;
        } else next.readySk = `${next.runAt}#${job.id}`;
        try {
          await this.save(claimed, next);
        } catch (e) {
          if (!(e instanceof WriteConflict)) throw e;
        }
        processed++;
        if (exhausted) failed++;
      }
    }
    if (failed > 0)
      throw new Error(
        `Evidence reconciliation exhausted retries for ${failed} jobs; inspect FAILED jobs and retry after fixing the dependency.`,
      );
    return { processed };
  }
  private save(old: Item, item: Item) {
    return this.files.store.transact([
      {
        table: this.files.config.JOBS_TABLE,
        key: { pk: old.pk, sk: old.sk },
        guard: { kind: 'version', version: Number(old.version) },
        item,
      },
    ]);
  }
}
