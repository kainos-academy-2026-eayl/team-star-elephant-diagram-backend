import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseBasketRepository } from '../src/repositories/basketRepository.ts';

test('basket listing filters valid ten-digit IDs and applies database pagination', async () => {
	let findManyArgs;
	let countArgs;
	const prisma = {
		basket: {
			findMany(args) {
				findManyArgs = args;
				return Promise.resolve([]);
			},
			count(args) {
				countArgs = args;
				return Promise.resolve(45);
			},
		},
		$transaction: (queries) => Promise.all(queries),
	};
	const repository = createDatabaseBasketRepository(prisma);

	const result = await repository.list('1000000000', 20, 20);
	assert.deepEqual(result, { baskets: [], total: 45 });
	assert.equal(findManyArgs.skip, 20);
	assert.equal(findManyArgs.take, 20);
	assert.deepEqual(countArgs.where, findManyArgs.where);
	assert.ok(findManyArgs.where.AND[0].OR.some((clause) => clause.basketId === 1_000_000_000));

	await repository.list('2147483648', 0, 20);
	assert.equal(
		findManyArgs.where.AND[0].OR.some((clause) => 'basketId' in clause),
		false,
	);
});

test('basket item and activity updates roll back together on activity write failure', async () => {
	const originalUpdatedAt = new Date('2026-10-25T12:00:00Z');
	let failActivityUpdate = true;
	const state = {
		basket: { basketId: 1, userId: 2, updatedAt: originalUpdatedAt },
		items: [{ basketId: 1, productId: 3, quantity: 2 }],
	};
	const prisma = {
		$transaction: async (operation) => {
			const draft = structuredClone(state);
			const tx = {
				basket: {
					findUnique: async () => draft.basket,
					update: async ({ data }) => {
						if (failActivityUpdate) throw new Error('activity write failed');
						draft.basket.updatedAt = data.updatedAt;
					},
				},
				basketItem: {
					findUnique: async () => draft.items[0],
					update: async ({ data }) => {
						draft.items[0].quantity = data.quantity;
					},
				},
			};
			const result = await operation(tx);
			state.basket = draft.basket;
			state.items = draft.items;
			return result;
		},
	};
	const repository = createDatabaseBasketRepository(prisma);

	await assert.rejects(repository.addQuantity('2', 3, 1, 10), /activity write failed/);
	assert.equal(state.items[0].quantity, 2);
	assert.equal(state.basket.updatedAt, originalUpdatedAt);

	failActivityUpdate = false;
	assert.equal(await repository.addQuantity('2', 3, 1, 10), true);
	assert.equal(state.items[0].quantity, 3);
	assert.notEqual(state.basket.updatedAt, originalUpdatedAt);
});

test('basket item quantity changes and removals are scoped to the customer basket', async () => {
	const calls = [];
	const counts = { updateMany: 1, deleteMany: 0 };
	const tx = {
		basketItem: {
			updateMany: async (args) => { calls.push(['updateMany', args]); return { count: counts.updateMany }; },
			deleteMany: async (args) => { calls.push(['deleteMany', args]); return { count: counts.deleteMany }; },
		},
		basket: { update: async (args) => { calls.push(['touch', args.where]); } },
	};
	const repository = createDatabaseBasketRepository({ $transaction: (operation) => operation(tx) });

	assert.equal(await repository.setQuantity('7', 3, 4), true);
	assert.equal(await repository.removeItem('7', 3), false);
	assert.equal(await repository.setQuantity('not-a-user', 3, 4), false);

	assert.deepEqual(calls, [
		['updateMany', { where: { productId: 3, basket: { userId: 7 } }, data: { quantity: 4 } }],
		['touch', { userId: 7 }],
		['deleteMany', { where: { productId: 3, basket: { userId: 7 } } }],
	]);
});
