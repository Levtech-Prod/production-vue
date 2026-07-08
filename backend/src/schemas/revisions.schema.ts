import { z } from 'zod';

/** PATCH body for updating a revision's label/status/change notes — the
 *  exact same shape for both product revisions and sub-product revisions,
 *  so both routes share this one schema instead of keeping duplicate
 *  copies in sync by hand. */
export const revisionUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  status: z.enum(['draft', 'active', 'deprecated']).optional(),
  changeNotes: z.string().optional().nullable(),
});
export type RevisionUpdateInput = z.infer<typeof revisionUpdateSchema>;
