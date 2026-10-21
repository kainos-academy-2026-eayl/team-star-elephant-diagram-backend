import { z } from 'zod';

export const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginSchema>;