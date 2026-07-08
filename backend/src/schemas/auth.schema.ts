import { z } from 'zod';

export const signupSchema = z.object({
  username: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(6),
  admin: z.boolean().default(false),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;
