import { createHash, randomUUID } from 'node:crypto';
import type { RefreshSessionRepository } from '../repositories/refreshSessionRepository';
import {
	REFRESH_TOKEN_TTL_SECONDS,
	type Principal,
	type RefreshTokenPayload,
	type TokenService,
} from './tokenService';

export class InvalidSessionError extends Error {
	constructor() {
		super('Invalid or expired refresh token');
	}
}

const hash = (token: string) =>
	createHash('sha256').update(token).digest('hex');

export class AuthSessionService {
	constructor(
		private readonly tokens: TokenService,
		private readonly sessions: RefreshSessionRepository,
	) {}

	async create(principal: Principal) {
		const id = randomUUID();
		const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
		const refreshToken = await this.tokens.signRefreshToken(
			principal,
			id,
			expiresAt,
		);
		const accessToken = await this.tokens.signAccess(principal);
		await this.sessions.create({
			id,
			principalId:
				principal.kind === 'admin' ? principal.adminId : principal.userId,
			principalKind: principal.kind,
			tokenHash: hash(refreshToken),
			expiresAt,
			revokedAt: null,
		});
		return { accessToken, refreshToken, expiresAt };
	}

	async refresh(
		token: string,
		lookup: (payload: RefreshTokenPayload) => Promise<Principal | null>,
	) {
		const payload = await this.tokens.verifyRefreshToken(token);
		if (!payload) throw new InvalidSessionError();
		const session = await this.sessions.findById(payload.sessionId);
		if (
			!session ||
			session.revokedAt ||
			session.expiresAt.getTime() <= Date.now() ||
			session.principalId !== payload.principalId ||
			session.principalKind !== payload.kind
		) {
			throw new InvalidSessionError();
		}
		if (session.tokenHash !== hash(token)) {
			await this.sessions.revoke(session.id, new Date());
			throw new InvalidSessionError();
		}
		const principal = await lookup(payload);
		if (!principal) {
			await this.sessions.revoke(session.id, new Date());
			throw new InvalidSessionError();
		}
		const refreshToken = await this.tokens.signRefreshToken(
			principal,
			session.id,
			session.expiresAt,
		);
		const accessToken = await this.tokens.signAccess(principal);
		if (
			!(await this.sessions.rotate(
				session.id,
				hash(token),
				hash(refreshToken),
				new Date(),
			))
		) {
			await this.sessions.revoke(session.id, new Date());
			throw new InvalidSessionError();
		}
		return { accessToken, refreshToken, expiresAt: session.expiresAt };
	}

	async logout(token: string): Promise<void> {
		const payload = await this.tokens.verifyRefreshToken(token);
		if (payload) await this.sessions.revoke(payload.sessionId, new Date());
	}
}
