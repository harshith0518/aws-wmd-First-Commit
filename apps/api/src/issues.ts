import { fileKey, canReadAttachment } from './files/policy.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  categorySchema,
  groupSchema,
  unitSchema,
  publicConfigurationSchema,
  featureFlagsSchema,
  calendarSchema,
  serviceTargetsSchema,
  draftCreateSchema,
  draftUpdateSchema,
  draftSchema,
  issueCreateSchema,
  publishDraftSchema,
  issueSchema,
  personSchema,
  resolutionSchema,
  baseShape,
  audienceSchema,
  versionOnlySchema,
  type Draft,
  type Issue,
  type IssueInput,
  type IssueFeedQuery,
} from '@campusfix/contracts';
import { IdentityService } from './identity-service.js';
import { keys } from './data/keys.js';
import type { Item, Write } from './data/store.js';
import { CampusCommands, type CampusContext } from './commands.js';
import {
  canReadPost,
  canManageIssue,
  hasRole,
  postAccessSchema,
  type MemberRecord,
} from './policy.js';
import { ApiError, unavailable } from './errors.js';
import { workingDeadline } from './calendar.js';
const directoryBase = z.object({ ...baseShape, active: z.boolean() });
const defaults = {
  questions: false,
  activities: false,
  marketplace: false,
  ai: false,
  sensitiveCases: false,
};
function fields(item: Item, schema: z.ZodObject) {
  const shape = schema.shape;
  return Object.fromEntries(
    Object.keys(shape)
      .filter((k) => item[k] !== undefined)
      .map((k) => [k, item[k]]),
  );
}
export const discoveryKey = (campus: string, scope: string) =>
  `C#${campus}#AUD#${scope}#TYPE#ISSUE`;
export class IssueService {
  readonly commands: CampusCommands;
  constructor(readonly identity: IdentityService) {
    this.commands = new CampusCommands(identity);
  }
  get store() {
    return this.identity.store;
  }
  get config() {
    return this.identity.config;
  }
  async directory(campus: string, kind: 'CATEGORY' | 'UNIT' | 'GROUP', id: string) {
    const item = await this.store.get(this.config.CORE_TABLE, {
      pk: `C#${campus}`,
      sk: `${kind}#${id}`,
    });
    if (!item || item.campusId !== campus || item.id !== id || item.active !== true)
      throw new ApiError(
        422,
        'INVALID_DIRECTORY_REFERENCE',
        'Select an active category, team and group from this campus.',
      );
    directoryBase.parse(item);
    return item;
  }
  async configuration(actor: string, campus: string) {
    const ctx = await this.identity.member(actor, campus);
    const lists = await Promise.all(
      (['CATEGORY', 'UNIT', 'GROUP'] as const).map(async (kind) => {
        const page = await this.store.query({
          table: this.config.CORE_TABLE,
          pk: `C#${campus}`,
          prefix: `${kind}#`,
          limit: 100,
        });
        if (page.next)
          throw new ApiError(
            503,
            'DIRECTORY_LIMIT',
            'The campus directory exceeds the supported size.',
          );
        return page.items.filter((i) => i.campusId === campus && i.active === true);
      }),
    );
    await this.identity.member(actor, campus);
    return publicConfigurationSchema.parse({
      campus: {
        id: campus,
        name: ctx.campus.name,
        slug: ctx.campus.slug,
        status: ctx.campus.status,
        membershipStatus: ctx.member.status,
      },
      categories: lists[0]!.map((i) => categorySchema.parse(fields(i, categorySchema))),
      units: lists[1]!.map((i) => unitSchema.parse(fields(i, unitSchema))),
      groups: lists[2]!.map((i) => groupSchema.parse(fields(i, groupSchema))),
      featureFlags: featureFlagsSchema.parse({
        ...defaults,
        ...(ctx.campus.featureFlags as object),
        questions: false,
        activities: false,
        marketplace: false,
        ai: false,
      }),
      emergencyContacts: ctx.campus.emergencyContacts ?? [],
      policyVersion: ctx.campus.policyVersion,
    });
  }
  async canonical(campus: string, id: string) {
    const item = await this.store.get(this.config.CORE_TABLE, keys.post(campus, id));
    if (!item || item.campusId !== campus || item.id !== id) throw unavailable();
    return item;
  }
  async authorDraft(actor: string, campus: string, id: string) {
    const ctx = await this.identity.member(actor, campus);
    const post = await this.canonical(campus, id);
    if (post.publication !== 'DRAFT' || post.authorId !== actor) throw unavailable();
    return { ctx, post };
  }
  draftDto(post: Item): Draft {
    return draftSchema.parse(fields(post, draftSchema));
  }
  async getDraft(actor: string, campus: string, id: string) {
    return this.draftDto((await this.authorDraft(actor, campus, id)).post);
  }
  async draftReferences(
    ctx: CampusContext,
    data: {
      categoryId?: string | undefined;
      audience?: z.infer<typeof audienceSchema> | undefined;
    },
  ): Promise<Write[]> {
    const guards: Write[] = [];
    const campus = ctx.member.campusId;
    if (data.categoryId) {
      const c = await this.directory(campus, 'CATEGORY', data.categoryId);
      guards.push(this.guard(c));
    }
    if (data.audience?.kind === 'GROUPS')
      for (const g of data.audience.groupIds) {
        if (!ctx.member.groupIds.includes(g))
          throw new ApiError(
            403,
            'AUDIENCE_FORBIDDEN',
            'You can only report to your approved groups.',
          );
        guards.push(this.guard(await this.directory(campus, 'GROUP', g)));
      }
    return guards;
  }
  guard(item: Item): Write {
    return {
      table: this.config.CORE_TABLE,
      key: { pk: item.pk, sk: item.sk },
      guard: { kind: 'version', version: Number(item.version) },
    };
  }
  async createDraft(actor: string, campus: string, input: unknown, key: string) {
    const data = draftCreateSchema.parse(input);
    return this.commands.execute(
      actor,
      campus,
      'POST drafts',
      key,
      data,
      async (ctx) => {
        const guards = await this.draftReferences(ctx, data);
        const id = randomUUID(),
          now = new Date().toISOString();
        const post: Item = {
          ...keys.post(campus, id),
          id,
          campusId: campus,
          entityType: 'POST',
          schemaVersion: 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
          ...data,
          title: data.title ?? '',
          body: data.body ?? '',
          authorId: actor,
          publication: 'DRAFT',
          attachmentIds: [],
          aclVersion: 1,
          gsi1pk: `C#${campus}#AUTHOR#${actor}`,
          gsi1sk: `${now}#${id}`,
        };
        return {
          resourceId: id,
          response: this.draftDto(post),
          writes: [
            ...guards,
            {
              table: this.config.CORE_TABLE,
              key: keys.post(campus, id),
              guard: { kind: 'absent' },
              item: post,
            },
          ],
          eventType: 'DRAFT_CREATED',
          eventScope: 'AUTHOR',
          sourceVersion: 1,
          newPost: true,
        };
      },
      async (id) => this.getDraft(actor, campus, id),
    );
  }
  async updateDraft(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = draftUpdateSchema.parse(input);
    return this.commands.execute(
      actor,
      campus,
      `PATCH drafts/${id}`,
      key,
      data,
      async (ctx) => {
        const { post } = await this.authorDraft(actor, campus, id);
        if (post.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'This draft changed. Reload it before saving.',
            Number(post.version),
          );
        const { expectedVersion, ...changes } = data;
        const updated = {
          ...post,
          ...changes,
          version: expectedVersion + 1,
          updatedAt: new Date().toISOString(),
        };
        const guards = await this.draftReferences(
          ctx,
          draftSchema.parse(fields(updated, draftSchema)),
        );
        return {
          resourceId: id,
          response: this.draftDto(updated),
          writes: [
            ...guards,
            {
              table: this.config.CORE_TABLE,
              key: keys.post(campus, id),
              guard: { kind: 'version', version: expectedVersion },
              item: updated,
            },
          ],
          eventType: 'DRAFT_UPDATED',
          eventScope: 'AUTHOR',
          sourceVersion: expectedVersion + 1,
        };
      },
      async () => this.getDraft(actor, campus, id),
    );
  }
  async discardDraft(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = versionOnlySchema.parse(input);
    return this.commands.execute(
      actor,
      campus,
      `POST drafts/${id}/discard`,
      key,
      data,
      async () => {
        const { post } = await this.authorDraft(actor, campus, id);
        if (post.version !== data.expectedVersion)
          throw new ApiError(409, 'VERSION_CONFLICT', 'This draft changed.', Number(post.version));
        const updated = {
          ...post,
          publication: 'REMOVED',
          version: data.expectedVersion + 1,
          updatedAt: new Date().toISOString(),
        };
        return {
          resourceId: id,
          response: { id, removed: true, version: updated.version },
          writes: [
            {
              table: this.config.CORE_TABLE,
              key: keys.post(campus, id),
              guard: { kind: 'version', version: data.expectedVersion },
              item: updated,
            },
          ],
          eventType: 'DRAFT_DISCARDED',
          eventScope: 'AUTHOR',
          sourceVersion: updated.version,
        };
      },
      async () => {
        const post = await this.canonical(campus, id);
        if (post.authorId !== actor || post.publication !== 'REMOVED') throw unavailable();
        return { id, removed: true, version: Number(post.version) };
      },
    );
  }
  async person(campus: string, user: string) {
    const [profile, member] = await Promise.all([
      this.store.get(this.config.CORE_TABLE, keys.profile(user)),
      this.store.get(this.config.CORE_TABLE, keys.member(campus, user)),
    ]);
    if (!profile || !member) return { id: user, displayName: 'Former campus member' };
    return personSchema.parse({ id: user, displayName: profile.displayName });
  }
  async visibleFileIds(post: Item, member: MemberRecord, ids: string[]) {
    return (
      await Promise.all(
        ids.map(async (id) => {
          const file = await this.store.get(
            this.config.CORE_TABLE,
            fileKey(String(post.campusId), String(post.id), id),
          );
          return file && canReadAttachment(member, post, file) ? id : null;
        }),
      )
    ).filter((id): id is string => id !== null);
  }
  async resolutionDto(value: Item | Record<string, unknown>, post: Item, member?: MemberRecord) {
    return resolutionSchema.parse({
      ...fields(value as Item, resolutionSchema),
      evidenceIds: member
        ? await this.visibleFileIds(post, member, (value.evidenceIds ?? []) as string[])
        : (value.evidenceIds ?? []),
    });
  }
  async issueDto(post: Item, member?: MemberRecord): Promise<Issue> {
    const d = post.detail as Record<string, unknown>;
    const author = await this.person(String(post.campusId), String(post.authorId));
    const owner = await this.person(String(post.campusId), String(d.primaryOwnerId));
    return issueSchema.parse({
      ...fields(post, issueSchema),
      author,
      ...(member
        ? { attachmentIds: await this.visibleFileIds(post, member, post.attachmentIds as string[]) }
        : {}),
      capabilities: member
        ? [
            'REPLY',
            'SUPPORT',
            ...(canManageIssue(member, postAccessSchema.parse(post), true) ? ['MANAGE_ISSUE'] : []),
            ...(post.authorId === member.userId && d.status === 'PROPOSED_RESOLVED'
              ? ['CONFIRM']
              : []),
            ...(post.authorId === member.userId &&
            ['PROPOSED_RESOLVED', 'CONFIRMED_CLOSED'].includes(String(d.status))
              ? ['REOPEN']
              : []),
          ]
        : [],
      detail: {
        unitId: d.unitId,
        primaryOwner: owner,
        collaborators: await Promise.all(
          ((d.collaboratorIds ?? []) as string[]).map((u) => this.person(String(post.campusId), u)),
        ),
        status: d.status,
        severity: d.severity,
        supportCount: d.supportCount,
        currentResolution: d.currentResolution
          ? await this.resolutionDto(d.currentResolution as Record<string, unknown>, post, member)
          : null,
        ...(d.nextAction ? { nextAction: d.nextAction } : {}),
        ...(d.nextUpdateAt ? { nextUpdateAt: d.nextUpdateAt } : {}),
        ...(d.waitingReason ? { waitingReason: d.waitingReason } : {}),
        ...(d.resolutionId ? { resolutionId: d.resolutionId } : {}),
        ...(d.ackDueAt ? { ackDueAt: d.ackDueAt } : {}),
        ...(d.updateDueAt ? { updateDueAt: d.updateDueAt } : {}),
        ...(post.publication === 'RESTRICTED'
          ? {
              caseHandlers: await Promise.all(
                ((d.caseHandlerIds ?? []) as string[]).map((u) =>
                  this.person(String(post.campusId), u),
                ),
              ),
            }
          : {}),
      },
    });
  }
  async getIssue(actor: string, campus: string, id: string) {
    const post = await this.canonical(campus, id);
    const ctx = await this.identity.member(actor, campus);
    if (
      post.type !== 'ISSUE' ||
      post.publication === 'DRAFT' ||
      !canReadPost(ctx.member, postAccessSchema.parse(post))
    )
      throw unavailable();
    const dto = await this.issueDto(post, ctx.member);
    const fresh = await this.identity.member(actor, campus);
    const current = await this.canonical(campus, id);
    if (
      current.version !== post.version ||
      !canReadPost(fresh.member, postAccessSchema.parse(current))
    )
      throw unavailable();
    return dto;
  }
  async publish(actor: string, campus: string, input: unknown, key: string, draftId?: string) {
    const parsed = draftId ? publishDraftSchema.parse(input) : issueCreateSchema.parse(input);
    const data: IssueInput = 'payload' in parsed ? parsed.payload : parsed;
    const operation = draftId ? `POST drafts/${draftId}/publish` : 'POST issues';
    return this.commands.execute(
      actor,
      campus,
      operation,
      key,
      parsed,
      async (ctx) => {
        if (data.attachmentIds?.length && !draftId)
          throw new ApiError(422, 'DRAFT_REQUIRED', 'Save a draft before attaching evidence.');
        const old = draftId ? (await this.authorDraft(actor, campus, draftId)).post : undefined;
        if (
          old &&
          (old.type !== 'ISSUE' ||
            !('expectedVersion' in parsed) ||
            old.version !== parsed.expectedVersion)
        ) {
          if (old.type !== 'ISSUE')
            throw new ApiError(
              422,
              'UNSUPPORTED_POST_TYPE',
              'Only issue drafts can be published in this release.',
            );
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'This draft changed. Reload before publishing.',
            Number(old.version),
          );
        }
        const fileGuards: Write[] = [];
        for (const fid of data.attachmentIds ?? []) {
          const file = await this.store.get(this.config.CORE_TABLE, fileKey(campus, draftId!, fid));
          if (
            !file ||
            file.parentId !== draftId ||
            file.ownerId !== actor ||
            file.parentKind !== 'POST' ||
            file.state !== 'CLEAN' ||
            !((old?.attachmentIds as string[]) ?? []).includes(fid)
          )
            throw new ApiError(
              422,
              'FILE_NOT_READY',
              'Only clean evidence belonging to this draft can be published.',
            );
          fileGuards.push(this.guard(file));
        }
        const category = categorySchema.parse(
          fields(await this.directory(campus, 'CATEGORY', data.categoryId), categorySchema),
        );
        if (!category.allowedPostTypes.includes('ISSUE'))
          throw new ApiError(422, 'CATEGORY_FORBIDDEN', 'This category does not accept issues.');
        const restricted = data.audience.kind === 'RESTRICTED';
        if (category.sensitiveDefault && !restricted)
          throw new ApiError(
            422,
            'RESTRICTED_REQUIRED',
            'This category requires restricted visibility.',
          );
        if (
          restricted &&
          (ctx.campus.featureFlags as Record<string, unknown> | undefined)?.sensitiveCases !== true
        )
          throw new ApiError(
            503,
            'SENSITIVE_CASES_UNAVAILABLE',
            'Restricted case handling is not configured. Keep this as a draft.',
          );
        if (!restricted && data.caseHandlerIds?.length)
          throw new ApiError(
            422,
            'HANDLERS_FORBIDDEN',
            'Named sensitive handlers require a restricted case.',
          );
        const unitItem = await this.directory(campus, 'UNIT', data.unitId);
        const unit = unitSchema.parse(fields(unitItem, unitSchema));
        const owner = await this.identity.member(unit.leadId, campus).catch(() => {
          throw new ApiError(
            503,
            'OWNER_UNAVAILABLE',
            'This team has no eligible current owner. Keep a draft and contact the campus representative.',
          );
        });
        if (
          !hasRole(owner.member, restricted ? 'SENSITIVE_HANDLER' : 'UNIT_LEAD', unit.id) &&
          !(!restricted && hasRole(owner.member, 'HANDLER', unit.id))
        )
          throw new ApiError(503, 'OWNER_UNAVAILABLE', 'This team has no eligible current owner.');
        const handlers = restricted
          ? [...new Set([unit.leadId, ...(data.caseHandlerIds ?? [])])]
          : [];
        if (handlers.length > 9)
          throw new ApiError(
            422,
            'TOO_MANY_HANDLERS',
            'A restricted case supports at most nine handlers including its owner.',
          );
        const guards = await this.draftReferences(ctx, data);
        guards.push(this.guard(unitItem));
        const verified = [owner];
        for (const user of handlers.filter((u) => u !== unit.leadId)) {
          const candidate = await this.identity.member(user, campus);
          if (!hasRole(candidate.member, 'SENSITIVE_HANDLER', unit.id))
            throw new ApiError(
              422,
              'HANDLER_INELIGIBLE',
              'Choose an eligible sensitive-case handler.',
            );
          verified.push(candidate);
        }
        for (const person of verified) {
          guards.push({
            table: this.config.CORE_TABLE,
            key: keys.member(campus, person.member.userId),
            guard: {
              kind: 'member',
              version: person.member.version,
              now: new Date().toISOString(),
            },
          });
          guards.push(this.guard(person.profile));
        }
        const calendar = calendarSchema.parse(ctx.campus.businessCalendar);
        const targets = serviceTargetsSchema.parse(ctx.campus.serviceTargets);
        const id = draftId ?? randomUUID(),
          now = new Date().toISOString(),
          version = Number(old?.version ?? 0) + 1;
        const ackDueAt = workingDeadline(now, targets.acknowledgeWorkingDays, calendar),
          updateDueAt = workingDeadline(now, targets.updateWorkingDays, calendar);
        const post: Item = {
          ...old,
          ...keys.post(campus, id),
          id,
          campusId: campus,
          entityType: 'POST',
          schemaVersion: 1,
          version,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          publishedAt: now,
          type: 'ISSUE',
          authorId: actor,
          title: data.title,
          body: data.body,
          categoryId: data.categoryId,
          ...(data.locationLabel ? { locationLabel: data.locationLabel } : {}),
          audience: data.audience,
          aclVersion: 1,
          publication: restricted ? 'RESTRICTED' : 'PUBLISHED',
          attachmentIds: data.attachmentIds ?? [],
          fileSlotIds: old?.fileSlotIds ?? data.attachmentIds ?? [],
          tags: data.tags ?? [],
          detail: {
            unitId: unit.id,
            primaryOwnerId: unit.leadId,
            collaboratorIds: [],
            caseHandlerIds: handlers,
            status: 'SUBMITTED',
            severity: data.severity ?? 'NORMAL',
            supportCount: 0,
            ackDueAt,
            updateDueAt,
            calendarVersion: ctx.campus.policyVersion,
          },
          gsi1pk: `C#${campus}#AUTHOR#${actor}`,
          gsi1sk: `${old?.createdAt ?? now}#${id}`,
          gsi2pk: `C#${campus}#QUEUE#${unit.id}`,
          gsi2sk: `${ackDueAt}#${id}`,
        };
        const scopes = new Set([
          `USER#${actor}`,
          `USER#${unit.leadId}`,
          ...handlers.map((u) => `USER#${u}`),
          ...(data.audience.kind === 'CAMPUS'
            ? ['CAMPUS']
            : data.audience.kind === 'GROUPS'
              ? data.audience.groupIds.map((g) => `GROUP#${g}`)
              : []),
        ]);
        const writes: Write[] = [
          ...guards,
          ...fileGuards,
          {
            table: this.config.CORE_TABLE,
            key: keys.post(campus, id),
            guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
            item: post,
          },
        ];
        for (const scope of scopes) {
          const k = { pk: discoveryKey(campus, scope), sk: `${post.createdAt}#${id}` };
          writes.push({
            table: this.config.DISCOVERY_TABLE,
            key: k,
            guard: { kind: 'absent' },
            item: { ...k, canonicalPk: post.pk, canonicalSk: post.sk, sourceVersion: version },
          });
        }
        return {
          resourceId: id,
          response: await this.issueDto(post),
          writes,
          eventType: 'ISSUE_PUBLISHED',
          eventScope: 'READERS',
          sourceVersion: version,
          newPost: !old,
        };
      },
      async (id) => this.getIssue(actor, campus, id),
    );
  }
  async drafts(actor: string, campus: string, limit: number, cursor?: string) {
    const ctx = await this.identity.member(actor, campus);
    const binding = `drafts:${actor}:${campus}:${ctx.member.authVersion}:${limit}`;
    const page = await this.store.query({
      table: this.config.CORE_TABLE,
      index: 'gsi1',
      pk: `C#${campus}#AUTHOR#${actor}`,
      limit,
      ...(cursor ? { after: this.identity.cursors.decode(cursor, binding) } : {}),
    });
    const items: Draft[] = [];
    for (const ref of page.items) {
      if (!ref.pk.startsWith(`C#${campus}#POST#`) || ref.sk !== 'META') continue;
      const post = await this.store.get(this.config.CORE_TABLE, { pk: ref.pk, sk: ref.sk });
      if (post?.campusId === campus && post.authorId === actor && post.publication === 'DRAFT')
        items.push(this.draftDto(post));
    }
    await this.identity.member(actor, campus);
    return {
      items,
      nextCursor: page.next ? this.identity.cursors.encode(binding, page.next) : null,
    };
  }
  async feed(actor: string, campus: string, query: IssueFeedQuery) {
    const ctx = await this.identity.member(actor, campus);
    if (query.groupId && !ctx.member.groupIds.includes(query.groupId)) throw unavailable();
    const { cursor, ...filters } = query;
    const binding = JSON.stringify(['issue-feed', actor, campus, ctx.member.authVersion, filters]);
    const scopes = ['CAMPUS', `USER#${actor}`, ...ctx.member.groupIds.map((g) => `GROUP#${g}`)];
    const stateSchema = z.strictObject({
      streams: z.record(
        z.string(),
        z.strictObject({
          after: z.strictObject({ pk: z.string(), sk: z.string() }).optional(),
          done: z.boolean(),
        }),
      ),
      last: z.string().optional(),
    });
    const saved = cursor
      ? stateSchema.parse(JSON.parse(this.identity.cursors.decode(cursor, binding).sk))
      : { streams: {}, last: undefined };
    type Stream = {
      pk: string;
      after?: { pk: string; sk: string };
      done: boolean;
      buffer: Item[];
      more: boolean;
    };
    const streams: Stream[] = scopes.map((scope) => {
      const pk = discoveryKey(campus, scope);
      const prior = saved.streams[pk];
      return {
        pk,
        ...(prior?.after ? { after: prior.after } : {}),
        done: prior?.done ?? false,
        buffer: [],
        more: true,
      };
    });
    const result: Issue[] = [];
    let fetched = 0,
      last = saved.last,
      capped = false;
    while (result.length < query.limit) {
      for (const s of streams.filter((s) => !s.done && !s.buffer.length)) {
        if (fetched >= 200) {
          capped = true;
          break;
        }
        const amount = Math.min(8, 200 - fetched);
        const page = await this.store.query({
          table: this.config.DISCOVERY_TABLE,
          pk: s.pk,
          limit: amount,
          descending: query.sort === 'NEWEST',
          ...(s.after ? { after: s.after } : {}),
        });
        fetched += page.items.length;
        s.buffer = page.items;
        s.more = !!page.next;
        if (!s.buffer.length) s.done = true;
      }
      if (capped) break;
      const available = streams.filter((s) => s.buffer.length);
      if (!available.length) break;
      available.sort(
        (a, b) =>
          (query.sort === 'NEWEST' ? -1 : 1) * a.buffer[0]!.sk.localeCompare(b.buffer[0]!.sk),
      );
      const stream = available[0]!,
        pointer = stream.buffer.shift()!;
      stream.after = { pk: pointer.pk, sk: pointer.sk };
      if (!stream.buffer.length && !stream.more) stream.done = true;
      if (pointer.sk === last) continue;
      last = pointer.sk;
      if (
        typeof pointer.canonicalPk !== 'string' ||
        !pointer.canonicalPk.startsWith(`C#${campus}#POST#`) ||
        pointer.canonicalSk !== 'META'
      )
        continue;
      const post = await this.store.get(this.config.CORE_TABLE, {
        pk: pointer.canonicalPk,
        sk: 'META',
      });
      if (
        !post ||
        post.type !== 'ISSUE' ||
        pointer.sk !== `${post.createdAt}#${post.id}` ||
        post.publication === 'DRAFT'
      )
        continue;
      if (!canReadPost(ctx.member, postAccessSchema.parse(post))) continue;
      const d = post.detail as Record<string, unknown>;
      const audience = audienceSchema.parse(post.audience);
      if (
        query.groupId &&
        (audience.kind !== 'GROUPS' || !audience.groupIds.includes(query.groupId))
      )
        continue;
      if (
        (query.categoryId && post.categoryId !== query.categoryId) ||
        (query.unitId && d.unitId !== query.unitId) ||
        (query.status && d.status !== query.status) ||
        (query.mine === 'true' && post.authorId !== actor)
      )
        continue;
      if (
        query.query &&
        !`${post.title} ${post.body}`
          .normalize('NFKC')
          .toLowerCase()
          .includes(query.query.normalize('NFKC').toLowerCase())
      )
        continue;
      result.push(await this.issueDto(post, ctx.member));
    }
    // Recheck the live member and each source after serialization, not merely the lookup projection.
    const fresh = await this.identity.member(actor, campus);
    if (fresh.member.authVersion !== ctx.member.authVersion)
      throw new ApiError(409, 'ACCESS_CHANGED', 'Your campus access changed. Refresh this list.');
    const items: Issue[] = [];
    for (const dto of result) {
      const current = await this.canonical(campus, dto.id).catch(() => undefined);
      if (
        current &&
        current.version === dto.version &&
        canReadPost(fresh.member, postAccessSchema.parse(current))
      )
        items.push(dto);
    }
    const remaining = streams.some((s) => !s.done || s.buffer.length);
    const state = {
      streams: Object.fromEntries(
        streams.map((s) => [
          s.pk,
          { ...(s.after ? { after: s.after } : {}), done: s.done && !s.buffer.length },
        ]),
      ),
      ...(last ? { last } : {}),
    };
    return {
      items,
      nextCursor: remaining
        ? this.identity.cursors.encode(binding, { pk: 'FEED', sk: JSON.stringify(state) })
        : null,
      candidateLimitReached: capped,
    };
  }
}
