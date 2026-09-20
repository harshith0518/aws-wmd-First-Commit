import { involvement } from './involvement.js';
import { randomUUID } from 'node:crypto';
import {
  assignmentSchema,
  ownershipCommandSchema,
  accessEndedSchema,
  type OwnershipCommand,
  type Issue,
} from '@campusfix/contracts';
import { IssueService, discoveryKey } from './issues.js';
import { WorkflowService } from './workflow.js';
import { keys } from './data/keys.js';
import { type Item, type Write, WriteConflict } from './data/store.js';
import {
  canReadPost,
  canManageIssue,
  canAssignIssue,
  hasRole,
  postAccessSchema,
  transferRecipient,
  type MemberRecord,
} from './policy.js';
import { ApiError, unavailable } from './errors.js';
import { hash, type IdentityService } from './identity-service.js';
type Context = Awaited<ReturnType<IdentityService['member']>>;
const active = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING', 'REOPENED'];
const closed = ['CONFIRMED_CLOSED', 'DECLINED', 'DUPLICATE'];
export class OwnershipService {
  readonly workflow: WorkflowService;
  constructor(readonly issues: IssueService) {
    this.workflow = new WorkflowService(issues);
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
  eligible(member: MemberRecord, unit: string, restricted: boolean) {
    return restricted
      ? hasRole(member, 'SENSITIVE_HANDLER', unit)
      : hasRole(member, 'HANDLER', unit) || hasRole(member, 'UNIT_LEAD', unit);
  }
  guards(ctx: Context): Write[] {
    return [
      {
        table: this.config.CORE_TABLE,
        key: keys.member(ctx.member.campusId, ctx.member.userId),
        guard: { kind: 'member', version: ctx.member.version, now: new Date().toISOString() },
      },
      this.issues.guard(ctx.profile),
    ];
  }
  async candidate(campus: string, id: string, unit: string, restricted: boolean) {
    const ctx = await this.identity.member(id, campus);
    if (!this.eligible(ctx.member, unit, restricted))
      throw new ApiError(
        422,
        'HANDLER_INELIGIBLE',
        'Select an active handler with the required role in the destination unit.',
      );
    return ctx;
  }
  async pointers(post: Item, users: string[]) {
    const writes: Write[] = [];
    for (const u of new Set(users)) {
      const k = {
        pk: discoveryKey(String(post.campusId), `USER#${u}`),
        sk: `${post.createdAt}#${post.id}`,
      };
      if (!(await this.store.get(this.config.DISCOVERY_TABLE, k)))
        writes.push({
          table: this.config.DISCOVERY_TABLE,
          key: k,
          guard: { kind: 'absent' },
          item: { ...k, canonicalPk: post.pk, canonicalSk: post.sk, sourceVersion: post.version },
        });
    }
    return writes;
  }
  async candidates(
    actor: string,
    campus: string,
    id: string,
    unit: string,
    limit: number,
    cursor?: string,
  ) {
    const { ctx, post } = await this.workflow.source(actor, campus, id),
      access = postAccessSchema.parse(post);
    if (!canManageIssue(ctx.member, access) && !canAssignIssue(ctx.member, access))
      throw new ApiError(
        403,
        'ASSIGNMENT_FORBIDDEN',
        'Only the accountable owner or an authorized unit lead can choose handlers.',
      );
    await this.issues.directory(campus, 'UNIT', unit);
    const binding = JSON.stringify([
        'handler-candidates',
        actor,
        campus,
        id,
        unit,
        limit,
        post.aclVersion,
        ctx.member.authVersion,
      ]),
      page = await this.store.query({
        table: this.config.CORE_TABLE,
        pk: `C#${campus}`,
        prefix: 'MEMBER#',
        limit,
        ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
      }),
      items = [];
    for (const m of page.items) {
      if (typeof m.userId !== 'string') continue;
      try {
        const c = await this.identity.member(m.userId, campus);
        if (
          this.eligible(
            c.member,
            unit,
            access.audience.kind === 'RESTRICTED' || post.publication === 'RESTRICTED',
          )
        )
          items.push(await this.issues.person(campus, m.userId));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    await this.workflow.recheck(actor, campus, id, post.version, ctx.member.authVersion);
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
  async assign(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = assignmentSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `PUT issues/${id}/assignment`,
      key,
      data,
      async (ctx) => {
        const { post } = await this.workflow.source(actor, campus, id),
          access = postAccessSchema.parse(post),
          d = { ...(post.detail as Record<string, unknown>) };
        if (!canAssignIssue(ctx.member, access))
          throw new ApiError(
            403,
            'ASSIGNMENT_FORBIDDEN',
            'Only an authorized unit lead can change collaborators.',
          );
        if (post.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The report changed. Review current assignments.',
            Number(post.version),
          );
        if (!active.includes(String(d.status)))
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'Collaborators can be changed only while work is active.',
          );
        if (data.primaryOwnerId && data.primaryOwnerId !== d.primaryOwnerId)
          throw new ApiError(
            422,
            'TRANSFER_REQUIRED',
            'Changing the accountable owner requires an accepted transfer.',
          );
        if (data.collaboratorIds.includes(String(d.primaryOwnerId)))
          throw new ApiError(
            422,
            'OWNER_AS_COLLABORATOR',
            'The owner is already accountable; select other collaborators.',
          );
        const unit = await this.issues.directory(campus, 'UNIT', String(d.unitId)),
          restricted = access.audience.kind === 'RESTRICTED' || post.publication === 'RESTRICTED',
          guards: Write[] = [this.issues.guard(unit)];
        for (const user of data.collaboratorIds)
          guards.push(
            ...this.guards(await this.candidate(campus, user, String(d.unitId), restricted)),
          );
        const now = new Date().toISOString();
        d.collaboratorIds = data.collaboratorIds;
        if (restricted) d.caseHandlerIds = [String(d.primaryOwnerId), ...data.collaboratorIds];
        const updated = {
          ...post,
          version: data.expectedVersion + 1,
          aclVersion: Number(post.aclVersion) + 1,
          updatedAt: now,
          detail: d,
        };
        return {
          resourceId: id,
          response: await this.issues.issueDto(updated, ctx.member),
          writes: [
            ...guards,
            ...(await involvement(this.issues, post, data.collaboratorIds)),
            { ...this.issues.guard(post), item: updated },
            ...(await this.pointers(updated, data.collaboratorIds)),
          ],
          eventType: 'ISSUE_COLLABORATORS_CHANGED',
          eventScope: 'READERS' as const,
          sourceVersion: Number(updated.version),
          event: {
            summary: 'The unit lead updated the assigned collaborators.',
            reason: data.reason,
            changes: [
              {
                field: 'collaboratorIds',
                before: JSON.stringify(access.detail.collaboratorIds),
                after: JSON.stringify(data.collaboratorIds),
              },
            ],
          },
        };
      },
      async () => this.issues.getIssue(actor, campus, id),
    );
  }
  transferJob(campus: string, id: string, transfer: Record<string, unknown>): Write {
    const k = { pk: `C#${campus}#TRANSFER#${transfer.transferId}`, sk: 'EXPIRY' },
      shard = parseInt(hash(String(transfer.transferId)).slice(0, 2), 16) % 4;
    return {
      table: this.config.JOBS_TABLE,
      key: k,
      guard: { kind: 'absent' },
      item: {
        ...k,
        version: 1,
        id: transfer.transferId,
        campusId: campus,
        sourceId: id,
        kind: 'TRANSFER_EXPIRY',
        state: 'PENDING',
        attempts: 0,
        runAt: transfer.expiresAt,
        readyPk: `TRANSFERS#${shard}`,
        readySk: `${transfer.expiresAt}#${transfer.transferId}`,
      },
    };
  }
  async command(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = ownershipCommandSchema.parse(input);
    return this.issues.commands.execute<Issue | ReturnType<typeof accessEndedSchema.parse>>(
      actor,
      campus,
      `POST issues/${id}/commands`,
      key,
      data,
      async (ctx) => {
        const { post } = await this.workflow.source(actor, campus, id),
          access = postAccessSchema.parse(post),
          d = { ...(post.detail as Record<string, unknown>) },
          restricted = access.audience.kind === 'RESTRICTED' || post.publication === 'RESTRICTED';
        if (post.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The report changed. Review the current transfer.',
            Number(post.version),
          );
        if (!active.includes(String(d.status)))
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'Transfers require an issue with active work.',
          );
        const now = new Date().toISOString(),
          writes: Write[] = [],
          old = d.pendingTransfer as Record<string, unknown> | undefined;
        if (data.action === 'propose-transfer') {
          if (!canManageIssue(ctx.member, access))
            throw new ApiError(
              403,
              'TRANSFER_FORBIDDEN',
              'Only the current accountable owner can propose a transfer.',
            );
          if (old && Date.parse(String(old.expiresAt)) > Date.now())
            throw new ApiError(
              409,
              'TRANSFER_PENDING',
              'The current transfer must be accepted, rejected or expire first.',
            );
          if (data.toOwnerId === d.primaryOwnerId)
            throw new ApiError(422, 'SAME_OWNER', 'Choose another eligible owner.');
          const unit = await this.issues.directory(campus, 'UNIT', data.toUnitId),
            next = await this.candidate(campus, data.toOwnerId, data.toUnitId, restricted);
          writes.push(this.issues.guard(unit), ...this.guards(next));
          const pending = {
            transferId: randomUUID(),
            toUnitId: data.toUnitId,
            toOwnerId: data.toOwnerId,
            proposedAt: now,
            expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
            reason: data.reason,
          };
          d.pendingTransfer = pending;
          writes.push(this.transferJob(campus, id, pending));
        } else {
          if (
            !old ||
            old.transferId !== data.transferId ||
            Date.parse(String(old.expiresAt)) <= Date.now()
          )
            throw new ApiError(409, 'TRANSFER_EXPIRED', 'This transfer is no longer available.');
          if (old.toOwnerId !== actor || !transferRecipient(ctx.member, access))
            throw new ApiError(
              403,
              'TRANSFER_RECIPIENT_REQUIRED',
              'Only the proposed eligible owner can respond.',
            );
          const unit = await this.issues.directory(campus, 'UNIT', String(old.toUnitId));
          writes.push(this.issues.guard(unit));
          if (data.action === 'accept-transfer') {
            const sameUnit = d.unitId === old.toUnitId;
            d.primaryOwnerId = actor;
            d.unitId = old.toUnitId;
            d.collaboratorIds = sameUnit
              ? ((d.collaboratorIds ?? []) as string[]).filter((u) => u !== actor)
              : [];
            d.caseHandlerIds = restricted ? [actor, ...(d.collaboratorIds as string[])] : [];
          }
          delete d.pendingTransfer;
        }
        const updated: Item = {
          ...post,
          version: data.expectedVersion + 1,
          aclVersion: Number(post.aclVersion) + 1,
          updatedAt: now,
          detail: d,
        };
        if (!closed.includes(String(d.status))) {
          updated.gsi2pk = `C#${campus}#QUEUE#${d.unitId}`;
          updated.gsi2sk = `${d.nextUpdateAt ?? (d.status === 'SUBMITTED' ? d.ackDueAt : d.updateDueAt)}#${id}`;
        }
        writes.push(
          { ...this.issues.guard(post), item: updated },
          ...(await this.pointers(
            updated,
            data.action === 'propose-transfer' ? [data.toOwnerId] : [],
          )),
        );
        if (data.action === 'accept-transfer')
          writes.push(...(await involvement(this.issues, post, [actor])));
        const response = canReadPost(ctx.member, postAccessSchema.parse(updated))
          ? await this.issues.issueDto(updated, ctx.member)
          : accessEndedSchema.parse({ postId: id, version: updated.version, accessEnded: true });
        return {
          resourceId: id,
          response,
          writes,
          eventType: `ISSUE_${data.action.toUpperCase().replaceAll('-', '_')}`,
          eventScope: 'READERS' as const,
          sourceVersion: Number(updated.version),
          event: {
            summary:
              data.action === 'propose-transfer'
                ? 'The owner proposed a handover; current ownership remains in force.'
                : data.action === 'accept-transfer'
                  ? 'The proposed owner accepted accountability.'
                  : 'The proposed owner declined the handover; current ownership remains in force.',
            ...('reason' in data ? { reason: data.reason } : {}),
            changes: [
              {
                field: 'primaryOwnerId',
                before: String(access.detail.primaryOwnerId),
                after: String(d.primaryOwnerId),
              },
              { field: 'unitId', before: String(access.detail.unitId), after: String(d.unitId) },
            ],
          },
        };
      },
      async (_id, response) => {
        try {
          return await this.issues.getIssue(actor, campus, id);
        } catch (e) {
          if (data.action === 'reject-transfer' && e instanceof ApiError && e.status === 404)
            return accessEndedSchema.parse({
              postId: id,
              version: (response as { version: number }).version,
              accessEnded: true,
            });
          throw e;
        }
      },
    );
  }
  async expire(now = Date.now()) {
    let expired = 0,
      failed = 0;
    for (let shard = 0; shard < 4; shard++) {
      const page = await this.store.query({
        table: this.config.JOBS_TABLE,
        index: 'ready',
        pk: `TRANSFERS#${shard}`,
        sortAtMost: `${new Date(now).toISOString()}#~`,
        limit: 10,
      });
      for (const ref of page.items) {
        const job = await this.store.get(this.config.JOBS_TABLE, { pk: ref.pk, sk: ref.sk });
        if (
          !job ||
          job.kind !== 'TRANSFER_EXPIRY' ||
          job.state !== 'PENDING' ||
          Date.parse(String(job.runAt)) > now
        )
          continue;
        try {
          const post = await this.store.get(
              this.config.CORE_TABLE,
              keys.post(String(job.campusId), String(job.sourceId)),
            ),
            d = { ...(post?.detail as Record<string, unknown>) },
            t = d.pendingTransfer as Record<string, unknown> | undefined,
            done: Item = {
              ...job,
              version: Number(job.version) + 1,
              state: 'DONE',
              expiresAt: Math.floor(now / 1000) + 7 * 86400,
            };
          delete done.readyPk;
          delete done.readySk;
          const writes: Write[] = [
            {
              table: this.config.JOBS_TABLE,
              key: { pk: job.pk, sk: job.sk },
              guard: { kind: 'version', version: Number(job.version) },
              item: done,
            },
          ];
          if (post && t && t.transferId === job.id && Date.parse(String(t.expiresAt)) <= now) {
            delete d.pendingTransfer;
            const at = new Date(now).toISOString(),
              updated = {
                ...post,
                detail: d,
                version: Number(post.version) + 1,
                aclVersion: Number(post.aclVersion) + 1,
                updatedAt: at,
              },
              ek = { pk: post.pk, sk: `EVENT#${t.expiresAt}#${job.id}` },
              jk = { pk: `C#${job.campusId}#JOB#${job.id}`, sk: 'META' };
            writes.push(
              { ...this.issues.guard(post), item: updated },
              {
                table: this.config.CORE_TABLE,
                key: ek,
                guard: { kind: 'absent' },
                item: {
                  ...ek,
                  id: job.id,
                  campusId: job.campusId,
                  entityType: 'EVENT',
                  schemaVersion: 1,
                  version: 1,
                  createdAt: at,
                  updatedAt: at,
                  eventType: 'ISSUE_TRANSFER_EXPIRED',
                  visibility: 'READERS',
                  summary:
                    'The handover expired after 48 hours; the current owner remains accountable.',
                  rule: 'TRANSFER_48_HOURS',
                  sourceVersion: updated.version,
                },
              },
              {
                table: this.config.JOBS_TABLE,
                key: jk,
                guard: { kind: 'absent' },
                item: {
                  ...jk,
                  kind: 'ISSUE_TRANSFER_EXPIRED',
                  sourceId: post.id,
                  sourceVersion: updated.version,
                  state: 'PENDING',
                  attempts: 0,
                  runAt: at,
                  readyPk: `READY#${String(shard).padStart(2, '0')}`,
                  readySk: `${at}#${job.id}`,
                  expiresAt: Math.floor(now / 1000) + 7 * 86400,
                },
              },
            );
          }
          await this.store.transact(writes);
          expired++;
        } catch (e) {
          if (e instanceof WriteConflict) continue;
          const attempts = Number(job.attempts ?? 0) + 1,
            next: Item = {
              ...job,
              version: Number(job.version) + 1,
              attempts,
              state: attempts >= 5 ? 'FAILED' : 'PENDING',
              runAt: new Date(now + Math.min(900000, 30000 * 2 ** attempts)).toISOString(),
              readyPk: attempts >= 5 ? `TRANSFERS_FAILED#${shard}` : job.readyPk,
            };
          next.readySk = `${next.runAt}#${job.id}`;
          try {
            await this.store.transact([
              {
                table: this.config.JOBS_TABLE,
                key: { pk: job.pk, sk: job.sk },
                guard: { kind: 'version', version: Number(job.version) },
                item: next,
              },
            ]);
          } catch (retry) {
            if (!(retry instanceof WriteConflict)) throw retry;
          }
          if (attempts >= 5) failed++;
        }
      }
    }
    if (failed) throw new Error('Transfer expiry jobs exhausted their retry limit.');
    return { processed: expired };
  }
}
