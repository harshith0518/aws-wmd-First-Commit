import { z } from 'zod';
import { baseShape, dateSchema, idSchema, personSchema, uniqueIds, versionSchema } from './core.js';
const text = (max: number) => z.string().trim().min(1).max(max);
export const resolutionInputSchema = z.strictObject({
  symptom: text(1000),
  cause: z.string().max(1000).optional(),
  action: text(2000),
  outcome: text(1000),
  evidenceIds: uniqueIds(3).optional(),
  evidenceOmissionReason: text(1000).optional(),
});
export const resolutionSchema = z.strictObject({
  ...baseShape,
  postId: idSchema,
  publishedVersion: versionSchema,
  ...resolutionInputSchema.shape,
  evidenceIds: uniqueIds(3),
  proposedBy: personSchema,
  proposedAt: dateSchema,
  confirmedBy: personSchema.optional(),
  confirmedAt: dateSchema.optional(),
  state: z.enum(['PROPOSED', 'CONFIRMED', 'INVALIDATED']),
});
const version = { expectedVersion: versionSchema };
const next = { nextAction: text(1000), nextUpdateAt: dateSchema };
export const issueCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...version, action: z.literal('acknowledge'), ...next }),
  z.strictObject({ ...version, action: z.literal('start'), ...next }),
  z.strictObject({
    ...version,
    action: z.literal('progress'),
    update: text(2000),
    ...next,
    attachmentIds: uniqueIds(3).optional(),
  }),
  z.strictObject({
    ...version,
    action: z.literal('wait'),
    reason: text(1000),
    nextUpdateAt: dateSchema,
  }),
  z.strictObject({ ...version, action: z.literal('resume'), ...next }),
  z.strictObject({
    ...version,
    action: z.literal('propose-resolution'),
    resolution: resolutionInputSchema,
  }),
  z.strictObject({ ...version, action: z.literal('confirm'), resolutionId: idSchema }),
  z.strictObject({
    ...version,
    action: z.literal('reopen'),
    reason: text(1000),
    attachmentIds: uniqueIds(3).optional(),
  }),
]);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const eventSchema = z.strictObject({
  ...baseShape,
  eventType: text(80),
  actor: personSchema.nullable(),
  summary: text(1000),
  reason: z.string().max(1000).optional(),
  changes: z
    .array(z.strictObject({ field: z.string().max(80), before: scalar, after: scalar }))
    .max(30)
    .optional(),
  visibility: z.enum(['PUBLIC', 'HANDLERS', 'REPORTER_HANDLERS']),
  sourceEventId: idSchema.optional(),
  attachmentIds: uniqueIds(3).optional(),
});
export const eventPageSchema = z.strictObject({
  items: z.array(eventSchema).max(25),
  nextCursor: z.string().nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const resolutionPageSchema = z.strictObject({
  items: z.array(resolutionSchema).max(25),
  nextCursor: z.string().nullable(),
});
export const queueQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().max(16384).optional(),
  unitId: idSchema.optional(),
  status: z
    .enum([
      'SUBMITTED',
      'ACKNOWLEDGED',
      'IN_PROGRESS',
      'WAITING',
      'PROPOSED_RESOLVED',
      'CONFIRMED_CLOSED',
      'REOPENED',
      'DECLINED',
      'DUPLICATE',
    ])
    .optional(),
  tab: z.enum(['MINE', 'UNIT', 'OVERDUE', 'AWAITING_CONFIRMATION']).default('MINE'),
  categoryId: idSchema.optional(),
});
export type IssueCommand = z.infer<typeof issueCommandSchema>;
export type IssueEvent = z.infer<typeof eventSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
export type QueueQuery = z.infer<typeof queueQuerySchema>;
