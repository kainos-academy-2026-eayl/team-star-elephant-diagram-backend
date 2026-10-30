import prisma from '../prismaClient';

export interface PasswordResetRepository {
	save(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
	findByHash(tokenHash: string): Promise<{ userId: number; passwordResetExpiresAt: Date | null } | null>;
	consume(tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;
}

export const prismaPasswordResetRepository: PasswordResetRepository = {
	async save(userId, tokenHash, expiresAt) {
		await prisma.user.update({
			where: { userId },
			data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
		});
	},
	findByHash(tokenHash) {
		return prisma.user.findUnique({
			where: { passwordResetTokenHash: tokenHash },
			select: { userId: true, passwordResetExpiresAt: true },
		});
	},
	consume(tokenHash, passwordHash, now) {
		return prisma.$transaction(async (tx) => {
			const user = await tx.user.findUnique({
				where: { passwordResetTokenHash: tokenHash },
				select: { userId: true },
			});
			if (!user) return false;

			// The conditional update claims the token even under concurrent redemption.
			const { count } = await tx.user.updateMany({
				where: {
					userId: user.userId,
					passwordResetTokenHash: tokenHash,
					passwordResetExpiresAt: { gt: now },
				},
				data: {
					passwordHash,
					passwordResetTokenHash: null,
					passwordResetExpiresAt: null,
				},
			});
			if (count !== 1) return false;
			await tx.refreshSession.updateMany({
				where: { principalId: user.userId, principalKind: 'customer', revokedAt: null },
				data: { revokedAt: now },
			});
			return true;
		});
	},
};
