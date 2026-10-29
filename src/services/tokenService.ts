import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAdminRole, type AdminRole } from '../models/adminRoles';

export interface AdminTokenPayload {
    adminId: number;
    role: AdminRole;
    exp: number;
}

export const ADMIN_TOKEN_TTL_SECONDS = 60 * 60 * 8;

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export class TokenService {
    constructor(private readonly secret: string) { }

    sign(adminId: number, role: AdminRole, now = Date.now()): string {
        const payload: AdminTokenPayload = { adminId, role, exp: Math.floor(now / 1000) + ADMIN_TOKEN_TTL_SECONDS };
        const body = b64(JSON.stringify(payload));
        return `${body}.${this.signature(body)}`;
    }

    verify(token: string, now = Date.now()): AdminTokenPayload | null {
        const [body, signature, ...rest] = token.split('.');
        if (!body || !signature || rest.length > 0) return null;

        const expected = Buffer.from(this.signature(body));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

        try {
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            if (typeof payload.adminId !== 'number' || typeof payload.exp !== 'number') return null;
            if (typeof payload.role !== 'string' || !isAdminRole(payload.role)) return null;
            if (payload.exp <= Math.floor(now / 1000)) return null;
            return payload;
        } catch {
            return null;
        }
    }

    private signature(body: string): string {
        return b64(createHmac('sha256', this.secret).update(body).digest());
    }
}

export function createTokenService(secret = process.env.ADMIN_TOKEN_SECRET): TokenService {
    if (secret) return new TokenService(secret);
    if (process.env.NODE_ENV === 'production') {
        throw new Error('ADMIN_TOKEN_SECRET environment variable is not set');
    }
    // Dev/test fallback: tokens are invalidated whenever the process restarts.
    return new TokenService(randomBytes(32).toString('hex'));
}
