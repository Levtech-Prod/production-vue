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
  duplicateFromId: z.number().optional().nullable(),
});
export type NewRevisionInput = z.input<typeof newRevisionSchema>;

export const setDefaultRevisionSchema = z.object({
  revisionId: z.number().nullable(),
});

export const setProductStatusSchema = z.object({
  status: productStatusSchema,
});
