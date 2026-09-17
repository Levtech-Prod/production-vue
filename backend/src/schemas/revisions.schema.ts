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

/**
 * The same patch as a SQL assignment list: only the fields the caller actually
 * sent, numbered from `$1`. Lives beside the schema because it is the same
 * decision as the schema — which columns a revision update may touch — and
 * writing it out per route is how the product and sub-product versions would
 * come to disagree about that.
 *
 * An empty `assignments` means the body carried nothing to change; the caller
 * decides what to answer.
 */
export function revisionUpdateAssignments(
  data: RevisionUpdateInput,
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = $${values.length + 1}`);
    values.push(value);
  };

  if (data.label !== undefined) set('label', data.label);
  if (data.status !== undefined) set('status', data.status);
  if (data.changeNotes !== undefined) set('change_notes', data.changeNotes || null);

  return { assignments, values };
}
