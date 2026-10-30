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
};
const adminRepository = {
	async findByEmail() {
		return null;
	},
	async findById() {
		return null;
	},
};

let server;
let url;
let adminToken;
let passwordHash;
before(async () => {
	passwordHash = await argon2.hash('correct-horse', ARGON2_OPTIONS);
	adminToken = await tokens.signAccessToken({ adminId: 1, role: 'SuperAdmin' });
	server = createApp({
		userRepository,
		adminRepository,
		tokenService: tokens,
		refreshSessionRepository: memoryRefreshSessions(),
		authRateLimitOptions: { limit: 1000 },
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
	users.clear();
	orders.length = 0;
	users.set(1, customer(1, 'Ada', 'Lovelace', 'ada@example.com'));
	users.set(2, customer(2, 'Grace', 'Hopper', 'grace@example.com'));
	users.set(3, customer(3, 'Alan', 'Turing', 'alan.t@example.org', { status: 'SUSPENDED' }));
	orders.push(
		{ userId: 1, orderId: 10, orderPlacedAt: new Date('2026-03-01T10:00:00Z'), orderStatus: 'DELIVERED', cost: '349.99' },
		{ userId: 1, orderId: 11, orderPlacedAt: new Date('2026-04-01T10:00:00Z'), orderStatus: 'PENDING', cost: '12.50' },
		{ userId: 2, orderId: 12, orderPlacedAt: new Date('2026-04-02T10:00:00Z'), orderStatus: 'SHIPPED', cost: '5.00' },
	);
});

const request = (method, path, token = adminToken) =>
	fetch(`${url}${path}`, {
		method,
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
const get = (path, token) => request('GET', path, token);
const post = (path, token) => request('POST', path, token);
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
		]) {
			const response = await request(method, path);
			assert.equal(response.status, 404, `${method} ${path}`);
			assert.deepEqual(await response.json(), { error: 'User not found' });
		}
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

test('admin user endpoints require an admin access token', async () => {
	const customerToken = await tokens.signAccess({ kind: 'customer', userId: 1, email: 'ada@example.com' });
	for (const token of [undefined, 'not-a-jwt', customerToken]) {
		for (const [method, path] of [
			['GET', '/admin/users'],
			['GET', '/admin/users/1'],
			['POST', '/admin/users/1/suspend'],
			['POST', '/admin/users/3/reactivate'],
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
