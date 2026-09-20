import { z } from 'zod';

export const idSchema = z.uuid();
// Cognito subjects are opaque identifiers, not necessarily RFC UUIDs.
export const subjectSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const dateSchema = z.iso.datetime();
export const versionSchema = z.number().int().min(1).max(1_000_000);
export const roleSchema = z.enum([
  'STUDENT',
  'HANDLER',
  'UNIT_LEAD',
  'ADMIN',
  'MODERATOR',
  'REVIEWER',
  'SENSITIVE_HANDLER',
]);
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('campusfix-api'),
  stage: z.literal('foundation'),
});
export const errorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  latestVersion: versionSchema.optional(),
});
export const profileSchema = z.strictObject({
  id: subjectSchema,
  displayName: z.string().min(1).max(80),
  verifiedEmail: z.email(),
  emailVerified: z.boolean(),
  mfaEnrolled: z.boolean(),
});
export const profileSyncSchema = z.strictObject({ displayName: z.string().trim().min(1).max(80) });
export const personSchema = z.strictObject({
  id: subjectSchema,
  displayName: z.string().min(1).max(80),
  verifiedRole: roleSchema.optional(),
});
export const roleGrantSchema = z
  .strictObject({
    id: idSchema,
    role: roleSchema,
    scope: z.enum(['CAMPUS', 'UNIT', 'GROUP']),
    scopeId: idSchema.optional(),
    expiresAt: dateSchema,
  })
  .refine((v) => v.scope === 'CAMPUS' || !!v.scopeId, {
    message: 'Scoped grants need a scope ID.',
  });
export const baseShape = {
  id: idSchema,
  campusId: idSchema,
  version: versionSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
};
export const membershipStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']);
export const uniqueIds = (max: number) =>
  z
    .array(idSchema)
    .max(max)
    .refine((v) => new Set(v).size === v.length, 'IDs must be unique.');
export const membershipSchema = z.strictObject({
  ...baseShape,
  user: personSchema,
  status: membershipStatusSchema,
  groupIds: uniqueIds(20),
  roles: z.array(roleGrantSchema).max(20),
  authVersion: versionSchema,
  expiresAt: dateSchema.optional(),
});
export const campusSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(80),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']),
  membershipStatus: z.enum(['NONE', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']),
});
export const campusPageSchema = z.strictObject({
  items: z.array(campusSummarySchema).max(25),
  nextCursor: z.string().max(16384).nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const audienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CAMPUS') }),
  z.strictObject({ kind: z.literal('GROUPS'), groupIds: uniqueIds(4).refine((v) => v.length > 0) }),
  z.strictObject({ kind: z.literal('RESTRICTED') }),
]);
export const postTypeSchema = z.enum(['ISSUE', 'QUESTION', 'ACTIVITY', 'LISTING', 'NOTICE']);
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type RoleGrant = z.infer<typeof roleGrantSchema>;
export type CampusSummary = z.infer<typeof campusSummarySchema>;
export type CampusPage = z.infer<typeof campusPageSchema>;
export type Audience = z.infer<typeof audienceSchema>;
