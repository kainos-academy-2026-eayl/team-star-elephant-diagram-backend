import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { adminUserService } from '../services/AdminUserService';
import { loginSchema } from '../validators/loginSchema';

export function adminController(adminService: typeof adminUserService) {
    const router = Router();
    router.post('/login', async (req: Request, res: Response) => {
        const parsed = loginSchema.safeParse(req.body);

        if (!parsed.success) {
            res.status(400).json({
                error: 'Invalid login details',
                details: z.flattenError(parsed.error).fieldErrors,
            });
            return;
        }

        try {
            await adminService.login(parsed.data);

            res.status(200).json({
                status: 'Success',
            });
        } catch (error) {
            res.status(401).json({
                error: 'Invalid email or password',
            });
        }
    });
    return router;
}



