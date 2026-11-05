import assert from 'node:assert/strict';
import { test } from 'node:test';

test('permanent customer deletion persists atomically in PostgreSQL', {
	skip: !process.env.USER_DELETION_TEST_DATABASE_URL,
}, async () => {
	const url = new URL(process.env.USER_DELETION_TEST_DATABASE_URL);
	assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local test database');
	assert.match(url.pathname, /^\/user_deletion_test_[a-z0-9_]+$/, 'Use a dedicated user_deletion_test_* database');
	process.env.DATABASE_URL = url.href;
	const { default: prisma } = await import('../src/prismaClient.ts');
	const { prismaUserRepository } = await import('../src/repositories/userRepository.ts');
	const { prismaRefreshSessionRepository } = await import('../src/repositories/refreshSessionRepository.ts');
	let userId;
	let otherId;
	let productId;
	try {
		const makeUser = (email) => prisma.user.create({
			data: {
				forename: 'Deletion', surname: 'Test', email, passwordHash: 'test-hash',
				addressLine1: '', addressLine2: '', city: '', postcode: '',
			},
		});
		const user = await makeUser('delete@example.com');
		userId = user.userId;
		otherId = (await makeUser('keep@example.com')).userId;
		productId = (await prisma.product.create({
			data: { name: 'Keep product', description: 'Deletion test', price: 2, imageURL: '/test.png' },
		})).productId;
		const order = await prisma.order.create({
			data: { userId, cost: 4, orderItems: { create: { productId, quantity: 2 } } },
		});
		const basket = await prisma.basket.create({
			data: { userId, items: { create: { productId, quantity: 1 } } },
		});
		await prisma.paymentDetail.create({
			data: { userId, paymentMethod: 'DEBIT_CARD', cardName: 'Test', cardNumber: '0000000000000000', expirationDate: '01/2030' },
		});
		const session = {
			id: 'customer-delete', principalId: userId, principalKind: 'customer',
			tokenHash: 'test-hash', expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
		};
		await prismaRefreshSessionRepository.create(session);
		await prismaRefreshSessionRepository.create({ ...session, id: 'keep-admin', principalKind: 'admin' });
		await prismaRefreshSessionRepository.create({ ...session, id: 'keep-customer', principalId: otherId });

		await prisma.$executeRaw`CREATE FUNCTION deletion_test_failure() RETURNS trigger LANGUAGE plpgsql AS
			'BEGIN RAISE EXCEPTION ''test deletion failure''; END'`;
		try {
			await prisma.$executeRaw`CREATE TRIGGER deletion_test_failure BEFORE DELETE ON "RefreshSession"
				FOR EACH STATEMENT EXECUTE FUNCTION deletion_test_failure()`;
			await assert.rejects(prismaUserRepository.delete(userId), /test deletion failure/);
			assert.ok(await prisma.user.findUnique({ where: { userId } }));
			assert.equal(await prisma.order.count({ where: { userId } }), 1);
			assert.equal(await prisma.orderItem.count({ where: { orderId: order.orderId } }), 1);
			assert.equal(await prisma.paymentDetail.count({ where: { userId } }), 1);
			assert.equal(await prisma.basket.count({ where: { userId } }), 1);
			assert.equal(await prisma.basketItem.count({ where: { basketId: basket.basketId } }), 1);
			assert.ok(await prisma.refreshSession.findUnique({ where: { id: session.id } }));
		} finally {
			await prisma.$executeRaw`DROP TRIGGER IF EXISTS deletion_test_failure ON "RefreshSession"`;
			await prisma.$executeRaw`DROP FUNCTION deletion_test_failure()`;
		}

		assert.equal(await prismaUserRepository.delete(userId), true);
		assert.equal(await prisma.user.findUnique({ where: { userId } }), null);
		assert.equal(await prisma.order.count({ where: { userId } }), 0);
		assert.equal(await prisma.orderItem.count({ where: { orderId: order.orderId } }), 0);
		assert.equal(await prisma.paymentDetail.count({ where: { userId } }), 0);
		assert.equal(await prisma.basket.count({ where: { userId } }), 0);
		assert.equal(await prisma.basketItem.count({ where: { basketId: basket.basketId } }), 0);
		assert.equal(await prisma.refreshSession.findUnique({ where: { id: session.id } }), null);
		assert.equal(await prisma.refreshSession.count(), 2);
		assert.ok(await prisma.product.findUnique({ where: { productId } }));
		assert.ok(await prisma.user.findUnique({ where: { userId: otherId } }));
		assert.equal(await prismaUserRepository.delete(userId), false);
		await assert.rejects(prismaRefreshSessionRepository.create({ ...session, id: 'orphan' }), /deleted customer/);
		assert.equal(await prisma.refreshSession.findUnique({ where: { id: 'orphan' } }), null);
	} finally {
		if (userId) await prismaUserRepository.delete(userId);
		if (otherId) await prismaUserRepository.delete(otherId);
		await prisma.refreshSession.deleteMany({ where: { id: 'keep-admin' } });
		if (productId) await prisma.product.delete({ where: { productId } });
		await prisma.$disconnect();
	}
});
