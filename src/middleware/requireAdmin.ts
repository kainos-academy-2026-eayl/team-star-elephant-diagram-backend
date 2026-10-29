import type { NextFunction, Request, Response } from 'express';
import type { AdminRole } from '../models/adminRoles';
import type { AdminTokenPayload, TokenService } from '../services/tokenService';

declare module 'express-serve-static-core' {
    interface Locals {
        admin?: AdminTokenPayload;
    }
}

export function requireAdmin(tokens: TokenService, allowed?: (payload: AdminTokenPayload, req: Request) => boolean) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const header = req.headers.authorization ?? '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        const payload = token ? tokens.verify(token) : null;

        if (!payload) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        if (allowed && !allowed(payload, req)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        res.locals.admin = payload;
        next();
    };
}

export const hasRole = (...roles: AdminRole[]) => (payload: AdminTokenPayload) => roles.includes(payload.role);
