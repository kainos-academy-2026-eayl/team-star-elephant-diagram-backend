import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // bcrypt only uses the first 72 bytes of input, so longer passwords are rejected rather than silently truncated
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes'),
})

export type RegisterInput = z.infer<typeof registerSchema>
