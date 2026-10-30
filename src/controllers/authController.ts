import { Router, type Response } from 'express';
import type { AdminUserService } from '../services/AdminUserService';
import {
	InvalidSessionError,
	type AuthSessionService,
} from '../services/authSessionService';
import type { UserService } from '../services/userService';
import { ACCESS_TOKEN_TTL_SECONDS } from '../services/tokenService';

export const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: true,
	sameSite: 'strict',
	path: '/',
} as const;

export function sendTokens(
	res: Response,
	credentials: { accessToken: string; refreshToken: string; expiresAt: Date },
) {
	res.set('Cache-Control', 'no-store');
	res.cookie(REFRESH_COOKIE, credentials.refreshToken, {
		...COOKIE_OPTIONS,
		expires: credentials.expiresAt,
		maxAge: Math.max(0, credentials.expiresAt.getTime() - Date.now()),
	});
	return {
		accessToken: credentials.accessToken,
		expiresIn: ACCESS_TOKEN_TTL_SECONDS,
	};
}

export function authController(
	sessions: AuthSessionService,
	admins: AdminUserService,
	users: UserService,
) {
	const router = Router();
	router.use(
		['/auth/refresh', '/auth/logout', '/admin/logout'],
		(req, res, next) => {
			res.set('Cache-Control', 'no-store');
			const origin = req.get('origin');
			if (
				origin &&
				origin !== process.env.FRONTEND_BASE_URL &&
				origin !== `${req.protocol}://${req.get('host')}`
			) {
				res.sendStatus(403);
				return;
			}
			next();
		},
	);
	router.post('/auth/refresh', async (req, res) => {
		try {
			const token: unknown = req.cookies?.[REFRESH_COOKIE];
			if (typeof token !== 'string' || !token) throw new InvalidSessionError();
			const credentials = await sessions.refresh(token, async (payload) => {
				if (payload.kind === 'admin') {
					const admin = await admins.findById(payload.principalId);
					return admin
						? { kind: 'admin', adminId: admin.adminId, role: admin.role }
						: null;
				}
				const user = await users.findById(payload.principalId);
				return user
					? { kind: 'customer', userId: user.userId, email: user.email }
					: null;
			});
			res.json({ status: 'Success', ...sendTokens(res, credentials) });
		} catch (error) {
			if (error instanceof InvalidSessionError) {
				res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
				res
					.status(401)
					.set('Cache-Control', 'no-store')
					.json({ error: error.message });
				return;
			}
			console.error('Session refresh failed', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});
	router.post(['/auth/logout', '/admin/logout'], async (req, res) => {
		try {
			const token: unknown = req.cookies?.[REFRESH_COOKIE];
			if (typeof token === 'string') await sessions.logout(token);
			res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
			res.set('Cache-Control', 'no-store').json({ status: 'Success' });
		} catch (error) {
			console.error('Logout failed', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});
	return router;
}
