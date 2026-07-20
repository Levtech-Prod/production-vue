import { z } from 'zod';

export const partParameterTypeSchema = z.enum(['text', 'number', 'boolean', 'dropdown']);
export type PartParameterType = z.infer<typeof partParameterTypeSchema>;

export const partCategoryPayloadSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1),
        type: partParameterTypeSchema.default('text'),
        unit: z.string().optional().nullable(),
        required: z.boolean().default(false),
        options: z.array(z.string().min(1)).optional().default([]), // Only for dropdown type
      }),
    )
    .optional()
    .default([]),
});
export type PartCategoryPayload = z.infer<typeof partCategoryPayloadSchema>;
