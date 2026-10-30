import type { NextFunction, Request, Response } from 'express';
import type { AccessTokenPayload, TokenService } from '../services/tokenService';

declare module 'express-serve-static-core' {
	interface Locals {
		admin?: AccessTokenPayload;
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
