import { z } from 'zod';

/** Create and update use the same shape. */
export const productTypePayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type ProductTypePayload = z.input<typeof productTypePayloadSchema>;
