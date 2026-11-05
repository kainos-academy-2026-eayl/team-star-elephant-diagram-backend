import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import argon2 from 'argon2';
import { createApp } from '../src/app.ts';
import { ARGON2_OPTIONS } from '../src/services/userService.ts';
import { TokenService } from '../src/services/tokenService.ts';
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs';

const customerSecret = 'customer-access-secret-at-least-32-bytes';
process.env.JWT_SECRET = customerSecret;
const tokens = new TokenService(
	'admin-access-secret-at-least-32-bytes',
	'refresh-secret-at-least-32-bytes-long',
	customerSecret,
);

const users = new Map();
const orders = [];
const refreshSessions = memoryRefreshSessions();
const matches = (user, search) =>
	(search ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) =>
			[user.forename, user.surname, user.email].some((field) =>
				field.toLowerCase().includes(term.toLowerCase()),
			),
		);
const userRepository = {
	async findByEmail(email) {
		return [...users.values()].find((user) => user.email === email) ?? null;
	},
	async findById(userId) {
		return users.get(userId) ?? null;
	},
	async create(user) {
		const row = { ...user, userId: users.size + 1, status: 'ACTIVE' };
		users.set(row.userId, row);
		return row;
	},
	async list({ search, skip, take }) {
		const found = [...users.values()]
			.filter((user) => matches(user, search))
			.sort((a, b) => b.createdAt - a.createdAt || b.userId - a.userId);
		return { users: found.slice(skip, skip + take), total: found.length };
	},
	async findRecentOrders(userId, take) {
		return orders
			.filter((order) => order.userId === userId)
			.sort((a, b) => b.orderPlacedAt - a.orderPlacedAt)
			.slice(0, take);
	},
	async updateStatus(userId, status) {
		const user = users.get(userId);
		if (!user) return null;
		user.status = status;
		return { userId, status };
	},
	async delete(userId) {
		if (!users.delete(userId)) return false;
		for (let index = orders.length - 1; index >= 0; index--) {
			if (orders[index].userId === userId) orders.splice(index, 1);
		}
		for (const [id, basket] of baskets) {
			if (basket.userId === userId) baskets.delete(id);
		}
		for (const [id, session] of refreshSessions.rows) {
			if (session.principalId === userId && session.principalKind === 'customer') refreshSessions.rows.delete(id);
		}
		return true;
	},
};
const admins = new Map();
const adminOrders = new Map();
const makeAdminOrder = (orderId, userId, orderStatus, orderPlacedAt = new Date('2026-04-01T10:00:00Z')) => {
	const user = users.get(userId);
	return {
		orderId,
		orderPlacedAt,
		orderStatus,
		cost: '12.50',
		modifiedAt: new Date('2026-04-02T10:00:00Z'),
		user: {
			userId,
			forename: user.forename,
			surname: user.surname,
			email: user.email,
			addressLine1: '1 Analytical Engine Way',
			addressLine2: '',
			city: 'London',
			postcode: 'N1 1AA',
		},
		orderItems: [{ productId: 1, quantity: 2, product: { name: 'Green tea', price: '3.50' } }],
	};
};
const adminRepository = {
	async findByEmail() {
		return null;
	},
	async findById(adminId) {
		return admins.get(adminId) ?? null;
	},
	async listOrders({ search, status, skip, take }) {
		const terms = (search ?? '').trim().split(/\s+/).filter(Boolean);
		const matching = [...adminOrders.values()]
			.filter((order) => (!status || order.orderStatus === status) && terms.every((term) => {
				const id = term.replace(/^#/, '');
				return (
					(/^\d+$/.test(id) && Number(id) === order.orderId) ||
					[order.user.forename, order.user.surname, order.user.email].some((field) =>
						field.toLowerCase().includes(term.toLowerCase()),
					)
				);
			}))
			.sort((a, b) => b.orderPlacedAt - a.orderPlacedAt || b.orderId - a.orderId);
		return { orders: matching.slice(skip, skip + take), total: matching.length };
	},
	async findOrderById(orderId) {
		return adminOrders.get(orderId) ?? null;
	},
	async updateOrderStatus(orderId, from, to) {
		const order = adminOrders.get(orderId);
		if (!order || order.orderStatus !== from) return false;
		order.orderStatus = to;
		order.modifiedAt = new Date('2026-04-03T10:00:00Z');
		return true;
	},
};

const products = new Map([
	[1, { productId: 1, name: 'Green tea', price: 3.5, imageURL: '/tea.png' }],
	[2, { productId: 2, name: 'Coffee beans', price: 39, imageURL: '/coffee.png' }],
]);
const productCreateCalls = [];
const productRepository = {
	async findAll() {
		return [...products.values()];
	},
	async findById(productId) {
		return products.get(productId) ?? null;
	},
	async findByIds(productIds) {
		return productIds.map((id) => products.get(id)).filter(Boolean);
	},
	async create(input) {
		productCreateCalls.push(input);
		const product = {
			...input,
			productId: products.size + 1,
			createdAt: new Date(),
			modifiedAt: new Date(),
		};
		products.set(product.productId, product);
		return product;
	},
};

// basketId -> { basketId, userId, createdAt, updatedAt, items: Map<productId, quantity> }
const baskets = new Map();
const toBasketRecord = (basket) => {
	const { forename, surname, email } = users.get(basket.userId);
	return { ...basket, customer: { forename, surname, email }, items: new Map(basket.items) };
};
const basketMatches = (basket, search) =>
	(search ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => {
			const user = users.get(basket.userId);
			return (
				(/^\d+$/.test(term) && Number(term) === basket.basketId) ||
				[user.forename, user.surname, user.email].some((field) => field.toLowerCase().includes(term.toLowerCase()))
			);
		});
const basketRepository = {
	async getItems(userId) {
		const basket = [...baskets.values()].find((b) => b.userId === Number(userId));
		return new Map(basket?.items ?? []);
	},
	async addQuantity() {
		throw new Error('not used by admin tests');
	},
	async list(search, skip, take) {
		const matching = [...baskets.values()]
			.filter((basket) => basketMatches(basket, search))
			.sort((a, b) => b.updatedAt - a.updatedAt || b.basketId - a.basketId);
		return { baskets: matching.slice(skip, skip + take).map(toBasketRecord), total: matching.length };
	},
	async findByBasketId(basketId) {
		const basket = baskets.get(basketId);
		return basket ? toBasketRecord(basket) : null;
	},
};

let server;
let url;
let adminToken;
let passwordHash;
let productRequestIp = 0;
let adminRequestIp = 0;
let testRequestIp = 0;
before(async () => {
	passwordHash = await argon2.hash('correct-horse', ARGON2_OPTIONS);
	adminToken = await tokens.signAccessToken({ adminId: 1, role: 'SuperAdmin' });
	server = createApp({
		userRepository,
		adminRepository,
		productRepository,
		basketRepository,
		tokenService: tokens,
		refreshSessionRepository: refreshSessions,
		authRateLimitOptions: { limit: 1000 },
		trustedProxyAddresses: ['127.0.0.1'],
	}).listen(0, '127.0.0.1');
	await once(server, 'listening');
	url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const customer = (userId, forename, surname, email, overrides = {}) => ({
	userId,
	forename,
	surname,
	email,
	passwordHash,
	createdAt: new Date(Date.UTC(2026, 0, userId)),
	modifiedAt: new Date(Date.UTC(2026, 0, userId)),
	addressLine1: '',
	addressLine2: '',
	city: '',
	postcode: '',
	status: 'ACTIVE',
	...overrides,
});

beforeEach(() => {
	testRequestIp++;
	for (const productId of products.keys()) {
		if (productId > 2) products.delete(productId);
	}
	productCreateCalls.length = 0;
	users.clear();
	refreshSessions.rows.clear();
	admins.clear();
	admins.set(1, { adminId: 1, forename: 'Test', surname: 'Admin', email: 'admin@example.com', role: 'SuperAdmin' });
	orders.length = 0;
	users.set(1, customer(1, 'Ada', 'Lovelace', 'ada@example.com'));
	users.set(2, customer(2, 'Grace', 'Hopper', 'grace@example.com'));
	users.set(3, customer(3, 'Alan', 'Turing', 'alan.t@example.org', { status: 'SUSPENDED' }));
	adminOrders.clear();
	adminOrders.set(10, makeAdminOrder(10, 1, 'PENDING'));
	adminOrders.set(11, makeAdminOrder(11, 2, 'PROCESSING', new Date('2026-04-02T10:00:00Z')));
	adminOrders.set(12, makeAdminOrder(12, 3, 'SHIPPED', new Date('2026-04-03T10:00:00Z')));
	orders.push(
		{ userId: 1, orderId: 10, orderPlacedAt: new Date('2026-03-01T10:00:00Z'), orderStatus: 'DELIVERED', cost: '349.99' },
		{ userId: 1, orderId: 11, orderPlacedAt: new Date('2026-04-01T10:00:00Z'), orderStatus: 'PENDING', cost: '12.50' },
		{ userId: 2, orderId: 12, orderPlacedAt: new Date('2026-04-02T10:00:00Z'), orderStatus: 'SHIPPED', cost: '5.00' },
	);
	baskets.clear();
	baskets.set(123, {
		basketId: 123,
		userId: 2,
		createdAt: new Date('2026-10-20T09:00:00Z'),
		updatedAt: new Date('2026-10-25T12:00:00Z'),
		items: new Map([[1, 2], [2, 2]]),
	});
	baskets.set(456, {
		basketId: 456,
		userId: 3,
		createdAt: new Date('2026-10-21T09:00:00Z'),
		updatedAt: new Date('2026-10-26T12:00:00Z'),
		items: new Map([[1, 1]]),
	});
});

const _request = (method, path, token = adminToken) =>
	fetch(`${url}${path}`, {
		method,
		headers: {
			'x-forwarded-for': `198.51.100.${testRequestIp}`,
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	});
const requestWithUniqueIp = (method, path, token = adminToken, body) => {
	const requestIp = ++adminRequestIp;
	return fetch(`${url}${path}`, {
		method,
		headers: {
			...(token ? { authorization: ['Bearer', token].join(' ') } : {}),
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			'x-forwarded-for': `198.51.${Math.floor(requestIp / 256)}.${requestIp % 256}`,
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
};
const get = (path, token) => requestWithUniqueIp('GET', path, token);
const post = (path, token) => requestWithUniqueIp('POST', path, token);
const postJson = (path, body, token = adminToken) => requestWithUniqueIp('POST', path, token, body);
const postProduct = (input, token = adminToken) =>
	fetch(`${url}/admin/products`, {
		method: 'POST',
		headers: {
			...(token ? { authorization: ['Bearer', token].join(' ') } : {}),
			'content-type': 'application/json',
			'x-forwarded-for': `192.0.2.${++productRequestIp}`,
		},
		body: JSON.stringify(input),
	});
const validProduct = {
	imageURL: 'https://example.com/product.jpg',
	name: 'Product name',
	description: 'Product description',
	category: 'Products',
	price: 12.34,
};
const customerLogin = (password = 'correct-horse') =>
	fetch(`${url}/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'ada@example.com', password }),
	});

test('GET /admin/users lists users newest first with the frontend contract fields', async () => {
	const response = await get('/admin/users');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	const body = await response.json();
	assert.deepEqual(body.users, [
		{ id: 3, name: 'Alan Turing', email: 'alan.t@example.org', registeredAt: '2026-01-03T00:00:00.000Z', status: 'suspended' },
		{ id: 2, name: 'Grace Hopper', email: 'grace@example.com', registeredAt: '2026-01-02T00:00:00.000Z', status: 'active' },
		{ id: 1, name: 'Ada Lovelace', email: 'ada@example.com', registeredAt: '2026-01-01T00:00:00.000Z', status: 'active' },
	]);
	assert.deepEqual(body.pagination, { page: 1, pageSize: 20, totalPages: 1, totalUsers: 3 });
	for (const user of body.users) assert.equal(user.passwordHash, undefined);
});

test('GET /admin/users paginates 20 users per page', async () => {
	for (let id = 4; id <= 25; id += 1)
		users.set(id, customer(id, 'User', `Number${id}`, `user${id}@example.com`));
	const first = await (await get('/admin/users')).json();
	assert.equal(first.users.length, 20);
	assert.deepEqual(first.pagination, { page: 1, pageSize: 20, totalPages: 2, totalUsers: 25 });
	const second = await (await get('/admin/users?page=2')).json();
	assert.equal(second.users.length, 5);
	assert.equal(second.pagination.page, 2);
	assert.deepEqual(second.users.at(-1).id, 1);
});

test('GET /admin/users searches by name and email, case-insensitively', async () => {
	const search = async (term) => {
		const response = await get(`/admin/users?search=${encodeURIComponent(term)}`);
		assert.equal(response.status, 200);
		return (await response.json()).users.map((user) => user.id);
	};
	assert.deepEqual(await search('grace'), [2]);
	assert.deepEqual(await search('LOVELACE'), [1]);
	assert.deepEqual(await search('ada lovelace'), [1]);
	assert.deepEqual(await search('example.org'), [3]);
	assert.deepEqual(await search('  '), [3, 2, 1]);
	assert.deepEqual(await search('nobody'), []);
	const body = await (await get('/admin/users?search=nobody')).json();
	assert.deepEqual(body.pagination, { page: 1, pageSize: 20, totalPages: 1, totalUsers: 0 });
});

test('GET /admin/users rejects invalid query parameters', async () => {
	for (const query of ['page=0', 'page=abc', 'page=1.5', `search=${'a'.repeat(101)}`, 'search=a&search=b']) {
		const response = await get(`/admin/users?${query}`);
		assert.equal(response.status, 400, query);
	}
});

test('GET /admin/users/:id returns customer details, recent orders and an empty basket', async () => {
	const response = await get('/admin/users/1');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), {
		user: { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', registeredAt: '2026-01-01T00:00:00.000Z', status: 'active' },
		recentOrders: [
			{ id: 11, placedAt: '2026-04-01T10:00:00.000Z', status: 'pending', total: 12.5 },
			{ id: 10, placedAt: '2026-03-01T10:00:00.000Z', status: 'delivered', total: 349.99 },
		],
		basket: { itemCount: 0, subtotal: 0, items: [] },
	});
});

test('GET /admin/users/:id limits recent orders to the latest 5', async () => {
	for (let id = 20; id < 30; id += 1)
		orders.push({ userId: 2, orderId: id, orderPlacedAt: new Date(Date.UTC(2026, 5, id)), orderStatus: 'PENDING', cost: '1.00' });
	const body = await (await get('/admin/users/2')).json();
	assert.deepEqual(body.recentOrders.map((order) => order.id), [29, 28, 27, 26, 25]);
});

test('admin user endpoints return 404 for unknown or malformed ids', async () => {
	for (const id of ['999', '0', '-1', 'abc', '1.5', '0x1', '1e1', '99999999999']) {
		for (const [method, path] of [
			['GET', `/admin/users/${id}`],
			['POST', `/admin/users/${id}/suspend`],
			['POST', `/admin/users/${id}/reactivate`],
			['POST', `/admin/users/${id}/delete`],
		]) {
			const response = await requestWithUniqueIp(method, path);
			assert.equal(response.status, 404, `${method} ${path}`);
			assert.deepEqual(await response.json(), { error: 'User not found' });
		}
	}
});

test('permanent deletion removes the customer and rejects login, refresh and existing access', async () => {
	const login = await customerLogin();
	const credentials = await login.json();
	const cookie = login.headers.getSetCookie()[0].split(';', 1)[0];
	const response = await post('/admin/users/1/delete');
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: true });
	assert.equal(users.has(1), false);
	assert.equal(orders.some((order) => order.userId === 1), false);
	assert.equal([...refreshSessions.rows.values()].some((session) => session.principalId === 1), false);
	assert.equal(users.has(2), true);
	assert.equal(orders.some((order) => order.userId === 2), true);
	assert.equal((await get('/admin/users/1')).status, 404);
	assert.equal((await post('/admin/users/1/delete')).status, 404);
	assert.equal((await customerLogin()).status, 401);
	assert.equal((await get('/profile', credentials.accessToken)).status, 401);
	const refresh = await fetch(`${url}/auth/refresh`, { method: 'POST', headers: { cookie } });
	assert.equal(refresh.status, 401);
});

test('permanent deletion returns an explicit error on repository failure', async () => {
	const original = userRepository.delete;
	userRepository.delete = async () => { throw new Error('db down'); };
	try {
		const response = await post('/admin/users/1/delete');
		assert.equal(response.status, 500);
		assert.match((await response.json()).error, /could not be deleted/);
		assert.equal(users.has(1), true);
	} finally {
		userRepository.delete = original;
	}
});

test('POST /admin/users/:id/suspend suspends the customer and is idempotent', async () => {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await post('/admin/users/1/suspend');
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { user: { id: 1, status: 'suspended' } });
	}
	assert.equal(users.get(1).status, 'SUSPENDED');
	const details = await (await get('/admin/users/1')).json();
	assert.equal(details.user.status, 'suspended');
});

test('POST /admin/users/:id/reactivate reactivates a suspended customer', async () => {
	const response = await post('/admin/users/3/reactivate');
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { user: { id: 3, status: 'active' } });
	assert.equal(users.get(3).status, 'ACTIVE');
});

test('suspended customers cannot log in and get the standard invalid credentials response', async () => {
	const wrongPassword = await customerLogin('wrong-password');
	assert.equal(wrongPassword.status, 401);
	const invalidCredentialsBody = await wrongPassword.json();

	assert.equal((await post('/admin/users/1/suspend')).status, 200);
	const suspended = await customerLogin();
	assert.equal(suspended.status, 401);
	assert.deepEqual(await suspended.json(), invalidCredentialsBody);
	assert.deepEqual(invalidCredentialsBody, { error: 'Invalid email or password' });
	assert.equal(suspended.headers.getSetCookie().length, 0);

	assert.equal((await post('/admin/users/1/reactivate')).status, 200);
	const reactivated = await customerLogin();
	assert.equal(reactivated.status, 200);
	assert.ok((await reactivated.json()).accessToken);
});

test('suspending a logged-in customer rejects refresh and profile access', async () => {
	const loginResponse = await customerLogin();
	assert.equal(loginResponse.status, 200);
	const credentials = await loginResponse.json();
	const refreshCookie = loginResponse.headers.getSetCookie()[0].split(';', 1)[0];

	assert.equal((await post('/admin/users/1/suspend')).status, 200);
	const refresh = await fetch(`${url}/auth/refresh`, {
		method: 'POST',
		headers: { cookie: refreshCookie },
	});
	assert.equal(refresh.status, 401);
	assert.equal(refresh.headers.getSetCookie()[0].startsWith('refreshToken=;'), true);

	const profile = await get('/profile', credentials.accessToken);
	assert.equal(profile.status, 401);
});

test('admin user endpoints require an admin access token', async () => {
	const customerToken = await tokens.signAccess({ kind: 'customer', userId: 1, email: 'ada@example.com' });
	for (const token of [undefined, 'not-a-jwt', customerToken]) {
		for (const [method, path] of [
			['GET', '/admin/users'],
			['GET', '/admin/users/1'],
			['POST', '/admin/users/1/suspend'],
			['POST', '/admin/users/3/reactivate'],
			['POST', '/admin/users/1/delete'],
		]) {
			const response = await fetch(`${url}${path}`, {
				method,
				headers: token ? { authorization: `Bearer ${token}` } : {},
			});
			assert.equal(response.status, 401, `${method} ${path}`);
			assert.deepEqual(await response.json(), { error: 'Authentication required' });
		}
	}
	assert.equal(users.get(1).status, 'ACTIVE');
	assert.equal(users.get(3).status, 'SUSPENDED');
});

test('admin user endpoints require a live admin with a recognised role', async () => {
	const admin = admins.get(1);
	const paths = [
		['GET', '/admin/users'],
		['GET', '/admin/users/1'],
		['POST', '/admin/users/1/suspend'],
		['POST', '/admin/users/3/reactivate'],
	];
	try {
		admins.delete(1);
		for (const [method, path] of paths)
			assert.equal((await requestWithUniqueIp(method, path)).status, 401, `${method} ${path} for deleted admin`);

		admins.set(1, { ...admin, role: 'Intern' });
		for (const [method, path] of paths)
			assert.equal((await requestWithUniqueIp(method, path)).status, 401, `${method} ${path} for invalid role`);
	} finally {
		admins.set(1, admin);
	}
});

test('admin user endpoints return 500 without leaking details on repository failure', async () => {
	const original = userRepository.list;
	userRepository.list = async () => {
		throw new Error('database down');
	};
	const originalError = console.error;
	console.error = () => {};
	try {
		const response = await get('/admin/users');
		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { error: 'Internal server error' });
	} finally {
		userRepository.list = original;
		console.error = originalError;
	}
});

test('GET /admin/users/:id returns the customer\'s real basket', async () => {
	const body = await (await get('/admin/users/2')).json();
	assert.deepEqual(body.basket, {
		itemCount: 4,
		subtotal: 85,
		items: [
			{ productName: 'Green tea', quantity: 2 },
			{ productName: 'Coffee beans', quantity: 2 },
		],
	});
});

test('GET /admin/baskets lists baskets by most recent activity with the frontend contract fields', async () => {
	const response = await get('/admin/baskets');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), {
		baskets: [
			{
				basketId: 456,
				customerName: 'Alan Turing',
				customerEmail: 'alan.t@example.org',
				itemCount: 1,
				total: '£3.50',
				lastActivity: '2026-10-26',
				status: 'Active',
			},
			{
				basketId: 123,
				customerName: 'Grace Hopper',
				customerEmail: 'grace@example.com',
				itemCount: 4,
				total: '£85.00',
				lastActivity: '2026-10-25',
				status: 'Active',
			},
		],
		pagination: { page: 1, pageSize: 20, totalPages: 1, totalBaskets: 2 },
	});
});

test('GET /admin/baskets paginates results before returning basket records', async () => {
	for (let basketId = 1000; basketId < 1021; basketId += 1) {
		baskets.set(basketId, {
			basketId,
			userId: 1,
			createdAt: new Date('2026-10-20T09:00:00Z'),
			updatedAt: new Date(`2026-10-${String(27 + (basketId % 4)).padStart(2, '0')}T12:00:00Z`),
			items: new Map(),
		});
	}

	const first = await (await get('/admin/baskets')).json();
	assert.equal(first.baskets.length, 20);
	assert.deepEqual(first.pagination, { page: 1, pageSize: 20, totalPages: 2, totalBaskets: 23 });

	const second = await (await get('/admin/baskets?page=2')).json();
	assert.equal(second.baskets.length, 3);
	assert.deepEqual(second.pagination, { page: 2, pageSize: 20, totalPages: 2, totalBaskets: 23 });
	assert.equal((await get('/admin/baskets?page=0')).status, 400);
});

test('GET /admin/baskets searches by basket ID, customer name and email', async () => {
	const search = async (query) => {
		const response = await get(`/admin/baskets?${query}`);
		assert.equal(response.status, 200, query);
		return (await response.json()).baskets.map((basket) => basket.basketId);
	};
	assert.deepEqual(await search('search=123'), [123]);
	baskets.set(1_000_000_000, {
		basketId: 1_000_000_000,
		userId: 1,
		createdAt: new Date('2026-10-20T09:00:00Z'),
		updatedAt: new Date('2026-10-27T12:00:00Z'),
		items: new Map(),
	});
	assert.deepEqual(await search('search=1000000000'), [1_000_000_000]);
	baskets.delete(1_000_000_000);
	assert.deepEqual(await search('search=grace'), [123]);
	assert.deepEqual(await search('search=ALAN%20TURING'), [456]);
	assert.deepEqual(await search('search=example.org'), [456]);
	assert.deepEqual(await search('q=hopper'), [123]);
	assert.deepEqual(await search('search=%20%20'), [456, 123]);
	assert.deepEqual(await search('search=nobody'), []);
	assert.equal((await get(`/admin/baskets?search=${'a'.repeat(101)}`)).status, 400);
});

test('GET /admin/baskets/:id returns basket, customer and priced items', async () => {
	const response = await get('/admin/baskets/123');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), {
		basket: {
			basketId: 123,
			createdAt: '2026-10-20',
			lastActivity: '2026-10-25',
			status: 'Active',
			customer: { name: 'Grace Hopper', email: 'grace@example.com' },
			items: [
				{ productName: 'Green tea', quantity: 2, unitPrice: '£3.50', totalPrice: '£7.00' },
				{ productName: 'Coffee beans', quantity: 2, unitPrice: '£39.00', totalPrice: '£78.00' },
			],
			itemCount: 4,
			total: '£85.00',
		},
	});
});

test('GET /admin/baskets/:id returns 404 for unknown or malformed ids', async () => {
	for (const id of ['999', '0', '-1', 'abc', '1.5', '0x1', '1e1', '99999999999']) {
		const response = await get(`/admin/baskets/${id}`);
		assert.equal(response.status, 404, id);
		assert.deepEqual(await response.json(), { error: 'Basket not found' });
	}
});

test('GET /admin/orders lists orders newest first with pagination', async () => {
	for (let orderId = 100; orderId <= 120; orderId += 1) {
		adminOrders.set(
			orderId,
			makeAdminOrder(orderId, 1, 'PENDING', new Date(Date.UTC(2026, 5, orderId - 99))),
		);
	}

	const firstResponse = await get('/admin/orders');
	assert.equal(firstResponse.status, 200);
	assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
	const first = await firstResponse.json();
	assert.deepEqual(first.pagination, { page: 1, pageSize: 20, totalPages: 2, totalOrders: 24 });
	assert.deepEqual(first.orders.map((order) => order.orderId), Array.from({ length: 20 }, (_, index) => 120 - index));
	assert.deepEqual(first.orders[0], {
		orderId: 120,
		customer: { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
		status: 'PENDING',
		orderDate: '2026-06-21T00:00:00.000Z',
		totalCost: 12.5,
	});

	const second = await (await get('/admin/orders?page=2')).json();
	assert.deepEqual(second.pagination, { page: 2, pageSize: 20, totalPages: 2, totalOrders: 24 });
	assert.deepEqual(second.orders.map((order) => order.orderId), [100, 12, 11, 10]);
});

test('GET /admin/orders searches by order ID and customer details and filters by status', async () => {
	const search = async (query) => {
		const response = await get(`/admin/orders?${query}`);
		assert.equal(response.status, 200, query);
		return (await response.json()).orders.map((order) => order.orderId);
	};
	assert.deepEqual(await search('search=%2310'), [10]);
	assert.deepEqual(await search('q=hopper'), [11]);
	assert.deepEqual(await search('search=ALAN%20Turing'), [12]);
	assert.deepEqual(await search('search=example.org'), [12]);
	assert.deepEqual(await search('status=processing'), [11]);
	assert.deepEqual(await search('status='), [12, 11, 10]);
	assert.deepEqual(await search('search=nobody'), []);
});

test('GET /admin/orders rejects invalid query parameters', async () => {
	for (const query of [
		'page=0',
		'page=abc',
		'page=1.5',
		'status=unknown',
		`search=${'a'.repeat(101)}`,
		'search=a&search=b',
	]) {
		assert.equal((await get(`/admin/orders?${query}`)).status, 400, query);
	}
});

test('GET /admin/orders/:id returns order, customer, items and allowed transitions', async () => {
	const response = await get('/admin/orders/10');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), {
		order: {
			orderId: 10,
			status: 'PENDING',
			orderDate: '2026-04-01T10:00:00.000Z',
			lastUpdated: '2026-04-02T10:00:00.000Z',
			customer: {
				id: 1,
				name: 'Ada Lovelace',
				email: 'ada@example.com',
				address: { line1: '1 Analytical Engine Way', line2: '', city: 'London', postcode: 'N1 1AA' },
			},
			items: [{ productId: 1, productName: 'Green tea', quantity: 2, unitPrice: 3.5, itemTotal: 7 }],
			itemCount: 2,
			orderTotal: 12.5,
			allowedTransitions: ['PROCESSING', 'CANCELLED'],
		},
	});
});

test('GET /admin/orders/:id returns 404 for unknown or malformed IDs', async () => {
	for (const id of ['999', '0', '-1', 'abc', '1.5', '0x1', '1e1', '99999999999']) {
		const response = await get(`/admin/orders/${id}`);
		assert.equal(response.status, 404, id);
		assert.deepEqual(await response.json(), { error: 'Order not found' });
	}
});

test('POST /admin/orders/:id/status validates status input and missing orders', async () => {
	for (const id of ['999', '0', 'abc', '1.5', '99999999999']) {
		const response = await postJson(`/admin/orders/${id}/status`, { status: 'PROCESSING' });
		assert.equal(response.status, 404, id);
		assert.deepEqual(await response.json(), { error: 'Order not found' });
	}
	for (const body of [{}, { status: 'unknown' }, { status: 1 }, { status: ' ' }]) {
		assert.equal((await postJson('/admin/orders/10/status', body)).status, 400, JSON.stringify(body));
	}
	assert.equal((await postJson('/admin/orders/10/status', null)).status, 400);
});

test('POST /admin/orders/:id/status applies every allowed fulfilment transition', async () => {
	const transitions = [
		['PENDING', 'PROCESSING'],
		['PENDING', 'CANCELLED'],
		['PROCESSING', 'SHIPPED'],
		['PROCESSING', 'CANCELLED'],
		['SHIPPED', 'DELIVERED'],
	];
	for (const [from, to] of transitions) {
		adminOrders.set(10, makeAdminOrder(10, 1, from));
		const response = await postJson('/admin/orders/10/status', { status: to.toLowerCase() });
		assert.equal(response.status, 200, `${from} -> ${to}`);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		const body = await response.json();
		assert.equal(body.order.status, to);
		assert.equal(adminOrders.get(10).orderStatus, to);
	}
});

test('POST /admin/orders/:id/status rejects skipped, post-shipping cancellation, and terminal transitions', async () => {
	const invalidTransitions = [
		['PENDING', 'SHIPPED'],
		['PROCESSING', 'DELIVERED'],
		['SHIPPED', 'CANCELLED'],
		['DELIVERED', 'PROCESSING'],
		['CANCELLED', 'PROCESSING'],
	];
	for (const [from, to] of invalidTransitions) {
		adminOrders.set(10, makeAdminOrder(10, 1, from));
		const response = await postJson('/admin/orders/10/status', { status: to });
		assert.equal(response.status, 400, `${from} -> ${to}`);
		assert.deepEqual(await response.json(), {
			error: 'Invalid status transition',
			details: { from, to },
		});
		assert.equal(adminOrders.get(10).orderStatus, from);
	}
});

test('POST /admin/orders/:id/status rejects a transition after a concurrent status change', async () => {
	const originalUpdate = adminRepository.updateOrderStatus;
	adminRepository.updateOrderStatus = async (orderId) => {
		adminOrders.get(orderId).orderStatus = 'SHIPPED';
		return false;
	};
	try {
		const response = await postJson('/admin/orders/10/status', { status: 'PROCESSING' });
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), {
			error: 'Invalid status transition',
			details: { from: 'SHIPPED', to: 'PROCESSING' },
		});
		assert.equal(adminOrders.get(10).orderStatus, 'SHIPPED');
	} finally {
		adminRepository.updateOrderStatus = originalUpdate;
	}
});

test('admin basket endpoints require a live admin access token', async () => {
	const customerToken = await tokens.signAccess({ kind: 'customer', userId: 1, email: 'ada@example.com' });
	for (const token of [undefined, 'not-a-jwt', customerToken]) {
		for (const path of ['/admin/baskets', '/admin/baskets/123']) {
			const response = await get(path, token ?? '');
			assert.equal(response.status, 401, `${path} with ${token}`);
			assert.deepEqual(await response.json(), { error: 'Authentication required' });
		}
	}
	admins.delete(1);
	for (const path of ['/admin/baskets', '/admin/baskets/123'])
		assert.equal((await get(path)).status, 401, `${path} for deleted admin`);
});

test('POST /admin/products creates products for SuperAdmin and InventoryManager', async () => {
	for (const [index, role] of ['SuperAdmin', 'InventoryManager'].entries()) {
		admins.set(1, { ...admins.get(1), role });
		const token = await tokens.signAccessToken({ adminId: 1, role });
		const input = { ...validProduct, price: index === 0 ? 12.34 : '12.34' };
		const response = await postProduct(input, token);

		assert.equal(response.status, 201);
		assert.equal(response.headers.get('location'), `/products/${index + 3}`);
		const product = await response.json();
		assert.deepEqual(
			{
				productId: product.productId,
				name: product.name,
				description: product.description,
				category: product.category,
				price: product.price,
				imageURL: product.imageURL,
			},
			{ ...validProduct, productId: index + 3 },
		);
		assert.deepEqual(productCreateCalls[index], { ...validProduct, price: 12.34 });
		assert.deepEqual(products.get(index + 3), {
			...validProduct,
			productId: index + 3,
			createdAt: products.get(index + 3).createdAt,
			modifiedAt: products.get(index + 3).modifiedAt,
		});
	}
});

test('POST /admin/products rejects unauthorized requests without creating products', async () => {
	const customerToken = await tokens.signAccess({
		kind: 'customer',
		userId: 1,
		email: 'ada@example.com',
	});
	admins.set(1, { ...admins.get(1), role: 'Admin' });
	const adminRoleToken = await tokens.signAccessToken({ adminId: 1, role: 'Admin' });

	assert.equal((await postProduct(validProduct, '')).status, 401);
	assert.equal((await postProduct(validProduct, customerToken)).status, 401);
	assert.equal((await postProduct(validProduct, adminRoleToken)).status, 403);
	assert.equal(productCreateCalls.length, 0);
});

test('POST /admin/products validates fields and price boundaries', async () => {
	const invalidProducts = [
		{ ...validProduct, imageURL: '' },
		{ ...validProduct, imageURL: 'ftp://example.com/product.jpg' },
		{ ...validProduct, name: ' ' },
		{ ...validProduct, name: 'n'.repeat(101) },
		{ ...validProduct, description: '' },
		{ ...validProduct, category: '' },
		...[
			0,
			-1,
			'0',
			'1.001',
			1.001,
			'0.000000001',
			0.000000001,
			'100000000',
			100_000_000,
		].map((price) => ({ ...validProduct, price })),
	];
	for (const input of invalidProducts) {
		assert.equal((await postProduct(input)).status, 400, JSON.stringify(input));
	}
	assert.equal(productCreateCalls.length, 0);

	for (const price of ['0.01', 99_999_999.99]) {
		const response = await postProduct({ ...validProduct, price });
		assert.equal(response.status, 201, String(price));
		assert.equal((await response.json()).price, Number(price));
	}
	assert.equal(productCreateCalls.length, 2);
});

test('POST /admin/products returns 500 when product creation fails', async () => {
	const originalCreate = productRepository.create;
	const originalError = console.error;
	productRepository.create = async () => {
		throw new Error('database down');
	};
	console.error = () => {};
	try {
		const response = await postProduct(validProduct);
		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { error: 'Internal server error' });
		assert.equal(productCreateCalls.length, 0);
	} finally {
		productRepository.create = originalCreate;
		console.error = originalError;
	}
});
