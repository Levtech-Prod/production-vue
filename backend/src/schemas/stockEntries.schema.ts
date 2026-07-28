import { z } from 'zod';

const receivedPayloadSchema = z.object({
  type: z.literal('received'),
  partId: z.number().int().positive(),
  companyId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  pricePerPiece: z.number().nonnegative(),
});

const removedPayloadSchema = z.object({
  type: z.literal('removed'),
  partId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  note: z.string().min(1).max(1000),
});

export const stockEntryPayloadSchema = z.discriminatedUnion('type', [
  receivedPayloadSchema,
  removedPayloadSchema,
]);

export type StockEntryPayload = z.input<typeof stockEntryPayloadSchema>;
