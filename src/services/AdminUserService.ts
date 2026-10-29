import argon2 from 'argon2';
import { DASHBOARD_BY_ROLE, isAdminRole, type AdminRole } from '../models/adminRoles';
import type { adminRepository } from '../repositories/adminRepository';
import type { LoginRequest } from '../validators/loginSchema';

export class InvalidCredentialsError extends Error {
    constructor() {
        super('Invalid email or password');
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

export class AdminUserService {
    constructor(private readonly admins: adminRepository) { }

    async login(data: LoginRequest): Promise<AuthenticatedAdmin> {
        const admin = await this.admins.findByEmail(data.email);

        if (!admin) {
            throw new InvalidCredentialsError();
        }

        let valid = false;
        try {
            valid = await argon2.verify(admin.passwordHash, data.password);
        } catch {
            // malformed stored hash (e.g. unseeded placeholder) must not authenticate
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
