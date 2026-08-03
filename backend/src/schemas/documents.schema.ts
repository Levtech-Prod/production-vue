import { z } from 'zod';

/**
 * Body of an upload / replace multipart request. Multipart text fields always
 * arrive as strings, so this only carries the optional display name — an empty
 * or whitespace-only value means "keep the uploaded file's own name".
 *
 * Story 5 extends this with `documentTypeId` (which card the file belongs to).
 */
export const documentUploadSchema = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type DocumentUploadPayload = z.infer<typeof documentUploadSchema>;
