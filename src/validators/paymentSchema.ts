import { z } from 'zod'

const name = (label: string) =>
  z
    .string()
    .trim()
    .uppercase()
    .min(1, `${label} is required`)
    .max(20, `${label} must be at most 20 characters`)

export const registerSchema = z.object({
  nameoncard: name('Name on Card'),
  
})

export type RegisterInput = z.infer<typeof registerSchema>
