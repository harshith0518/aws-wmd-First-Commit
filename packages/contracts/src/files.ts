import { z } from 'zod';
import { baseShape, idSchema, dateSchema, versionSchema } from './core.js';
export const fileMimeSchema = z.enum(['image/jpeg', 'image/png', 'application/pdf']);
export const fileScopeSchema = z.enum(['PUBLIC', 'HANDLERS', 'REPORTER_HANDLERS']);
export const fileParentSchema = z.strictObject({
  parentKind: z.literal('POST'),
  parentId: idSchema,
});
export const attachmentSchema = z.strictObject({
  ...baseShape,
  ...fileParentSchema.shape,
  scope: fileScopeSchema,
  originalName: z.string().min(1).max(180),
  mime: fileMimeSchema,
  bytes: z.number().int().min(1).max(5242880),
  state: z.enum(['RESERVED', 'UPLOADED', 'SCANNING', 'CLEAN', 'REJECTED', 'DELETED']),
  rejectionCode: z
    .enum(['INVALID_TYPE', 'OVERSIZE', 'MALWARE', 'SCAN_ERROR', 'EXPIRED'])
    .optional(),
});
export const uploadReserveSchema = z.strictObject({
  ...fileParentSchema.shape,
  scope: fileScopeSchema,
  originalName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((s) => !/[\x00-\x1f\x7f]/.test(s), 'Control characters are not allowed.'),
  mime: fileMimeSchema,
  bytes: z.number().int().min(1).max(5242880),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const uploadCompleteSchema = z.strictObject({
  expectedVersion: versionSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const uploadReservationSchema = z.strictObject({
  attachment: attachmentSchema,
  uploadUrl: z.url(),
  method: z.literal('POST'),
  fields: z
    .record(z.string().min(1).max(160), z.string().max(20000))
    .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 30),
  expiresAt: dateSchema,
  maxBytes: z.literal(5242880),
});
export const fileVariantSchema = z.enum(['ORIGINAL', 'SANITIZED', 'THUMBNAIL']);
export const downloadLinkSchema = z.strictObject({
  url: z.url(),
  expiresAt: dateSchema,
  variant: fileVariantSchema,
});
export const fileRemoveSchema = z.strictObject({
  expectedVersion: versionSchema,
  reason: z.string().trim().min(1).max(1000),
});
export const attachmentListSchema = z.strictObject({
  items: z.array(attachmentSchema).max(3),
  uploadsEnabled: z.boolean(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export type FileParent = z.infer<typeof fileParentSchema>;
export type FileVariant = z.infer<typeof fileVariantSchema>;
export type UploadReserve = z.infer<typeof uploadReserveSchema>;
