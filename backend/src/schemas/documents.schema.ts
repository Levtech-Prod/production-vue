import { z } from 'zod';

// Multipart text fields always arrive as strings, and an untouched field comes
// through as ''. Both empty and absent mean "not provided" here.
const optionalId = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

/**
 * Body of an upload / replace multipart request.
 *
 *  - `name` overrides the file's own name; empty means keep the original.
 *  - `documentTypeId` is the card the file belongs to; omitted files land in
 *    the ad-hoc "Other documents" bucket.
 */
export const documentUploadSchema = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((value) => (value ? value : undefined)),
  documentTypeId: optionalId,
});
export type DocumentUploadPayload = z.infer<typeof documentUploadSchema>;

/** Body of a "use a file from another revision" request. JSON, not multipart:
 *  no bytes move, only a pointer to an already-stored file. */
export const documentLinkSchema = z.object({
  sourceDocumentId: z.number().int().positive(),
  documentTypeId: z.number().int().positive().nullable().optional(),
});
export type DocumentLinkPayload = z.infer<typeof documentLinkSchema>;
