import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderError, OrderService } from '../src/services/orderService.ts';

test('order creation consumes an active reservation in the order transaction', async () => {
	const now = new Date(Date.now() + 60_000);
	const state = {
		reservation: {
			reservationId: 7,
			userId: 3,
			status: 'ACTIVE',
			expiresAt: now,
			items: [{ productId: 11, quantity: 2 }],
		},
		orders: [],
	};
	const consumeArgs = [];
	const orderService = new OrderService(
		{
			$transaction: async (operation) => operation({
				reservation: {
					findUnique: async () => state.reservation,
					updateMany: async (args) => {
						consumeArgs.push(args);
						if (
							state.reservation.status !== args.where.status ||
							state.reservation.expiresAt <= args.where.expiresAt.gt
						) {
							return { count: 0 };
						}
						state.reservation.status = args.data.status;
						return { count: 1 };
					},
					update: async ({ data }) => {
						state.reservation.orderId = data.orderId;
					},
				},
				order: {
					create: async ({ data }) => {
						const order = { orderId: state.orders.length + 1, ...data, userId: data.userId, orderPlacedAt: new Date() };
						state.orders.push(order);
						return order;
					},
				},
				orderItem: { create: async () => {} },
			}),
		},
		{
			findByIds: async () => [{ productId: 11, name: 'Widget', price: 5 }],
		},
		{
			getItems: async () => new Map(),
			removeItem: async () => true,
		},
	);

	const result = await orderService.createOrderFromReservation(3, 7);

	assert.equal(result.orderId, 1);
	assert.equal(state.reservation.status, 'CONVERTED');
	assert.equal(state.reservation.orderId, result.orderId);
	assert.equal(state.orders.length, 1);
	assert.equal(consumeArgs[0].where.reservationId, 7);
	assert.equal(consumeArgs[0].where.userId, 3);
	assert.equal(consumeArgs[0].where.status, 'ACTIVE');
	assert.ok(consumeArgs[0].where.expiresAt.gt instanceof Date);
	assert.equal(consumeArgs[0].data.status, 'CONVERTED');

	await assert.rejects(orderService.createOrderFromReservation(3, 7), OrderError);
	assert.equal(state.orders.length, 1);
});
