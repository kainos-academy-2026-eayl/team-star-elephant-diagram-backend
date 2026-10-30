import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import argon2 from 'argon2';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { createApp } from '../src/app.ts';
import { ARGON2_OPTIONS } from '../src/services/AdminUserService.ts';
import { AuthSessionService } from '../src/services/authSessionService.ts';
import {
	TokenService,
	createTokenService,
} from '../src/services/tokenService.ts';
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs';

const accessSecret = 'admin-access-secret-at-least-32-bytes';
const refreshSecret = 'refresh-secret-at-least-32-bytes-long';
const customerSecret = 'customer-access-secret-at-least-32-bytes';
process.env.JWT_SECRET = customerSecret;
const tokens = new TokenService(accessSecret, refreshSecret, customerSecret);
const sessions = memoryRefreshSessions();
const admins = new Map();
const customers = new Map();
const repository = (rows, key) => ({
	async findByEmail(email) {
		return [...rows.values()].find((user) => user.email === email) ?? null;
	},
	async findById(id) {
		return rows.get(id) ?? null;
	},
	async create(user) {
		const row = { ...user, [key]: rows.size + 1 };
		rows.set(row[key], row);
		return row;
	},
});
let server;
let url;
before(async () => {
	server = createApp({
		adminRepository: repository(admins, 'adminId'),
		userRepository: repository(customers, 'userId'),
		tokenService: tokens,
		refreshSessionRepository: sessions,
	}).listen(0, '127.0.0.1');
	await once(server, 'listening');
	url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(async () => {
	sessions.rows.clear();
	admins.clear();
	customers.clear();
	const base = {
		forename: 'Ada',
		surname: 'Lovelace',
		email: 'ada@example.com',
		passwordHash: await argon2.hash('correct-horse', ARGON2_OPTIONS),
		createdAt: new Date(),
		modifiedAt: new Date(),
	};
	admins.set(1, { ...base, adminId: 1, role: 'SuperAdmin' });
	customers.set(1, { ...base, userId: 1 });
});
const post = (path, body = {}, cookie = '') =>
	fetch(`${url}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify(body),
	});
const login = (kind = 'admin') =>
	post(kind === 'admin' ? '/admin/login' : '/login', {
		email: 'ada@example.com',
		password: 'correct-horse',
	});
const cookie = (response) =>
	response.headers
		.getSetCookie()
		.find((value) => value.startsWith('refreshToken='))
		.split(';')[0];
const get = (path, accessToken) =>
	fetch(`${url}${path}`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});

for (const kind of ['admin', 'customer']) {
	test(`${kind}: login sets a 7-day Secure HttpOnly Strict cookie and a standard 15m JWT`, async () => {
		const response = await login(kind);
		assert.equal(response.status, 200);
		const body = await response.json();
		const key = new TextEncoder().encode(
			kind === 'admin' ? accessSecret : customerSecret,
		);
		const { payload } = await jwtVerify(body.accessToken, key, {
			algorithms: ['HS256'],
			issuer: 'star-elephant',
			audience: 'star-elephant-api',
		});
		assert.equal(payload.exp - payload.iat, 900);
		assert.equal(payload.tokenUse, 'access');
		assert.equal(payload.kind, kind);
		assert.equal(body.expiresIn, 900);
		assert.equal(payload.passwordHash, undefined);
		assert.equal(body.refreshToken, undefined);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		const header = response.headers.getSetCookie()[0];
		for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
			assert.ok(header.includes(flag), flag);
		const maxAge = Number(header.match(/Max-Age=(\d+)/)[1]);
		assert.ok(maxAge >= 604798 && maxAge <= 604800);
		const raw = cookie(response).slice('refreshToken='.length);
		const refresh = await tokens.verifyRefreshToken(raw);
		assert.equal(refresh.exp - refresh.iat, 604800);
		const stored = sessions.rows.get(refresh.sessionId);
		assert.notEqual(stored.tokenHash, raw);
		assert.equal(stored.tokenHash.length, 64);
	});

	test(`${kind}: restores a session after access expiry and uses current account details`, async () => {
		const response = await login(kind);
		if (kind === 'admin') admins.get(1).role = 'InventoryManager';
		const refreshed = await post('/auth/refresh', {}, cookie(response));
		assert.equal(refreshed.status, 200);
		const { accessToken } = await refreshed.json();
		const profile = await get(
			kind === 'admin' ? '/admin/me' : '/profile',
			accessToken,
		);
		assert.equal(profile.status, 200);
		if (kind === 'admin')
			assert.equal((await profile.json()).role, 'InventoryManager');
		else assert.equal((await profile.json()).user.email, 'ada@example.com');
		assert.notEqual(cookie(refreshed), cookie(response));
		const oldPayload = decodeJwt(
			cookie(response).slice('refreshToken='.length),
		);
		const newPayload = decodeJwt(
			cookie(refreshed).slice('refreshToken='.length),
		);
		assert.equal(
			newPayload.exp,
			oldPayload.exp,
			'Refresh must not extend the original 7-day session',
		);
	});

	test(`${kind}: replay invalidates the refresh session`, async () => {
		const response = await login(kind);
		const refreshed = await post('/auth/refresh', {}, cookie(response));
		assert.equal(refreshed.status, 200);
		assert.equal(
			(await post('/auth/refresh', {}, cookie(response))).status,
			401,
		);
		assert.equal(
			(await post('/auth/refresh', {}, cookie(refreshed))).status,
			401,
		);
	});

	test(`${kind}: logout revokes copied refresh tokens and clears the matching cookie`, async () => {
		const response = await login(kind);
		const logout = await post('/auth/logout', {}, cookie(response));
		assert.equal(logout.status, 200);
		const cleared = logout.headers.getSetCookie()[0];
		assert.ok(cleared.startsWith('refreshToken=;'));
		assert.ok(Date.parse(cleared.match(/Expires=([^;]+)/)[1]) < Date.now());
		for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
			assert.ok(cleared.includes(flag));
		assert.equal(
			(await post('/auth/refresh', {}, cookie(response))).status,
			401,
		);
	});

	test(`${kind}: deleted accounts cannot refresh`, async () => {
		const response = await login(kind);
		(kind === 'admin' ? admins : customers).delete(1);
		assert.equal(
			(await post('/auth/refresh', {}, cookie(response))).status,
			401,
		);
	});

	test(`${kind}: invalid login does not create credentials`, async () => {
		const response = await post(kind === 'admin' ? '/admin/login' : '/login', {
			email: 'ada@example.com',
			password: 'incorrect',
		});
		assert.equal(response.status, 401);
		assert.equal(response.headers.get('set-cookie'), null);
		assert.equal(sessions.rows.size, 0);
	});
}

test('access tokens cannot refresh, and refresh tokens cannot access protected resources', async () => {
	const response = await login();
	const { accessToken } = await response.json();
	assert.equal(
		(await post('/auth/refresh', {}, `refreshToken=${accessToken}`)).status,
		401,
	);
	const raw = cookie(response).slice('refreshToken='.length);
	assert.equal((await get('/admin/me', raw)).status, 401);
	const customer = await (await login('customer')).json();
	assert.equal((await get('/admin/me', customer.accessToken)).status, 401);
	assert.equal((await get('/profile', accessToken)).status, 401);
});

test('purpose claims prevent substitution even with a JWT signed by the expected key', async () => {
	const forged = await new SignJWT({
		kind: 'admin',
		tokenUse: 'refresh',
		adminId: 1,
		role: 'SuperAdmin',
	})
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setIssuer('star-elephant')
		.setAudience('star-elephant-api')
		.setSubject('1')
		.setJti('test')
		.setIssuedAt()
		.setExpirationTime('15m')
		.sign(new TextEncoder().encode(accessSecret));
	assert.equal(await tokens.verifyAccessToken(forged), null);
});

test('configuration rejects short or equal secrets', () => {
	assert.throws(() => new TokenService('short', refreshSecret), /32 bytes/);
	assert.throws(
		() => new TokenService(accessSecret, accessSecret),
		/different/,
	);
	assert.throws(
		() => new TokenService(accessSecret, customerSecret, customerSecret),
		/different/,
	);
});

test('startup requires stable signing secrets instead of silently generating ephemeral keys', () => {
	assert.throws(() => createTokenService('', ''), /must be set/);
});

test('expired, tampered, malformed and missing access tokens fail closed', async () => {
	const expired = await tokens.signAccessToken(
		admins.get(1),
		Date.now() - 901_000,
	);
	const valid = await tokens.signAccessToken(admins.get(1));
	for (const value of [
		expired,
		`${valid.slice(0, -10)}tampered00`,
		'garbage',
		'',
	]) {
		assert.equal((await get('/admin/me', value)).status, 401);
	}
});

test('expired refresh and database-expired sessions are rejected', async () => {
	const response = await login();
	const raw = cookie(response).slice('refreshToken='.length);
	const payload = await tokens.verifyRefreshToken(raw);
	const expired = await tokens.signRefreshToken(
		{ kind: 'admin', adminId: 1, role: 'SuperAdmin' },
		payload.sessionId,
		new Date(Date.now() - 1000),
		Date.now() - 604_801_000,
	);
	assert.equal(
		(await post('/auth/refresh', {}, `refreshToken=${expired}`)).status,
		401,
	);
	sessions.rows.get(payload.sessionId).expiresAt = new Date(Date.now() - 1000);
	assert.equal((await post('/auth/refresh', {}, cookie(response))).status, 401);
});

test('only one concurrent rotation succeeds', async () => {
	const response = await login();
	const responses = await Promise.all([
		post('/auth/refresh', {}, cookie(response)),
		post('/auth/refresh', {}, cookie(response)),
	]);
	assert.deepEqual(responses.map((result) => result.status).sort(), [200, 401]);
});

test('refresh remains valid across service recreation with persistent storage and stable keys', async () => {
	const first = new AuthSessionService(tokens, sessions);
	const credentials = await first.create({
		kind: 'admin',
		adminId: 1,
		role: 'SuperAdmin',
	});
	const recreated = new AuthSessionService(
		new TokenService(accessSecret, refreshSecret, customerSecret),
		sessions,
	);
	const refreshed = await recreated.refresh(
		credentials.refreshToken,
		async () => ({ kind: 'admin', adminId: 1, role: 'SuperAdmin' }),
	);
	assert.ok(await tokens.verifyAccessToken(refreshed.accessToken));
});

test('missing and non-string refresh cookies return 401, not 500', async () => {
	for (const value of [
		'',
		'refreshToken=bad',
		'refreshToken=j%3A%7B%22invalid%22%3Atrue%7D',
	]) {
		assert.equal((await post('/auth/refresh', {}, value)).status, 401);
	}
});
