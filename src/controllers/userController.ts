import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { UserService } from '../services/userService';
import { loginSchema } from '../validators/loginSchema';

export function userController(userService: UserService): Router {
    const router = Router();

    router.post('/', async (req: Request, res: Response) => {
        const parsed = loginSchema.safeParse(req.body);

        if (!parsed.success) {
            res.status(400).json({
                error: 'Invalid login details',
                details: z.flattenError(parsed.error).fieldErrors,
            });
            return;
        }

        try {
            await userService.login(parsed.data);

            res.status(200).json({
                status: 'Success',
            });
        } catch (error) {
            res.status(401).json({
                error: 'Invalid email or password',
            });
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}

