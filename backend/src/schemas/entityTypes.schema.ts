import { z } from 'zod';

/**
 * The payload for both managed type lists (`product_types` and
 * `sub_product_types`) — one schema, because `createTypeRouter` serves both
 * and writes exactly these columns.
 *
 * Deliberately NOT passed into the router as config: a schema the router only
 * partly writes would validate a field and then drop it with nothing failing.
 * Adding a column here means adding it to the router's statements, in the same
 * change, or it will not compile.
 */
export const typePayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type TypePayload = z.infer<typeof typePayloadSchema>;
