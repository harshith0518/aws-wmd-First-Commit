import { involvement } from './involvement.js';
import { canReadAttachment, fileKey } from './files/policy.js';
import { randomUUID } from 'node:crypto';
import {
  issueCommandSchema,
  eventSchema,
  eventPageSchema,
  resolutionSchema,
  resolutionPageSchema,
  type Issue,
  type QueueQuery,
  type Resolution,
} from '@campusfix/contracts';
import { IssueService } from './issues.js';
import { keys } from './data/keys.js';
import type { Item, Write, Key } from './data/store.js';
import { ApiError, unavailable } from './errors.js';
import {
  canReadPost,
  canManageIssue,
  hasRole,
  postAccessSchema,
  type MemberRecord,
} from './policy.js';
const active = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING', 'REOPENED'];
const summaries: Record<string, string> = {
  acknowledge: 'Owner acknowledged the issue.',
  start: 'Owner started work.',
  progress: 'A handler recorded a progress update.',
  wait: 'Owner recorded a dependency and review time.',
  resume: 'Owner resumed work.',
  'propose-resolution': 'Owner proposed a resolution; reporter confirmation is pending.',
  confirm: 'Reporter confirmed the resolution.',
  reopen: 'Reporter reopened the issue.',
};
export class WorkflowService {
  constructor(readonly issues: IssueService) {}
  get identity() {
    return this.issues.identity;
  }
  get store() {
    return this.issues.store;
  }
  get config() {
    return this.issues.config;
  }
  async source(actor: string, campus: string, id: string) {
    const ctx = await this.identity.member(actor, campus),
      post = await this.issues.canonical(campus, id);
    if (
      post.type !== 'ISSUE' ||
      post.publication === 'DRAFT' ||
      !canReadPost(ctx.member, postAccessSchema.parse(post))
    )
      throw unavailable();
    return { ctx, post };
  }
  async command(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = issueCommandSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST issues/${id}/commands`,
      key,
      data,
      async (ctx) => {
        const post = await this.issues.canonical(campus, id),
          access = postAccessSchema.parse(post);
        if (
          post.type !== 'ISSUE' ||
          post.publication === 'DRAFT' ||
          !canReadPost(ctx.member, access)
        )
          throw unavailable();
        const reporter = data.action === 'confirm' || data.action === 'reopen';
        if (
          reporter
            ? post.authorId !== actor
            : !canManageIssue(ctx.member, access, data.action === 'progress')
        )
          throw new ApiError(
            403,
            'ACTION_FORBIDDEN',
            'Your current role cannot perform this action.',
          );
        if (post.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The issue changed. Review the latest record before submitting.',
            Number(post.version),
          );
        const evidenceIds =
          data.action === 'propose-resolution'
            ? (data.resolution.evidenceIds ?? [])
            : 'attachmentIds' in data
              ? (data.attachmentIds ?? [])
              : [];
        const evidenceGuards: Write[] = [];
        for (const fid of evidenceIds) {
          const file = await this.store.get(this.config.CORE_TABLE, fileKey(campus, id, fid));
          if (
            !file ||
            file.state !== 'CLEAN' ||
            !(post.attachmentIds as string[]).includes(fid) ||
            !canReadAttachment(ctx.member, post, file)
          )
            throw new ApiError(
              422,
              'FILE_NOT_READY',
              'Choose clean evidence attached to this issue.',
            );
          if (data.action === 'propose-resolution' && file.scope === 'HANDLERS')
            throw new ApiError(
              422,
              'EVIDENCE_NOT_REVIEWABLE',
              'Resolution evidence must be visible to the reporter.',
            );
          evidenceGuards.push(this.issues.guard(file));
        }
        const d = { ...(post.detail as Record<string, unknown>) };
        const previous = String(d.status),
          version = data.expectedVersion + 1,
          now = new Date().toISOString();
        const permitted: Record<string, string[]> = {
          acknowledge: ['SUBMITTED'],
          start: ['ACKNOWLEDGED', 'REOPENED'],
          progress: active,
          wait: ['ACKNOWLEDGED', 'IN_PROGRESS', 'REOPENED'],
          resume: ['WAITING'],
          'propose-resolution': ['IN_PROGRESS', 'WAITING', 'REOPENED'],
          confirm: ['PROPOSED_RESOLVED'],
          reopen: ['PROPOSED_RESOLVED', 'CONFIRMED_CLOSED'],
        };
        if (!permitted[data.action]!.includes(previous))
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'That action is not available in the current issue state.',
          );
        if ('nextUpdateAt' in data && Date.parse(data.nextUpdateAt) <= Date.now())
          throw new ApiError(422, 'INVALID_NEXT_UPDATE', 'Choose a future next-update time.');
        const writes: Write[] = [
          ...evidenceGuards,
          ...(!reporter ? await involvement(this.issues, post, [actor]) : []),
        ];
        if ('nextAction' in data) d.nextAction = data.nextAction;
        if ('nextUpdateAt' in data) d.nextUpdateAt = data.nextUpdateAt;
        if (data.action === 'acknowledge') {
          d.status = 'ACKNOWLEDGED';
          d.acknowledgedAt ??= now;
        }
        if (data.action === 'start' || data.action === 'resume') {
          d.status = 'IN_PROGRESS';
          delete d.waitingReason;
        }
        if (data.action === 'wait') {
          d.status = 'WAITING';
          d.previousActiveState = previous;
          d.waitingReason = data.reason;
        }
        let resolution: Resolution | undefined;
        if (data.action === 'propose-resolution') {
          if (!evidenceIds.length && !data.resolution.evidenceOmissionReason)
            throw new ApiError(
              422,
              'EVIDENCE_REASON_REQUIRED',
              'Explain why evidence is unsuitable or unavailable for this resolution.',
            );
          const rid = randomUUID();
          resolution = resolutionSchema.parse({
            id: rid,
            campusId: campus,
            postId: id,
            version: 1,
            publishedVersion: version,
            createdAt: now,
            updatedAt: now,
            ...data.resolution,
            evidenceIds,
            proposedBy: await this.issues.person(campus, actor),
            proposedAt: now,
            state: 'PROPOSED',
          });
          d.status = 'PROPOSED_RESOLVED';
          d.nextAction = 'Reporter to review the proposed resolution.';
          delete d.nextUpdateAt;
          delete d.waitingReason;
          d.resolutionId = rid;
          d.currentResolution = resolution;
          d.knowledgeValid = false;
          const rk = { pk: post.pk, sk: `RESOLUTION#${rid}` };
          writes.push({
            table: this.config.CORE_TABLE,
            key: rk,
            guard: { kind: 'absent' },
            item: { ...rk, ...resolution, entityType: 'RESOLUTION', schemaVersion: 1 },
          });
        }
        if (data.action === 'confirm' || data.action === 'reopen') {
          const current = resolutionSchema.parse(d.currentResolution);
          if (
            data.action === 'confirm' &&
            (current.id !== data.resolutionId || current.state !== 'PROPOSED')
          )
            throw new ApiError(
              409,
              'RESOLUTION_CHANGED',
              'Review the current proposed resolution before confirming.',
            );
          const rk = { pk: post.pk, sk: `RESOLUTION#${current.id}` };
          const record = await this.store.get(this.config.CORE_TABLE, rk);
          if (!record || record.version !== current.version || record.state !== current.state)
            throw new ApiError(
              409,
              'RESOLUTION_CHANGED',
              'The resolution changed. Refresh this issue.',
            );
          resolution = resolutionSchema.parse({
            ...current,
            version: current.version + 1,
            updatedAt: now,
            state: data.action === 'confirm' ? 'CONFIRMED' : 'INVALIDATED',
            ...(data.action === 'confirm'
              ? { confirmedBy: await this.issues.person(campus, actor), confirmedAt: now }
              : {}),
          });
          d.currentResolution = resolution;
          d.status = data.action === 'confirm' ? 'CONFIRMED_CLOSED' : 'REOPENED';
          delete d.nextAction;
          delete d.nextUpdateAt;
          d.knowledgeValid = false;
          if (data.action === 'reopen') {
            d.reopenedAt = now;
            delete d.waitingReason;
            delete d.nextAction;
            delete d.nextUpdateAt;
          }
          writes.push({
            table: this.config.CORE_TABLE,
            key: rk,
            guard: { kind: 'version', version: current.version },
            item: { ...record, ...resolution },
          });
        }
        const cancelTransfer = data.action === 'propose-resolution' && !!d.pendingTransfer;
        if (cancelTransfer) delete d.pendingTransfer;
        const updated: Item = {
          ...post,
          version,
          updatedAt: now,
          detail: d,
          ...(cancelTransfer ? { aclVersion: Number(post.aclVersion) + 1 } : {}),
        };
        if (!['CONFIRMED_CLOSED', 'DECLINED', 'DUPLICATE'].includes(String(d.status))) {
          updated.gsi2pk = `C#${campus}#QUEUE#${d.unitId}`;
          updated.gsi2sk = `${d.nextUpdateAt ?? (d.status === 'SUBMITTED' ? d.ackDueAt : d.updateDueAt)}#${id}`;
        } else {
          delete updated.gsi2pk;
          delete updated.gsi2sk;
        }
        writes.push({ ...this.issues.guard(post), item: updated });
        const changes: Array<{
          field: string;
          before: string | number | boolean | null;
          after: string | number | boolean | null;
        }> = [{ field: 'status', before: previous, after: String(d.status) }];
        if (cancelTransfer)
          changes.push({
            field: 'pendingTransfer',
            before: 'PENDING',
            after: 'CANCELLED_BY_RESOLUTION_PROPOSAL',
          });
        if ('nextAction' in data)
          changes.push({
            field: 'nextAction',
            before:
              typeof (post.detail as Record<string, unknown>).nextAction === 'string'
                ? String((post.detail as Record<string, unknown>).nextAction)
                : null,
            after: data.nextAction,
          });
        if ('nextUpdateAt' in data)
          changes.push({
            field: 'nextUpdateAt',
            before:
              typeof (post.detail as Record<string, unknown>).nextUpdateAt === 'string'
                ? String((post.detail as Record<string, unknown>).nextUpdateAt)
                : null,
            after: data.nextUpdateAt,
          });
        if (data.action === 'progress')
          changes.push({ field: 'progress', before: null, after: data.update });
        if (resolution)
          changes.push({
            field: 'resolutionId',
            before:
              typeof (post.detail as Record<string, unknown>).resolutionId === 'string'
                ? String((post.detail as Record<string, unknown>).resolutionId)
                : null,
            after: resolution.id,
          });
        return {
          resourceId: id,
          response: await this.issues.issueDto(updated, ctx.member),
          writes,
          eventType: `ISSUE_${data.action.toUpperCase().replaceAll('-', '_')}`,
          eventScope: 'READERS' as const,
          sourceVersion: version,
          event: {
            summary: summaries[data.action]!,
            ...('reason' in data ? { reason: data.reason } : {}),
            changes,
            ...(evidenceIds.length ? { attachmentIds: evidenceIds } : {}),
          },
        };
      },
      async () => this.issues.getIssue(actor, campus, id),
    );
  }
  async recheck(actor: string, campus: string, id: string, version: unknown, authVersion: number) {
    const current = await this.source(actor, campus, id);
    if (current.post.version !== version || current.ctx.member.authVersion !== authVersion)
      throw new ApiError(
        409,
        'SOURCE_CHANGED',
        'The issue or your access changed. Refresh this page.',
      );
  }
  async history(actor: string, campus: string, id: string, limit: number, cursor?: string) {
    const { ctx, post } = await this.source(actor, campus, id);
    const binding = JSON.stringify([
      'history',
      actor,
      campus,
      id,
      ctx.member.authVersion,
      post.aclVersion,
      limit,
    ]);
    const page = await this.store.query({
      table: this.config.CORE_TABLE,
      pk: post.pk,
      prefix: 'EVENT#',
      limit,
      descending: true,
      ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
    });
    const items = [];
    for (const e of page.items) {
      if (
        e.campusId !== campus ||
        (e.visibility === 'AUTHOR' && post.authorId !== actor) ||
        (e.visibility === 'HANDLERS' &&
          !canManageIssue(ctx.member, postAccessSchema.parse(post), true)) ||
        !['AUTHOR', 'READERS', 'HANDLERS'].includes(String(e.visibility))
      )
        continue;
      items.push(
        eventSchema.parse({
          id: e.id,
          campusId: campus,
          version: e.version,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          eventType: e.eventType,
          actor: typeof e.actorId === 'string' ? await this.issues.person(campus, e.actorId) : null,
          summary: e.summary ?? String(e.eventType).replaceAll('_', ' ').toLowerCase(),
          ...(e.reason ? { reason: e.reason } : {}),
          ...(e.changes ? { changes: e.changes } : {}),
          visibility:
            e.visibility === 'AUTHOR'
              ? 'REPORTER_HANDLERS'
              : e.visibility === 'HANDLERS'
                ? 'HANDLERS'
                : 'PUBLIC',
          ...(Array.isArray(e.attachmentIds)
            ? {
                attachmentIds: await this.issues.visibleFileIds(
                  post,
                  ctx.member,
                  e.attachmentIds as string[],
                ),
              }
            : {}),
        }),
      );
    }
    await this.recheck(actor, campus, id, post.version, ctx.member.authVersion);
    return eventPageSchema.parse({
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    });
  }
  async resolutions(actor: string, campus: string, id: string, limit: number, cursor?: string) {
    const { ctx, post } = await this.source(actor, campus, id);
    const binding = JSON.stringify([
      'resolutions',
      actor,
      campus,
      id,
      ctx.member.authVersion,
      post.aclVersion,
      limit,
    ]);
    const page = await this.store.query({
      table: this.config.CORE_TABLE,
      pk: post.pk,
      prefix: 'RESOLUTION#',
      limit,
      ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
    });
    const items = await Promise.all(
      page.items
        .filter((i) => i.campusId === campus && i.postId === id)
        .map((i) => this.issues.resolutionDto(i, post, ctx.member)),
    );
    await this.recheck(actor, campus, id, post.version, ctx.member.authVersion);
    return resolutionPageSchema.parse({
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    });
  }
  staff(member: MemberRecord, unit: string) {
    return (
      hasRole(member, 'UNIT_LEAD', unit) ||
      hasRole(member, 'HANDLER', unit) ||
      hasRole(member, 'SENSITIVE_HANDLER', unit)
    );
  }
  async queue(actor: string, campus: string, q: QueueQuery) {
    const { member } = await this.identity.member(actor, campus);
    let unit = q.unitId;
    if (!unit) {
      const scoped = [
        ...new Set(
          member.roles
            .filter(
              (r) =>
                r.scope === 'UNIT' &&
                r.scopeId &&
                Date.parse(r.expiresAt) > Date.now() &&
                ['UNIT_LEAD', 'HANDLER', 'SENSITIVE_HANDLER'].includes(r.role),
            )
            .map((r) => r.scopeId!),
        ),
      ];
      if (scoped.length === 1) unit = scoped[0];
    }
    if (!unit) throw new ApiError(422, 'UNIT_REQUIRED', 'Select one of your assigned units.');
    if (!this.staff(member, unit))
      throw new ApiError(403, 'QUEUE_FORBIDDEN', 'You cannot read this unit queue.');
    await this.issues.directory(campus, 'UNIT', unit);
    const { cursor, ...filters } = q;
    const binding = JSON.stringify(['queue', actor, campus, member.authVersion, unit, filters]);
    let after: Key | undefined = cursor ? this.identity.cursors.decode(cursor, binding) : undefined;
    const items: Issue[] = [];
    let examined = 0;
    while (items.length < q.limit && examined < 200) {
      const page = await this.store.query({
        table: this.config.CORE_TABLE,
        index: 'gsi2',
        pk: `C#${campus}#QUEUE#${unit}`,
        limit: Math.min(q.limit - items.length, 200 - examined),
        ...(after ? { after } : {}),
      });
      examined += page.items.length;
      after = page.next;
      for (const ref of page.items) {
        if (!ref.pk.startsWith(`C#${campus}#POST#`) || ref.sk !== 'META') continue;
        const post = await this.store.get(this.config.CORE_TABLE, { pk: ref.pk, sk: ref.sk });
        if (
          !post ||
          post.type !== 'ISSUE' ||
          !['PUBLISHED', 'RESTRICTED'].includes(String(post.publication)) ||
          !canReadPost(member, postAccessSchema.parse(post))
        )
          continue;
        const d = post.detail as Record<string, unknown>;
        if (
          d.unitId !== unit ||
          !active.concat('PROPOSED_RESOLVED').includes(String(d.status)) ||
          (q.status && d.status !== q.status) ||
          (q.categoryId && post.categoryId !== q.categoryId) ||
          (q.tab === 'MINE' && d.primaryOwnerId !== actor) ||
          (q.tab === 'AWAITING_CONFIRMATION' && d.status !== 'PROPOSED_RESOLVED')
        )
          continue;
        if (
          q.tab === 'OVERDUE' &&
          (d.status === 'PROPOSED_RESOLVED' ||
            Date.parse(
              String(d.status === 'SUBMITTED' ? d.ackDueAt : (d.nextUpdateAt ?? d.updateDueAt)),
            ) >= Date.now())
        )
          continue;
        items.push(await this.issues.getIssue(actor, campus, String(post.id)));
      }
      if (!after) break;
    }
    const fresh = await this.identity.member(actor, campus);
    if (fresh.member.authVersion !== member.authVersion || !this.staff(fresh.member, unit))
      throw new ApiError(409, 'ACCESS_CHANGED', 'Your queue access changed. Refresh this page.');
    const safe: Issue[] = [];
    for (const i of items) {
      const p = await this.issues.canonical(campus, i.id).catch(() => undefined);
      if (p && p.version === i.version && canReadPost(fresh.member, postAccessSchema.parse(p)))
        safe.push(i);
    }
    return {
      items: safe,
      nextCursor: after ? this.identity.cursors.encode(binding, after) : null,
      ...(examined >= 200 ? { candidateLimitReached: true } : {}),
    };
  }
}
