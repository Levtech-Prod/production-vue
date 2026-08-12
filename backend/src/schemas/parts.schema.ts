import { z } from 'zod';
import { priceInputSchema } from './money.schema.js';

/** A part's quantity/unit/position/notes as recorded against one sub-product
 *  revision. Reused everywhere a revision's part list is created,
 *  duplicated or replaced. */
export const revisionPartInputSchema = z.object({
  partId: z.number(),
  quantity: z.number().transform((v) => Math.round(v)),
  unit: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Where the part sits on this sub-product ("left side", "R12"). Belongs to
  // the line, not the part: parts.location is the warehouse spot instead.
  // Capped at the column width so an over-long value is a 400, not a 500.
  mountPosition: z.string().max(120).optional().nullable(),
});
export type RevisionPartInput = z.input<typeof revisionPartInputSchema>;

/** Stock part create/update payload — both endpoints use the same shape. */
export const partPayloadSchema = z.object({
  categoryId: z.number(),
  // The text the user typed, not the final name: a 'parameters' category
  // generates the name and accepts an empty one, so the emptiness check lives
  // in the route where the category (and its mode) is known.
  name: z.string().default(''),
  code: z.string().min(1),
  // Manual fallback price, entered in EUR or RON. Converted to canonical EUR
  // at the boundary (see the parts route) before it hits the database.
  pricePerPiece: priceInputSchema,
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parameters: z.array(z.object({ parameterId: z.number(), value: z.string() })).default([]),
});
export type PartPayload = z.input<typeof partPayloadSchema>;
