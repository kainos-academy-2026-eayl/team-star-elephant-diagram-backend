import argon2 from 'argon2';
import type { adminRepository } from '../repositories/adminRepository';
import type { LoginRequest } from '../validators/loginSchema';


// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
} as const;

export class adminUserService {
    static login: any;
    constructor(private readonly users: adminRepository) { }


    async login(data: LoginRequest): Promise<void> {
        const AdminUser = await this.users.findByEmail(data.email);

        if (!AdminUser) {
            throw new Error('Invalid email or password');
        }

        if (!await argon2.verify(AdminUser.passwordHash, data.password)) {
            throw new Error('Invalid email or password');
        }
    }
}