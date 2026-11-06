import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import express from 'express';
import { Prisma } from '@prisma/client';
import './helpers/authEnvironment.mjs';
import { createApp } from '../src/app.ts';
import { InventoryController } from '../src/controllers/inventoryController.ts';
import { createInventoryRouter } from '../src/routes/inventoryRoutes.ts';
import { InventoryError, InventoryService } from '../src/services/inventoryService.ts';
import { TokenService } from '../src/services/tokenService.ts';
import { hasPermission } from '../src/models/adminRoles.ts';
import {
	inventoryIdSchema, inventoryPaginationSchema, inventoryQuerySchema,
	stockAdjustmentSchema, thresholdSchema,
} from '../src/validators/inventorySchema.ts';

process.env.JWT_SECRET = 'test-customer-secret-at-least-32-bytes';

test('inventory validation enforces JSON integers, bounds, reason and strict bodies', () => {
	for (const adjustment of [undefined, null, '1', 1.1, NaN, Infinity, 2_147_483_648, -2_147_483_648]) {
		assert.equal(stockAdjustmentSchema.safeParse({ adjustment, reason: 'Stock count' }).success, false);
	}
	for (const reason of [undefined, null, '', '  a  ', '💥a', 'a'.repeat(256)]) {
		assert.equal(stockAdjustmentSchema.safeParse({ adjustment: 1, reason }).success, false);
	}
	for (const lowStockThreshold of [undefined, null, '1', -1, 0.1, 2_147_483_648]) {
		assert.equal(thresholdSchema.safeParse({ lowStockThreshold }).success, false);
	}
	assert.equal(thresholdSchema.parse({ lowStockThreshold: 0 }).lowStockThreshold, 0);
	assert.deepEqual(stockAdjustmentSchema.parse({ adjustment: -4, reason: ' Damaged ', notes: 'Box' }),
		{ adjustment: -4, reason: 'Damaged', notes: 'Box' });
	assert.equal(stockAdjustmentSchema.parse({ adjustment: 1, reason: '💥ab' }).reason, '💥ab');
	assert.equal(stockAdjustmentSchema.safeParse({ adjustment: 1, reason: 'Count', adjustedById: 99 }).success, false);
	assert.equal(stockAdjustmentSchema.safeParse({ adjustment: 0, reason: 'Count' }).success, true);
	assert.equal(stockAdjustmentSchema.safeParse({ adjustment: 1, reason: 'Count', notes: 5 }).success, false);
});

test('inventory query and identifier validation reject malformed, repeated and excessive inputs', () => {
	assert.deepEqual(inventoryQuerySchema.parse({}), { page: 1, limit: 20 });
	assert.deepEqual(inventoryPaginationSchema.parse({ page: '2', limit: '100' }), { page: 2, limit: 100 });
	for (const query of [
		{ page: '0' }, { page: '1.1' }, { page: '100001' }, { limit: '101' },
		{ limit: '-1' }, { status: 'low' }, { status: ['LOW_STOCK', 'IN_STOCK'] },
		{ search: { contains: 'x' } }, { search: 'x'.repeat(101) }, { page: ['1', '2'] },
	]) assert.equal(inventoryQuerySchema.safeParse(query).success, false);
	for (const id of ['0', '-1', '1.5', '1e2', '2147483648', 'abc', '01']) {
		assert.equal(inventoryIdSchema.safeParse({ id }).success, false, id);
	}
	assert.equal(inventoryIdSchema.parse({ id: '2147483647' }).id, 2_147_483_647);
});

test('stock status boundaries match the business rules', () => {
	const service = new InventoryService({});
	for (const [stock, threshold, status] of [
		[0, 0, 'OUT_OF_STOCK'], [0, 10, 'OUT_OF_STOCK'],
		[10, 10, 'LOW_STOCK'], [1, 10, 'LOW_STOCK'], [11, 10, 'IN_STOCK'], [1, 0, 'IN_STOCK'],
	]) assert.equal(service.calculateStockStatus(stock, threshold), status);
});

test('service queries combine name/SKU search with status and paginate a consistent snapshot', async () => {
	let criteria;
	const tx = {
		product: {
			count: async ({ where }) => { criteria = where; return 3; },
			findMany: async (query) => {
				assert.deepEqual(query.where, criteria);
				assert.equal(query.skip, 2);
				assert.equal(query.take, 2);
				assert.deepEqual(query.orderBy, { productId: 'asc' });
				return [{ productId: 3 }];
			},
		},
	};
	const service = new InventoryService({
		$transaction: async (work, options) => {
			assert.equal(options.isolationLevel, 'RepeatableRead');
			return work(tx);
		},
	});
	assert.deepEqual(await service.getInventory({ search: ' tea ', status: 'LOW_STOCK', page: 2, limit: 2 }),
		{ items: [{ productId: 3 }], totalItems: 3, totalPages: 2, currentPage: 2 });
	assert.deepEqual(criteria, {
		stockStatus: 'LOW_STOCK',
		OR: [{ name: { contains: 'tea', mode: 'insensitive' } }, { sku: { contains: 'tea', mode: 'insensitive' } }],
	});
});

test('service retries only serialization failures, and reports exhausted retries', async () => {
	let attempts = 0;
	const conflict = new Prisma.PrismaClientKnownRequestError('Conflict', { code: 'P2034', clientVersion: '6.19.3' });
	const db = { $transaction: async () => { attempts++; throw conflict; } };
	await assert.rejects(new InventoryService(db).updateThreshold(1, 10), (error) => error.status === 409);
	assert.equal(attempts, 3);
	for (const code of ['40001', '40P01']) {
		db.$transaction = async () => {
			throw new Prisma.PrismaClientKnownRequestError('Raw conflict', {
				code: 'P2010', meta: { code }, clientVersion: '6.19.3',
			});
		};
		await assert.rejects(new InventoryService(db).updateThreshold(1, 10), (error) => error.status === 409);
	}
	db.$transaction = async () => { throw new Error('Database offline'); };
	await assert.rejects(new InventoryService(db).updateThreshold(1, 10), /Database offline/);
});

test('controller forwards validated payload and the authenticated actor, not body-supplied identity', async () => {
	const calls = [];
	const service = Object.fromEntries([
		'getInventory', 'getInventoryById', 'adjustStock', 'updateThreshold', 'getAdjustmentHistory',
		'createProduct', 'updateProduct', 'deleteProduct', 'getSuppliers',
	].map((method) => [method, async (...args) => { calls.push([method, ...args]); return { ok: true }; }]));
	const controller = new InventoryController(service);
	const res = {
		locals: {
			currentAdmin: { adminId: 7 },
			inventoryRequest: {
				productId: 42, query: { page: 1, limit: 20 }, pagination: { page: 2, limit: 5 },
				adjustment: { adjustment: -4, reason: 'Damaged', notes: 'Packaging' },
				threshold: { lowStockThreshold: 10 },
			},
		},
		json: (body) => assert.deepEqual(body, { ok: true }),
	};
	for (const method of ['getInventory', 'getInventoryItem', 'adjustStock', 'updateThreshold', 'getHistory']) {
		await controller[method]({ body: { adjustedById: 999 } }, res);
	}
	assert.deepEqual(calls, [
		['getInventory', { page: 1, limit: 20 }], ['getInventoryById', 42],
		['adjustStock', 42, -4, 'Damaged', 'Packaging', 7],
		['updateThreshold', 42, 10], ['getAdjustmentHistory', 42, { page: 2, limit: 5 }],
	]);
});

const tokens = new TokenService(
	'test-admin-access-secret-at-least-32-bytes',
	'test-refresh-secret-at-least-32-bytes-long',
	'test-customer-secret-at-least-32-bytes',
);
const stored = new Map([
	[1, { adminId: 1, role: 'InventoryManager' }],
	[2, { adminId: 2, role: 'WarehouseStaff' }],
	[3, { adminId: 3, role: 'Admin' }],
	[4, { adminId: 4, role: 'SuperAdmin' }],
	[5, { adminId: 5, role: 'FinanceManager' }],
	[6, { adminId: 6, role: 'CustomerService' }],
]);
const calls = [];
const service = Object.fromEntries([
	'getInventory', 'getInventoryById', 'adjustStock', 'updateThreshold', 'getAdjustmentHistory',
	'createProduct', 'updateProduct', 'deleteProduct', 'getSuppliers',
].map((method) => [method, async (...args) => {
	calls.push([method, ...args]);
	if (args[0] === 404) throw new InventoryError(404, 'Product not found');
	if (args[0] === 500) throw new Error('Sensitive database detail');
	return { ok: true };
}]));
let server;
let base;
before(async () => {
	// Exercise the real app registration and dependency injection, without database access.
	const app = createApp({
		adminInventoryService: service,
		adminRepository: { findById: async (id) => stored.get(id) ?? null },
		tokenService: tokens, startReservationExpirationJob: false,
	});
	server = app.listen(0, '127.0.0.1');
	await once(server, 'listening');
	base = `http://127.0.0.1:${server.address().port}/api/admin/inventory`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function request(path = '', { id, token, body, method = 'GET' } = {}) {
	const bearer = token ?? (id ? await tokens.signAccessToken({ adminId: id, role: 'InventoryManager' }) : undefined);
	return fetch(`${base}${path}`, {
		method,
		headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const productInput = {
	name: 'Tea', description: 'Tea leaves', category: 'Drinks', price: 2.5, imageURL: 'https://example.com/tea.png',
	sku: 'TEA-1', stockQuantity: 10, lowStockThreshold: 5, supplierId: 2,
};
const { sku: _sku, supplierId: _supplier, ...editable } = productInput;
const endpoints = [
	['', 'GET', undefined, 'view'], ['/1', 'GET', undefined, 'view'], ['/1/history', 'GET', undefined, 'view'],
	['/1/stock', 'PATCH', { adjustment: 1, reason: 'Count' }, 'update'],
	['/1/threshold', 'PATCH', { lowStockThreshold: 10 }, 'update'],
	['', 'POST', productInput, 'create'],
	['/suppliers', 'GET', undefined, 'create'],
	['/1', 'PUT', { ...editable, reason: 'Stock count' }, 'update'],
	['/1', 'DELETE', undefined, 'delete'],
];

test('all endpoints reuse KAN-97 permissions against the current stored role', async () => {
	for (const [path, method, body, action] of endpoints) {
		const before = calls.length;
		assert.equal((await request(path, { method, body })).status, 401);
		assert.equal((await request(path, { method, body, token: 'invalid' })).status, 401);
		assert.equal((await request(path, { method, body, id: 99 })).status, 401);
		const customer = await tokens.signAccess({ kind: 'customer', userId: 1, email: 'test@example.com' });
		assert.equal((await request(path, { method, body, token: customer })).status, 403);
		assert.equal(calls.length, before, 'Unauthorised requests must not access inventory');
		for (const [id, admin] of stored) {
			const before = calls.length;
			const allowed = hasPermission(admin.role, 'inventory', action);
			assert.equal((await request(path, { method, body, id })).status, allowed ? (method === 'POST' ? 201 : 200) : 403, `${admin.role} ${method} ${path}`);
			assert.equal(calls.length, before + Number(allowed));
		}
	}
});

test('stored role changes override JWT role claims', async () => {
	const token = await tokens.signAccessToken({ adminId: 1, role: 'InventoryManager' });
	stored.set(1, { adminId: 1, role: 'CustomerService' });
	try {
		assert.equal((await request('/1/threshold', { token, method: 'PATCH', body: { lowStockThreshold: 5 } })).status, 403);
		assert.equal((await request('/1/stock', { token, method: 'PATCH', body: { adjustment: 2, reason: 'Count' } })).status, 403);
		assert.equal((await request('/1/history', { token })).status, 200);
	} finally {
		stored.set(1, { adminId: 1, role: 'InventoryManager' });
	}
});

test('routes validate before invoking services and return JSON errors', async () => {
	for (const [path, method, body] of [
		['?limit=101', 'GET'], ['?page=0', 'GET'], ['?status=INVALID', 'GET'],
		['/abc', 'GET'], ['/2147483648', 'GET'], ['/1/history?page=no', 'GET'],
		['/1/stock', 'PATCH', { adjustment: 1.5, reason: 'Count' }],
		['/1/stock', 'PATCH', { adjustment: 1, reason: 'x' }],
		['/1/stock', 'PATCH', { adjustment: 1, reason: 'Count', userId: 99 }],
		['/1/threshold', 'PATCH', { lowStockThreshold: -1 }],
		['', 'POST', { ...productInput, sku: '' }],
		['', 'POST', { ...productInput, supplierId: 0 }],
		['', 'POST', { ...productInput, price: '2.001' }],
		['', 'POST', { ...productInput, stockQuantity: -1 }],
		['/1', 'PUT', { ...editable, reason: 'x' }],
		['/1', 'PUT', { ...editable, reason: 'Count', sku: 'immutable' }],
		['?sort=notAColumn', 'GET'],
	]) {
		const before = calls.length;
		const response = await request(path, { id: 1, method, body });
		assert.equal(response.status, 400, path);
		assert.equal((await response.json()).error, 'Invalid inventory request');
		assert.equal(calls.length, before);
	}
	for (const [path, method, body] of [
		['/404', 'GET'], ['/404/history', 'GET'],
		['/404/stock', 'PATCH', { adjustment: 1, reason: 'Count' }],
		['/404/threshold', 'PATCH', { lowStockThreshold: 5 }],
	]) assert.equal((await request(path, { id: 1, method, body })).status, 404);
	const failure = await request('/500', { id: 1 });
	assert.equal(failure.status, 500);
	assert.deepEqual(await failure.json(), { error: 'Internal server error' });
	const malformed = await fetch(`${base}/1/stock`, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${await tokens.signAccessToken({ adminId: 1, role: 'InventoryManager' })}`, 'Content-Type': 'application/json' },
		body: '{',
	});
	assert.equal(malformed.status, 400);
});

test('inventory read routes support HEAD and stock adjustment validation follows the matched route', async () => {
	for (const path of ['', '/1', '/1/history']) {
		const before = calls.length;
		const response = await request(path, { id: 1, method: 'HEAD' });
		assert.equal(response.status, 200, path);
		assert.equal(await response.text(), '');
		assert.equal(calls.length, before + 1);
	}
	for (const path of ['/1/stock/', '/1/STOCK']) {
		const before = calls.length;
		const response = await request(path, { id: 1, method: 'PATCH', body: { adjustment: 1, reason: 'Count' } });
		assert.equal(response.status, 200, path);
		assert.equal(calls.length, before + 1);
		assert.equal(calls.at(-1)[0], 'adjustStock');
	}
});

test('router forwards unexpected authentication failures to its error handler', async () => {
	const app = express();
	app.use(createInventoryRouter(service, {}, {
		verifyCustomerAccessToken: async () => { throw new Error('JWT provider unavailable'); },
	}));
	const local = app.listen(0, '127.0.0.1');
	await once(local, 'listening');
	try {
		const response = await fetch(`http://127.0.0.1:${local.address().port}`, { headers: { Authorization: 'Bearer test' } });
		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { error: 'Internal server error' });
	} finally {
		await new Promise((resolve) => local.close(resolve));
	}
});
