import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import './helpers/authEnvironment.mjs';
import { createApp } from '../src/app.ts';
import { requirePermission } from '../src/middleware/requireAdmin.ts';
import { ADMIN_RESOURCE_ACTIONS, ADMIN_ROLES, hasPermission } from '../src/models/adminRoles.ts';
import { TokenService } from '../src/services/tokenService.ts';
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs';

const customerSecret = 'customer-access-secret-at-least-32-bytes';
process.env.JWT_SECRET = customerSecret;
const tokens = new TokenService(
	'admin-access-secret-at-least-32-bytes',
	'refresh-secret-at-least-32-bytes-long',
	customerSecret,
);

// ---- Permission matrix -------------------------------------------------------

const ALL_PERMISSIONS = Object.entries(ADMIN_RESOURCE_ACTIONS).flatMap(([resource, actions]) =>
	actions.map((action) => [resource, action]),
);

// Expected grants per role, exactly as specified in KAN-97. Anything not listed must be denied.
const EXPECTED = {
	Admin: ['users:view', 'users:suspend', 'users:reactivate', 'baskets:view', 'orders:view', 'orders:update', 'inventory:view', 'finance:view'],
	CustomerService: ['users:view', 'baskets:view', 'orders:view', 'inventory:view'],
	InventoryManager: ['inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete', 'orders:view'],
	WarehouseStaff: ['inventory:view', 'inventory:update'],
	FinanceManager: ['finance:view', 'finance:update', 'orders:view', 'inventory:view'],
};

test('SuperAdmin bypasses every permission check', () => {
	for (const [resource, action] of ALL_PERMISSIONS) {
		assert.equal(hasPermission('SuperAdmin', resource, action), true, `${resource}:${action}`);
	}
});

for (const [role, granted] of Object.entries(EXPECTED)) {
	test(`${role} holds exactly the permissions in the matrix`, () => {
		for (const [resource, action] of ALL_PERMISSIONS) {
			const key = `${resource}:${action}`;
			assert.equal(hasPermission(role, resource, action), granted.includes(key), `${role} ${key}`);
		}
	});
}

test('no role other than SuperAdmin can manage admin accounts or permissions', () => {
	for (const role of ADMIN_ROLES.filter((r) => r !== 'SuperAdmin')) {
		for (const resource of ['admins', 'permissions']) {
			for (const action of ADMIN_RESOURCE_ACTIONS[resource]) {
				assert.equal(hasPermission(role, resource, action), false, `${role} ${resource}:${action}`);
			}
		}
	}
});

test('unknown roles, resources and actions are denied', () => {
	assert.equal(hasPermission('Intern', 'users', 'view'), false);
	assert.equal(hasPermission('', 'users', 'view'), false);
	assert.equal(hasPermission('Admin', 'users', 'delete'), false);
	assert.equal(hasPermission('Admin', 'unknown', 'view'), false);
	assert.equal(hasPermission('Admin', 'users', 'launch'), false);
});

// ---- requirePermission middleware -------------------------------------------

const runMiddleware = (handler, currentAdmin) => {
	const result = { status: 200, body: undefined, nextCalled: false };
	const res = {
		locals: currentAdmin ? { currentAdmin } : {},
		status(code) {
			result.status = code;
			return this;
		},
		json(body) {
			result.body = body;
			return this;
		},
	};
	handler({}, res, () => {
		result.nextCalled = true;
	});
	return result;
};

test('requirePermission calls next when the role is granted the permission', () => {
	const result = runMiddleware(requirePermission('users', 'view'), { role: 'CustomerService' });
	assert.equal(result.nextCalled, true);
});

test('requirePermission returns 403 Forbidden when the role lacks the permission', () => {
	const result = runMiddleware(requirePermission('users', 'suspend'), { role: 'CustomerService' });
	assert.equal(result.nextCalled, false);
	assert.equal(result.status, 403);
	assert.deepEqual(result.body, { error: 'Forbidden' });
});

test('requirePermission lets SuperAdmin through for any permission', () => {
	for (const [resource, action] of ALL_PERMISSIONS) {
		assert.equal(runMiddleware(requirePermission(resource, action), { role: 'SuperAdmin' }).nextCalled, true);
	}
});

test('requirePermission returns 401 when no current admin has been loaded', () => {
	const result = runMiddleware(requirePermission('users', 'view'));
	assert.equal(result.nextCalled, false);
	assert.equal(result.status, 401);
});

test('requirePermission denies admins whose stored role is not recognised', () => {
	const result = runMiddleware(requirePermission('baskets', 'view'), { role: 'Intern' });
	assert.equal(result.status, 403);
});

// ---- Route protection --------------------------------------------------------

const ROLE_IDS = { SuperAdmin: 1, Admin: 2, InventoryManager: 3, FinanceManager: 4, CustomerService: 5 };
const admins = new Map();
const adminCalls = { orders: 0, inventory: 0 };
let orderStatus = 'PENDING';
const orderRecord = () => ({
	orderId: 42,
	orderPlacedAt: new Date('2026-04-02T10:00:00Z'),
	orderStatus,
	cost: '12.50',
	modifiedAt: new Date('2026-04-02T10:00:00Z'),
	user: {
		userId: 1,
		forename: 'Ada',
		surname: 'Lovelace',
		email: 'ada@example.com',
		addressLine1: '1 Analytical Engine Way',
		addressLine2: '',
		city: 'London',
		postcode: 'N1 1AA',
	},
	orderItems: [{ productId: 1, quantity: 1, product: { name: 'Green tea', price: '3.50' } }],
});
const adminRepository = {
	async findByEmail() {
		return null;
	},
	async findById(adminId) {
		return admins.get(adminId) ?? null;
	},
	async getOrderMetrics() {
		adminCalls.orders++;
		return {
			totalOrders: 3,
			pendingOrders: 1,
			revenue: 367.49,
			recentOrders: [{ orderId: 12, customer: 'Grace Hopper', placedAt: new Date('2026-04-02T10:00:00Z'), status: 'PENDING' }],
		};
	},
	async getInventoryMetrics() {
		adminCalls.inventory++;
		return {
			unitsInStock: 120,
			lowStockLines: 2,
			recentStockChanges: [{ product: 'Green tea', quantity: 40, modifiedAt: new Date('2026-10-01T09:00:00Z') }],
		};
	},
	async listOrders() {
		const { orderId, orderPlacedAt, orderStatus, cost, user } = orderRecord();
		return { orders: [{ orderId, orderPlacedAt, orderStatus, cost, user }], total: 1 };
	},
	async findOrderById(orderId) {
		return orderId === 42 ? orderRecord() : null;
	},
	async updateOrderStatus(orderId, from, to) {
		if (orderId !== 42 || orderStatus !== from) return false;
		orderStatus = to;
		return true;
	},
};

const users = new Map();
let userListCalls = 0;
const userRepository = {
	async findByEmail() {
		return null;
	},
	async findById(userId) {
		return users.get(userId) ?? null;
	},
	async create() {
		throw new Error('not used');
	},
	async list({ skip, take }) {
		userListCalls++;
		const all = [...users.values()];
		return { users: all.slice(skip, skip + take), total: all.length };
	},
	async findRecentOrders() {
		return [];
	},
	async updateStatus(userId, status) {
		const user = users.get(userId);
		if (!user) return null;
		user.status = status;
		return { userId, status };
	},
};

const products = new Map([[1, { productId: 1, name: 'Green tea', price: 3.5, imageURL: '/tea.png' }]]);
const productRepository = {
	async findAll() {
		return [...products.values()];
	},
	async findById(id) {
		return products.get(id) ?? null;
	},
	async findByIds(ids) {
		return ids.map((id) => products.get(id)).filter(Boolean);
	},
};

const basket = {
	basketId: 123,
	userId: 1,
	createdAt: new Date('2026-10-20T09:00:00Z'),
	updatedAt: new Date('2026-10-25T12:00:00Z'),
	customer: { forename: 'Ada', surname: 'Lovelace', email: 'ada@example.com' },
};
const basketRepository = {
	async getItems() {
		return new Map([[1, 2]]);
	},
	async addQuantity() {
		throw new Error('not used');
	},
	async list() {
		return { baskets: [{ ...basket, items: new Map([[1, 2]]) }], total: 1 };
	},
	async findByBasketId(id) {
		return id === basket.basketId ? { ...basket, items: new Map([[1, 2]]) } : null;
	},
};

let server;
let url;
const roleTokens = {};
before(async () => {
	for (const [role, adminId] of Object.entries(ROLE_IDS)) {
		roleTokens[role] = await tokens.signAccessToken({ adminId, role });
	}
	server = createApp({
		adminRepository,
		userRepository,
		productRepository,
		basketRepository,
		tokenService: tokens,
		refreshSessionRepository: memoryRefreshSessions(),
		authRateLimitOptions: { limit: 1000 },
	}).listen(0, '127.0.0.1');
	await once(server, 'listening');
	url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
	admins.clear();
	for (const [role, adminId] of Object.entries(ROLE_IDS)) {
		admins.set(adminId, { adminId, forename: 'Test', surname: role, email: `${role.toLowerCase()}@example.com`, role });
	}
	users.clear();
	users.set(1, {
		userId: 1,
		forename: 'Ada',
		surname: 'Lovelace',
		email: 'ada@example.com',
		createdAt: new Date('2026-01-01T00:00:00Z'),
		status: 'ACTIVE',
	});
	adminCalls.orders = 0;
	adminCalls.inventory = 0;
	userListCalls = 0;
	orderStatus = 'PENDING';
});

const call = (method, path, token) =>
	fetch(`${url}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });

const callWithBody = (method, path, token, body) => {
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = ['Bearer', token].join(' ');
	return fetch(`${url}${path}`, { method, headers, body: JSON.stringify(body) });
};

const ROUTES = [
	['GET', '/admin/users', 'users:view'],
	['GET', '/admin/users/1', 'users:view'],
	['POST', '/admin/users/1/suspend', 'users:suspend'],
	['POST', '/admin/users/1/reactivate', 'users:reactivate'],
	['GET', '/admin/baskets', 'baskets:view'],
	['GET', '/admin/baskets/123', 'baskets:view'],
	['GET', '/admin/orders', 'orders:view'],
	['GET', '/admin/orders/42', 'orders:view'],
	['POST', '/admin/orders/42/status', 'orders:update', { status: 'PROCESSING' }],
];

for (const role of Object.keys(ROLE_IDS)) {
	test(`${role} can only reach the admin endpoints its permissions allow`, async () => {
		for (const [method, path, permission, body] of ROUTES) {
			const allowed = role === 'SuperAdmin' || EXPECTED[role].includes(permission);
			const response = body
				? await callWithBody(method, path, roleTokens[role], body)
				: await call(method, path, roleTokens[role]);
			assert.equal(response.status, allowed ? 200 : 403, `${role} ${method} ${path}`);
			if (!allowed) assert.deepEqual(await response.json(), { error: 'Forbidden' });
		}
		assert.equal(orderStatus, role === 'SuperAdmin' || EXPECTED[role].includes('orders:update') ? 'PROCESSING' : 'PENDING');
	});
}

test('protected admin endpoints still require authentication (401 before 403)', async () => {
	for (const [method, path, , body] of ROUTES) {
		const response = body
			? await callWithBody(method, path, undefined, body)
			: await call(method, path);
		assert.equal(response.status, 401, `${method} ${path}`);
	}
});

test('CustomerService cannot suspend or reactivate users and the user is unchanged', async () => {
	assert.equal((await call('POST', '/admin/users/1/suspend', roleTokens.CustomerService)).status, 403);
	assert.equal(users.get(1).status, 'ACTIVE');
	users.get(1).status = 'SUSPENDED';
	assert.equal((await call('POST', '/admin/users/1/reactivate', roleTokens.CustomerService)).status, 403);
	assert.equal(users.get(1).status, 'SUSPENDED');
});

test('permissions follow the stored role, not the role in the token', async () => {
	admins.get(ROLE_IDS.SuperAdmin).role = 'InventoryManager';
	assert.equal((await call('GET', '/admin/users', roleTokens.SuperAdmin)).status, 403);
	admins.get(ROLE_IDS.InventoryManager).role = 'Admin';
	assert.equal((await call('GET', '/admin/users', roleTokens.InventoryManager)).status, 200);
});

test('admins with an unrecognised stored role are rejected', async () => {
	admins.get(ROLE_IDS.Admin).role = 'Intern';
	assert.equal((await call('GET', '/admin/baskets', roleTokens.Admin)).status, 401);
});

// ---- Role-scoped dashboard --------------------------------------------------

const dashboardFor = async (role) => {
	const response = await call('GET', '/admin', roleTokens[role]);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	return response.json();
};
const labels = (items) => items.map((item) => item.label);

test('GET /admin requires authentication', async () => {
	assert.equal((await call('GET', '/admin')).status, 401);
});

test('GET /admin keeps the dashboard response structure for every role', async () => {
	for (const role of Object.keys(ROLE_IDS)) {
		const body = await dashboardFor(role);
		assert.deepEqual(body.staff, { name: `Test ${role}` });
		assert.equal(body.role, role);
		for (const key of ['sections', 'quickActions', 'cards', 'recentOrders', 'newUsers', 'stockChanges']) {
			assert.ok(Array.isArray(body[key]), `${role} ${key}`);
		}
	}
});

test('SuperAdmin dashboard has full operational visibility', async () => {
	const body = await dashboardFor('SuperAdmin');
	assert.deepEqual(labels(body.sections), ['Users', 'Baskets', 'Orders', 'Inventory', 'Finance', 'Admin accounts', 'Permissions']);
	assert.deepEqual(labels(body.cards), ['Customers', 'Customer baskets', 'Orders', 'Pending orders', 'Revenue', 'Units in stock', 'Low stock lines']);
	assert.ok(labels(body.quickActions).includes('Manage admin accounts'));
	assert.equal(body.recentOrders.length, 1);
	assert.equal(body.newUsers.length, 1);
	assert.equal(body.stockChanges.length, 1);
});

test('Admin dashboard shows customer and operations metrics without admin management', async () => {
	const body = await dashboardFor('Admin');
	assert.deepEqual(labels(body.sections), ['Users', 'Baskets', 'Orders', 'Inventory', 'Finance']);
	assert.deepEqual(labels(body.quickActions), ['Suspend or reactivate customers', 'Update order status']);
	assert.ok(labels(body.cards).includes('Customers'));
	assert.ok(labels(body.cards).includes('Revenue'));
});

test('CustomerService dashboard shows customer activity and baskets but no finance', async () => {
	const body = await dashboardFor('CustomerService');
	assert.deepEqual(labels(body.sections), ['Users', 'Baskets', 'Orders', 'Inventory']);
	assert.deepEqual(body.quickActions, []);
	assert.ok(labels(body.cards).includes('Customer baskets'));
	assert.ok(!labels(body.cards).includes('Revenue'));
	assert.equal(body.newUsers.length, 1);
});

test('InventoryManager dashboard shows stock metrics and no customer data', async () => {
	const body = await dashboardFor('InventoryManager');
	assert.deepEqual(labels(body.sections), ['Orders', 'Inventory']);
	assert.deepEqual(labels(body.quickActions), ['Add product']);
	assert.deepEqual(labels(body.cards), ['Orders', 'Pending orders', 'Units in stock', 'Low stock lines']);
	assert.deepEqual(body.newUsers, []);
	assert.equal(body.stockChanges.length, 1);
	assert.equal(userListCalls, 0, 'customer data must not be loaded');
});

test('FinanceManager dashboard shows revenue metrics and no customer or basket data', async () => {
	const body = await dashboardFor('FinanceManager');
	assert.deepEqual(labels(body.sections), ['Orders', 'Inventory', 'Finance']);
	assert.deepEqual(labels(body.quickActions), ['Update finance records']);
	assert.ok(labels(body.cards).includes('Revenue'));
	assert.equal(body.cards.find((card) => card.label === 'Revenue').value, '£367.49');
	assert.ok(!labels(body.cards).includes('Customers'));
	assert.ok(!labels(body.cards).includes('Customer baskets'));
	assert.deepEqual(body.newUsers, []);
	assert.equal(userListCalls, 0, 'customer data must not be loaded');
});

test('GET /admin returns 500 when dashboard data cannot be loaded', async () => {
	const original = adminRepository.getOrderMetrics;
	adminRepository.getOrderMetrics = async () => {
		throw new Error('db down');
	};
	try {
		assert.equal((await call('GET', '/admin', roleTokens.FinanceManager)).status, 500);
	} finally {
		adminRepository.getOrderMetrics = original;
	}
});
