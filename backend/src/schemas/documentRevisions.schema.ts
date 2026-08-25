import { z } from 'zod';

/** A version's lifecycle stage. At most one `production` per document type —
 *  enforced by the partial unique indexes in migration 022. */
export const DOCUMENT_REVISION_STATUSES = ['testing', 'production', 'deprecated'] as const;
export type DocumentRevisionStatus = (typeof DOCUMENT_REVISION_STATUSES)[number];

/** Body of a version create / update request. */
export const documentRevisionPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(DOCUMENT_REVISION_STATUSES).default('testing'),
  releaseNotes: z
    .string()
    .trim()
    .max(20000)
    .nullish()
    .transform((value) => value || null),
});
export type DocumentRevisionPayload = z.infer<typeof documentRevisionPayloadSchema>;

/**
 * Text fields of a version file upload: one optional display name per file,
 * index-aligned with the `files` parts. An empty entry keeps the uploaded
 * file's own name.
 *
 * Multipart repeats the field once per file, and a single repeat arrives as a
 * bare string rather than a one-element array — hence the preprocess.
 */
export const documentRevisionFileUploadSchema = z.object({
  names: z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(z.string().trim().max(255)),
  ),
});
export type DocumentRevisionFileUploadPayload = z.infer<typeof documentRevisionFileUploadSchema>;
