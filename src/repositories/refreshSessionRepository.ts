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
		if (session.principalKind !== 'customer') {
			await prisma.refreshSession.create({ data: session });
			return;
		}
		await prisma.$transaction(async (tx) => {
			// Share the customer's deletion lock so login cannot leave orphaned sessions.
			const users = await tx.$queryRaw<{ userId: number }[]>`
				SELECT "userId" FROM "User" WHERE "userId" = ${session.principalId} FOR KEY SHARE
			`;
			if (users.length === 0) throw new Error('Cannot create a session for a deleted customer');
			await tx.refreshSession.create({ data: session });
		});
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
