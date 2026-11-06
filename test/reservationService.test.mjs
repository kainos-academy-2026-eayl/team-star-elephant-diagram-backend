import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import prisma from '../src/prismaClient.ts';
import { convertReservationToOrder, ReservationError } from '../src/services/reservationService.ts';

function paymentTransaction(t, { expired = false, missing = false, failOrder = false, failClear = false } = {}) {
	const state = {
		basketItems: [{ userId: 3, productId: 11 }, { userId: 4, productId: 12 }],
		orders: [],
	};
	const deleteArgs = [];
	const reservation = {
		reservationId: 7,
		expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)),
		items: [{ productId: 11, quantity: 2, product: { name: 'Widget', price: new Prisma.Decimal(5) } }],
	};
	const originalTransaction = prisma.$transaction;
	t.after(() => { prisma.$transaction = originalTransaction; });
	prisma.$transaction = async (operation) => {
		const pending = structuredClone(state);
		const result = await operation({
			reservation: {
				findFirst: async () => missing ? null : reservation,
				updateMany: async () => ({ count: 1 }),
				update: async () => ({}),
			},
			reservationItem: { findMany: async () => reservation.items },
			inventory: {
				findFirst: async () => ({ inventoryId: 1, reservedQuantity: 2 }),
				update: async () => ({}),
			},
			order: {
				create: async ({ data }) => {
					if (failOrder) throw new Error('Order creation failed');
					const order = {
						orderId: 42, ...data, orderPlacedAt: new Date(),
						orderItems: data.orderItems.create,
					};
					pending.orders.push(order.orderId);
					return order;
				},
			},
			basketItem: {
				deleteMany: async (args) => {
					deleteArgs.push(args);
					pending.basketItems = pending.basketItems.filter(item => item.userId !== args.where.basket.userId);
					if (failClear) throw new Error('Basket clearing failed');
					return { count: 1 };
				},
			},
			basket: { updateMany: async () => ({ count: 1 }) },
		});
		Object.assign(state, pending);
		return result;
	};
	return { state, deleteArgs };
}

test('successful payment clears only the paying customer basket within the order transaction', async (t) => {
	const { state, deleteArgs } = paymentTransaction(t);
	const result = await convertReservationToOrder(3);

	assert.equal(result.order.orderStatus, 'PROCESSING');
	assert.deepEqual(state.orders, [42]);
	assert.deepEqual(state.basketItems, [{ userId: 4, productId: 12 }]);
	assert.deepEqual(deleteArgs, [{ where: { basket: { userId: 3 } } }]);
});

for (const scenario of ['expired', 'missing', 'failOrder', 'failClear']) {
	test(`payment with ${scenario} preserves basket contents and creates no order`, async (t) => {
		const { state } = paymentTransaction(t, { [scenario]: true });
		const before = structuredClone(state);

		await assert.rejects(
			convertReservationToOrder(3),
			scenario === 'expired' || scenario === 'missing' ? ReservationError : Error,
		);
		assert.deepEqual(state, before);
	});
}
