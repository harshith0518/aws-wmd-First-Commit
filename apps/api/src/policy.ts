import { z } from 'zod';
import {
  audienceSchema,
  baseShape,
  roleGrantSchema,
  uniqueIds,
  subjectSchema,
  membershipStatusSchema,
  type RoleGrant,
} from '@campusfix/contracts';
import { unavailable } from './errors.js';

export const memberRecordSchema = z.object({
  ...baseShape,
  userId: subjectSchema,
  status: membershipStatusSchema,
  groupIds: uniqueIds(20),
  roles: z.array(roleGrantSchema).max(20),
  authVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime().optional(),
  verifiedEmailHash: z.string().optional(),
});
export type MemberRecord = z.infer<typeof memberRecordSchema>;
export const postAccessSchema = z.object({
  ...baseShape,
  authorId: subjectSchema,
  audience: audienceSchema,
  publication: z.enum(['DRAFT', 'PUBLISHED', 'RESTRICTED', 'REMOVED']),
  detail: z
    .object({
      unitId: z.string().optional(),
      primaryOwnerId: subjectSchema.optional(),
      collaboratorIds: z.array(subjectSchema).max(8).default([]),
      caseHandlerIds: z.array(subjectSchema).max(9).default([]),
    })
    .passthrough(),
});
export type PostAccess = z.infer<typeof postAccessSchema>;
export function activeMember(
  m: MemberRecord,
  campusId: string,
  userId: string,
  now = Date.now(),
): boolean {
  return (
    m.campusId === campusId &&
    m.userId === userId &&
    m.status === 'ACTIVE' &&
    (!m.expiresAt || Date.parse(m.expiresAt) > now)
  );
}
export function hasRole(
  m: MemberRecord,
  role: RoleGrant['role'],
  unitId?: string,
  now = Date.now(),
): boolean {
  return m.roles.some(
    (r) =>
      r.role === role &&
      Date.parse(r.expiresAt) > now &&
      (r.scope === 'CAMPUS' || (r.scope === 'UNIT' && !!unitId && r.scopeId === unitId)),
  );
}
export function canReadPost(m: MemberRecord, post: PostAccess, now = Date.now()): boolean {
  if (!activeMember(m, post.campusId, m.userId, now) || post.publication === 'REMOVED')
    return false;
  const author = m.userId === post.authorId;
  if (post.publication === 'DRAFT') return author;
  const d = post.detail;
  if (post.audience.kind === 'RESTRICTED' || post.publication === 'RESTRICTED')
    return (
      author ||
      (d.caseHandlerIds.includes(m.userId) && hasRole(m, 'SENSITIVE_HANDLER', d.unitId, now))
    );
  if (post.audience.kind === 'CAMPUS' || author) return true;
  const assigned =
    (d.primaryOwnerId === m.userId || d.collaboratorIds.includes(m.userId)) &&
    (hasRole(m, 'HANDLER', d.unitId, now) || hasRole(m, 'UNIT_LEAD', d.unitId, now));
  return assigned || post.audience.groupIds.some((g) => m.groupIds.includes(g));
}
export function requirePostRead(m: MemberRecord, post: PostAccess, now = Date.now()) {
  if (!canReadPost(m, post, now)) throw unavailable();
}

export function canManageIssue(m: MemberRecord, post: PostAccess, collaborator = false): boolean {
  if (!canReadPost(m, post)) return false;
  const d = post.detail;
  const assigned =
    d.primaryOwnerId === m.userId || (collaborator && d.collaboratorIds.includes(m.userId));
  const eligible =
    post.audience.kind === 'RESTRICTED' || post.publication === 'RESTRICTED'
      ? d.caseHandlerIds.includes(m.userId) && hasRole(m, 'SENSITIVE_HANDLER', d.unitId)
      : hasRole(m, 'HANDLER', d.unitId) || hasRole(m, 'UNIT_LEAD', d.unitId);
  return assigned && eligible;
}
