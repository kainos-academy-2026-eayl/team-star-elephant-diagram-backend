import prisma from '../prismaClient';

export interface RefreshSession {
	id: string;
	principalId: number;
	principalKind: string;
	tokenHash: string;
	expiresAt: Date;
	revokedAt: Date | null;
}

export interface RefreshSessionRepository {
	create(session: RefreshSession): Promise<void>;
	findById(id: string): Promise<RefreshSession | null>;
	rotate(
		id: string,
		previousHash: string,
		nextHash: string,
		now: Date,
	): Promise<boolean>;
	revoke(id: string, now: Date): Promise<void>;
}

export const prismaRefreshSessionRepository: RefreshSessionRepository = {
	async create(session) {
		await prisma.refreshSession.create({ data: session });
	},
	findById(id) {
		return prisma.refreshSession.findUnique({ where: { id } });
	},
	async rotate(id, previousHash, nextHash, now) {
		const { count } = await prisma.refreshSession.updateMany({
			where: {
				id,
				tokenHash: previousHash,
				revokedAt: null,
				expiresAt: { gt: now },
			},
			data: { tokenHash: nextHash },
		});
		return count === 1;
	},
	async revoke(id, now) {
		await prisma.refreshSession.updateMany({
			where: { id, revokedAt: null },
			data: { revokedAt: now },
		});
	},
};
