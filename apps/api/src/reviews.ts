import { randomUUID } from 'node:crypto';
import {
  reviewCreateSchema,
  reviewSchema,
  reviewPageSchema,
  reviewCommandSchema,
  reviewResponseCreateSchema,
  reviewResponseSchema,
  reviewEventSchema,
  calendarSchema,
  type ServiceReview,
} from '@campusfix/contracts';
import { IssueService } from './issues.js';
import { WorkflowService } from './workflow.js';
import { DiscussionService } from './discussion.js';
import { hasRole, type MemberRecord } from './policy.js';
import { keys } from './data/keys.js';
import { type Item, type Write } from './data/store.js';
import { ApiError, unavailable } from './errors.js';
import { workingDeadline } from './calendar.js';
import { OwnershipService } from './ownership.js';
export const reviewKey = (campus: string, id: string) => ({
  pk: `C#${campus}#REVIEW#${id}`,
  sk: 'META',
});
export class ReviewService {
  readonly workflow: WorkflowService;
  readonly ownership: OwnershipService;
  constructor(readonly issues: IssueService) {
    this.workflow = new WorkflowService(issues);
    this.ownership = new OwnershipService(issues);
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
  async canonical(campus: string, id: string) {
    const review = await this.store.get(this.config.CORE_TABLE, reviewKey(campus, id));
    if (
      !review ||
      review.entityType !== 'SERVICE_REVIEW' ||
      review.campusId !== campus ||
      review.id !== id
    )
      throw unavailable();
    return review;
  }
  async independent(member: MemberRecord, review: Item, post?: Item) {
    if (!hasRole(member, 'REVIEWER', String(review.sourceUnitId))) return false;
    if (
      [
        review.requesterId,
        review.subjectId,
        review.replyAuthorId,
        review.originalOwnerId,
        ...((review.originalCollaboratorIds ?? []) as string[]),
      ].includes(member.userId)
    )
      return false;
    const source =
      post ??
      (await this.store.get(
        this.config.CORE_TABLE,
        keys.post(member.campusId, String(review.issueId)),
      ));
    if (!source) return false;
    const d = source.detail as Record<string, unknown>;
    if ([d.primaryOwnerId, ...((d.collaboratorIds ?? []) as string[])].includes(member.userId))
      return false;
    return !(await this.store.get(this.config.CORE_TABLE, {
      pk: source.pk,
      sk: `INVOLVED#${member.userId}`,
    }));
  }
  async source(actor: string, campus: string, id: string) {
    const ctx = await this.identity.member(actor, campus),
      review = await this.canonical(campus, id),
      isReviewer = review.reviewerId === actor && (await this.independent(ctx.member, review));
    if (review.requesterId !== actor && !isReviewer) throw unavailable();
    return { ctx, review, isReviewer };
  }
  async dto(review: Item, isReviewer: boolean): Promise<ServiceReview> {
    const reviewerAvailable =
      typeof review.reviewerId === 'string'
        ? await this.identity
            .member(review.reviewerId, String(review.campusId))
            .then((c) => this.independent(c.member, review))
            .catch((e) => {
              if (e instanceof ApiError && e.status === 404) return false;
              throw e;
            })
        : false;
    const fields = [
      'id',
      'campusId',
      'version',
      'createdAt',
      'updatedAt',
      'issueId',
      'replyId',
      'reasonCode',
      'description',
      'desiredOutcome',
      'state',
      'dueAt',
      'nextUpdateAt',
      'decisionReason',
      'correctiveAction',
      'decisionOutcome',
      'correctiveOwnerId',
      'decisionId',
      'ackDueAt',
      'decisionDueAt',
      'appealDeadline',
    ];
    return reviewSchema.parse({
      ...Object.fromEntries(
        fields.filter((k) => review[k] !== undefined).map((k) => [k, review[k]]),
      ),
      requester: await this.issues.person(String(review.campusId), String(review.requesterId)),
      ...(review.reviewerId
        ? { reviewer: await this.issues.person(String(review.campusId), String(review.reviewerId)) }
        : {}),
      ...(review.subjectId
        ? { subject: await this.issues.person(String(review.campusId), String(review.subjectId)) }
        : {}),
      evidenceIds: [],
      reviewerAvailable,
      capabilities: [
        ...(review.state !== 'CLOSED' ? ['RESPOND'] : []),
        ...(isReviewer
          ? review.state === 'OPEN'
            ? ['BEGIN']
            : review.state === 'IN_REVIEW'
              ? ['DECIDE', 'REQUIRE_ACTION']
              : review.state === 'ACTION_REQUIRED'
                ? ['CLOSE']
                : []
          : []),
      ],
    });
  }
  async get(actor: string, campus: string, id: string) {
    const { ctx, review, isReviewer } = await this.source(actor, campus, id),
      dto = await this.dto(review, isReviewer);
    const fresh = await this.source(actor, campus, id);
    if (
      fresh.review.version !== review.version ||
      fresh.ctx.member.authVersion !== ctx.member.authVersion
    )
      throw new ApiError(409, 'REVIEW_CHANGED', 'The review or your access changed. Reload it.');
    return dto;
  }
  ref(campus: string, user: string, review: Item): Write {
    const k = { pk: `C#${campus}#MEMBER#${user}`, sk: `REVIEW#${review.createdAt}#${review.id}` };
    return {
      table: this.config.CORE_TABLE,
      key: k,
      guard: { kind: 'absent' },
      item: { ...k, campusId: campus, reviewId: review.id, version: 1 },
    };
  }
  async quota(actor: string, campus: string, feature: string, maximum: number) {
    const seconds = feature === 'REVIEW_CREATE' ? 86400 : 3600,
      period = Math.floor(Date.now() / 1000 / seconds),
      k = { pk: `C#${campus}#QUOTA#${actor}`, sk: `${feature}#${period}` },
      old = await this.store.get(this.config.JOBS_TABLE, k);
    if (Number(old?.count ?? 0) >= maximum)
      throw new ApiError(
        429,
        'REVIEW_QUOTA_REACHED',
        'The review action limit was reached. Please try again later.',
      );
    return {
      table: this.config.JOBS_TABLE,
      key: k,
      guard: old
        ? { kind: 'version' as const, version: Number(old.version) }
        : { kind: 'absent' as const },
      item: {
        ...k,
        version: Number(old?.version ?? 0) + 1,
        count: Number(old?.count ?? 0) + 1,
        expiresAt: (period + 2) * seconds,
      },
    };
  }
  async create(actor: string, campus: string, input: unknown, key: string) {
    const data = reviewCreateSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      'POST service-reviews',
      key,
      data,
      async (ctx) => {
        const { post } = await this.workflow.source(actor, campus, data.issueId),
          d = post.detail as Record<string, unknown>,
          guards: Write[] = [this.issues.guard(post)],
          activeKey = { pk: post.pk, sk: `REVIEW_ACTIVE#${actor}` },
          old = await this.store.get(this.config.CORE_TABLE, activeKey);
        if (old?.active === true)
          throw new ApiError(
            409,
            'ACTIVE_REVIEW_EXISTS',
            'You already have an active review for this report. Open it from your service reviews.',
          );
        let replyAuthorId: string | undefined;
        if (data.replyId) {
          const replies = new DiscussionService(this.issues),
            reply = await replies.source(actor, campus, data.issueId, data.replyId);
          replyAuthorId = String(reply.reply.authorId);
          guards.push(this.issues.guard(reply.reply));
        }
        if (data.subjectId)
          guards.push(...this.ownership.guards(await this.identity.member(data.subjectId, campus)));
        const now = new Date().toISOString(),
          id = randomUUID(),
          calendar = calendarSchema.parse(ctx.campus.businessCalendar),
          review: Item = {
            ...reviewKey(campus, id),
            ...data,
            id,
            campusId: campus,
            entityType: 'SERVICE_REVIEW',
            schemaVersion: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
            requesterId: actor,
            sourceUnitId: d.unitId,
            originalOwnerId: d.primaryOwnerId,
            originalCollaboratorIds: d.collaboratorIds ?? [],
            ...(replyAuthorId ? { replyAuthorId } : {}),
            state: 'ESCALATED',
            evidenceIds: [],
            ackDueAt: workingDeadline(now, 2, calendar),
            decisionDueAt: workingDeadline(now, 5, calendar),
            calendarVersion: ctx.campus.policyVersion,
          };
        const unit = await this.issues.directory(campus, 'UNIT', String(d.unitId));
        guards.push(this.issues.guard(unit));
        for (const candidate of new Set([unit.escalationId, ctx.campus.independentReviewerId])) {
          if (typeof candidate !== 'string') continue;
          try {
            const c = await this.identity.member(candidate, campus);
            if (await this.independent(c.member, review, post)) {
              review.reviewerId = candidate;
              review.state = 'OPEN';
              guards.push(...this.ownership.guards(c));
              break;
            }
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 404)) throw e;
          }
        }
        const marker = {
          ...activeKey,
          reviewId: id,
          active: true,
          version: Number(old?.version ?? 0) + 1,
        };
        return {
          resourceId: id,
          resourceKind: 'REVIEW' as const,
          response: await this.dto(review, false),
          writes: [
            ...guards,
            await this.quota(actor, campus, 'REVIEW_CREATE', 3),
            {
              table: this.config.CORE_TABLE,
              key: reviewKey(campus, id),
              guard: { kind: 'absent' },
              item: review,
            },
            {
              table: this.config.CORE_TABLE,
              key: activeKey,
              guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
              item: marker,
            },
            this.ref(campus, actor, review),
            ...(review.reviewerId ? [this.ref(campus, String(review.reviewerId), review)] : []),
          ],
          eventType: 'SERVICE_REVIEW_CREATED',
          eventScope: 'REVIEW_PARTIES' as const,
          sourceVersion: 1,
          event: {
            summary: review.reviewerId
              ? 'A private service review was assigned to an independent reviewer.'
              : 'A private service review is awaiting an eligible independent reviewer.',
          },
        };
      },
      async (id) => this.get(actor, campus, id),
    );
  }
  async list(actor: string, campus: string, limit: number, cursor?: string) {
    const ctx = await this.identity.member(actor, campus),
      binding = JSON.stringify(['reviews', actor, campus, limit, ctx.member.authVersion]),
      page = await this.store.query({
        table: this.config.CORE_TABLE,
        pk: `C#${campus}#MEMBER#${actor}`,
        prefix: 'REVIEW#',
        limit,
        descending: true,
        ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
      }),
      items = [];
    for (const p of page.items) {
      try {
        items.push(await this.get(actor, campus, String(p.reviewId)));
      } catch (e) {
        if (!(e instanceof ApiError && [404, 409].includes(e.status))) throw e;
      }
    }
    const fresh = await this.identity.member(actor, campus);
    if (fresh.member.authVersion !== ctx.member.authVersion) throw unavailable();
    return reviewPageSchema.parse({
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    });
  }
  async command(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = reviewCommandSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST service-reviews/${id}/commands`,
      key,
      data,
      async (ctx) => {
        const { review, isReviewer } = await this.source(actor, campus, id);
        if (!isReviewer)
          throw new ApiError(
            403,
            'REVIEWER_REQUIRED',
            'Only the current independent reviewer can decide this review.',
          );
        if (review.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The review changed. Read the latest version.',
            Number(review.version),
          );
        const permitted = {
          begin: ['OPEN'],
          decide: ['IN_REVIEW'],
          'require-action': ['IN_REVIEW'],
          close: ['ACTION_REQUIRED'],
        };
        if (!permitted[data.action].includes(String(review.state)))
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'This action does not match the current review state.',
          );
        const post = await this.issues.canonical(campus, String(review.issueId));
        if (!(await this.independent(ctx.member, review, post))) throw unavailable();
        const writes: Write[] = [this.issues.guard(post)],
          now = new Date().toISOString(),
          updated: Item = { ...review, version: data.expectedVersion + 1, updatedAt: now };
        if (data.action === 'begin') {
          if (Date.parse(data.nextUpdateAt) <= Date.now())
            throw new ApiError(422, 'INVALID_NEXT_UPDATE', 'Choose a future update time.');
          updated.state = 'IN_REVIEW';
          updated.nextUpdateAt = data.nextUpdateAt;
          updated.acknowledgedAt = now;
        } else {
          if ('appealDeadline' in data) {
            const days = (Date.parse(data.appealDeadline) - Date.now()) / 86400000;
            if (days < 14 - 1 / 1440 || days > 30)
              throw new ApiError(
                422,
                'INVALID_APPEAL_DEADLINE',
                'Allow at least fourteen and at most thirty days for appeal.',
              );
            updated.appealDeadline = data.appealDeadline;
          }
          if (data.action === 'require-action') {
            if (Date.parse(data.dueAt) <= Date.now())
              throw new ApiError(
                422,
                'INVALID_DUE_TIME',
                'Choose a future corrective-action deadline.',
              );
            const owner = await this.identity.member(data.correctiveOwnerId, campus);
            if (
              !this.ownership.eligible(
                owner.member,
                String(review.sourceUnitId),
                post.publication === 'RESTRICTED',
              )
            )
              throw new ApiError(
                422,
                'CORRECTIVE_OWNER_INELIGIBLE',
                'Choose an eligible handler in the reviewed unit.',
              );
            writes.push(...this.ownership.guards(owner));
            updated.state = 'ACTION_REQUIRED';
            updated.correctiveOwnerId = data.correctiveOwnerId;
            updated.correctiveAction = data.correctiveAction;
            updated.dueAt = data.dueAt;
            updated.decisionOutcome = 'COMPLAINT_UPHELD';
          } else {
            if (data.action === 'close' && data.remedyEvidenceIds?.length)
              throw new ApiError(
                422,
                'REVIEW_FILES_UNAVAILABLE',
                'Review evidence uploads are not configured yet.',
              );
            updated.state = 'CLOSED';
            if (data.action === 'decide') updated.decisionOutcome = data.decisionOutcome;
            delete updated.nextUpdateAt;
            const markerKey = { pk: post.pk, sk: `REVIEW_ACTIVE#${review.requesterId}` },
              marker = await this.store.get(this.config.CORE_TABLE, markerKey);
            if (!marker || marker.reviewId !== id || marker.active !== true)
              throw new ApiError(409, 'REVIEW_CHANGED', 'The active review record changed.');
            writes.push({
              ...this.issues.guard(marker),
              item: { ...marker, version: Number(marker.version) + 1, active: false },
            });
          }
          updated.decisionReason = data.decisionReason;
          updated.decisionId = randomUUID();
          const dk = { pk: review.pk, sk: `DECISION#${now}#${updated.decisionId}` };
          writes.push({
            table: this.config.CORE_TABLE,
            key: dk,
            guard: { kind: 'absent' },
            item: {
              ...dk,
              id: updated.decisionId,
              campusId: campus,
              reviewId: id,
              entityType: 'REVIEW_DECISION',
              schemaVersion: 1,
              version: 1,
              createdAt: now,
              updatedAt: now,
              actorId: actor,
              ...data,
              state: updated.state,
            },
          });
        }
        writes.push({ ...this.issues.guard(review), item: updated });
        return {
          resourceId: id,
          resourceKind: 'REVIEW' as const,
          response: await this.dto(updated, true),
          writes,
          eventType: `SERVICE_REVIEW_${data.action.toUpperCase().replaceAll('-', '_')}`,
          eventScope: 'REVIEW_PARTIES' as const,
          sourceVersion: Number(updated.version),
          event: {
            summary:
              data.action === 'begin'
                ? 'The independent reviewer began the review.'
                : data.action === 'require-action'
                  ? 'The reviewer upheld the concern and recorded a corrective action.'
                  : data.action === 'close'
                    ? 'The reviewer verified the remedy and closed the review.'
                    : 'The reviewer recorded a reasoned decision.',
            ...('decisionReason' in data ? { reason: data.decisionReason } : {}),
          },
        };
      },
      async () => this.get(actor, campus, id),
    );
  }
  async candidates(actor: string, campus: string, id: string, limit: number, cursor?: string) {
    const { ctx, review, isReviewer } = await this.source(actor, campus, id);
    if (!isReviewer)
      throw new ApiError(
        403,
        'REVIEWER_REQUIRED',
        'Only the independent reviewer can choose corrective handlers.',
      );
    const post = await this.issues.canonical(campus, String(review.issueId)),
      binding = JSON.stringify([
        'review-handlers',
        actor,
        campus,
        id,
        limit,
        ctx.member.authVersion,
        review.version,
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
        const candidate = await this.identity.member(m.userId, campus);
        if (
          this.ownership.eligible(
            candidate.member,
            String(review.sourceUnitId),
            post.publication === 'RESTRICTED',
          )
        )
          items.push(await this.issues.person(campus, m.userId));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    const fresh = await this.source(actor, campus, id);
    if (!fresh.isReviewer || fresh.review.version !== review.version) throw unavailable();
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
  async respond(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = reviewResponseCreateSchema.parse(input);
    if (data.evidenceIds?.length)
      throw new ApiError(
        422,
        'REVIEW_FILES_UNAVAILABLE',
        'Review evidence uploads are not configured yet.',
      );
    return this.issues.commands.execute(
      actor,
      campus,
      `POST service-reviews/${id}/responses`,
      key,
      data,
      async () => {
        const { review, isReviewer } = await this.source(actor, campus, id);
        if (review.state === 'CLOSED')
          throw new ApiError(422, 'REVIEW_CLOSED', 'This review is closed.');
        if (data.visibility === 'REVIEWERS' && !isReviewer)
          throw new ApiError(
            403,
            'REVIEWER_REQUIRED',
            'Only the assigned reviewer can add a private reviewer note.',
          );
        const rid = randomUUID(),
          now = new Date().toISOString(),
          response: Item = {
            pk: review.pk,
            sk: `RESPONSE#${now}#${rid}`,
            id: rid,
            campusId: campus,
            version: 1,
            createdAt: now,
            updatedAt: now,
            authorId: actor,
            entityType: 'REVIEW_RESPONSE',
            schemaVersion: 1,
            ...data,
            evidenceIds: [],
          },
          updated = { ...review, version: Number(review.version) + 1, updatedAt: now };
        const post = await this.issues.canonical(campus, String(review.issueId));
        return {
          resourceId: id,
          resourceKind: 'REVIEW' as const,
          response: await this.responseDto(response),
          writes: [
            this.issues.guard(post),
            await this.quota(actor, campus, 'REVIEW_RESPONSE', 30),
            { ...this.issues.guard(review), item: updated },
            {
              table: this.config.CORE_TABLE,
              key: { pk: response.pk, sk: response.sk },
              guard: { kind: 'absent' },
              item: response,
            },
          ],
          eventType: 'SERVICE_REVIEW_RESPONSE',
          eventScope:
            data.visibility === 'REVIEWERS' ? ('REVIEWERS' as const) : ('REVIEW_PARTIES' as const),
          sourceVersion: updated.version,
          event: {
            summary:
              data.visibility === 'REVIEWERS'
                ? 'The reviewer added a private note.'
                : 'A review participant added a response.',
          },
        };
      },
      async (_id, response) => {
        const { isReviewer } = await this.source(actor, campus, id);
        const stored = response as { visibility: string };
        if (stored.visibility === 'REVIEWERS' && !isReviewer) throw unavailable();
        return reviewResponseSchema.parse(response);
      },
    );
  }
  async responseDto(r: Item) {
    return reviewResponseSchema.parse({
      id: r.id,
      campusId: r.campusId,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      body: r.body,
      evidenceIds: [],
      visibility: r.visibility,
      author: await this.issues.person(String(r.campusId), String(r.authorId)),
    });
  }
  async children(
    actor: string,
    campus: string,
    id: string,
    kind: 'RESPONSE' | 'EVENT',
    limit: number,
    cursor?: string,
  ) {
    const { ctx, review, isReviewer } = await this.source(actor, campus, id),
      binding = JSON.stringify([
        'review-children',
        actor,
        campus,
        id,
        kind,
        limit,
        ctx.member.authVersion,
        isReviewer,
      ]),
      page = await this.store.query({
        table: this.config.CORE_TABLE,
        pk: review.pk,
        prefix: `${kind}#`,
        limit,
        descending: true,
        ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
      }),
      items = [];
    for (const i of page.items) {
      if (i.visibility === 'REVIEWERS' && !isReviewer) continue;
      if (kind === 'RESPONSE') items.push(await this.responseDto(i));
      else
        items.push(
          reviewEventSchema.parse({
            id: i.id,
            campusId: campus,
            version: i.version,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
            eventType: i.eventType,
            actor: await this.issues.person(campus, String(i.actorId)),
            summary: i.summary,
            ...(i.reason ? { reason: i.reason } : {}),
            visibility: i.visibility === 'REVIEWERS' ? 'REVIEWERS' : 'COMPLAINANT_REVIEWERS',
          }),
        );
    }
    const fresh = await this.source(actor, campus, id);
    if (
      fresh.review.version !== review.version ||
      fresh.isReviewer !== isReviewer ||
      fresh.ctx.member.authVersion !== ctx.member.authVersion
    )
      throw new ApiError(409, 'REVIEW_CHANGED', 'The review changed. Reload it.');
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
}
