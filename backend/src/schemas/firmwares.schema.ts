import { z } from 'zod';

/** A firmware's lifecycle stage. At most one `production` per sub-product
 *  revision — enforced by `ux_firmwares_one_production` (migration 019). */
export const FIRMWARE_STATUSES = ['testing', 'production', 'deprecated'] as const;
export type FirmwareStatus = (typeof FIRMWARE_STATUSES)[number];

/** Body of a firmware create / update request. */
export const firmwarePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(FIRMWARE_STATUSES).default('testing'),
  releaseNotes: z
    .string()
    .trim()
    .max(20000)
    .nullish()
    .transform((value) => value || null),
});
export type FirmwarePayload = z.infer<typeof firmwarePayloadSchema>;
