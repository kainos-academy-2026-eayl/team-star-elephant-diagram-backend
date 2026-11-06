import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import prisma from '../src/prismaClient.ts';
import { prismaUserRepository } from '../src/repositories/userRepository.ts';
import { prismaRefreshSessionRepository } from '../src/repositories/refreshSessionRepository.ts';

const originalTransaction = prisma.$transaction;
after(() => { prisma.$transaction = originalTransaction; });

test('deletion removes only customer-owned data in dependency order in one transaction', async () => {
	const calls = [];
	const tx = {
		$queryRaw: async (query, id) => {
			assert.match(query.join('?'), /FOR UPDATE/);
			assert.equal(id, 7);
			return [{ userId: 7 }];
		},
	};
	for (const model of ['orderItem', 'order', 'paymentDetail', 'basket', 'refreshSession', 'user']) {
		tx[model] = {
			[model === 'user' ? 'delete' : 'deleteMany']: async (args) => { calls.push([model, args]); },
		};
	}
	let transactions = 0;
	prisma.$transaction = async (operation) => { transactions++; return operation(tx); };
	assert.equal(await prismaUserRepository.delete(7), true);
	assert.equal(transactions, 1);
	assert.deepEqual(calls, [
		['orderItem', { where: { order: { userId: 7 } } }],
		['order', { where: { userId: 7 } }],
		['paymentDetail', { where: { userId: 7 } }],
		['basket', { where: { userId: 7 } }],
		['refreshSession', { where: { principalId: 7, principalKind: 'customer' } }],
		['user', { where: { userId: 7 } }],
	]);
});

test('missing customers do not delete any data', async () => {
	prisma.$transaction = async (operation) => operation({ $queryRaw: async () => [] });
	assert.equal(await prismaUserRepository.delete(999), false);
});

test('dependent-deletion errors reject the transaction rather than reporting success', async () => {
	let userDeleted = false;
	prisma.$transaction = async (operation) => operation({
		$queryRaw: async () => [{ userId: 7 }],
		orderItem: { deleteMany: async () => { throw new Error('delete failed'); } },
		user: { delete: async () => { userDeleted = true; } },
	});
	await assert.rejects(prismaUserRepository.delete(7), /delete failed/);
	assert.equal(userDeleted, false);
});

test('customer session creation locks the customer against concurrent deletion', async () => {
	let stored;
	prisma.$transaction = async (operation) => operation({
		$queryRaw: async (query, id) => {
			assert.match(query.join('?'), /FOR KEY SHARE/);
			assert.equal(id, 7);
			return [{ userId: 7 }];
		},
		refreshSession: { create: async ({ data }) => { stored = data; } },
	});
	const session = { id: 'test', principalId: 7, principalKind: 'customer' };
	await prismaRefreshSessionRepository.create(session);
	assert.deepEqual(stored, session);
});

test('session creation rejects a deleted customer instead of leaving an orphan session', async () => {
	prisma.$transaction = async (operation) => operation({ $queryRaw: async () => [] });
	await assert.rejects(
		prismaRefreshSessionRepository.create({ principalId: 7, principalKind: 'customer' }),
		/deleted customer/,
	);
});
