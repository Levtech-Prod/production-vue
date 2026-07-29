import { z } from 'zod';

/** Currencies a price may be entered in. Stored value is always canonical EUR. */
export const entryCurrencySchema = z.enum(['EUR', 'RON']);
export type EntryCurrency = z.infer<typeof entryCurrencySchema>;

/**
 * A price as entered by the user: an amount plus the currency it was typed in.
 * The backend converts RON to EUR (BNR rate for the entry date) before storing;
 * `currency` defaults to EUR so callers that only deal in euros stay simple.
 */
export const priceInputSchema = z.object({
  amount: z.number().nonnegative(),
  currency: entryCurrencySchema.default('EUR'),
});
export type PriceInput = z.input<typeof priceInputSchema>;
