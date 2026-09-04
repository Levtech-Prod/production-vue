import { z } from 'zod';

export const projectStatusSchema = z.enum(['draft', 'started', 'stopped', 'completed']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

// Board default (projects-preparation-plan.md §6.3): thirty live projects
// across five columns is already over a hundred cards, so stopped and
// completed ones are hidden until asked for.
export const DEFAULT_PROJECT_LIST_STATUSES: ProjectStatus[] = ['draft', 'started'];

/** One pinned product at one of its revisions, with the project's quantity. */
export const projectProductInputSchema = z.object({
  productId: z.number().int().positive(),
  productRevisionId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});
export type ProjectProductInput = z.input<typeof projectProductInputSchema>;

// Create and update use the same shape — PATCH replaces both the fields and
// the whole product set (§5.2).
export const projectPayloadSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional().nullable(),
  // 'YYYY-MM-DD', matching the `deadline DATE` column; validated loosely
  // here, Postgres rejects anything that doesn't parse as a real date.
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
    .optional()
    .nullable(),
  products: z.array(projectProductInputSchema),
});
export type ProjectPayload = z.input<typeof projectPayloadSchema>;

// GET /api/projects — `status` is repeatable in the query string
// (?status=draft&status=started), and a single value may itself be
// comma-joined (?status=draft,started); both normalize to the same array.
export const projectListQuerySchema = z
  .object({
    status: z
      .preprocess((val) => {
        if (val === undefined) return undefined;
        const raw = Array.isArray(val) ? val : [val];
        return raw.flatMap((v) => (typeof v === 'string' ? v.split(',') : v));
      }, z.array(projectStatusSchema))
      .optional(),
    q: z.string().trim().min(1).optional(),
  })
  .transform((data) => ({
    status: data.status ?? DEFAULT_PROJECT_LIST_STATUSES,
    q: data.q,
  }));
export type ProjectListQuery = z.output<typeof projectListQuerySchema>;
