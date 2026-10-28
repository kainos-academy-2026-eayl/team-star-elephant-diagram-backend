import { Router, type Request, type Response } from 'express';
const router = Router();
import { z } from 'zod';
import { adminUserService } from '../services/AdminUserService';
import { loginSchema } from '../validators/loginSchema';
import { prismaAdminUserRepository } from '../repositories/adminRepository';


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
        await new adminUserService(prismaAdminUserRepository).login(parsed.data);

        res.status(200).json({
            status: 'Success',
        });
    } catch (error) {
        res.status(401).json({
            error: 'Invalid email or password',
        });
    }
});

export default router;