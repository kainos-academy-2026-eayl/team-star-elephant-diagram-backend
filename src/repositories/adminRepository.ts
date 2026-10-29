import type { AdminUser } from '../models/AdminUser';
import prisma from '../prismaClient';

export interface adminRepository {
    findByEmail(email: string): Promise<AdminUser | null>;
    findById(adminId: number): Promise<AdminUser | null>;
}

export const prismaAdminUserRepository: adminRepository = {
    async findByEmail(email: string) {
        return prisma.adminUser.findUnique({
            where: { email },
        });
    },
    async findById(adminId: number) {
        return prisma.adminUser.findUnique({
            where: { adminId },
        });
    },
};
