import { z } from 'zod';

/** Create and update use the same shape. */
export const subProductTypePayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type SubProductTypePayload = z.input<typeof subProductTypePayloadSchema>;
