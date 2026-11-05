import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseInventoryRepository } from '../src/repositories/inventoryRepository.ts';
import { createDatabaseReservationRepository } from '../src/repositories/reservationRepository.ts';
import { ReservationService } from '../src/services/checkoutReservationService.ts';

function createPrismaMock(inventoryRows) {
	const state = {
		inventories: inventoryRows.map((row) => ({ ...row })),
		allocations: [],
	};
	const prisma = {
		inventory: {
			findMany: async ({ where }) => state.inventories.filter((row) => row.productId === where.productId),
		},
		$transaction: async (operation) => {
			const draft = structuredClone(state);
			const tx = {
				inventory: {
					findMany: async ({ where }) => draft.inventories.filter((row) => row.productId === where.productId),
					updateMany: async ({ where, data }) => {
						const row = draft.inventories.find(
							(inventory) =>
								inventory.inventoryId === where.inventoryId &&
								inventory.productId === where.productId &&
								inventory.quantity >= where.quantity.gte,
						);
						if (!row) return { count: 0 };
						row.quantity -= data.quantity.decrement;
						return { count: 1 };
					},
				},
				reservationItem: {
					findUnique: async () => ({ reservationItemId: 20 }),
				},
				reservationInventoryAllocation: {
					createMany: async ({ data }) => {
						draft.allocations.push(...data);
						return { count: data.length };
					},
				},
			};
			const result = await operation(tx);
			Object.assign(state, draft);
			return result;
		},
	};
	return { prisma, state };
}

test('availability sums supplier rows and deduction allocates exactly the requested quantity', async () => {
	const { prisma, state } = createPrismaMock([
		{ inventoryId: 1, productId: 3, quantity: 2 },
		{ inventoryId: 2, productId: 3, quantity: 5 },
	]);
	const repository = createDatabaseInventoryRepository(prisma);

	assert.equal(await repository.getAvailableQuantity(3), 7);
	assert.equal(await repository.hasAvailableQuantity(3, 6), true);
	assert.equal(await repository.decreaseQuantity(9, 3, 4), true);
	assert.deepEqual(
		state.inventories.map(({ inventoryId, quantity }) => ({ inventoryId, quantity })),
		[
			{ inventoryId: 1, quantity: 0 },
			{ inventoryId: 2, quantity: 3 },
		],
	);
	assert.deepEqual(state.allocations, [
		{ reservationItemId: 20, inventoryId: 1, quantity: 2 },
		{ reservationItemId: 20, inventoryId: 2, quantity: 2 },
	]);
});

test('insufficient combined stock leaves all supplier rows unchanged', async () => {
	const { prisma, state } = createPrismaMock([
		{ inventoryId: 1, productId: 3, quantity: 1 },
		{ inventoryId: 2, productId: 3, quantity: 1 },
	]);
	const repository = createDatabaseInventoryRepository(prisma);

	assert.equal(await repository.decreaseQuantity(9, 3, 3), false);
	assert.deepEqual(
		state.inventories.map(({ inventoryId, quantity }) => ({ inventoryId, quantity })),
		[
			{ inventoryId: 1, quantity: 1 },
			{ inventoryId: 2, quantity: 1 },
		],
	);
	assert.deepEqual(state.allocations, []);
});

test('reservation release restores only the saved supplier-row allocations', async () => {
	const reservation = {
		reservationId: 9,
		userId: 2,
		createdAt: new Date(),
		updatedAt: new Date(),
		expiresAt: new Date(),
		items: [
			{
				productId: 3,
				quantity: 4,
				inventoryAllocations: [
					{ inventoryId: 1, quantity: 2 },
					{ inventoryId: 2, quantity: 2 },
				],
			},
		],
	};
	const prisma = {
		reservation: {
			findUnique: async () => reservation,
			delete: async () => reservation,
		},
	};
	const reservations = createDatabaseReservationRepository(prisma);
	const record = await reservations.findByReservationId(9);
	const restored = [];
	const service = new ReservationService(
		reservations,
		{ increaseQuantity: async (inventoryId, quantity) => restored.push({ inventoryId, quantity }) },
		{},
		{},
	);

	await service.releaseReservation(9);
	assert.deepEqual(record.allocations.get(3), [
		{ inventoryId: 1, quantity: 2 },
		{ inventoryId: 2, quantity: 2 },
	]);
	assert.deepEqual(restored, [
		{ inventoryId: 1, quantity: 2 },
		{ inventoryId: 2, quantity: 2 },
	]);
});
