import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prismaClient.ts';
import { prismaAdminUserRepository } from '../src/repositories/adminRepository.ts';

test('dashboard low-stock query uses supplier-line thresholds and returns separate product status totals', async (t) => {
	const queries = [];
	const transaction = prisma.$transaction;
	const original = {
		aggregate: prisma.inventory.aggregate,
		count: prisma.inventory.count,
		findMany: prisma.inventory.findMany,
	};
	const productCount = prisma.product.count;
	t.after(() => {
		prisma.$transaction = transaction;
		Object.assign(prisma.inventory, original);
		prisma.product.count = productCount;
	});

	prisma.$transaction = (operations) => Promise.all(operations);
	prisma.inventory.aggregate = async () => ({ _sum: { quantity: 12 } });
	prisma.inventory.count = async () => 6;
	prisma.product.count = async (query) => query?.where?.stockStatus === 'LOW_STOCK' ? 3 : query?.where ? 2 : 12;
	prisma.inventory.findMany = async (query) => {
		queries.push(query);
		if (!query.where) return [];
		return [{
			inventoryId: 7,
			quantity: 0,
			reorderLevel: 5,
			product: { name: 'Tea' },
			supplier: { name: 'Tea supplier' },
		}];
	};

	const result = await prismaAdminUserRepository.getInventoryMetrics();
	const query = queries.find((entry) => entry.where);
	assert.deepEqual(query.where, { quantity: { lte: prisma.inventory.fields.reorderLevel } });
	assert.equal(query.take, 5);
	assert.deepEqual(query.orderBy, [{ quantity: 'asc' }, { inventoryId: 'asc' }]);
	assert.equal(result.lowStockLines, 6);
	assert.deepEqual(result.lowStockItems, [
		{ inventoryId: 7, product: 'Tea', supplier: 'Tea supplier', quantity: 0, reorderLevel: 5 },
	]);
	assert.equal(result.totalProducts, 12);
	assert.equal(result.lowStockProducts, 3);
	assert.equal(result.outOfStockProducts, 2);
});
