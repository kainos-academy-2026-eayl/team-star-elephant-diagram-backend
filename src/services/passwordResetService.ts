import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PasswordResetRepository } from '../repositories/passwordResetRepository';
import type { UserRepository } from '../repositories/userRepository';
import { ARGON2_OPTIONS } from './userService';

export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
export type PasswordResetDelivery = (token: string) => Promise<void>;

export class InvalidPasswordResetError extends Error {
	constructor() {
		super('This reset link is invalid or has expired.');
	}
}

export class PasswordResetUnavailableError extends Error {
	constructor() {
		super('Password reset delivery is not configured.');
	}
}

export function createConsoleResetDelivery(): PasswordResetDelivery | undefined {
	const mode = process.env.PASSWORD_RESET_DELIVERY;
	if (!mode) return undefined;
	if (mode !== 'console' || process.env.NODE_ENV === 'production') {
		throw new Error('PASSWORD_RESET_DELIVERY=console is supported only outside production.');
	}
	const base = process.env.FRONTEND_BASE_URL;
	if (!base) throw new Error('FRONTEND_BASE_URL is required for local password reset delivery.');
	const url = new URL(base);
	const localHttp = url.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (
		(!localHttp && url.protocol !== 'https:') ||
		url.username || url.password || url.search || url.hash || url.pathname !== '/'
	) {
		throw new Error('FRONTEND_BASE_URL must be an HTTPS origin or a local HTTP origin.');
	}
	return async (token) => {
		const link = new URL('/reset-password', url);
		link.searchParams.set('token', token);
		console.info(`Local password reset link (expires in 15 minutes): ${link.href}`);
	};
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class PasswordResetService {
	constructor(
		private readonly users: UserRepository,
		private readonly resets: PasswordResetRepository,
		private readonly deliver: PasswordResetDelivery | undefined,
	) {}

	async request(email: string): Promise<void> {
		if (!this.deliver) throw new PasswordResetUnavailableError();
		const user = await this.users.findByEmail(email);
		if (!user) return;
		const token = randomBytes(32).toString('hex');
		await this.resets.save(user.userId, hashToken(token), new Date(Date.now() + PASSWORD_RESET_TTL_MS));
		await this.deliver(token);
	}

	async reset(token: string, password: string): Promise<void> {
		const tokenHash = hashToken(token);
		const record = await this.resets.findByHash(tokenHash);
		if (!record?.passwordResetExpiresAt || record.passwordResetExpiresAt.getTime() <= Date.now()) {
			throw new InvalidPasswordResetError();
		}
		const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
		if (!await this.resets.consume(tokenHash, passwordHash, new Date())) {
			throw new InvalidPasswordResetError();
		}
	}
}
