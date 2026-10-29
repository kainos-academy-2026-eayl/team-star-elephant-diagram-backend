import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { DuplicateEmailError } from '../repositories/userRepository';
import type { UserService } from '../services/userService';
import { loginSchema } from '../validators/loginSchema';
import { registerSchema } from '../validators/registerSchema';

export function userController(userService: UserService): Router {
    const router = Router();

    router.post('/register', async (req: Request, res: Response) => {
        const registerValidation = registerSchema.safeParse(req.body);
        if (!registerValidation.success) {
            res.status(400).json({ error: 'Invalid registration details', details: z.flattenError(registerValidation.error).fieldErrors });
            return;
        }

        try {
            await userService.register(registerValidation.data);
            res.status(201).json({ status: 'created' });
        } catch (error) {
            if (error instanceof DuplicateEmailError) {
                res.status(400).json({ error: error.message });
                return;
            }
            console.error('Registration failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/login', async (req: Request, res: Response) => {
        const loginValidation = loginSchema.safeParse(req.body);
        if (!loginValidation.success) {
            res.status(400).json({
                error: 'Invalid login details',
                details: z.flattenError(loginValidation.error).fieldErrors,
            });
            return;
        }
        try {
            const token = await userService.login(loginValidation.data);
            res.status(200).json({
                status: 'Success',
                token,
            });
        } catch (error) {
            res.status(401).json({
                error: 'Invalid email or password',
            });
        }
    });

    return router;
}
