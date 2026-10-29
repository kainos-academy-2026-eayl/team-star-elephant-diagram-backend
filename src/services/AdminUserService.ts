import argon2 from 'argon2';
import type { AdminUser } from '../models/AdminUser';
import type { adminRepository } from '../repositories/adminRepository';
import type { LoginRequest } from '../validators/loginSchema';

export class InvalidCredentialsError extends Error {
	constructor(message = 'Invalid email or password') {
		super(message);
		this.name = 'InvalidCredentialsError';
	}
}

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

export class AdminUserService {
	constructor(private readonly users: adminRepository) {}

	async login(data: LoginRequest): Promise<AdminUser> {
		const adminUser = await this.users.findByEmail(data.email);

		if (!adminUser) {
			throw new InvalidCredentialsError();
		}

		if (!(await argon2.verify(adminUser.passwordHash, data.password))) {
			throw new InvalidCredentialsError();
		}

		return adminUser;
	}

	async findById(adminId: number): Promise<AdminUser | null> {
		return this.users.findById(adminId);
	}
}
