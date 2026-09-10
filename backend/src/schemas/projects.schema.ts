import { z } from 'zod';
import { POSTGRES_INT_MAX } from '../db.js';

export const projectStatusSchema = z.enum(['draft', 'started', 'stopped', 'completed']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

// Board default (projects-preparation-plan.md §6.3): thirty live projects
// across five columns is already over a hundred cards, so stopped and
// completed ones are hidden until asked for.
export const DEFAULT_PROJECT_LIST_STATUSES: ProjectStatus[] = ['draft', 'started'];

// project_products' id/revision-id/quantity columns are all plain `integer`,
// so a value like 99999999999 passes zod (well under Number.MAX_SAFE_INTEGER)
// but throws a raw "integer out of range" (22003) once it reaches an `::int[]`
// cast. Same ceiling the id parser applies to route params.
const pgIntSchema = () => z.number().int().positive().max(POSTGRES_INT_MAX);

/** One pinned product at one of its revisions, with the project's quantity. */
export const projectProductInputSchema = z.object({
  productId: pgIntSchema(),
  productRevisionId: pgIntSchema(),
  quantity: pgIntSchema(),
});
export type ProjectProductInput = z.input<typeof projectProductInputSchema>;

// Create and update use the same shape — PATCH replaces both the fields and
// the whole product set (§5.2).
export const projectPayloadSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional().nullable(),
  // 'YYYY-MM-DD', matching the `deadline DATE` column; validated loosely
  // here, Postgres rejects anything that doesn't parse as a real date.
  // '' is normalized to null before the regex runs: like `image` in
  // products.schema.ts, the client clears an optional field by sending ''
  // rather than omitting it or sending null.
  deadline: z.preprocess(
    (val) => (val === '' ? null : val),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
      .optional()
      .nullable(),
  ),
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

// PATCH /api/projects/:id/parts/:projectPartId (§5.2). Both quantities are
// whole parts (§3.3, §11.11): `z.number().int()`, not a plain number, so a
// fraction is refused here rather than rounded silently by the INTEGER
// column — this endpoint is the first one after migration 025 through which
// a fractional quantity could otherwise enter the system.
const nonNegativeIntSchema = () => z.number().int().min(0).max(POSTGRES_INT_MAX);

export const projectPartUpdateSchema = z
  .object({
    missingQty: nonNegativeIntSchema().optional(),
    fromStockQty: nonNegativeIntSchema().optional(),
  })
  .refine((data) => data.missingQty !== undefined || data.fromStockQty !== undefined, {
    message: 'At least one of missingQty or fromStockQty is required',
  });
export type ProjectPartUpdateInput = z.infer<typeof projectPartUpdateSchema>;
