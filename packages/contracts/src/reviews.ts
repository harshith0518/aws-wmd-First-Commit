import { z } from 'zod';
import {
  baseShape,
  idSchema,
  subjectSchema,
  dateSchema,
  personSchema,
  versionSchema,
  uniqueIds,
} from './core.js';
const text = (max: number) => z.string().trim().min(1).max(max);
export const reviewReasonSchema = z.enum([
  'NO_RESPONSE',
  'INCOMPLETE_FIX',
  'INAPPROPRIATE_CONDUCT',
  'RETALIATION',
]);
export const reviewCreateSchema = z.strictObject({
  issueId: idSchema,
  replyId: idSchema.optional(),
  subjectId: subjectSchema.optional(),
  reasonCode: reviewReasonSchema,
  description: text(3000),
  desiredOutcome: z.string().max(1000).optional(),
});
export const reviewSchema = z.strictObject({
  ...baseShape,
  issueId: idSchema,
  replyId: idSchema.optional(),
  subject: personSchema.optional(),
  requester: personSchema,
  reasonCode: reviewReasonSchema,
  description: text(3000),
  desiredOutcome: z.string().max(1000).optional(),
  evidenceIds: uniqueIds(3),
  reviewer: personSchema.optional(),
  reviewerAvailable: z.boolean(),
  state: z.enum(['OPEN', 'IN_REVIEW', 'ACTION_REQUIRED', 'CLOSED', 'ESCALATED']),
  dueAt: dateSchema.optional(),
  nextUpdateAt: dateSchema.optional(),
  decisionReason: z.string().max(2000).optional(),
  correctiveAction: z.string().max(2000).optional(),
  decisionOutcome: z
    .enum(['COMPLAINT_UPHELD', 'RESPONSE_UPHELD', 'INSUFFICIENT_EVIDENCE'])
    .optional(),
  correctiveOwnerId: subjectSchema.optional(),
  decisionId: idSchema.optional(),
  ackDueAt: dateSchema,
  decisionDueAt: dateSchema,
  appealDeadline: dateSchema.optional(),
  capabilities: z.array(z.enum(['RESPOND', 'BEGIN', 'DECIDE', 'REQUIRE_ACTION', 'CLOSE'])).max(5),
});
export const reviewPageSchema = z.strictObject({
  items: z.array(reviewSchema).max(25),
  nextCursor: z.string().nullable(),
});
export const reviewCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('begin'),
    nextUpdateAt: dateSchema,
  }),
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('decide'),
    decisionOutcome: z.enum(['RESPONSE_UPHELD', 'INSUFFICIENT_EVIDENCE']),
    decisionReason: text(2000),
    appealDeadline: dateSchema,
  }),
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('require-action'),
    decisionOutcome: z.literal('COMPLAINT_UPHELD'),
    decisionReason: text(2000),
    correctiveAction: text(2000),
    correctiveOwnerId: subjectSchema,
    dueAt: dateSchema,
  }),
  z.strictObject({
    expectedVersion: versionSchema,
    action: z.literal('close'),
    decisionReason: text(2000),
    remedyEvidenceIds: uniqueIds(3).optional(),
    appealDeadline: dateSchema,
  }),
]);
export const reviewResponseCreateSchema = z.strictObject({
  body: text(2000),
  visibility: z.enum(['COMPLAINANT_REVIEWERS', 'REVIEWERS']),
  evidenceIds: uniqueIds(3).optional(),
});
export const reviewResponseSchema = z.strictObject({
  ...baseShape,
  author: personSchema,
  body: text(2000),
  evidenceIds: uniqueIds(3),
  visibility: z.enum(['COMPLAINANT_REVIEWERS', 'REVIEWERS']),
});
export const reviewResponsePageSchema = z.strictObject({
  items: z.array(reviewResponseSchema).max(25),
  nextCursor: z.string().nullable(),
});
export const reviewEventSchema = z.strictObject({
  ...baseShape,
  eventType: text(80),
  actor: personSchema,
  summary: text(1000),
  reason: z.string().max(2000).optional(),
  visibility: z.enum(['COMPLAINANT_REVIEWERS', 'REVIEWERS']),
});
export const reviewEventPageSchema = z.strictObject({
  items: z.array(reviewEventSchema).max(25),
  nextCursor: z.string().nullable(),
});
export type ServiceReview = z.infer<typeof reviewSchema>;

export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
