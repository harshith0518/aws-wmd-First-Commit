import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  knowledgeCreateSchema,
  knowledgeCommandSchema,
  knowledgeSchema,
  knowledgePageSchema,
  versionSchema,
  idSchema,
  type Knowledge,
  type KnowledgeQuery,
} from '@campusfix/contracts';
import { IssueService } from './issues.js';
import { WorkflowService } from './workflow.js';
import { type Item, type Write } from './data/store.js';
import { keys } from './data/keys.js';
import { hasRole, canReadPost, postAccessSchema, type MemberRecord } from './policy.js';
import { ApiError, unavailable } from './errors.js';
import { type CampusContext } from './commands.js';
export const knowledgeKey = (campus: string, id: string) => ({
  pk: `C#${campus}#KNOWLEDGE#${id}`,
  sk: 'META',
});
const stop = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
]);
export function keywords(text: string) {
  return new Set(
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((w) => w.length > 1 && !stop.has(w)) ?? [],
  );
}
export function overlap(query: string, text: string) {
  const q = keywords(query),
    t = keywords(text);
  return [...q].filter((w) => t.has(w)).length;
}
export class KnowledgeService {
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
  curator(member: MemberRecord, post: Item) {
    return (
      canReadPost(member, postAccessSchema.parse(post)) &&
      (hasRole(member, 'UNIT_LEAD', String((post.detail as Record<string, unknown>).unitId)) ||
        hasRole(member, 'REVIEWER', String((post.detail as Record<string, unknown>).unitId)))
    );
  }
  async source(actor: string, campus: string, id: string) {
    const { ctx, post } = await this.workflow.source(actor, campus, id),
      d = post.detail as Record<string, unknown>;
    if (d.status !== 'CONFIRMED_CLOSED' || typeof d.resolutionId !== 'string') throw unavailable();
    const resolution = await this.store.get(this.config.CORE_TABLE, {
      pk: post.pk,
      sk: `RESOLUTION#${d.resolutionId}`,
    });
    if (
      !resolution ||
      resolution.state !== 'CONFIRMED' ||
      resolution.postId !== id ||
      (d.currentResolution as Record<string, unknown>)?.version !== resolution.version
    )
      throw unavailable();
    return { ctx, post, resolution };
  }
  async context(actor: string, campus: string, id: string) {
    const card = await this.store.get(this.config.CORE_TABLE, knowledgeKey(campus, id));
    if (!card || card.campusId !== campus || card.entityType !== 'KNOWLEDGE') throw unavailable();
    const source = await this.source(actor, campus, String(card.sourcePostId));
    if (source.resolution.id !== card.resolutionId) throw unavailable();
    return { ...source, card };
  }
  state(card: Item, post: Item) {
    return card.state === 'ACTIVE' &&
      (Date.parse(String(card.reviewDueAt)) <= Date.now() ||
        card.sourceVersion !== post.version ||
        card.sourceAclVersion !== post.aclVersion)
      ? 'STALE'
      : String(card.state);
  }
  async dto(card: Item, post: Item, member: MemberRecord): Promise<Knowledge> {
    const data = Object.fromEntries(
        Object.keys(knowledgeSchema.shape)
          .filter((k) => card[k] !== undefined)
          .map((k) => [k, card[k]]),
      ),
      state = this.state(card, post),
      curator = this.curator(member, post);
    return knowledgeSchema.parse({
      ...data,
      state,
      reviewer: await this.issues.person(String(card.campusId), String(card.reviewerId)),
      ...(card.lastChange
        ? {
            lastChange: {
              actor: await this.issues.person(
                String(card.campusId),
                String((card.lastChange as Record<string, unknown>).actorId),
              ),
              reason: (card.lastChange as Record<string, unknown>).reason,
              at: (card.lastChange as Record<string, unknown>).at,
            },
          }
        : {}),
      capabilities: [
        ...(state === 'ACTIVE' ? ['FLAG_STALE'] : []),
        ...(curator && state !== 'REVOKED' ? ['REVIEW', 'RETIRE'] : []),
      ],
    });
  }
  async verify(actor: string, campus: string, card: Item, post: Item, ctx: CampusContext) {
    const current = await this.context(actor, campus, String(card.id));
    if (
      current.card.version !== card.version ||
      current.post.version !== post.version ||
      current.ctx.member.authVersion !== ctx.member.authVersion
    )
      throw new ApiError(
        409,
        'SOURCE_CHANGED',
        'The resolution or your access changed. Refresh this page.',
      );
  }
  async get(actor: string, campus: string, id: string) {
    const { ctx, post, card } = await this.context(actor, campus, id),
      dto = await this.dto(card, post, ctx.member);
    await this.verify(actor, campus, card, post, ctx);
    return dto;
  }
  due(date: string) {
    if (Date.parse(date) <= Date.now() || Date.parse(date) > Date.now() + 366 * 86400000)
      throw new ApiError(
        422,
        'INVALID_REVIEW_DATE',
        'Choose a future review date within one year.',
      );
  }
  async pointers(card: Item, post: Item, prior?: Item): Promise<Write[]> {
    const access = postAccessSchema.parse(post),
      d = post.detail as Record<string, unknown>;
    const scopes =
      card.state === 'ACTIVE'
        ? new Set([
            `USER#${post.authorId}`,
            `USER#${d.primaryOwnerId}`,
            ...((d.collaboratorIds ?? []) as string[]).map((u) => `USER#${u}`),
            ...(access.audience.kind === 'CAMPUS'
              ? ['CAMPUS']
              : access.audience.kind === 'GROUPS'
                ? access.audience.groupIds.map((g) => `GROUP#${g}`)
                : ((d.caseHandlerIds ?? []) as string[]).map((u) => `USER#${u}`)),
          ])
        : new Set<string>();
    const next = [...scopes].map((scope) => ({
      pk: `C#${post.campusId}#KNOW#${post.categoryId}#AUD#${scope}`,
      sk: `${card.reviewedAt}#${card.id}`,
    }));
    const writes: Write[] = [],
      oldKeys = (prior?.discoveryKeys ?? []) as Array<{ pk: string; sk: string }>;
    for (const key of oldKeys) {
      if (next.some((k) => k.pk === key.pk && k.sk === key.sk)) continue;
      const old = await this.store.get(this.config.DISCOVERY_TABLE, key);
      if (old)
        writes.push({
          table: this.config.DISCOVERY_TABLE,
          key,
          guard: { kind: 'version', version: Number(old.version) },
          delete: true,
        });
    }
    for (const key of next) {
      const old = await this.store.get(this.config.DISCOVERY_TABLE, key);
      writes.push({
        table: this.config.DISCOVERY_TABLE,
        key,
        guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
        item: {
          ...key,
          canonicalPk: card.pk,
          canonicalSk: 'META',
          version: Number(old?.version ?? 0) + 1,
        },
      });
    }
    card.discoveryKeys = next;
    return writes;
  }
  async create(actor: string, campus: string, input: unknown, key: string) {
    const data = knowledgeCreateSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      'POST knowledge',
      key,
      data,
      async (ctx) => {
        const { post, resolution } = await this.source(actor, campus, data.sourcePostId);
        if (!this.curator(ctx.member, post))
          throw new ApiError(
            403,
            'CURATION_FORBIDDEN',
            'A scoped unit lead or reviewer must verify reusable resolutions.',
          );
        if (post.version !== data.sourceExpectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The source changed. Review the current resolution.',
            Number(post.version),
          );
        if (resolution.id !== data.resolutionId)
          throw new ApiError(409, 'RESOLUTION_CHANGED', 'Select the current confirmed resolution.');
        this.due(data.reviewDueAt);
        const marker = { pk: post.pk, sk: `KNOWLEDGE#${resolution.id}` };
        if (await this.store.get(this.config.CORE_TABLE, marker))
          throw new ApiError(
            409,
            'KNOWLEDGE_EXISTS',
            'This resolution already has a library card. Review the existing entry.',
          );
        const now = new Date().toISOString(),
          id = randomUUID(),
          card: Item = {
            ...knowledgeKey(campus, id),
            id,
            campusId: campus,
            entityType: 'KNOWLEDGE',
            schemaVersion: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
            sourcePostId: post.id,
            sourceVersion: post.version,
            sourceAclVersion: post.aclVersion,
            resolutionId: resolution.id,
            categoryId: post.categoryId,
            unitId: (post.detail as Record<string, unknown>).unitId,
            symptom: data.symptom,
            ...(data.cause ? { cause: data.cause } : {}),
            fix: data.fix,
            outcome: data.outcome,
            reviewDueAt: data.reviewDueAt,
            reviewerId: actor,
            reviewedAt: now,
            state: 'ACTIVE',
          };
        const pointers = await this.pointers(card, post);
        return {
          resourceKind: 'KNOWLEDGE' as const,
          resourceId: id,
          response: await this.dto(card, post, ctx.member),
          writes: [
            this.issues.guard(post),
            this.issues.guard(resolution),
            {
              table: this.config.CORE_TABLE,
              key: knowledgeKey(campus, id),
              guard: { kind: 'absent' as const },
              item: card,
            },
            {
              table: this.config.CORE_TABLE,
              key: marker,
              guard: { kind: 'absent' as const },
              item: { ...marker, knowledgeId: id },
            },
            ...pointers,
          ],
          sourceVersion: 1,
          eventType: 'KNOWLEDGE_CREATED',
          eventScope: 'READERS' as const,
          event: { summary: 'A curator reviewed the confirmed resolution for reuse.' },
        };
      },
      async (id) => this.get(actor, campus, id),
    );
  }
  async command(actor: string, campus: string, id: string, input: unknown, key: string) {
    const data = knowledgeCommandSchema.parse(input);
    return this.issues.commands.execute(
      actor,
      campus,
      `POST knowledge/${id}/commands`,
      key,
      data,
      async (ctx) => {
        const { card, post, resolution } = await this.context(actor, campus, id);
        if (data.action !== 'mark-stale' && !this.curator(ctx.member, post))
          throw new ApiError(
            403,
            'CURATION_FORBIDDEN',
            'Only a scoped curator can review or retire this entry.',
          );
        if (card.version !== data.expectedVersion)
          throw new ApiError(
            409,
            'VERSION_CONFLICT',
            'The library card changed. Refresh before submitting.',
            Number(card.version),
          );
        if (
          card.state === 'REVOKED' ||
          (data.action === 'mark-stale' && this.state(card, post) !== 'ACTIVE')
        )
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'That action is not available for this card.',
          );
        const now = new Date().toISOString(),
          updated = {
            ...card,
            version: data.expectedVersion + 1,
            updatedAt: now,
            lastChange: { actorId: actor, reason: data.reason, at: now },
            state:
              data.action === 'mark-stale'
                ? 'STALE'
                : data.action === 'retire'
                  ? 'REVOKED'
                  : 'ACTIVE',
          };
        if (data.action === 'review') {
          this.due(data.reviewDueAt);
          Object.assign(updated, {
            reviewerId: actor,
            reviewedAt: now,
            reviewDueAt: data.reviewDueAt,
            sourceVersion: post.version,
            sourceAclVersion: post.aclVersion,
            categoryId: post.categoryId,
            unitId: (post.detail as Record<string, unknown>).unitId,
          });
        }
        const pointers = await this.pointers(updated, post, card);
        return {
          resourceKind: 'KNOWLEDGE' as const,
          resourceId: id,
          response: await this.dto(updated, post, ctx.member),
          writes: [
            this.issues.guard(post),
            this.issues.guard(resolution),
            { ...this.issues.guard(card), item: updated },
            ...pointers,
          ],
          sourceVersion: updated.version,
          eventType: `KNOWLEDGE_${data.action.toUpperCase().replaceAll('-', '_')}`,
          eventScope: 'READERS' as const,
          event: {
            summary:
              data.action === 'mark-stale'
                ? 'A reader flagged this resolution as stale.'
                : data.action === 'retire'
                  ? 'A curator retired this library card.'
                  : 'A curator reviewed the resolution again.',
            reason: data.reason,
          },
        };
      },
      async () => this.get(actor, campus, id),
    );
  }
  async search(actor: string, campus: string, q: KnowledgeQuery) {
    const ctx = await this.identity.member(actor, campus);
    if (q.groupId && !ctx.member.groupIds.includes(q.groupId)) throw unavailable();
    await this.issues.directory(campus, 'CATEGORY', q.categoryId);
    const { cursor, ...filters } = q,
      binding = JSON.stringify(['knowledge', actor, campus, ctx.member.authVersion, filters]);
    const snapshotSchema = z.strictObject({
      refs: z.array(z.strictObject({ id: idSchema, version: versionSchema })).max(100),
      offset: z.number().int().min(0).max(100),
      capped: z.boolean(),
    });
    let snapshot: z.infer<typeof snapshotSchema>;
    if (cursor)
      snapshot = snapshotSchema.parse(JSON.parse(this.identity.cursors.decode(cursor, binding).sk));
    else {
      const scopes = q.groupId
          ? [`GROUP#${q.groupId}`]
          : ['CAMPUS', `USER#${actor}`, ...ctx.member.groupIds.map((g) => `GROUP#${g}`)],
        budget = Math.floor(100 / scopes.length);
      const pages = await Promise.all(
        scopes.map((scope) =>
          this.store.query({
            table: this.config.DISCOVERY_TABLE,
            pk: `C#${campus}#KNOW#${q.categoryId}#AUD#${scope}`,
            limit: budget,
            descending: true,
          }),
        ),
      );
      const seen = new Set<string>(),
        ranked: Array<{ id: string; version: number; score: number; date: string }> = [];
      for (const ref of pages.flatMap((p) => p.items)) {
        if (
          typeof ref.canonicalPk !== 'string' ||
          !ref.canonicalPk.startsWith(`C#${campus}#KNOWLEDGE#`) ||
          ref.canonicalSk !== 'META'
        )
          continue;
        const id = ref.canonicalPk.split('#').at(-1)!;
        if (!idSchema.safeParse(id).success || seen.has(id)) continue;
        seen.add(id);
        try {
          const { card, post } = await this.context(actor, campus, id);
          if (
            this.state(card, post) !== 'ACTIVE' ||
            card.categoryId !== q.categoryId ||
            (q.unitId && card.unitId !== q.unitId)
          )
            continue;
          const a = postAccessSchema.parse(post).audience;
          if (q.groupId && (a.kind !== 'GROUPS' || !a.groupIds.includes(q.groupId))) continue;
          const n = overlap(
            q.query ?? '',
            `${post.title} ${card.symptom} ${card.cause ?? ''} ${card.fix} ${card.outcome}`,
          );
          if (q.query && keywords(q.query).size && !n) continue;
          ranked.push({
            id,
            version: Number(card.version),
            score: 3 + (q.unitId && card.unitId === q.unitId ? 2 : 0) + n,
            date: String(card.reviewedAt),
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
      ranked.sort(
        (a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
      );
      snapshot = {
        refs: ranked.map(({ id, version }) => ({ id, version })),
        offset: 0,
        capped: pages.some((p) => !!p.next),
      };
    }
    const items: Knowledge[] = [];
    while (snapshot.offset < snapshot.refs.length && items.length < q.limit) {
      const ref = snapshot.refs[snapshot.offset++]!;
      try {
        const item = await this.get(actor, campus, ref.id);
        if (item.state === 'ACTIVE' && item.version === ref.version) items.push(item);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    // No cached card is trusted at output: a concurrent reopening/revocation aborts safely.
    const verified: Knowledge[] = [];
    for (const item of items) {
      try {
        const fresh = await this.get(actor, campus, item.id);
        if (fresh.state === 'ACTIVE' && fresh.version === item.version) verified.push(fresh);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    const fresh = await this.identity.member(actor, campus);
    if (fresh.member.authVersion !== ctx.member.authVersion)
      throw new ApiError(409, 'ACCESS_CHANGED', 'Your library access changed. Refresh this page.');
    return knowledgePageSchema.parse({
      items: verified,
      nextCursor:
        snapshot.offset < snapshot.refs.length
          ? this.identity.cursors.encode(binding, {
              pk: 'KNOWLEDGE_PAGE',
              sk: JSON.stringify(snapshot),
            })
          : null,
      candidateLimitReached: snapshot.capped,
    });
  }
}
