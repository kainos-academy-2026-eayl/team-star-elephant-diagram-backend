import { z } from 'zod'

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} must be at most 100 characters`)

export const registerSchema = z.object({
  forename: name('Forename'),
  surname: name('Surname'),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // Upper bound stops oversized inputs being used to waste hashing work
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

export type RegisterInput = z.infer<typeof registerSchema>
