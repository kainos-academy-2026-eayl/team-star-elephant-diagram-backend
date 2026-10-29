import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/requireAdmin';
import { DASHBOARD_BY_ROLE } from '../models/adminRoles';
import { InvalidCredentialsError, UnknownAdminRoleError, type AdminUserService } from '../services/AdminUserService';
import type { TokenService } from '../services/tokenService';
import { loginSchema } from '../validators/loginSchema';

export function adminController(adminService: AdminUserService, tokens: TokenService): Router {
    const router = Router();
    router.post('/admin/login', async (req: Request, res: Response) => {
        const loginValidation = loginSchema.safeParse(req.body);

        if (!loginValidation.success) {
            res.status(400).json({
                error: 'Invalid login details',
                details: z.flattenError(loginValidation.error).fieldErrors,
            });
            return;
        }

        try {
            const admin = await adminService.login(loginValidation.data);

            res.status(200).json({
                status: 'Success',
                token: tokens.sign(admin.adminId, admin.role),
                admin,
            });
        } catch (error) {
            if (error instanceof InvalidCredentialsError) {
                res.status(401).json({ error: 'Invalid email or password' });
                return;
            }
            if (error instanceof UnknownAdminRoleError) {
                res.status(403).json({ error: 'Admin account has no valid role' });
                return;
            }
            console.error('Admin login failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Current admin and their dashboard; the frontend calls this to restore a session.
    router.get('/admin/me', requireAdmin(tokens), async (_req: Request, res: Response) => {
        try {
            const admin = await adminService.findById(res.locals.admin?.adminId ?? -1);
            if (!admin) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            res.json({ admin });
        } catch (error) {
            console.error('Admin lookup failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get(
        '/admin/dashboards/:key',
        requireAdmin(tokens),
        async (req: Request, res: Response) => {
            try {
                const admin = await adminService.findById(res.locals.admin?.adminId ?? -1);
                if (!admin) {
                    res.status(401).json({ error: 'Authentication required' });
                    return;
                }
                if (admin.role !== 'SuperAdmin' && DASHBOARD_BY_ROLE[admin.role] !== req.params.key) {
                    res.status(403).json({ error: 'Forbidden' });
                    return;
                }
                res.json({ dashboard: req.params.key, role: admin.role });
            } catch (error) {
                console.error('Admin lookup failed', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    return router;
}
