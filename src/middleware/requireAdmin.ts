import type { NextFunction, Request, Response } from 'express';
import { hasPermission, type AdminAction, type AdminResource } from '../models/adminRoles';
import type { AuthenticatedAdmin } from '../services/AdminUserService';
import type { AccessTokenPayload, TokenService } from '../services/tokenService';

declare module 'express-serve-static-core' {
	interface Locals {
		admin?: AccessTokenPayload;
		// The admin as currently stored, so role changes apply before the token expires.
		currentAdmin?: AuthenticatedAdmin;
	}
}

export function requireAdmin(tokens: TokenService) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const header = req.headers.authorization ?? '';
		const token = header.startsWith('Bearer ') ? header.slice(7) : '';
		const payload = token ? await tokens.verifyAccessToken(token) : null;

		if (!payload) {
			res.status(401).json({ error: 'Authentication required' });
			return;
		}

		res.locals.admin = payload;
		next();
	};
}

// Must run after the current admin has been loaded into res.locals.currentAdmin.
export function requirePermission<R extends AdminResource>(resource: R, action: AdminAction<R>) {
	return (_req: Request, res: Response, next: NextFunction): void => {
		const admin = res.locals.currentAdmin;
		if (!admin) {
			res.status(401).json({ error: 'Authentication required' });
			return;
		}
		if (!hasPermission(admin.role, resource, action)) {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}
		next();
	};
}
