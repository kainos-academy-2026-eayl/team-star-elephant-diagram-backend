import { randomUUID } from 'node:crypto';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = 'star-elephant';
const AUDIENCE = 'star-elephant-api';

export type Principal =
	| { kind: 'admin'; adminId: number; role: string }
	| { kind: 'customer'; userId: number; email: string };
export interface AccessTokenPayload extends JWTPayload {
	adminId: number;
	role: string;
	exp: number;
}
export interface RefreshTokenPayload extends JWTPayload {
	principalId: number;
	kind: 'admin' | 'customer';
	sessionId: string;
	exp: number;
}

export class TokenService {
	private readonly accessKey: Uint8Array;
	private readonly refreshKey: Uint8Array;
	private readonly customerKey: Uint8Array;

	constructor(
		accessSecret: string,
		refreshSecret: string,
		customerSecret = accessSecret,
	) {
		for (const secret of [accessSecret, refreshSecret, customerSecret]) {
			if (Buffer.byteLength(secret) < 32)
				throw new Error('Token secrets must contain at least 32 bytes');
		}
		if (refreshSecret === accessSecret || refreshSecret === customerSecret) {
			throw new Error('Access and refresh token secrets must be different');
		}
		this.accessKey = new TextEncoder().encode(accessSecret);
		this.refreshKey = new TextEncoder().encode(refreshSecret);
		this.customerKey = new TextEncoder().encode(customerSecret);
	}

	signAccessToken(
		admin: { adminId: number; role: string },
		now = Date.now(),
	): Promise<string> {
		return this.signAccess(
			{ kind: 'admin', adminId: admin.adminId, role: admin.role },
			now,
		);
	}

	signAccess(principal: Principal, now = Date.now()): Promise<string> {
		const id =
			principal.kind === 'admin' ? principal.adminId : principal.userId;
		return this.sign(
			{ ...principal, tokenUse: 'access' },
			String(id),
			principal.kind === 'admin' ? this.accessKey : this.customerKey,
			now,
			Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS,
		);
	}

	signRefreshToken(
		principal: Principal,
		sessionId: string,
		expiresAt: Date,
		now = Date.now(),
	): Promise<string> {
		const principalId =
			principal.kind === 'admin' ? principal.adminId : principal.userId;
		return this.sign(
			{ kind: principal.kind, principalId, sessionId, tokenUse: 'refresh' },
			String(principalId),
			this.refreshKey,
			now,
			Math.floor(expiresAt.getTime() / 1000),
		);
	}

	async verifyAccessToken(
		token: string,
		now = Date.now(),
	): Promise<AccessTokenPayload | null> {
		const payload = await this.verify(token, this.accessKey, now);
		if (
			payload?.tokenUse !== 'access' ||
			payload.kind !== 'admin' ||
			!this.validId(payload.adminId) ||
			typeof payload.role !== 'string' ||
			payload.sub !== String(payload.adminId) ||
			typeof payload.exp !== 'number'
		)
			return null;
		return {
			...payload,
			adminId: payload.adminId,
			role: payload.role,
			exp: payload.exp,
		};
	}

	async verifyCustomerAccessToken(token: string): Promise<JWTPayload | null> {
		const payload = await this.verify(token, this.customerKey, Date.now());
		if (
			payload?.tokenUse !== 'access' ||
			payload.kind !== 'customer' ||
			!this.validId(payload.userId) ||
			typeof payload.email !== 'string' ||
			payload.sub !== String(payload.userId)
		)
			return null;
		return payload;
	}

	async verifyRefreshToken(
		token: string,
		now = Date.now(),
	): Promise<RefreshTokenPayload | null> {
		const payload = await this.verify(token, this.refreshKey, now);
		if (
			payload?.tokenUse !== 'refresh' ||
			(payload.kind !== 'admin' && payload.kind !== 'customer') ||
			!this.validId(payload.principalId) ||
			payload.sub !== String(payload.principalId) ||
			typeof payload.sessionId !== 'string' ||
			typeof payload.jti !== 'string' ||
			typeof payload.exp !== 'number'
		)
			return null;
		return {
			...payload,
			principalId: payload.principalId,
			kind: payload.kind,
			sessionId: payload.sessionId,
			exp: payload.exp,
		};
	}

	private validId(value: unknown): value is number {
		return (
			typeof value === 'number' && Number.isSafeInteger(value) && value > 0
		);
	}

	private sign(
		payload: JWTPayload,
		subject: string,
		key: Uint8Array,
		now: number,
		exp: number,
	): Promise<string> {
		return new SignJWT(payload)
			.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setSubject(subject)
			.setJti(randomUUID())
			.setIssuedAt(Math.floor(now / 1000))
			.setExpirationTime(exp)
			.sign(key);
	}

	private async verify(
		token: string,
		key: Uint8Array,
		now: number,
	): Promise<JWTPayload | null> {
		try {
			const { payload } = await jwtVerify(token, key, {
				algorithms: ['HS256'],
				typ: 'JWT',
				issuer: ISSUER,
				audience: AUDIENCE,
				requiredClaims: ['exp', 'iat', 'sub', 'jti'],
				currentDate: new Date(now),
			});
			return payload;
		} catch (error) {
			if (error instanceof errors.JOSEError) return null;
			throw error;
		}
	}
}

export function createTokenService(
	accessSecret = process.env.ADMIN_ACCESS_TOKEN_SECRET,
	refreshSecret = process.env.ADMIN_REFRESH_TOKEN_SECRET,
): TokenService {
	if (!accessSecret || !refreshSecret || !process.env.JWT_SECRET) {
		throw new Error(
			'JWT_SECRET, ADMIN_ACCESS_TOKEN_SECRET and ADMIN_REFRESH_TOKEN_SECRET must be set',
		);
	}
	return new TokenService(accessSecret, refreshSecret, process.env.JWT_SECRET);
}
