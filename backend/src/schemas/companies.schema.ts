import { z } from 'zod';

export const companyPayloadSchema = z.object({
  name: z.string().min(1).max(200),
});

export type CompanyPayload = z.input<typeof companyPayloadSchema>;
