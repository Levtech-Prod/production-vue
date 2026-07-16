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
  duplicateFromId: z.number().optional().nullable(),
  parts: z.array(revisionPartInputSchema).optional().default([]),
});
export type NewSubProductRevisionInput = z.input<typeof newSubProductRevisionSchema>;

export const replaceRevisionPartsSchema = z.object({
  parts: z.array(revisionPartInputSchema),
});

export const setRevisionSubProductsSchema = z.object({
  subProductRevisionIds: z.array(z.number()),
});
