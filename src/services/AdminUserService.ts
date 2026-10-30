import argon2 from 'argon2';
import { DASHBOARD_BY_ROLE, isAdminRole, type AdminRole } from '../models/adminRoles';
import type { adminRepository } from '../repositories/adminRepository';
import type { LoginRequest } from '../validators/loginSchema';

export class InvalidCredentialsError extends Error {
	constructor(message = 'Invalid email or password') {
		super(message);
		this.name = 'InvalidCredentialsError';
	}
}

export class UnknownAdminRoleError extends Error {
	constructor(role: string) {
		super(`Admin has unrecognised role: ${role}`);
		this.name = 'UnknownAdminRoleError';
	}
}

export interface AuthenticatedAdmin {
	adminId: number;
	forename: string;
	surname: string;
	email: string;
	role: AdminRole;
	dashboard: string;
}

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

export class AdminUserService {
	constructor(private readonly admins: adminRepository) {}

	async login(data: LoginRequest): Promise<AuthenticatedAdmin> {
		const admin = await this.admins.findByEmail(data.email);

		if (!admin) {
			throw new InvalidCredentialsError();
		}

		let valid = false;
		try {
			valid = await argon2.verify(admin.passwordHash, data.password);
		} catch {
			// Malformed stored hashes must not authenticate.
		}

		if (!valid) {
			throw new InvalidCredentialsError();
		}
		if (!isAdminRole(admin.role)) {
			throw new UnknownAdminRoleError(admin.role);
		}

		return {
			adminId: admin.adminId,
			forename: admin.forename,
			surname: admin.surname,
			email: admin.email,
			role: admin.role,
			dashboard: DASHBOARD_BY_ROLE[admin.role],
		};
	}

	async findById(adminId: number): Promise<AuthenticatedAdmin | null> {
		const admin = await this.admins.findById(adminId);
		if (!admin || !isAdminRole(admin.role)) return null;
		return {
			adminId: admin.adminId,
			forename: admin.forename,
			surname: admin.surname,
			email: admin.email,
			role: admin.role,
			dashboard: DASHBOARD_BY_ROLE[admin.role],
		};
	}
}
