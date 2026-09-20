import { randomUUID } from 'node:crypto';
import type { Item, Write } from './data/store.js';
import { WriteConflict } from './data/store.js';
import { IdentityService, hash } from './identity-service.js';
import { keys } from './data/keys.js';
import { ApiError } from './errors.js';
export type CampusContext = Awaited<ReturnType<IdentityService['member']>>;
export type CommandPlan<T> = {
  resourceId: string;
  response: T;
  writes: Write[];
  eventType: string;
  eventScope: 'AUTHOR' | 'READERS' | 'HANDLERS' | 'REVIEW_PARTIES' | 'REVIEWERS';
  resourceKind?: 'POST' | 'REVIEW';
  sourceVersion: number;
  newPost?: boolean;
  event?: {
    summary: string;
    attachmentIds?: string[];
    replyId?: string;
    mentionIds?: string[];
    reason?: string;
    changes?: Array<{
      field: string;
      before: string | number | boolean | null;
      after: string | number | boolean | null;
    }>;
  };
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export class CampusCommands {
  constructor(readonly identity: IdentityService) {}
  async execute<T>(
    actor: string,
    campus: string,
    operation: string,
    idempotencyKey: string,
    input: unknown,
    plan: (context: CampusContext) => Promise<CommandPlan<T>>,
    replay: (resourceId: string, response: unknown) => Promise<T>,
  ): Promise<T> {
    const { store, config } = this.identity;
    let context = await this.identity.member(actor, campus);
    const now = new Date();
    const date = now.toISOString();
    const seconds = Math.floor(now.getTime() / 1000);
    const key = { pk: `C#${campus}#IDEMP#${actor}`, sk: hash(`${operation}:${idempotencyKey}`) };
    const requestHash = hash(JSON.stringify(canonical(input)));
    const recover = async () => {
      const receipt = await store.get(config.JOBS_TABLE, key);
      if (!receipt || Number(receipt.expiresAt) <= seconds) return undefined;
      if (receipt.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'That request key was already used for different data.',
        );
      await this.identity.member(actor, campus);
      return { response: await replay(String(receipt.resourceId), receipt.response) };
    };
    const previous = await recover();
    if (previous) return previous.response;
    let prepared: CommandPlan<T>;
    try {
      prepared = await plan(context);
    } catch (error) {
      // Another identical request may have committed while this request was validating its draft.
      const committed = await recover();
      if (committed) return committed.response;
      throw error;
    }
    const eventId = randomUUID();
    const eventKey = {
      pk:
        prepared.resourceKind === 'REVIEW'
          ? `C#${campus}#REVIEW#${prepared.resourceId}`
          : keys.post(campus, prepared.resourceId).pk,
      sk: `EVENT#${date}#${eventId}`,
    };
    const jobKey = { pk: `C#${campus}#JOB#${eventId}`, sk: 'META' };
    const guards: Write[] = [
      {
        table: config.CORE_TABLE,
        key: keys.member(campus, actor),
        guard: { kind: 'member', version: context.member.version, now: date },
      },
      {
        table: config.CORE_TABLE,
        key: keys.campus(campus),
        guard: { kind: 'version', version: Number(context.campus.version) },
      },
      {
        table: config.CORE_TABLE,
        key: keys.profile(actor),
        guard: { kind: 'version', version: Number(context.profile.version) },
      },
    ];
    const quotas: Write[] = [];
    if (prepared.newPost) {
      const settings = (context.campus.quotas ?? {}) as Record<string, unknown>;
      for (const [period, secondsPerPeriod, maximum] of [
        ['HOUR', 3600, Math.min(5, Number(settings.postsPerHour ?? 5))],
        ['DAY', 86400, Math.min(30, Number(settings.postsPerDay ?? 30))],
      ] as const) {
        const qkey = {
          pk: `C#${campus}#QUOTA#${actor}`,
          sk: `${period}#${Math.floor(seconds / secondsPerPeriod)}#POST`,
        };
        const old = await store.get(config.JOBS_TABLE, qkey);
        const count = Number(old?.count ?? 0);
        if (!Number.isFinite(maximum) || maximum < 1 || count >= maximum)
          throw new ApiError(
            429,
            'POST_QUOTA_REACHED',
            'You have reached the campus reporting limit. Try again after the current period.',
          );
        quotas.push({
          table: config.JOBS_TABLE,
          key: qkey,
          guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
          item: {
            ...qkey,
            count: count + 1,
            version: Number(old?.version ?? 0) + 1,
            expiresAt: (Math.floor(seconds / secondsPerPeriod) + 2) * secondsPerPeriod,
          },
        });
      }
    }
    const writes = [
      ...guards,
      ...prepared.writes,
      ...quotas,
      {
        table: config.JOBS_TABLE,
        key,
        guard: { kind: 'expired' as const, now: seconds },
        item: {
          ...key,
          requestHash,
          resourceId: prepared.resourceId,
          response: prepared.response,
          expiresAt: seconds + 86400,
        },
      },
      {
        table: config.CORE_TABLE,
        key: eventKey,
        guard: { kind: 'absent' as const },
        item: {
          ...eventKey,
          entityType: 'EVENT',
          schemaVersion: 1,
          campusId: campus,
          id: eventId,
          createdAt: date,
          updatedAt: date,
          version: 1,
          eventType: prepared.eventType,
          actorId: actor,
          sourceVersion: prepared.sourceVersion,
          visibility: prepared.eventScope,
          commandId: hash(idempotencyKey),
          ...prepared.event,
        },
      },
      {
        table: config.JOBS_TABLE,
        key: jobKey,
        guard: { kind: 'absent' as const },
        item: {
          ...jobKey,
          kind: prepared.eventType,
          sourceId: prepared.resourceId,
          sourceKind: prepared.resourceKind ?? 'POST',
          campusId: campus,
          sourceVersion: prepared.sourceVersion,
          state: 'PENDING',
          attempts: 0,
          runAt: date,
          readyPk: `READY#${String(parseInt(hash(eventId).slice(0, 2), 16) % 4).padStart(2, '0')}`,
          readySk: `${date}#${eventId}`,
          expiresAt: seconds + 7 * 86400,
        },
      },
    ];
    // Several validated references may identify the same membership. DynamoDB permits one action per item.
    const unique = new Map<string, Write>();
    for (const w of writes) {
      const id = JSON.stringify([w.table, w.key]);
      const prior = unique.get(id);
      if (prior) {
        if (
          !prior.item &&
          !w.item &&
          prior.guard.kind === 'member' &&
          w.guard.kind === 'member' &&
          prior.guard.version === w.guard.version
        ) {
          if (w.guard.now > prior.guard.now) prior.guard.now = w.guard.now;
          continue;
        }
        if (prior.item || w.item || JSON.stringify(prior.guard) !== JSON.stringify(w.guard))
          throw new Error('Conflicting transaction actions.');
        continue;
      }
      unique.set(id, w);
    }
    try {
      await store.transact([...unique.values()]);
      return prepared.response;
    } catch (error) {
      if (!(error instanceof WriteConflict)) throw error;
      const committed = await recover();
      if (committed) return committed.response;
      context = await this.identity.member(actor, campus);
      const current = await store.get(
        config.CORE_TABLE,
        prepared.resourceKind === 'REVIEW'
          ? { pk: `C#${campus}#REVIEW#${prepared.resourceId}`, sk: 'META' }
          : keys.post(campus, prepared.resourceId),
      );
      throw new ApiError(
        409,
        'VERSION_CONFLICT',
        'The record or its permissions changed. Reload before trying again.',
        typeof current?.version === 'number' ? current.version : undefined,
      );
    }
  }
}
