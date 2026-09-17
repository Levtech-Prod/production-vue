import { z } from 'zod';

export const companyPayloadSchema = z.object({
  // Trimmed before `min(1)`, so "  " is not a company and " Farnell" is the
  // same company as "Farnell". `companies.name` is a plain exact-match UNIQUE,
  // so an untrimmed copy slips past it and becomes a second supplier — one the
  // author cannot delete, since DELETE stayed admin-only (§8.5) while POST did
  // not. That asymmetry is why this matters more since the relaxation.
  name: z.string().trim().min(1).max(200),
});

export type CompanyPayload = z.input<typeof companyPayloadSchema>;
