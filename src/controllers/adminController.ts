import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/requireAdmin';
import { type AdminUserService, InvalidCredentialsError } from '../services/AdminUserService';
import type { TokenService } from '../services/tokenService';
import { loginSchema } from '../validators/loginSchema';
import type { AuthSessionService } from '../services/authSessionService';
import { sendTokens } from './authController';

export function adminController(adminService: AdminUserService, tokens: TokenService, sessions: AuthSessionService) {
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

			const credentials = await sessions.create({ kind: 'admin', adminId: admin.adminId, role: admin.role });

			res.status(200).json({
				status: 'Success',
				...sendTokens(res, credentials),
				admin: {
					adminId: admin.adminId,
					forename: admin.forename,
					surname: admin.surname,
					email: admin.email,
					role: admin.role,
				},
			});
		} catch (error) {
			if (error instanceof InvalidCredentialsError) {
				res.status(401).json({ error: 'Invalid email or password' });
				return;
			}
			console.error('Login error:', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	router.get(['/admin/me', '/admin'], requireAdmin(tokens), async (req: Request, res: Response) => {
		try {
			const admin = await adminService.findById(res.locals.admin?.adminId ?? -1);
			if (!admin) {
				res.status(401).json({ error: 'Authentication required' });
				return;
			}
			res.set('Cache-Control', 'no-store');
			if (req.path === '/admin') {
				res.json({
					staff: { name: `${admin.forename} ${admin.surname}` },
					error: 'You are logged in. Dashboard metrics are not implemented yet.',
				});
				return;
			}
			res.json({
				adminId: admin.adminId,
				forename: admin.forename,
				surname: admin.surname,
				email: admin.email,
				role: admin.role,
			});
		} catch (error) {
			console.error('Admin lookup failed', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	return router;
}


