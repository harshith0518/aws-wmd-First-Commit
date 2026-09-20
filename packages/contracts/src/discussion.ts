import { z } from 'zod';
import {
  baseShape,
  dateSchema,
  idSchema,
  personSchema,
  subjectSchema,
  uniqueIds,
  versionSchema,
} from './core.js';
const text = (max: number) => z.string().trim().min(1).max(max);
export const replyScopeSchema = z.enum(['PUBLIC', 'STAFF']);
export const replyCreateSchema = z.strictObject({
  body: text(2000),
  scope: replyScopeSchema,
  parentReplyId: idSchema.optional(),
  mentionIds: z
    .array(subjectSchema)
    .max(10)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
});
export const replyEditSchema = z.strictObject({
  expectedVersion: versionSchema,
  body: text(2000),
  reason: text(1000),
});
export const replyRemoveSchema = z.strictObject({
  expectedVersion: versionSchema,
  reason: text(1000),
});
export const replySchema = z.strictObject({
  ...baseShape,
  author: personSchema.nullable(),
  body: z.string().max(2000),
  parentReplyId: idSchema.optional(),
  scope: replyScopeSchema,
  editedAt: dateSchema.optional(),
  removedAt: dateSchema.optional(),
  usefulCount: z.number().int().min(0),
  viewerVoted: z.boolean(),
  attachmentIds: uniqueIds(3),
  mentions: z.array(personSchema).max(10),
  roleAtPosting: z.enum(['MEMBER', 'HANDLER', 'UNIT_LEAD', 'SENSITIVE_HANDLER']),
});
export const replyQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().max(16384).optional(),
  parentReplyId: idSchema.optional(),
  scope: replyScopeSchema.default('PUBLIC'),
});
export const replyPageSchema = z.strictObject({
  items: z.array(replySchema).max(25),
  nextCursor: z.string().nullable(),
  candidateLimitReached: z.boolean().optional(),
});
export const replyRevisionSchema = z.strictObject({
  ...baseShape,
  replyId: idSchema,
  body: z.string().max(2000),
  scope: replyScopeSchema,
  actor: personSchema,
  reason: text(1000),
});
export const replyRevisionPageSchema = z.strictObject({
  items: z.array(replyRevisionSchema).max(25),
  nextCursor: z.string().nullable(),
});
export const supportToggleSchema = z.strictObject({
  expectedVersion: versionSchema,
  enabled: z.boolean(),
});
export const supportResultSchema = z.strictObject({
  postId: idSchema,
  version: versionSchema,
  supported: z.boolean(),
  supportCount: z.number().int().min(0).max(1000000),
});
export type Reply = z.infer<typeof replySchema>;
export type ReplyQuery = z.infer<typeof replyQuerySchema>;
export type ReplyRevision = z.infer<typeof replyRevisionSchema>;
