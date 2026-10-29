import { z } from 'zod';

const name = (label: string) =>
  z
    .string()
    .trim()
    .uppercase()
    .min(1, `${label} is required`)
    .max(20, `${label} must be at most 20 characters`);

export const registerSchema = z.object({
  nameoncard: name('Name on Card'),
  cardnumber: z
    .string()
    .trim()
    .min(16, 'Card number must be 16 digits')
    .max(16, 'Card number must be 16 digits')
    .regex(/^\d+$/, 'Card number must contain only digits'),
  cvv: z
    .string()
    .trim()
    .min(3, 'CVV must be 3 digits')
    .max(3, 'CVV must be 3 digits')
    .regex(/^\d+$/, 'CVV must contain only digits'),
  expirydate: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Expiration date must be in MM/YY format'),

});

export type RegisterInput = z.infer<typeof registerSchema>;
