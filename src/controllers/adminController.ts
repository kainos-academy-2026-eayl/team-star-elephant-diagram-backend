import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { adminUserService } from '../services/AdminUserService';
import { loginSchema } from '../validators/loginSchema';

export function adminController(adminService: typeof adminUserService) {
    const router = Router();
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
            await adminService.login(loginValidation.data);

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



