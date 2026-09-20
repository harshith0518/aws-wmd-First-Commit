import { z } from 'zod';
import { idSchema, subjectSchema, versionSchema, personSchema } from './core.js';
const reason = z.string().trim().min(1).max(1000),
  v = { expectedVersion: versionSchema };
export const assignmentSchema = z.strictObject({
  ...v,
  primaryOwnerId: subjectSchema.optional(),
  collaboratorIds: z
    .array(subjectSchema)
    .max(8)
    .refine((a) => new Set(a).size === a.length),
  reason,
});
export const ownershipCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...v,
    action: z.literal('propose-transfer'),
    toUnitId: idSchema,
    toOwnerId: subjectSchema,
    reason,
  }),
  z.strictObject({ ...v, action: z.literal('accept-transfer'), transferId: idSchema }),
  z.strictObject({ ...v, action: z.literal('reject-transfer'), transferId: idSchema, reason }),
]);
export const accessEndedSchema = z.strictObject({
  postId: idSchema,
  version: versionSchema,
  accessEnded: z.literal(true),
});
export const ownerCandidatesQuerySchema = z.strictObject({
  unitId: idSchema,
  limit: z.coerce.number().int().min(1).max(25).default(25),
  cursor: z.string().max(16384).optional(),
});
export const ownerCandidatesSchema = z.strictObject({
  items: z.array(personSchema).max(25),
  nextCursor: z.string().nullable(),
});
export type OwnershipCommand = z.infer<typeof ownershipCommandSchema>;
