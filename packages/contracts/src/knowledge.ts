import { z } from 'zod';
import { baseShape, dateSchema, idSchema, personSchema, versionSchema } from './core.js';
const text = (n: number) => z.string().trim().min(1).max(n);
const content = {
  symptom: text(1000),
  cause: z.string().max(1000).optional(),
  fix: text(2000),
  outcome: text(1000),
};
export const knowledgeCreateSchema = z.strictObject({
  sourcePostId: idSchema,
  sourceExpectedVersion: versionSchema,
  resolutionId: idSchema,
  ...content,
  reviewDueAt: dateSchema,
});
export const knowledgeSchema = z.strictObject({
  ...baseShape,
  sourcePostId: idSchema,
  sourceVersion: versionSchema,
  resolutionId: idSchema,
  categoryId: idSchema,
  unitId: idSchema,
  ...content,
  reviewer: personSchema,
  reviewedAt: dateSchema,
  reviewDueAt: dateSchema,
  state: z.enum(['ACTIVE', 'STALE', 'REVOKED']),
  lastChange: z
    .strictObject({ actor: personSchema, reason: text(1000), at: dateSchema })
    .optional(),
  capabilities: z.array(z.enum(['FLAG_STALE', 'REVIEW', 'RETIRE'])).max(3),
});
export const knowledgePageSchema = z.strictObject({
  items: z.array(knowledgeSchema).max(25),
  nextCursor: z.string().nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const knowledgeQuerySchema = z.strictObject({
  categoryId: idSchema,
  query: z.string().trim().max(200).optional(),
  unitId: idSchema.optional(),
  groupId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().max(16384).optional(),
});
export const knowledgeCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('mark-stale'),
    reason: text(1000),
  }),
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('retire'),
    reason: text(1000),
  }),
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('review'),
    reason: text(1000),
    reviewDueAt: dateSchema,
  }),
]);
export type Knowledge = z.infer<typeof knowledgeSchema>;
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
