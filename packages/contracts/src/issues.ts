import { resolutionSchema } from './workflow.js';
import { z } from 'zod';
import {
  idSchema,
  subjectSchema,
  dateSchema,
  versionSchema,
  baseShape,
  uniqueIds,
  audienceSchema,
  postTypeSchema,
  personSchema,
  campusSummarySchema,
} from './core.js';
const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(5);
const directoryShape = { ...baseShape, name: z.string().min(1).max(80), active: z.boolean() };
export const categorySchema = z.strictObject({
  ...directoryShape,
  description: z.string().max(500),
  defaultUnitId: idSchema,
  sensitiveDefault: z.boolean(),
  allowedPostTypes: z.array(postTypeSchema).max(5),
});
export const groupSchema = z.strictObject({
  ...directoryShape,
  kind: z.enum(['HOSTEL', 'DEPARTMENT', 'BATCH', 'CLUB']),
  approverIds: z.array(subjectSchema).min(1).max(8),
});
export const unitSchema = z.strictObject({
  ...directoryShape,
  description: z.string().max(500).optional(),
  leadId: subjectSchema,
  backupId: subjectSchema,
  escalationId: subjectSchema,
});
export const featureFlagsSchema = z.strictObject({
  questions: z.boolean(),
  activities: z.boolean(),
  marketplace: z.boolean(),
  ai: z.boolean(),
  sensitiveCases: z.boolean(),
});
export const emergencyContactSchema = z.strictObject({
  label: z.string().min(1).max(80),
  number: z.string().min(1).max(40),
  verifiedAt: dateSchema,
});
export const publicConfigurationSchema = z.strictObject({
  campus: campusSummarySchema,
  categories: z.array(categorySchema).max(100),
  units: z.array(unitSchema).max(100),
  groups: z.array(groupSchema).max(100),
  featureFlags: featureFlagsSchema,
  emergencyContacts: z.array(emergencyContactSchema).max(10),
  policyVersion: versionSchema,
});
export const calendarSchema = z
  .strictObject({
    timezone: z.string().min(1).max(60),
    workingDays: z
      .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
      .min(1)
      .max(7),
    opensAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    closesAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    holidays: z.array(z.iso.date()).max(100),
  })
  .refine((c) => c.opensAt < c.closesAt, 'Closing time must be later than opening time.');
export const serviceTargetsSchema = z.strictObject({
  acknowledgeWorkingDays: z.number().int().min(1).max(30),
  updateWorkingDays: z.number().int().min(1).max(30),
  reviewWorkingDays: z.number().int().min(1).max(30),
});
const draftInputShape = {
  type: postTypeSchema,
  title: z.string().max(120).optional(),
  body: z.string().max(5000).optional(),
  categoryId: idSchema.optional(),
  locationLabel: z.string().max(160).optional(),
  audience: audienceSchema.optional(),
  tags: tagsSchema.optional(),
};
export const draftCreateSchema = z.strictObject(draftInputShape);
export const draftUpdateSchema = z.strictObject({
  ...draftInputShape,
  type: postTypeSchema.optional(),
  expectedVersion: versionSchema,
});
export const draftSchema = z.strictObject({
  ...baseShape,
  ...draftInputShape,
  title: z.string().max(120),
  body: z.string().max(5000),
  attachmentIds: uniqueIds(3),
});
export const issueCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  categoryId: idSchema,
  locationLabel: z.string().max(160).optional(),
  audience: audienceSchema,
  attachmentIds: uniqueIds(3).optional(),
  tags: tagsSchema.optional(),
  audienceConfirmed: z.literal(true),
  unitId: idSchema,
  severity: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  caseHandlerIds: z
    .array(subjectSchema)
    .max(9)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
});
export const publishDraftSchema = z.strictObject({
  expectedVersion: versionSchema,
  payload: issueCreateSchema,
});
export const versionOnlySchema = z.strictObject({ expectedVersion: versionSchema });
export const issueStatusSchema = z.enum([
  'SUBMITTED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'WAITING',
  'PROPOSED_RESOLVED',
  'CONFIRMED_CLOSED',
  'REOPENED',
  'DECLINED',
  'DUPLICATE',
]);
export const issueDetailSchema = z.strictObject({
  unitId: idSchema,
  primaryOwner: personSchema,
  collaborators: z.array(personSchema).max(8),
  status: issueStatusSchema,
  severity: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  ackDueAt: dateSchema.optional(),
  updateDueAt: dateSchema.optional(),
  nextAction: z.string().max(1000).optional(),
  nextUpdateAt: dateSchema.optional(),
  waitingReason: z.string().max(1000).optional(),
  resolutionId: idSchema.optional(),
  duplicateOf: idSchema.optional(),
  pendingTransfer: z
    .strictObject({
      transferId: idSchema,
      toUnitId: idSchema,
      toOwnerId: subjectSchema,
      proposedAt: dateSchema,
      expiresAt: dateSchema,
      reason: z.string().max(1000),
    })
    .optional(),
  supportCount: z.number().int().min(0),
  caseHandlers: z.array(personSchema).max(9).optional(),
  currentResolution: resolutionSchema.nullable(),
});
export const issueSchema = z.strictObject({
  ...baseShape,
  type: z.literal('ISSUE'),
  author: personSchema.nullable(),
  title: z.string().min(1).max(120),
  body: z.string().max(5000),
  categoryId: idSchema,
  locationLabel: z.string().max(160).optional(),
  audience: audienceSchema,
  aclVersion: versionSchema,
  publication: z.enum(['DRAFT', 'PUBLISHED', 'RESTRICTED', 'REMOVED']),
  attachmentIds: uniqueIds(3),
  tags: tagsSchema,
  capabilities: z
    .array(
      z.enum([
        'EDIT',
        'REPLY',
        'SUPPORT',
        'SUBSCRIBE',
        'MANAGE_ISSUE',
        'CONFIRM',
        'REOPEN',
        'ASSIGN',
        'TRANSFER',
        'RESPOND_TRANSFER',
        'CHANGE_AUDIENCE',
        'MODERATE',
        'MANAGE_ACTIVITY',
        'MANAGE_LISTING',
        'REQUEST_REVIEW',
      ]),
    )
    .max(20),
  detail: issueDetailSchema,
});
export const draftPageSchema = z.strictObject({
  items: z.array(draftSchema).max(25),
  nextCursor: z.string().nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const issuePageSchema = z.strictObject({
  items: z.array(issueSchema).max(25),
  nextCursor: z.string().nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const issueFeedQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().max(16384).optional(),
  type: z.literal('ISSUE').default('ISSUE'),
  groupId: idSchema.optional(),
  categoryId: idSchema.optional(),
  unitId: idSchema.optional(),
  status: issueStatusSchema.optional(),
  query: z.string().max(200).optional(),
  sort: z.enum(['NEWEST', 'OLDEST']).default('NEWEST'),
  mine: z.enum(['true', 'false']).optional(),
});
export type PublicConfiguration = z.infer<typeof publicConfigurationSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type IssueInput = z.infer<typeof issueCreateSchema>;
export type IssueFeedQuery = z.infer<typeof issueFeedQuerySchema>;
export type BusinessCalendar = z.infer<typeof calendarSchema>;
