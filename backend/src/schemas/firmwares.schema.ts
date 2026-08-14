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

/**
 * Text fields of a firmware file upload: one optional display name per file,
 * index-aligned with the `files` parts. An empty entry keeps the uploaded
 * file's own name.
 *
 * Multipart repeats the field once per file, and a single repeat arrives as a
 * bare string rather than a one-element array — hence the preprocess.
 */
export const firmwareFileUploadSchema = z.object({
  names: z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(z.string().trim().max(255)),
  ),
});
export type FirmwareFileUploadPayload = z.infer<typeof firmwareFileUploadSchema>;
