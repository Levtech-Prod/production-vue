import { z } from 'zod';

export const productStatusSchema = z.enum(['active', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Create and update use the same shape. */
export const productPayloadSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional().nullable(),
  image: z.string().min(1),
});
export type ProductPayload = z.input<typeof productPayloadSchema>;

export const newRevisionSchema = z.object({
  label: z.string().min(1),
  changeNotes: z.string().optional().nullable(),
  // Sub-product composition to copy.
  duplicateFromId: z.number().int().positive().nullable().optional(),
  // Documents to carry forward. Null = none; omitted = fall back to
  // `duplicateFromId`, then the previous revision (resolveCarryForwardSource).
  documentsFromId: z.number().int().positive().nullable().optional(),
});
export type NewRevisionInput = z.input<typeof newRevisionSchema>;

export const setDefaultRevisionSchema = z.object({
  revisionId: z.number().nullable(),
});

export const setProductStatusSchema = z.object({
  status: productStatusSchema,
});
