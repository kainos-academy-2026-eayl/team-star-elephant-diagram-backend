export function memoryRefreshSessions() {
	const rows = new Map();
	return {
		rows,
		async create(session) {
			rows.set(session.id, { ...session });
		},
		async findById(id) {
			return rows.get(id) ?? null;
		},
		async rotate(id, previousHash, nextHash, now) {
			const session = rows.get(id);
			if (
				!session ||
				session.revokedAt ||
				session.expiresAt <= now ||
				session.tokenHash !== previousHash
			)
				return false;
			rows.set(id, { ...session, tokenHash: nextHash });
			return true;
		},
		async revoke(id, now) {
			const session = rows.get(id);
			if (session) rows.set(id, { ...session, revokedAt: now });
		},
	};
}
