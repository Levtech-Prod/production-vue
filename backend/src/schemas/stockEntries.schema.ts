import { z } from 'zod';

export const stockEntryPayloadSchema = z.object({
  partId: z.number().int().positive(),
  companyId: z.number().int().positive(),
  quantity: z.number().positive(),
  pricePerPiece: z.number().nonnegative(),
});

export type StockEntryPayload = z.input<typeof stockEntryPayloadSchema>;
