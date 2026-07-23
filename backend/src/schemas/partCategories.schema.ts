import { z } from 'zod';

export const partParameterTypeSchema = z.enum(['text', 'number', 'boolean', 'dropdown']);
export type PartParameterType = z.infer<typeof partParameterTypeSchema>;

export const partCategoryPayloadSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(1),
  image: z.string().optional().nullable(),
  parameters: z
    .array(
      z.object({
        // Present when updating an existing parameter row; absent for new
        // rows (PUT /:id uses this to distinguish update vs. insert).
        id: z.number().optional(),
        name: z.string().min(1),
        type: partParameterTypeSchema.default('text'),
        unit: z.string().optional().nullable(),
        required: z.boolean().default(false),
        // Only meaningful for dropdown type. Blank entries are dropped rather
        // than rejected — the UI lets a user add an option row and fill it
        // in a moment later, so an in-progress blank shouldn't 422 the save.
        options: z
          .array(z.string())
          .optional()
          .default([])
          .transform((opts) => opts.filter((option) => option.trim() !== '')),
      }),
    )
    // Left optional (no default) so callers can PATCH category-level fields
    // without touching parameters: an omitted `parameters` on PUT leaves the
    // existing rows untouched, whereas `[]` explicitly clears them.
    .optional(),
});
export type PartCategoryPayload = z.infer<typeof partCategoryPayloadSchema>;
