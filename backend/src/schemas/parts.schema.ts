import { z } from 'zod';

/** A part's quantity/unit/notes as recorded against one sub-product
 *  revision. Reused everywhere a revision's part list is created,
 *  duplicated or replaced. */
export const revisionPartInputSchema = z.object({
  partId: z.number(),
  quantity: z.number().transform((v) => Math.round(v)),
  unit: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type RevisionPartInput = z.input<typeof revisionPartInputSchema>;

/** Stock part create/update payload — both endpoints use the same shape. */
export const partPayloadSchema = z.object({
  categoryId: z.number(),
  name: z.string().min(2),
  code: z.string().min(1),
  pricePerPiece: z.number().nonnegative(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parameters: z.array(z.object({ parameterId: z.number(), value: z.string() })).default([]),
});
export type PartPayload = z.input<typeof partPayloadSchema>;
