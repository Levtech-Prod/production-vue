import { z } from 'zod';
import { revisionPartInputSchema } from './parts.schema.js';

/** Base sub-product fields shared by create and update. */
export const subProductPayloadSchema = z.object({
  name: z.string().min(2),
  // Optional, unlike products.sku: sub-products may be created without one.
  sku: z.string().min(1).optional().nullable(),
  type: z.string().min(1),
  description: z.string().optional().nullable(),
  image: z.string().min(1),
});
export type SubProductPayload = z.input<typeof subProductPayloadSchema>;

/** Create also needs the owning product and accepts optional parts for the
 *  auto-created first revision (Rev. 1). Every sub-product belongs to a
 *  main product, even before it is added to any product revision. */
export const createSubProductSchema = subProductPayloadSchema.extend({
  productId: z.number(),
  parts: z.array(revisionPartInputSchema).optional().default([]),
});
export type CreateSubProductInput = z.input<typeof createSubProductSchema>;

export const newSubProductRevisionSchema = z.object({
  label: z.string().min(1),
  changeNotes: z.string().optional().nullable(),
  // Parts to copy. The route also inserts `parts` explicitly and the two are
  // unioned — so documents get their own field below rather than reusing this
  // one, or choosing a document source would re-add parts the user removed.
  duplicateFromId: z.number().int().positive().nullable().optional(),
  // Documents to carry forward. Null = none; omitted = fall back to
  // `duplicateFromId`, then the previous revision.
  documentsFromId: z.number().int().positive().nullable().optional(),
  parts: z.array(revisionPartInputSchema).optional().default([]),
});
export type NewSubProductRevisionInput = z.input<typeof newSubProductRevisionSchema>;

export const replaceRevisionPartsSchema = z.object({
  parts: z.array(revisionPartInputSchema),
});

export const setRevisionSubProductsSchema = z.object({
  subProductRevisionIds: z.array(z.number()),
});
