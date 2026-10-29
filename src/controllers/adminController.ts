import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DASHBOARD_BY_ROLE } from '../models/adminRoles';
import { requireAdmin } from '../middleware/requireAdmin';
import {
	InvalidCredentialsError,
	UnknownAdminRoleError,
	type AdminUserService,
} from '../services/AdminUserService';
import type { TokenService } from '../services/tokenService';
import type { AuthSessionService } from '../services/authSessionService';
import { loginSchema } from '../validators/loginSchema';
import { sendTokens } from './authController';

const adminRateLimit = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 100,
	standardHeaders: true,
	legacyHeaders: false,
});

export function adminController(
	adminService: AdminUserService,
	tokens: TokenService,
	sessions: AuthSessionService,
) {
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
			const credentials = await sessions.create({
				kind: 'admin',
				adminId: admin.adminId,
				role: admin.role,
			});

			res.status(200).json({
				status: 'Success',
				...sendTokens(res, credentials),
				token: credentials.accessToken,
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

	router.get(
		['/admin/me', '/admin'],
		adminRateLimit,
		requireAdmin(tokens),
		async (req: Request, res: Response) => {
			try {
				const admin = await adminService.findById(
					res.locals.admin?.adminId ?? -1,
				);
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
				res.json({ ...admin, admin });
			} catch (error) {
				console.error('Admin lookup failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	router.get(
		'/admin/dashboards/:key',
		adminRateLimit,
		requireAdmin(tokens),
		async (req: Request, res: Response) => {
			try {
				const admin = await adminService.findById(
					res.locals.admin?.adminId ?? -1,
				);
				if (!admin) {
					res.status(401).json({ error: 'Authentication required' });
					return;
				}
				if (
					admin.role !== 'SuperAdmin' &&
					DASHBOARD_BY_ROLE[admin.role] !== req.params.key
				) {
					res.status(403).json({ error: 'Forbidden' });
					return;
				}
				res.set('Cache-Control', 'no-store').json({
					dashboard: req.params.key,
					role: admin.role,
				});
			} catch (error) {
				console.error('Admin lookup failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	return router;
}
