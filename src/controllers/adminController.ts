import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';
import { z } from 'zod';
import { createAuthRateLimiter } from '../middleware/authRateLimiter';
import { DASHBOARD_BY_ROLE, type AdminAction, type AdminResource } from '../models/adminRoles';
import { requireAdmin, requirePermission } from '../middleware/requireAdmin';
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

// Decimal digits only, up to the Postgres INTEGER upper bound; larger ids cannot exist.
const userIdSchema = z
	.string()
	.regex(/^[1-9]\d{0,9}$/)
	.transform(Number)
	.pipe(z.number().max(2_147_483_647));

const userListQuerySchema = z.object({
	search: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().positive().max(100_000).optional(),
});

// Accepts `search` (consistent with /admin/users) or `q` (the frontend's form field name).
const basketListQuerySchema = z
	.object({
		search: z.string().trim().max(100).optional(),
		q: z.string().trim().max(100).optional(),
		page: z.coerce.number().int().positive().max(100_000).optional(),
	})
	.transform(({ search, q, page }) => ({ search: search || q || undefined, page }));

export function adminController(
	adminService: AdminUserService,
	tokens: TokenService,
	sessions: AuthSessionService,
	rateLimitOptions: Partial<RateLimitOptions> = {},
) {
	const router = Router();
	const requireCurrentAdmin = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		try {
			const admin = await adminService.findById(res.locals.admin?.adminId ?? -1);
			if (!admin) {
				res.status(401).json({ error: 'Authentication required' });
				return;
			}
			res.locals.currentAdmin = admin;
			next();
		} catch (error) {
			console.error('Admin lookup failed', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	};

	// Route-level RBAC: authenticate, load the current stored role, then check Role -> Resource -> Action.
	const authorize = <R extends AdminResource>(resource: R, action: AdminAction<R>) => [
		adminRateLimit,
		requireAdmin(tokens),
		requireCurrentAdmin,
		requirePermission(resource, action),
	];

	router.post('/admin/login', createAuthRateLimiter(rateLimitOptions), async (req: Request, res: Response) => {
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
		requireCurrentAdmin,
		async (req: Request, res: Response) => {
			const admin = res.locals.currentAdmin;
			if (!admin) {
				res.status(401).json({ error: 'Authentication required' });
				return;
			}
			res.set('Cache-Control', 'no-store');
			if (req.path !== '/admin') {
				res.json({ ...admin, admin });
				return;
			}
			try {
				// Single dashboard endpoint; content is scoped to the admin's role permissions.
				res.json(await adminService.getDashboard(admin));
			} catch (error) {
				console.error('Admin dashboard failed', error);
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

	router.get(
		'/admin/users',
		...authorize('users', 'view'),
		async (req: Request, res: Response) => {
			const query = userListQuerySchema.safeParse(req.query);
			if (!query.success) {
				res.status(400).json({
					error: 'Invalid user search',
					details: z.flattenError(query.error).fieldErrors,
				});
				return;
			}
			try {
				res.set('Cache-Control', 'no-store').json(await adminService.listUsers(query.data));
			} catch (error) {
				console.error('Admin user list failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	router.get(
		'/admin/users/:id',
		...authorize('users', 'view'),
		async (req: Request, res: Response) => {
			const userId = userIdSchema.safeParse(req.params.id);
			try {
				const details = userId.success ? await adminService.getUserDetails(userId.data) : null;
				if (!details) {
					res.status(404).json({ error: 'User not found' });
					return;
				}
				res.set('Cache-Control', 'no-store').json(details);
			} catch (error) {
				console.error('Admin user lookup failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	for (const [action, status] of [
		['suspend', 'SUSPENDED'],
		['reactivate', 'ACTIVE'],
	] as const) {
		router.post(
			`/admin/users/:id/${action}`,
			...authorize('users', action),
			async (req: Request, res: Response) => {
				const userId = userIdSchema.safeParse(req.params.id);
				try {
					const result = userId.success ? await adminService.setUserStatus(userId.data, status) : null;
					if (!result) {
						res.status(404).json({ error: 'User not found' });
						return;
					}
					res.set('Cache-Control', 'no-store').json(result);
				} catch (error) {
					console.error(`Admin user ${action} failed`, error);
					res.status(500).json({ error: 'Internal server error' });
				}
			},
		);
	}

	router.get(
		'/admin/baskets',
		...authorize('baskets', 'view'),
		async (req: Request, res: Response) => {
			const query = basketListQuerySchema.safeParse(req.query);
			if (!query.success) {
				res.status(400).json({
					error: 'Invalid basket search',
					details: z.flattenError(query.error).fieldErrors,
				});
				return;
			}
			try {
				res.set('Cache-Control', 'no-store').json(await adminService.listBaskets(query.data.search, query.data.page));
			} catch (error) {
				console.error('Admin basket list failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	router.get(
		'/admin/baskets/:id',
		...authorize('baskets', 'view'),
		async (req: Request, res: Response) => {
			const basketId = userIdSchema.safeParse(req.params.id);
			try {
				const details = basketId.success ? await adminService.getBasketDetails(basketId.data) : null;
				if (!details) {
					res.status(404).json({ error: 'Basket not found' });
					return;
				}
				res.set('Cache-Control', 'no-store').json(details);
			} catch (error) {
				console.error('Admin basket lookup failed', error);
				res.status(500).json({ error: 'Internal server error' });
			}
		},
	);

	return router;
}
