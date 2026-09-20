import { randomUUID } from 'node:crypto';
import {
  replyCreateSchema,
  replyEditSchema,
  replyRemoveSchema,
  replySchema,
  replyRevisionSchema,
  supportResultSchema,
  supportToggleSchema,
  type ReplyQuery,
} from '@campusfix/contracts';
import { WorkflowService } from './workflow.js';
import { IssueService } from './issues.js';
import {
  canReadPost,
  canManageIssue,
  postAccessSchema,
  hasRole,
  type MemberRecord,
} from './policy.js';
import { ApiError, unavailable } from './errors.js';
import { keys } from './data/keys.js';
import type { Item, Write } from './data/store.js';
export const replyReference = (campus: string, id: string) => ({
  pk: `C#${campus}#REPLY#${id}`,
  sk: 'REF',
});
export class DiscussionService {
  readonly workflow: WorkflowService;
  constructor(readonly issues: IssueService) {
    this.workflow = new WorkflowService(issues);
  }
  get store() {
    return this.issues.store;
  }
  get config() {
    return this.issues.config;
  }
  get identity() {
    return this.issues.identity;
  }
  canRead(member: MemberRecord, post: Item, reply: Item) {
    return (
      reply.campusId === post.campusId &&
      reply.postId === post.id &&
      canReadPost(member, postAccessSchema.parse(post)) &&
      (reply.scope === 'PUBLIC' ||
        (reply.scope === 'STAFF' && canManageIssue(member, postAccessSchema.parse(post), true)))
    );
  }
  async canonical(campus: string, postId: string, id: string) {
    const ref = await this.store.get(this.config.CORE_TABLE, replyReference(campus, id));
    if (
      !ref ||
      ref.postId !== postId ||
      ref.campusId !== campus ||
      typeof ref.replySk !== 'string' ||
      !ref.replySk.startsWith('REPLY#')
    )
      throw unavailable();
    const reply = await this.store.get(this.config.CORE_TABLE, {
      pk: keys.post(campus, postId).pk,
      sk: ref.replySk,
    });
    if (!reply || reply.id !== id || reply.postId !== postId || reply.campusId !== campus)
      throw unavailable();
    return reply;
  }
  async source(actor: string, campus: string, postId: string, id: string) {
    const { ctx, post } = await this.workflow.source(actor, campus, postId),
      reply = await this.canonical(campus, postId, id);
    if (!this.canRead(ctx.member, post, reply)) throw unavailable();
    return { ctx, post, reply };
  }
  role(member: MemberRecord, post: Item) {
    if (!canManageIssue(member, postAccessSchema.parse(post), true)) return 'MEMBER';
    const unit = String((post.detail as Item).unitId);
    return hasRole(member, 'SENSITIVE_HANDLER', unit)
      ? 'SENSITIVE_HANDLER'
      : hasRole(member, 'UNIT_LEAD', unit)
        ? 'UNIT_LEAD'
        : 'HANDLER';
  }
  async dto(reply: Item) {
    return replySchema.parse({
      id: reply.id,
      campusId: reply.campusId,
      version: reply.version,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      author: await this.issues.person(String(reply.campusId), String(reply.authorId)),
      body: reply.removedAt ? '' : reply.body,
      scope: reply.scope,
      ...(reply.parentReplyId ? { parentReplyId: reply.parentReplyId } : {}),
      ...(reply.editedAt ? { editedAt: reply.editedAt } : {}),
      ...(reply.removedAt ? { removedAt: reply.removedAt } : {}),
      usefulCount: 0,
      viewerVoted: false,
      attachmentIds: [],
      mentions: reply.removedAt
        ? []
        : await Promise.all(
            ((reply.mentionIds ?? []) as string[]).map((id) =>
              this.issues.person(String(reply.campusId), id),
            ),
          ),
      roleAtPosting: reply.roleAtPosting ?? 'MEMBER',
    });
  }
  async get(actor: string, campus: string, postId: string, id: string) {
    const { ctx, post, reply } = await this.source(actor, campus, postId, id),
      dto = await this.dto(reply);
    await this.workflow.recheck(actor, campus, postId, post.version, ctx.member.authVersion);
    return dto;
  }
  async list(actor: string, campus: string, postId: string, q: ReplyQuery) {
    const { ctx, post } = await this.workflow.source(actor, campus, postId);
    if (q.scope === 'STAFF' && !canManageIssue(ctx.member, postAccessSchema.parse(post), true))
      throw unavailable();
    if (q.parentReplyId) {
      const parent = await this.canonical(campus, postId, q.parentReplyId);
      if (
        !this.canRead(ctx.member, post, parent) ||
        parent.scope !== q.scope ||
        parent.parentReplyId
      )
        throw unavailable();
    }
    const binding = JSON.stringify([
      'replies',
      actor,
      campus,
      postId,
      ctx.member.authVersion,
      post.aclVersion,
      q.limit,
      q.scope,
      q.parentReplyId ?? null,
    ]);
    const page = await this.store.query({
      table: this.config.CORE_TABLE,
      pk: post.pk,
      prefix: 'REPLY#',
      limit: q.limit,
      ...(q.cursor ? { after: this.identity.cursors.decode(q.cursor, binding) } : {}),
    });
    const items = [];
    for (const item of page.items)
      if (
        item.scope === q.scope &&
        (item.parentReplyId ?? undefined) === q.parentReplyId &&
        this.canRead(ctx.member, post, item)
      )
        items.push(await this.dto(item));
    await this.workflow.recheck(actor, campus, postId, post.version, ctx.member.authVersion);
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
  async quota(actor: string, campus: string, settings: Record<string, unknown>, feature = 'REPLY') {
    const hour = Math.floor(Date.now() / 3600000),
      key = { pk: `C#${campus}#QUOTA#${actor}`, sk: `${feature}#HOUR#${hour}` },
      old = await this.store.get(this.config.JOBS_TABLE, key),
      count = Number(old?.count ?? 0),
      limit =
        feature === 'REPLY'
          ? Math.min(30, Number(settings.repliesPerHour ?? 30))
          : Math.min(60, Number(settings.reactionsPerHour ?? 60));
    if (!Number.isFinite(limit) || limit < 1 || count >= limit)
      throw new ApiError(
        429,
        feature === 'REPLY' ? 'REPLY_QUOTA_REACHED' : 'SUPPORT_QUOTA_REACHED',
        'You have reached the hourly limit for this action.',
      );
    return {
      table: this.config.JOBS_TABLE,
      key,
      guard: old
        ? { kind: 'version' as const, version: Number(old.version) }
        : { kind: 'absent' as const },
      item: {
        ...key,
        count: count + 1,
        version: Number(old?.version ?? 0) + 1,
        expiresAt: (hour + 2) * 3600,
      },
    };
  }
  async create(actor: string, campus: string, postId: string, input: unknown, key: string) {
    const data = replyCreateSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST posts/${postId}/replies`,
      key,
      data,
      async (ctx) => {
        const { post } = await this.workflow.source(actor, campus, postId);
        if (
          data.scope === 'STAFF' &&
          !canManageIssue(ctx.member, postAccessSchema.parse(post), true)
        )
          throw new ApiError(
            403,
            'STAFF_NOTE_FORBIDDEN',
            'Only assigned handlers can write staff notes.',
          );
        const guards: Write[] = [];
        if (data.parentReplyId) {
          const parent = await this.canonical(campus, postId, data.parentReplyId);
          if (!this.canRead(ctx.member, post, parent)) throw unavailable();
          if (parent.parentReplyId || parent.scope !== data.scope)
            throw new ApiError(
              422,
              'REPLY_NESTING',
              'Replies allow one nesting level and must retain their parent’s scope.',
            );
          guards.push(this.issues.guard(parent));
        }
        for (const id of data.mentionIds ?? []) {
          const mentioned = await this.identity.member(id, campus);
          if (
            !canReadPost(mentioned.member, postAccessSchema.parse(post)) ||
            (data.scope === 'STAFF' &&
              !canManageIssue(mentioned.member, postAccessSchema.parse(post), true))
          )
            throw new ApiError(
              422,
              'MENTION_NOT_ALLOWED',
              'Mention only current readers of this conversation.',
            );
          guards.push(
            {
              table: this.config.CORE_TABLE,
              key: keys.member(campus, id),
              guard: {
                kind: 'member',
                version: mentioned.member.version,
                now: new Date().toISOString(),
              },
            },
            {
              table: this.config.CORE_TABLE,
              key: keys.profile(id),
              guard: { kind: 'version', version: Number(mentioned.profile.version) },
            },
          );
        }
        const id = randomUUID(),
          now = new Date().toISOString(),
          reply: Item = {
            pk: post.pk,
            sk: `REPLY#${now}#${id}`,
            ...data,
            id,
            campusId: campus,
            postId,
            entityType: 'REPLY',
            schemaVersion: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
            authorId: actor,
            roleAtPosting: this.role(ctx.member, post),
            attachmentIds: [],
          };
        const ref = replyReference(campus, id),
          updated = { ...post, version: Number(post.version) + 1, updatedAt: now };
        return {
          resourceId: postId,
          response: await this.dto(reply),
          writes: [
            ...guards,
            await this.quota(actor, campus, (ctx.campus.quotas ?? {}) as Record<string, unknown>),
            { ...this.issues.guard(post), item: updated },
            {
              table: this.config.CORE_TABLE,
              key: { pk: reply.pk, sk: reply.sk },
              guard: { kind: 'absent' },
              item: reply,
            },
            {
              table: this.config.CORE_TABLE,
              key: ref,
              guard: { kind: 'absent' },
              item: { ...ref, id, postId, campusId: campus, replySk: reply.sk, version: 1 },
            },
          ],
          eventType: 'REPLY_CREATED',
          eventScope: data.scope === 'STAFF' ? ('HANDLERS' as const) : ('READERS' as const),
          sourceVersion: Number(updated.version),
          event: {
            summary:
              data.scope === 'STAFF'
                ? 'An assigned handler added a private staff note.'
                : 'A member added a reply.',
            replyId: id,
            mentionIds: data.mentionIds ?? [],
          },
        };
      },
      async (_id, response) => this.get(actor, campus, postId, (response as { id: string }).id),
    );
  }
  async change(
    actor: string,
    campus: string,
    postId: string,
    id: string,
    input: unknown,
    key: string,
    remove = false,
  ) {
    const data = remove ? replyRemoveSchema.parse(input) : replyEditSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `${remove ? 'POST' : 'PATCH'} posts/${postId}/replies/${id}${remove ? '/remove' : ''}`,
      key,
      data,
      async (ctx) => {
        const { post, reply } = await this.source(actor, campus, postId, id);
        if (reply.authorId !== actor)
          throw new ApiError(403, 'REPLY_AUTHOR_REQUIRED', 'Only the reply author can change it.');
        if (reply.removedAt)
          throw new ApiError(422, 'REPLY_REMOVED', 'This reply was already removed.');
        if (reply.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The reply changed. Review its latest version.',
            Number(reply.version),
          );
        if (!remove && 'body' in data && data.body === reply.body)
          throw new ApiError(422, 'NO_CHANGES', 'Change the reply text before saving a revision.');
        const now = new Date().toISOString(),
          rk = { pk: post.pk, sk: `REV#${id}#${String(reply.version).padStart(8, '0')}` },
          revision = {
            ...rk,
            id: randomUUID(),
            campusId: campus,
            replyId: id,
            version: Number(reply.version),
            entityType: 'REPLY_REVISION',
            schemaVersion: 1,
            body: reply.body,
            scope: reply.scope,
            actorId: actor,
            reason: data.reason,
            createdAt: now,
            updatedAt: now,
          };
        const updatedReply = {
            ...reply,
            version: Number(reply.version) + 1,
            updatedAt: now,
            ...(remove
              ? { removedAt: now, body: '', attachmentIds: [] }
              : { body: 'body' in data ? data.body : reply.body, editedAt: now }),
          },
          updated = { ...post, version: Number(post.version) + 1, updatedAt: now };
        return {
          resourceId: postId,
          response: await this.dto(updatedReply),
          writes: [
            ...(!remove
              ? [
                  await this.quota(
                    actor,
                    campus,
                    (ctx.campus.quotas ?? {}) as Record<string, unknown>,
                  ),
                ]
              : []),
            { ...this.issues.guard(reply), item: updatedReply },
            { ...this.issues.guard(post), item: updated },
            { table: this.config.CORE_TABLE, key: rk, guard: { kind: 'absent' }, item: revision },
          ],
          eventType: remove ? 'REPLY_REMOVED' : 'REPLY_REVISED',
          eventScope: reply.scope === 'STAFF' ? ('HANDLERS' as const) : ('READERS' as const),
          sourceVersion: Number(updated.version),
          event: {
            summary: remove
              ? 'The author removed a reply; its placeholder remains.'
              : 'The author revised a reply.',
            replyId: id,
            reason: data.reason,
          },
        };
      },
      async () => this.get(actor, campus, postId, id),
    );
  }
  async revisions(
    actor: string,
    campus: string,
    postId: string,
    id: string,
    limit: number,
    cursor?: string,
  ) {
    const { ctx, post, reply } = await this.source(actor, campus, postId, id);
    const binding = JSON.stringify([
        'reply-revisions',
        actor,
        campus,
        postId,
        id,
        ctx.member.authVersion,
        post.aclVersion,
        limit,
      ]),
      page = await this.store.query({
        table: this.config.CORE_TABLE,
        pk: post.pk,
        prefix: `REV#${id}#`,
        limit,
        descending: true,
        ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
      });
    const items = [];
    for (const r of page.items) {
      if (r.campusId !== campus || r.replyId !== id || r.scope !== reply.scope) continue;
      // A removed body must not be recovered through a revision endpoint by an ordinary reader.
      if (
        reply.removedAt &&
        actor !== reply.authorId &&
        !canManageIssue(ctx.member, postAccessSchema.parse(post), true)
      )
        continue;
      items.push(
        replyRevisionSchema.parse({
          id: r.id,
          campusId: campus,
          replyId: id,
          version: r.version,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          body: r.body,
          scope: r.scope,
          actor: await this.issues.person(campus, String(r.actorId)),
          reason: r.reason,
        }),
      );
    }
    await this.workflow.recheck(actor, campus, postId, post.version, ctx.member.authVersion);
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
  async supportState(actor: string, campus: string, postId: string) {
    const { ctx, post } = await this.workflow.source(actor, campus, postId),
      support = await this.store.get(this.config.CORE_TABLE, {
        pk: post.pk,
        sk: `SUPPORT#${actor}`,
      });
    await this.workflow.recheck(actor, campus, postId, post.version, ctx.member.authVersion);
    return supportResultSchema.parse({
      postId,
      version: post.version,
      supported: support?.enabled === true,
      supportCount: (post.detail as Item).supportCount,
    });
  }
  async support(actor: string, campus: string, postId: string, input: unknown, key: string) {
    const data = supportToggleSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `PUT issues/${postId}/support`,
      key,
      data,
      async (ctx) => {
        const { post } = await this.workflow.source(actor, campus, postId),
          k = { pk: post.pk, sk: `SUPPORT#${actor}` },
          old = await this.store.get(this.config.CORE_TABLE, k),
          enabled = old?.enabled === true;
        const changed = enabled !== data.enabled;
        if (changed && post.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The report changed. Review the current support state.',
            Number(post.version),
          );
        const count =
          Number((post.detail as Item).supportCount) + (changed ? (data.enabled ? 1 : -1) : 0);
        if (count < 0 || count > 1000000)
          throw new ApiError(422, 'SUPPORT_LIMIT', 'This support count cannot be updated.');
        const now = new Date().toISOString(),
          updated = {
            ...post,
            ...(changed
              ? {
                  version: Number(post.version) + 1,
                  updatedAt: now,
                  detail: { ...(post.detail as Item), supportCount: count },
                }
              : {}),
          },
          writes: Write[] = [
            await this.quota(
              actor,
              campus,
              (ctx.campus.quotas ?? {}) as Record<string, unknown>,
              'SUPPORT',
            ),
            { ...this.issues.guard(post), ...(changed ? { item: updated } : {}) },
          ];
        if (changed)
          writes.push({
            table: this.config.CORE_TABLE,
            key: k,
            guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
            item: {
              ...k,
              id: old?.id ?? randomUUID(),
              campusId: campus,
              postId,
              userId: actor,
              entityType: 'SUPPORT',
              schemaVersion: 1,
              version: Number(old?.version ?? 0) + 1,
              enabled: data.enabled,
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
              ...(data.enabled
                ? { gsi1pk: `C#${campus}#USER#${actor}`, gsi1sk: `SUPPORT#${now}#${postId}` }
                : {}),
            },
          });
        else if (old) writes.push(this.issues.guard(old));
        return {
          resourceId: postId,
          response: supportResultSchema.parse({
            postId,
            version: updated.version,
            supported: data.enabled,
            supportCount: count,
          }),
          writes,
          eventType: changed ? 'ISSUE_SUPPORT_CHANGED' : 'ISSUE_SUPPORT_UNCHANGED',
          eventScope: 'AUTHOR' as const,
          sourceVersion: Number(updated.version),
          event: {
            summary: changed
              ? 'A member changed their affected status.'
              : 'A member confirmed their existing affected status.',
          },
        };
      },
      async () => this.supportState(actor, campus, postId),
    );
  }
}
