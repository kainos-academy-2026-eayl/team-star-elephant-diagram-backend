import { z } from 'zod';
import { loginSchema } from './loginSchema';
import { registerSchema } from './registerSchema';

export const forgotPasswordSchema = loginSchema.pick({ email: true });

export const resetPasswordSchema = z.object({
	token: z.string().regex(/^[a-f0-9]{64}$/, 'This reset link is invalid or has expired.'),
	password: registerSchema.shape.password,
});
