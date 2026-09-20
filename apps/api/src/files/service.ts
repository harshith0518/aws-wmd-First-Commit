import { randomUUID } from 'node:crypto';
import {
  attachmentSchema,
  uploadReserveSchema,
  uploadCompleteSchema,
  uploadReservationSchema,
  downloadLinkSchema,
  fileRemoveSchema,
  type FileParent,
  type FileVariant,
  type Attachment,
  type UploadReserve,
} from '@campusfix/contracts';
import { IssueService } from '../issues.js';
import { keys } from '../data/keys.js';
import { hash } from '../identity-service.js';
import { WriteConflict, type Item, type Write } from '../data/store.js';
import { ApiError, unavailable } from '../errors.js';
import { canReadPost, canManageIssue, postAccessSchema } from '../policy.js';
import { canReadAttachment, canWriteAttachment, fileKey, attachmentPostAccess } from './policy.js';
import type { EvidenceStorage, ObjectRef } from './storage.js';
export class FileService {
  constructor(
    readonly issues: IssueService,
    readonly storage?: EvidenceStorage,
  ) {
    if (storage?.kind === 'test' && issues.config.APP_ENV !== 'test')
      throw new Error('Synthetic evidence storage is forbidden outside test configuration.');
  }
  get identity() {
    return this.issues.identity;
  }
  get store() {
    return this.issues.store;
  }
  get config() {
    return this.issues.config;
  }
  enabled() {
    return !!this.storage;
  }
  requireStorage() {
    if (!this.storage)
      throw new ApiError(
        503,
        'UPLOADS_UNAVAILABLE',
        'Evidence uploads are unavailable until secure storage and scanning are configured.',
      );
    return this.storage;
  }
  dto(file: Item): Attachment {
    return attachmentSchema.parse(
      Object.fromEntries(
        Object.keys(attachmentSchema.shape)
          .filter((k) => file[k] !== undefined)
          .map((k) => [k, file[k]]),
      ),
    );
  }
  async parent(actor: string, campus: string, p: FileParent, write = false) {
    if (p.parentKind !== 'POST') throw unavailable();
    const ctx = await this.identity.member(actor, campus);
    const post = await this.issues.canonical(campus, p.parentId);
    if (
      !canReadPost(ctx.member, attachmentPostAccess(post)) ||
      post.type !== 'ISSUE' ||
      post.publication === 'REMOVED' ||
      (write && !canWriteAttachment(ctx.member, post))
    )
      throw unavailable();
    return { ctx, post };
  }
  async source(actor: string, campus: string, p: FileParent, id: string, write = false) {
    const { ctx, post } = await this.parent(actor, campus, p, write);
    const file = await this.store.get(this.config.CORE_TABLE, fileKey(campus, p.parentId, id));
    if (
      !file ||
      file.id !== id ||
      !canReadAttachment(ctx.member, post, file) ||
      (write && file.ownerId !== actor && !canManageIssue(ctx.member, attachmentPostAccess(post)))
    )
      throw unavailable();
    return { ctx, post, file };
  }
  async status(actor: string, campus: string, p: FileParent, id: string) {
    const { file } = await this.source(actor, campus, p, id);
    const fresh = await this.source(actor, campus, p, id);
    if (fresh.file.version !== file.version)
      throw new ApiError(409, 'FILE_CHANGED', 'File processing changed. Refresh its state.');
    return this.dto(fresh.file);
  }
  async list(actor: string, campus: string, p: FileParent) {
    const { post } = await this.parent(actor, campus, p);
    const ids = (post.fileSlotIds ?? post.attachmentIds ?? []) as string[];
    if (ids.length > 3) throw new Error('Invalid file allocation.');
    const items = [];
    for (const id of ids) {
      try {
        items.push(await this.status(actor, campus, p, id));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    const fresh = await this.parent(actor, campus, p);
    if (fresh.post.version !== post.version)
      throw new ApiError(409, 'SOURCE_CHANGED', 'The report changed. Refresh its files.');
    return { items, uploadsEnabled: this.enabled() };
  }
  jobKey(campus: string, id: string) {
    return { pk: `C#${campus}#FILEJOB#${id}`, sk: 'META' };
  }
  job(campus: string, parent: string, id: string, date: string): Item {
    const key = this.jobKey(campus, id);
    return {
      ...key,
      id,
      campusId: campus,
      parentId: parent,
      version: 1,
      kind: 'FILE_RECONCILE',
      attempts: 0,
      state: 'PENDING',
      runAt: date,
      readyPk: `FILES#${parseInt(hash(id).slice(0, 2), 16) % 4}`,
      readySk: `${date}#${id}`,
    };
  }
  async quotaWrites(
    actor: string,
    campus: string,
    data: UploadReserve,
    settings: Record<string, unknown>,
  ) {
    const day = Math.floor(Date.now() / 86400000);
    const counters = [
      {
        key: { pk: `C#${campus}#QUOTA#${actor}`, sk: `UPLOAD#${day}` },
        limit: Math.min(50 * 1048576, Number(settings.uploadBytesPerDay ?? 50 * 1048576)),
        ttl: (day + 2) * 86400,
      },
      {
        key: { pk: `C#${campus}#STORAGE`, sk: 'UPLOAD_BYTES' },
        limit: Math.min(1024 * 1048576, Number(settings.storageBytes ?? 1024 * 1048576)),
        ttl: undefined,
      },
    ];
    const writes: Write[] = [];
    for (const q of counters) {
      const old = await this.store.get(this.config.JOBS_TABLE, q.key),
        used = Number(old?.bytes ?? 0);
      if (!Number.isFinite(q.limit) || q.limit < 1 || used + data.bytes > q.limit)
        throw new ApiError(
          429,
          'UPLOAD_QUOTA_REACHED',
          'The member or campus upload budget has been reached.',
        );
      writes.push({
        table: this.config.JOBS_TABLE,
        key: q.key,
        guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
        item: {
          ...q.key,
          bytes: used + data.bytes,
          version: Number(old?.version ?? 0) + 1,
          ...(q.ttl ? { expiresAt: q.ttl } : {}),
        },
      });
    }
    return writes;
  }
  async reserve(actor: string, campus: string, input: unknown, key: string) {
    const storage = this.requireStorage(),
      data = uploadReserveSchema.parse(input);
    const attachment = await this.issues.commands.execute(
      actor,
      campus,
      'POST attachments/reserve',
      key,
      data,
      async (ctx) => {
        const { post } = await this.parent(actor, campus, data, true);
        if (
          data.scope === 'HANDLERS' &&
          !canManageIssue(ctx.member, attachmentPostAccess(post), true)
        )
          throw new ApiError(
            403,
            'FILE_SCOPE_FORBIDDEN',
            'Only assigned handlers can add handler-only evidence.',
          );
        const slots = (post.fileSlotIds ?? post.attachmentIds ?? []) as string[];
        if (slots.length >= 3)
          throw new ApiError(
            422,
            'FILE_LIMIT',
            'Each report supports at most three files. Remove an unused file first.',
          );
        const id = randomUUID(),
          now = new Date().toISOString();
        const k = fileKey(campus, data.parentId, id);
        const file: Item = {
          ...k,
          ...data,
          id,
          campusId: campus,
          entityType: 'ATTACHMENT',
          schemaVersion: 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
          state: 'RESERVED',
          ownerId: actor,
          boundPublication: post.publication,
          generatedObjectKey: `evidence/${campus}/${data.parentId}/${id}/${randomUUID()}`,
          uploadExpiresAt: new Date(Date.now() + 300000).toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        };
        const updated = {
          ...post,
          version: Number(post.version) + 1,
          updatedAt: now,
          fileSlotIds: [...slots, id],
        };
        const job = this.job(
          campus,
          data.parentId,
          id,
          new Date(Date.now() + 300000).toISOString(),
        );
        return {
          resourceId: data.parentId,
          response: this.dto(file),
          writes: [
            ...(await this.quotaWrites(
              actor,
              campus,
              data,
              (ctx.campus.quotas ?? {}) as Record<string, unknown>,
            )),
            { ...this.issues.guard(post), item: updated },
            { table: this.config.CORE_TABLE, key: k, guard: { kind: 'absent' }, item: file },
            {
              table: this.config.JOBS_TABLE,
              key: this.jobKey(campus, id),
              guard: { kind: 'absent' },
              item: job,
            },
          ],
          eventType: 'FILE_RESERVED',
          eventScope: 'AUTHOR' as const,
          sourceVersion: Number(updated.version),
        };
      },
      async (_id, response) => this.status(actor, campus, data, (response as Attachment).id),
    );
    const { file } = await this.source(actor, campus, data, attachment.id, true);
    if (file.state !== 'RESERVED')
      throw new ApiError(
        409,
        'UPLOAD_ALREADY_RECEIVED',
        'This upload has already been received. Refresh its status.',
      );
    const seconds = Math.floor((Date.parse(String(file.uploadExpiresAt)) - Date.now()) / 1000);
    if (seconds < 1)
      throw new ApiError(
        409,
        'UPLOAD_EXPIRED',
        'This upload reservation expired. Remove it and reserve a new upload.',
      );
    const signed = await storage.reserve(
      String(file.generatedObjectKey),
      attachment.mime,
      attachment.bytes,
      String(file.sha256),
      seconds,
    );
    const fresh = await this.source(actor, campus, data, attachment.id, true);
    if (fresh.file.version !== file.version)
      throw new ApiError(409, 'FILE_CHANGED', 'This upload changed. Refresh its status.');
    return uploadReservationSchema.parse({
      attachment,
      uploadUrl: signed.url,
      method: 'POST',
      fields: signed.fields,
      expiresAt: file.uploadExpiresAt,
      maxBytes: 5242880,
    });
  }
  async complete(
    actor: string,
    campus: string,
    p: FileParent,
    id: string,
    input: unknown,
    key: string,
    objectVersion?: string,
  ) {
    const storage = this.requireStorage(),
      data = uploadCompleteSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST attachments/${id}/complete`,
      key,
      { ...p, ...data },
      async () => {
        const { post, file } = await this.source(actor, campus, p, id, true);
        if (file.ownerId !== actor) throw unavailable();
        if (file.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The upload state changed. Refresh before completing.',
            Number(file.version),
          );
        if (file.state !== 'RESERVED')
          throw new ApiError(409, 'UPLOAD_ALREADY_RECEIVED', 'This upload was already finalized.');
        if (file.sha256 !== data.sha256)
          throw new ApiError(
            422,
            'CHECKSUM_MISMATCH',
            'The uploaded file does not match its reservation.',
          );
        if (Number(file.expiresAt) <= Date.now() / 1000)
          throw new ApiError(422, 'UPLOAD_EXPIRED', 'The file reservation expired.');
        if (
          file.boundPublication === 'DRAFT' &&
          post.publication !== 'DRAFT' &&
          !(post.attachmentIds as string[]).includes(id)
        )
          throw new ApiError(
            409,
            'DRAFT_ALREADY_PUBLISHED',
            'This file was not selected when the draft was published. Reserve a new upload to share it.',
          );
        const receipt = await storage.head(String(file.generatedObjectKey), objectVersion);
        if (
          receipt.bytes !== file.bytes ||
          receipt.sha256 !== file.sha256 ||
          receipt.mime !== file.mime ||
          Date.parse(receipt.modifiedAt) > Date.parse(String(file.uploadExpiresAt))
        )
          throw new ApiError(
            422,
            'UPLOAD_MISMATCH',
            'The stored object does not match the permitted upload.',
          );
        const { expiresAt: _reservationTtl, ...retained } = file;
        const now = new Date().toISOString();
        const updatedFile = {
          ...retained,
          state: 'SCANNING',
          version: Number(file.version) + 1,
          updatedAt: now,
          objectVersionId: receipt.version,
          uploadedAt: receipt.modifiedAt,
          scanDeadline: new Date(Date.now() + 15 * 60000).toISOString(),
        };
        const updatedPost = {
          ...post,
          version: Number(post.version) + 1,
          updatedAt: now,
          attachmentIds: [...new Set([...(post.attachmentIds as string[]), id])],
        };
        return {
          resourceId: p.parentId,
          response: this.dto(updatedFile),
          writes: [
            { ...this.issues.guard(file), item: updatedFile },
            { ...this.issues.guard(post), item: updatedPost },
          ],
          eventType: 'FILE_UPLOADED',
          eventScope: 'AUTHOR' as const,
          sourceVersion: Number(updatedPost.version),
        };
      },
      async () => this.status(actor, campus, p, id),
    );
  }
  async download(actor: string, campus: string, p: FileParent, id: string, variant: FileVariant) {
    const storage = this.requireStorage();
    const { ctx, post, file } = await this.source(actor, campus, p, id);
    if (file.state !== 'CLEAN')
      throw new ApiError(409, 'FILE_NOT_READY', 'This file is not ready for download.');
    if (variant === 'ORIGINAL' && !canManageIssue(ctx.member, attachmentPostAccess(post), true))
      throw new ApiError(
        403,
        'ORIGINAL_FORBIDDEN',
        'Only assigned evidence handlers can access the original file.',
      );
    const refs = file.cleanObjects as Record<string, ObjectRef>;
    const ref = refs[variant];
    if (!ref)
      throw new ApiError(
        422,
        'VARIANT_UNAVAILABLE',
        'This file does not have that display variant.',
      );
    if (variant === 'ORIGINAL') {
      const event = { pk: post.pk, sk: `EVENT#${new Date().toISOString()}#${randomUUID()}` };
      await this.store.transact([
        this.issues.guard(post),
        this.issues.guard(file),
        {
          table: this.config.CORE_TABLE,
          key: keys.member(campus, actor),
          guard: { kind: 'member', version: ctx.member.version, now: new Date().toISOString() },
        },
        {
          table: this.config.CORE_TABLE,
          key: event,
          guard: { kind: 'absent' },
          item: {
            ...event,
            entityType: 'EVENT',
            schemaVersion: 1,
            campusId: campus,
            id: randomUUID(),
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            eventType: 'EVIDENCE_ORIGINAL_ACCESSED',
            actorId: actor,
            visibility: 'HANDLERS',
            summary: 'An assigned handler accessed original evidence.',
          },
        },
      ]);
    }
    const mime = variant === 'ORIGINAL' ? String(file.mime) : String(file.displayMime);
    const filename =
      variant === 'ORIGINAL'
        ? String(file.originalName)
        : `evidence-${id}.${mime === 'application/pdf' ? 'pdf' : 'png'}`;
    const url = await storage.download(ref, mime, filename);
    const fresh = await this.source(actor, campus, p, id);
    if (
      fresh.file.version !== file.version ||
      fresh.post.version !== post.version ||
      fresh.file.state !== 'CLEAN' ||
      (variant === 'ORIGINAL' &&
        !canManageIssue(fresh.ctx.member, attachmentPostAccess(fresh.post), true))
    )
      throw unavailable();
    return downloadLinkSchema.parse({
      url,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      variant,
    });
  }
  async remove(
    actor: string,
    campus: string,
    p: FileParent,
    id: string,
    input: unknown,
    key: string,
  ) {
    const data = fileRemoveSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST attachments/${id}/remove`,
      key,
      { ...p, ...data },
      async () => {
        const { post, file } = await this.source(actor, campus, p, id, true);
        if (file.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'File state changed. Refresh before removing.',
            Number(file.version),
          );
        const now = new Date().toISOString(),
          updatedFile = {
            ...file,
            state: 'DELETED',
            updatedAt: now,
            version: Number(file.version) + 1,
          };
        const updatedPost = {
          ...post,
          updatedAt: now,
          version: Number(post.version) + 1,
          attachmentIds: (post.attachmentIds as string[]).filter((v) => v !== id),
          fileSlotIds: ((post.fileSlotIds ?? post.attachmentIds) as string[]).filter(
            (v) => v !== id,
          ),
        };
        const oldJob = await this.store.get(this.config.JOBS_TABLE, this.jobKey(campus, id));
        const job = {
          ...this.job(campus, p.parentId, id, now),
          version: Number(oldJob?.version ?? 0) + 1,
        };
        return {
          resourceId: p.parentId,
          response: { id, removed: true, version: Number(updatedFile.version) },
          writes: [
            { ...this.issues.guard(file), item: updatedFile },
            { ...this.issues.guard(post), item: updatedPost },
            {
              table: this.config.JOBS_TABLE,
              key: this.jobKey(campus, id),
              guard: oldJob
                ? { kind: 'version', version: Number(oldJob.version) }
                : { kind: 'absent' },
              item: job,
            },
          ],
          eventType: 'FILE_REMOVED',
          eventScope: 'AUTHOR' as const,
          sourceVersion: Number(updatedPost.version),
          event: { summary: 'An attachment was removed.', reason: data.reason },
        };
      },
      async () => {
        const { post } = await this.parent(actor, campus, p, true);
        const f = await this.store.get(this.config.CORE_TABLE, fileKey(campus, p.parentId, id));
        if (
          !f ||
          f.state !== 'DELETED' ||
          (f.ownerId !== actor &&
            !canManageIssue(
              (await this.identity.member(actor, campus)).member,
              attachmentPostAccess(post),
            ))
        )
          throw unavailable();
        return { id, removed: true, version: Number(f.version) };
      },
    );
  }
  scanKey(campus: string, parent: string, id: string, version: string) {
    return { pk: `C#${campus}#POST#${parent}#SCAN#${id}`, sk: hash(version) };
  }
  async recordScan(
    campus: string,
    parent: string,
    id: string,
    objectVersion: string,
    verdict: string,
    eventId: string,
  ) {
    const file = await this.store.get(this.config.CORE_TABLE, fileKey(campus, parent, id));
    if (!file) return;
    const k = this.scanKey(campus, parent, id, objectVersion);
    const existing = await this.store.get(this.config.JOBS_TABLE, k);
    if (!existing)
      try {
        await this.store.transact([
          {
            table: this.config.JOBS_TABLE,
            key: k,
            guard: { kind: 'absent' },
            item: {
              ...k,
              version: 1,
              objectVersion,
              verdict,
              eventId,
              expiresAt: Math.floor(Date.now() / 1000) + 86400,
            },
          },
        ]);
      } catch (e) {
        if (!(e instanceof WriteConflict)) throw e;
      }
    await this.process(campus, parent, id);
  }
  async reject(file: Item, code: Attachment['rejectionCode']) {
    const now = new Date().toISOString();
    try {
      await this.store.transact([
        {
          ...this.issues.guard(file),
          item: {
            ...file,
            state: 'REJECTED',
            rejectionCode: code,
            version: Number(file.version) + 1,
            updatedAt: now,
          },
        },
      ]);
    } catch (e) {
      if (!(e instanceof WriteConflict)) throw e;
    }
  }
  async process(campus: string, parent: string, id: string) {
    const storage = this.requireStorage();
    let file = await this.store.get(this.config.CORE_TABLE, fileKey(campus, parent, id));
    if (!file) return;
    if (['DELETED', 'REJECTED'].includes(String(file.state))) {
      await this.cleanup(file);
      return;
    }
    if (file.state === 'CLEAN') return;
    const p = { parentKind: 'POST' as const, parentId: parent };
    if (file.state === 'RESERVED') {
      try {
        await this.complete(
          String(file.ownerId),
          campus,
          p,
          id,
          { expectedVersion: file.version, sha256: file.sha256 },
          `system-receipt-${id}`,
        );
      } catch (e) {
        if (
          e instanceof ApiError &&
          [
            'DRAFT_ALREADY_PUBLISHED',
            'NOT_FOUND',
            'UPLOAD_MISMATCH',
            'UPLOAD_EXPIRED',
            'CHECKSUM_MISMATCH',
          ].includes(e.code)
        ) {
          await this.reject(file, e.code === 'UPLOAD_EXPIRED' ? 'EXPIRED' : 'INVALID_TYPE');
          return;
        }
        if (e instanceof Error && ['NotFound', 'NoSuchKey'].includes(e.name)) {
          if (Date.now() > Date.parse(String(file.uploadExpiresAt)))
            await this.reject(file, 'EXPIRED');
          return;
        }
        if (e instanceof ApiError && e.status === 409) return;
        throw e;
      }
      file = (await this.store.get(this.config.CORE_TABLE, fileKey(campus, parent, id)))!;
    }
    if (file.state !== 'SCANNING') return;
    if (Date.now() > Date.parse(String(file.scanDeadline))) {
      await this.reject(file, 'SCAN_ERROR');
      return;
    }
    try {
      await this.parent(String(file.ownerId), campus, p, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await this.reject(file, 'SCAN_ERROR');
        return;
      }
      throw e;
    }
    const version = String(file.objectVersionId);
    const scan = await this.store.get(
      this.config.JOBS_TABLE,
      this.scanKey(campus, parent, id, version),
    );
    if (!scan) {
      if (Date.now() > Date.parse(String(file.scanDeadline))) await this.reject(file, 'SCAN_ERROR');
      return;
    }
    if (scan.verdict !== 'NO_THREATS_FOUND') {
      await this.reject(file, scan.verdict === 'THREATS_FOUND' ? 'MALWARE' : 'SCAN_ERROR');
      return;
    }
    if (Number(file.processingLeaseUntil ?? 0) > Date.now()) return;
    const token = randomUUID();
    const leased = {
      ...file,
      processingToken: token,
      processingLeaseUntil: Date.now() + 300000,
      version: Number(file.version) + 1,
    };
    try {
      await this.store.transact([{ ...this.issues.guard(file), item: leased }]);
    } catch (e) {
      if (e instanceof WriteConflict) return;
      throw e;
    }
    file = leased;
    const { sanitizeEvidence, sha256, InvalidEvidence } = await import('./validation.js');
    let bytes: Uint8Array, clean: Awaited<ReturnType<typeof sanitizeEvidence>>;
    try {
      bytes = await storage.read({ key: String(file.generatedObjectKey), version });
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        throw new InvalidEvidence('INVALID_TYPE');
      clean = await sanitizeEvidence(bytes, String(file.mime));
    } catch (e) {
      if (e instanceof InvalidEvidence) {
        await this.reject(file, e.code);
        return;
      }
      throw e;
    }
    const root = `clean/${campus}/${parent}/${id}/${hash(version)}/${token}`;
    const refs: Record<string, ObjectRef> = {
      ORIGINAL: await storage.write(`${root}/original`, bytes, String(file.mime)),
      SANITIZED: await storage.write(`${root}/display`, clean.sanitized, clean.mime),
    };
    if (clean.thumbnail)
      refs.THUMBNAIL = await storage.write(`${root}/thumbnail`, clean.thumbnail, 'image/png');
    const latest = await this.source(String(file.ownerId), campus, p, id, true).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return undefined;
      throw e;
    });
    if (!latest || latest.file.version !== file.version) {
      if (!latest) await this.reject(file, 'SCAN_ERROR');
      await storage.remove(undefined, Object.values(refs));
      return;
    }
    const now = new Date().toISOString();
    try {
      await this.store.transact([
        this.issues.guard(latest.post),
        {
          table: this.config.CORE_TABLE,
          key: keys.profile(String(file.ownerId)),
          guard: { kind: 'version', version: Number(latest.ctx.profile.version) },
        },
        {
          table: this.config.CORE_TABLE,
          key: keys.campus(campus),
          guard: { kind: 'version', version: Number(latest.ctx.campus.version) },
        },
        {
          table: this.config.CORE_TABLE,
          key: keys.member(campus, String(file.ownerId)),
          guard: { kind: 'member', version: latest.ctx.member.version, now },
        },
        {
          ...this.issues.guard(file),
          item: {
            ...file,
            state: 'CLEAN',
            version: Number(file.version) + 1,
            updatedAt: now,
            cleanObjects: refs,
            displayMime: clean.mime,
            scanner: 'GUARDDUTY',
            scanEventId: scan.eventId,
            scanObjectVersion: version,
          },
        },
      ]);
    } catch (e) {
      if (!(e instanceof WriteConflict)) throw e;
      const current = await this.store.get(this.config.CORE_TABLE, fileKey(campus, parent, id));
      if (current?.processingToken !== token || current?.state !== 'CLEAN')
        await storage.remove(undefined, Object.values(refs));
    }
  }
  async cleanup(file: Item) {
    if (file.holdId || file.storageReleased === true) return;
    const refs = Object.values((file.cleanObjects ?? {}) as Record<string, ObjectRef>);
    const quarantine = file.objectVersionId
      ? { key: String(file.generatedObjectKey), version: String(file.objectVersionId) }
      : undefined;
    await this.requireStorage().remove(quarantine, refs);
    const quotaKey = { pk: `C#${file.campusId}#STORAGE`, sk: 'UPLOAD_BYTES' };
    const quota = await this.store.get(this.config.JOBS_TABLE, quotaKey);
    const writes: Write[] = [
      {
        ...this.issues.guard(file),
        item: {
          ...file,
          storageReleased: true,
          version: Number(file.version) + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    ];
    if (quota)
      writes.push({
        table: this.config.JOBS_TABLE,
        key: quotaKey,
        guard: { kind: 'version', version: Number(quota.version) },
        item: {
          ...quota,
          version: Number(quota.version) + 1,
          bytes: Math.max(0, Number(quota.bytes) - Number(file.bytes)),
        },
      });
    try {
      await this.store.transact(writes);
    } catch (e) {
      if (!(e instanceof WriteConflict)) throw e;
    }
  }
}
