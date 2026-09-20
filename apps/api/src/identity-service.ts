import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  profileSchema,
  membershipSchema,
  campusSummarySchema,
  type Profile,
} from '@campusfix/contracts';
import type { Identity } from './auth.js';
import type { Config } from './config.js';
import type { Store, Item } from './data/store.js';
import { WriteConflict } from './data/store.js';
import { keys } from './data/keys.js';
import { memberRecordSchema, activeMember } from './policy.js';
import { ApiError, unavailable } from './errors.js';
import { CursorCodec } from './cursor.js';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class IdentityService {
  constructor(
    readonly store: Store,
    readonly config: Config,
    readonly cursors: CursorCodec,
  ) {}
  async profile(user: string): Promise<Profile> {
    const item = await this.store.get(this.config.CORE_TABLE, keys.profile(user));
    if (!item) throw new ApiError(404, 'PROFILE_REQUIRED', 'Complete your profile to continue.');
    return profileSchema.parse({
      id: item.id,
      displayName: item.displayName,
      verifiedEmail: item.verifiedEmail,
      emailVerified: item.emailVerified,
      mfaEnrolled: item.mfaEnrolled,
    });
  }
  async sync(identity: Identity, displayName: string, idempotencyKey: string): Promise<Profile> {
    const now = new Date();
    const seconds = Math.floor(now.getTime() / 1000);
    const key = {
      pk: `GLOBAL#IDEMP#${identity.sub}`,
      sk: hash(`PUT:/api/v1/me:${idempotencyKey}`),
    };
    const requestHash = hash(JSON.stringify({ displayName, email: identity.email }));
    const replay = (record: Item | undefined): Profile | undefined => {
      if (!record || Number(record.expiresAt) <= seconds) return;
      if (record.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'That request key was already used for different data.',
        );
      return profileSchema.parse(record.response);
    };
    const prior = replay(await this.store.get(this.config.JOBS_TABLE, key));
    if (prior) return prior;
    const profileKey = keys.profile(identity.sub);
    const old = await this.store.get(this.config.CORE_TABLE, profileKey);
    // MFA enrollment is only set by a separately verified enrollment check. userInfo does not attest MFA.
    const response = profileSchema.parse({
      id: identity.sub,
      displayName,
      verifiedEmail: identity.email,
      emailVerified: true,
      mfaEnrolled: old?.mfaEnrolled === true,
    });
    const eventId = randomUUID();
    const date = now.toISOString();
    const version = Number(old?.version ?? 0) + 1;
    const event = { pk: `U#${identity.sub}`, sk: `EVENT#${date}#${eventId}` };
    const job = { pk: `GLOBAL#JOB#${eventId}`, sk: 'META' };
    try {
      await this.store.transact([
        {
          table: this.config.CORE_TABLE,
          key: profileKey,
          guard: old ? { kind: 'version', version: Number(old.version) } : { kind: 'absent' },
          item: {
            ...profileKey,
            ...response,
            version,
            entityType: 'PROFILE',
            schemaVersion: 1,
            createdAt: old?.createdAt ?? date,
            updatedAt: date,
          },
        },
        {
          table: this.config.JOBS_TABLE,
          key,
          guard: { kind: 'expired', now: seconds },
          item: { ...key, requestHash, response, expiresAt: seconds + 86400 },
        },
        {
          table: this.config.CORE_TABLE,
          key: event,
          guard: { kind: 'absent' },
          item: {
            ...event,
            entityType: 'IDENTITY_EVENT',
            actorId: identity.sub,
            eventType: 'PROFILE_SYNCED',
            sourceVersion: version,
            createdAt: date,
          },
        },
        {
          table: this.config.JOBS_TABLE,
          key: job,
          guard: { kind: 'absent' },
          item: {
            ...job,
            kind: 'PROFILE_SYNCED',
            sourceId: identity.sub,
            sourceVersion: version,
            state: 'PENDING',
            attempts: 0,
            runAt: date,
            readyPk: `READY#${String(parseInt(hash(eventId).slice(0, 2), 16) % 4).padStart(2, '0')}`,
            readySk: `${date}#${eventId}`,
            expiresAt: seconds + 7 * 86400,
          },
        },
      ]);
      return response;
    } catch (error) {
      if (!(error instanceof WriteConflict)) throw error;
      const committed = replay(await this.store.get(this.config.JOBS_TABLE, key));
      if (committed) return committed;
      throw new ApiError(
        409,
        'VERSION_CONFLICT',
        'Your profile changed. Reload it before trying again.',
      );
    }
  }
  async member(user: string, campus: string, requireActive = true) {
    const [item, campusItem, profileItem] = await Promise.all([
      this.store.get(this.config.CORE_TABLE, keys.member(campus, user)),
      this.store.get(this.config.CORE_TABLE, keys.campus(campus)),
      this.store.get(this.config.CORE_TABLE, keys.profile(user)),
    ]);
    if (!item || !campusItem || !profileItem || item.campusId !== campus || item.userId !== user)
      throw unavailable();
    const member = memberRecordSchema.parse(item);
    if (
      requireActive &&
      (campusItem.status !== 'ACTIVE' ||
        !activeMember(member, campus, user) ||
        !profileItem.emailVerified ||
        member.verifiedEmailHash !== hash(String(profileItem.verifiedEmail).toLowerCase()))
    )
      throw unavailable();
    return { member, campus: campusItem, profile: profileItem };
  }
  async membership(user: string, campus: string) {
    const { member: m, profile } = await this.member(user, campus, false);
    return membershipSchema.parse({
      id: m.id,
      campusId: m.campusId,
      version: m.version,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      user: { id: user, displayName: profile.displayName },
      status: m.status,
      groupIds: m.groupIds,
      roles: m.roles,
      authVersion: m.authVersion,
      ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}),
    });
  }
  async campuses(user: string, limit: number, cursor?: string) {
    const binding = `memberships:${user}:${limit}`;
    const page = await this.store.query({
      table: this.config.CORE_TABLE,
      index: 'gsi1',
      pk: keys.membershipIndex(user),
      prefix: 'CAMPUS#',
      limit,
      ...(cursor ? { after: this.cursors.decode(cursor, binding) } : {}),
    });
    const items = [];
    for (const ref of page.items) {
      // Index projections are lookup hints. Membership and campus are always read afresh.
      const match = /^C#([a-f0-9-]+)$/i.exec(ref.pk);
      if (!match?.[1] || ref.sk !== `MEMBER#${user}`) continue;
      try {
        const { member: m, campus: c } = await this.member(user, match[1], false);
        items.push(
          campusSummarySchema.parse({
            id: m.campusId,
            name: c.name,
            slug: c.slug,
            status: c.status,
            membershipStatus: m.status,
          }),
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) continue;
        throw e;
      }
    }
    return { items, nextCursor: page.next ? this.cursors.encode(binding, page.next) : null };
  }
}
export const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().min(1).max(16384).optional(),
});
