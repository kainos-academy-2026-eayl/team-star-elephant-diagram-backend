import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../src/services/inventoryService.ts';
import { TokenService } from '../src/services/tokenService.ts';

test('PostgreSQL inventory: adjustments, synchronization, history, atomic rollback and concurrency', {
	skip: !process.env.INVENTORY_TEST_DATABASE_URL,
}, async (t) => {
	const url = new URL(process.env.INVENTORY_TEST_DATABASE_URL);
	assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local test database');
	assert.match(url.pathname, /^\/inventory_test_[a-z0-9_]+$/, 'Use a dedicated inventory_test_* database');
	const db = new PrismaClient({ datasourceUrl: url.href });
	const service = new InventoryService(db);
	const suffix = randomUUID();
	const productIds = [];
	let admin;
	let supplier;
	let secondary;
	const makeProduct = async (quantity = 20, threshold = 5, extra = {}) => {
		const product = await db.product.create({ data: {
			name: `Inventory test ${suffix}`, description: 'Inventory integration fixture', price: 2, imageURL: '/test.png',
			lowStockThreshold: threshold, ...extra,
		} });
		productIds.push(product.productId);
		await db.productSupplier.create({ data: { productId: product.productId, supplierId: supplier.supplierId } });
		const row = await db.inventory.create({ data: { productId: product.productId, supplierId: supplier.supplierId, quantity, marketValue: 2 } });
		return { productId: product.productId, inventoryId: row.inventoryId };
	};
	const checkTotal = async (productId, stock, status) => {
		const product = await db.product.findUniqueOrThrow({ where: { productId } });
		const rows = await db.inventory.findMany({ where: { productId } });
		assert.equal(product.stockQuantity, stock);
		assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), stock);
		assert.equal(product.stockStatus, status);
		return product;
	};
	try {
		admin = await db.adminUser.create({ data: {
			forename: 'Inventory', surname: 'Test', email: `inventory-${suffix}@example.com`,
			role: 'InventoryManager', passwordHash: 'not-a-real-password',
		} });
		supplier = await db.supplier.create({ data: { name: `Inventory ${suffix}`, email: `${suffix}@example.com`, address: 'Test' } });
		secondary = await db.supplier.create({ data: { name: `Secondary ${suffix}`, email: `second-${suffix}@example.com`, address: 'Test' } });

		await t.test('adds 20 + 10 = 30, removes 20 - 5 = 15, and records the actor and notes', async () => {
			for (const [quantity, adjustment, expected, reason] of [[20, 10, 30, 'Restock'], [20, -5, 15, 'Count'], [10, -3, 7, 'Damaged']]) {
				const { productId } = await makeProduct(quantity);
				const result = await service.adjustStock(productId, adjustment, reason, 'Packaging', admin.adminId);
				assert.equal(result.stockQuantity, expected);
				await checkTotal(productId, expected, 'IN_STOCK');
				const history = await service.getAdjustmentHistory(productId);
				assert.equal(history.totalItems, 1);
				assert.equal(history.items[0].adjustedById, admin.adminId);
				assert.equal(history.items[0].previousStock, quantity);
				assert.equal(history.items[0].newStock, expected);
				assert.equal(history.items[0].adjustment, adjustment);
				assert.equal(history.items[0].reason, reason);
				assert.equal(history.items[0].notes, 'Packaging');
			}
		});

		await t.test('calculates exact status boundaries and recalculates on threshold updates', async () => {
			const { productId } = await makeProduct(10, 10);
			await checkTotal(productId, 10, 'LOW_STOCK');
			assert.equal((await service.updateThreshold(productId, 5)).stockStatus, 'IN_STOCK');
			assert.equal((await service.updateThreshold(productId, 15)).stockStatus, 'LOW_STOCK');
			assert.equal((await service.adjustStock(productId, -9, 'Count', undefined, admin.adminId)).stockStatus, 'LOW_STOCK');
			assert.equal((await service.adjustStock(productId, -1, 'Empty', undefined, admin.adminId)).stockStatus, 'OUT_OF_STOCK');
			assert.equal((await service.updateThreshold(productId, 0)).stockStatus, 'OUT_OF_STOCK');
			await checkTotal(productId, 0, 'OUT_OF_STOCK');
		});

		await t.test('rejects negative stock, overflow, invalid service inputs and missing products', async () => {
			const { productId } = await makeProduct(3);
			await assert.rejects(service.adjustStock(productId, -5, 'Damaged', undefined, admin.adminId), (error) => error.status === 400);
			await assert.rejects(service.adjustStock(productId, 2_147_483_647, 'Restock', undefined, admin.adminId), (error) => error.status === 400);
			await assert.rejects(service.adjustStock(productId, 1.5, 'Count', undefined, admin.adminId));
			await assert.rejects(service.updateThreshold(productId, -1));
			for (const action of [
				() => service.getInventoryById(2_147_483_647),
				() => service.getAdjustmentHistory(2_147_483_647),
				() => service.updateThreshold(2_147_483_647, 1),
				() => service.adjustStock(2_147_483_647, 1, 'Count', undefined, admin.adminId),
			]) await assert.rejects(action(), (error) => error.status === 404);
			await checkTotal(productId, 3, 'LOW_STOCK');
			assert.equal(await db.stockAdjustment.count({ where: { productId } }), 0);
		});

		await t.test('rolls back supplier stock and product status if audit creation fails', async () => {
			const { productId } = await makeProduct(3);
			const before = await db.product.findUniqueOrThrow({ where: { productId } });
			// A nonexistent staff FK makes the final audit insert fail after inventory writes.
			await assert.rejects(service.adjustStock(productId, 10, 'Restock', undefined, 2_147_483_647));
			const after = await checkTotal(productId, 3, 'LOW_STOCK');
			assert.equal(after.modifiedAt.getTime(), before.modifiedAt.getTime());
			assert.equal(await db.stockAdjustment.count({ where: { productId } }), 0);
		});

		await t.test('aggregates suppliers and preserves reserved stock when removing across rows', async () => {
			const { productId, inventoryId } = await makeProduct(10);
			await db.inventory.update({ where: { inventoryId }, data: { reservedQuantity: 8 } });
			const second = await db.inventory.create({ data: { productId, supplierId: secondary.supplierId, quantity: 5, marketValue: 2 } });
			await service.adjustStock(productId, -6, 'Damaged', undefined, admin.adminId);
			await checkTotal(productId, 9, 'IN_STOCK');
			assert.equal((await db.inventory.findUniqueOrThrow({ where: { inventoryId } })).quantity, 8);
			assert.equal((await db.inventory.findUniqueOrThrow({ where: { inventoryId: second.inventoryId } })).quantity, 1);
			await assert.rejects(service.adjustStock(productId, -2, 'Damaged', undefined, admin.adminId), (error) => error.status === 400);
		});

		await t.test('supports first-time stocking only after a supplier is assigned', async () => {
			const { productId } = await makeProduct(0);
			await db.inventory.deleteMany({ where: { productId } });
			await service.adjustStock(productId, 10, 'First delivery', undefined, admin.adminId);
			await checkTotal(productId, 10, 'IN_STOCK');
			await db.inventory.deleteMany({ where: { productId } });
			await db.productSupplier.deleteMany({ where: { productId } });
			await assert.rejects(service.adjustStock(productId, 10, 'First delivery', undefined, admin.adminId), (error) => error.status === 400);
			await checkTotal(productId, 0, 'OUT_OF_STOCK');
		});

		await t.test('checkout-style inventory writes, deletes and threshold writes cannot leave status stale', async () => {
			const { productId, inventoryId } = await makeProduct(20, 10);
			await db.inventory.update({ where: { inventoryId }, data: { quantity: { decrement: 10 } } });
			await checkTotal(productId, 10, 'LOW_STOCK');
			await db.product.update({ where: { productId }, data: { lowStockThreshold: 5 } });
			await checkTotal(productId, 10, 'IN_STOCK');
			await db.inventory.delete({ where: { inventoryId } });
			await checkTotal(productId, 0, 'OUT_OF_STOCK');
		});

		await t.test('searches name and SKU, combines status filters, and paginates history deterministically', async () => {
			const sku = `TEST-${suffix}`;
			const { productId } = await makeProduct(10, 10, { sku });
			for (let index = 0; index < 23; index++) await service.adjustStock(productId, 0, `Count ${index}`, undefined, admin.adminId);
			const result = await service.getInventory({ search: sku.toLowerCase(), status: 'LOW_STOCK', limit: 1 });
			assert.equal(result.totalItems, 1);
			assert.equal(result.totalPages, 1);
			assert.equal(result.items[0].productId, productId);
			assert.equal((await service.getInventory({ search: sku, status: 'IN_STOCK' })).totalItems, 0);
			assert.equal((await service.getInventory({ search: suffix })).totalItems, productIds.length);
			const beyond = await service.getInventory({ search: sku, page: 2, limit: 1 });
			assert.deepEqual(beyond.items, []);
			assert.equal(beyond.currentPage, 2);
			const details = await service.getInventoryById(productId);
			assert.equal(details.recentAdjustments.length, 20);
			assert.equal(details.recentAdjustments[0].reason, 'Count 22');
			const first = await service.getAdjustmentHistory(productId, { page: 1, limit: 20 });
			const last = await service.getAdjustmentHistory(productId, { page: 2, limit: 20 });
			assert.equal(first.totalItems, 23);
			assert.equal(first.totalPages, 2);
			assert.equal(last.items.length, 3);
			assert.equal(last.items[2].reason, 'Count 0');
			assert.equal(new Set([...first.items, ...last.items].map((item) => item.id)).size, 23);
		});

		await t.test('concurrent removals cannot oversell and successful audit entries form an unbroken chain', async () => {
			const { productId } = await makeProduct(3);
			const results = await Promise.allSettled([
				service.adjustStock(productId, -2, 'Count A', undefined, admin.adminId),
				service.adjustStock(productId, -2, 'Count B', undefined, admin.adminId),
			]);
			assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
			const rejected = results.find((result) => result.status === 'rejected');
			assert.equal(rejected.reason.status, 400, String(rejected.reason));
			await checkTotal(productId, 1, 'LOW_STOCK');
			const history = await service.getAdjustmentHistory(productId);
			assert.equal(history.totalItems, 1);
			assert.equal(history.items[0].previousStock, 3);
			assert.equal(history.items[0].newStock, 1);
			await Promise.all([
				service.adjustStock(productId, 2, 'Delivery A', undefined, admin.adminId),
				service.adjustStock(productId, 3, 'Delivery B', undefined, admin.adminId),
				service.updateThreshold(productId, 10),
			]);
			await checkTotal(productId, 6, 'LOW_STOCK');
			assert.equal((await service.getAdjustmentHistory(productId)).totalItems, 3);
		});

		await t.test('concurrent checkout-style writes and staff adjustments do not lose updates', async () => {
			const { productId, inventoryId } = await makeProduct(20);
			for (let index = 0; index < 5; index++) {
				await Promise.all([
					db.inventory.update({ where: { inventoryId }, data: { quantity: { decrement: 1 } } }),
					service.adjustStock(productId, 2, 'Delivery', undefined, admin.adminId),
				]);
			}
			await checkTotal(productId, 25, 'IN_STOCK');
			const history = await service.getAdjustmentHistory(productId);
			assert.equal(history.totalItems, 5);
			for (const audit of history.items) assert.equal(audit.newStock - audit.previousStock, 2);
		});

		await t.test('HTTP API persists stock, returns documented shapes, and applies current-role RBAC', async () => {
			const { createApp } = await import('../src/app.ts');
			const tokens = new TokenService(
				'inventory-test-admin-access-secret-32-bytes',
				'inventory-test-refresh-secret-at-least-32-bytes',
				'inventory-test-customer-secret-at-least-32-bytes',
			);
			const { productId } = await makeProduct(20);
			const app = createApp({
				adminInventoryService: service, tokenService: tokens, startReservationExpirationJob: false,
				adminRepository: { findById: (adminId) => db.adminUser.findUnique({ where: { adminId } }) },
			});
			const server = app.listen(0, '127.0.0.1');
			await once(server, 'listening');
			const root = `http://127.0.0.1:${server.address().port}/api/admin/inventory`;
			const token = await tokens.signAccessToken(admin);
			const request = (path, method = 'GET', body) => fetch(`${root}${path}`, {
				method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
			try {
				const adjusted = await request(`/${productId}/stock`, 'PATCH', { adjustment: -4, reason: 'Damaged', notes: 'Packaging destroyed' });
				assert.equal(adjusted.status, 200);
				const product = await adjusted.json();
				assert.equal(product.productId, productId);
				assert.equal(product.stockQuantity, 16);
				assert.equal(product.stockStatus, 'IN_STOCK');
				assert.equal(typeof product.sku, 'string');
				const details = await (await request(`/${productId}`)).json();
				assert.equal(details.product.stockQuantity, 16);
				assert.equal(details.recentAdjustments.length, 1);
				assert.equal(details.recentAdjustments[0].adjustedById, admin.adminId);
				const history = await (await request(`/${productId}/history`)).json();
				assert.deepEqual(Object.keys(history).sort(), ['currentPage', 'items', 'totalItems', 'totalPages']);
				assert.equal(history.items[0].notes, 'Packaging destroyed');
				const list = await (await request(`?search=${product.sku}`)).json();
				assert.deepEqual(Object.keys(list).sort(), ['currentPage', 'items', 'totalItems', 'totalPages']);
				assert.equal(list.totalItems, 1);
				const threshold = await request(`/${productId}/threshold`, 'PATCH', { lowStockThreshold: 16 });
				assert.equal((await threshold.json()).stockStatus, 'LOW_STOCK');
				assert.equal((await request(`/${productId}/stock`, 'PATCH', { adjustment: -17, reason: 'Damaged' })).status, 400);
				await checkTotal(productId, 16, 'LOW_STOCK');
				await db.adminUser.update({ where: { adminId: admin.adminId }, data: { role: 'WarehouseStaff' } });
				assert.equal((await request(`/${productId}/threshold`, 'PATCH', { lowStockThreshold: 1 })).status, 403);
				assert.equal((await request(`/${productId}/stock`, 'PATCH', { adjustment: 1, reason: 'Restock' })).status, 200);
			} finally {
				await db.adminUser.update({ where: { adminId: admin.adminId }, data: { role: 'InventoryManager' } });
				await new Promise((resolve) => server.close(resolve));
			}
		});
	} finally {
		await db.stockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
		await db.inventory.deleteMany({ where: { productId: { in: productIds } } });
		await db.productSupplier.deleteMany({ where: { productId: { in: productIds } } });
		await db.product.deleteMany({ where: { productId: { in: productIds } } });
		if (admin) await db.adminUser.delete({ where: { adminId: admin.adminId } });
		if (supplier) await db.supplier.delete({ where: { supplierId: supplier.supplierId } });
		if (secondary) await db.supplier.delete({ where: { supplierId: secondary.supplierId } });
		await db.$disconnect();
	}
});
