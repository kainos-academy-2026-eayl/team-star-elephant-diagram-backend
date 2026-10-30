import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { afterEach, beforeEach, mock, test } from 'node:test'
import argon2 from 'argon2'
import { createApp } from '../src/app.ts'
import { createConsoleResetDelivery, PASSWORD_RESET_TTL_MS, PasswordResetService, PasswordResetUnavailableError } from '../src/services/passwordResetService.ts'
import { ARGON2_OPTIONS } from '../src/services/userService.ts'
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs'
import './helpers/authEnvironment.mjs'

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security'

let server
let baseUrl
let users
let sessions
let delivered
let resets

beforeEach(async () => {
  users = new Map()
  sessions = memoryRefreshSessions()
  delivered = []
  resets = {
    async save(userId, tokenHash, expiresAt) {
      Object.assign(users.get(userId), { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt })
    },
    async findByHash(tokenHash) {
      return [...users.values()].find(user => user.passwordResetTokenHash === tokenHash) ?? null
    },
    async consume(tokenHash, passwordHash, now) {
      const user = [...users.values()].find(user => user.passwordResetTokenHash === tokenHash && user.passwordResetExpiresAt > now)
      if (!user) return false
      Object.assign(user, { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null })
      for (const session of sessions.rows.values()) {
        if (session.principalId === user.userId && session.principalKind === 'customer') session.revokedAt = now
      }
      return true
    },
  }
  const userRepository = {
    async findByEmail(email) { return [...users.values()].find(user => user.email === email) ?? null },
    async findById(id) { return users.get(id) ?? null },
    async create(data) {
      const user = { userId: users.size + 1, ...data }
      users.set(user.userId, user)
      return user
    },
  }
  server = createApp({
    userRepository,
    refreshSessionRepository: sessions,
    passwordResetRepository: resets,
    passwordResetDelivery: async token => { delivered.push(token) },
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
  assert.equal((await post('/register', {
    forename: 'Ada', surname: 'Lovelace', email: 'ada@example.com', password: 'old-password',
  })).status, 201)
})

afterEach(async () => {
  mock.restoreAll()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
})

const post = (path, body) => fetch(`${baseUrl}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const requestReset = () => post('/forgot-password', { email: 'ada@example.com' })
const reset = (token, password = 'new-password') => post('/reset-password', { token, password })

test('reset request normalises email, stores only a hashed token and expires in 15 minutes', async () => {
  const before = Date.now()
  const response = await post('/forgot-password', { email: ' Ada@Example.com ' })
  const after = Date.now()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(delivered[0], /^[a-f0-9]{64}$/)
  const user = users.get(1)
  assert.equal(user.passwordResetTokenHash, createHash('sha256').update(delivered[0]).digest('hex'))
  assert.notEqual(user.passwordResetTokenHash, delivered[0])
  assert.ok(user.passwordResetExpiresAt.getTime() >= before + PASSWORD_RESET_TTL_MS)
  assert.ok(user.passwordResetExpiresAt.getTime() <= after + PASSWORD_RESET_TTL_MS)
})

test('unknown email returns the same response without delivery', async () => {
  const existing = await requestReset()
  const unknown = await post('/forgot-password', { email: 'unknown@example.com' })
  assert.equal(unknown.status, existing.status)
  assert.deepEqual(await unknown.json(), await existing.json())
  assert.equal(delivered.length, 1)
})

test('reset changes the password hash, clears the token and invalidates customer refresh sessions', async () => {
  const login = await post('/login', { email: 'ada@example.com', password: 'old-password' })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  sessions.rows.set('admin', { principalId: 1, principalKind: 'admin', revokedAt: null })
  await requestReset()
  const response = await reset(delivered[0])
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const user = users.get(1)
  assert.equal(argon2.needsRehash(user.passwordHash, ARGON2_OPTIONS), false)
  assert.equal(await argon2.verify(user.passwordHash, 'new-password'), true)
  assert.equal(user.passwordResetTokenHash, null)
  assert.equal(user.passwordResetExpiresAt, null)
  assert.equal((await post('/login', { email: user.email, password: 'old-password' })).status, 401)
  assert.equal((await post('/login', { email: user.email, password: 'new-password' })).status, 200)
  const refresh = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', headers: { cookie } })
  assert.equal(refresh.status, 401)
  assert.equal(sessions.rows.get('admin').revokedAt, null)
})

test('a reset token is single-use', async () => {
  await requestReset()
  assert.equal((await reset(delivered[0])).status, 200)
  assert.equal((await reset(delivered[0], 'another-password')).status, 400)
})

test('requesting another link invalidates the old link', async () => {
  await requestReset()
  await requestReset()
  assert.notEqual(delivered[0], delivered[1])
  assert.equal((await reset(delivered[0])).status, 400)
  assert.equal((await reset(delivered[1])).status, 200)
})

test('expired and unknown tokens cannot change a password', async () => {
  await requestReset()
  const before = users.get(1).passwordHash
  users.get(1).passwordResetExpiresAt = new Date(Date.now() - 1)
  for (const token of [delivered[0], 'b'.repeat(64)]) {
    const response = await reset(token)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'This reset link is invalid or has expired.' })
  }
  assert.equal(users.get(1).passwordHash, before)
})

for (const [label, body] of [
  ['missing token', { password: 'new-password' }],
  ['malformed token', { token: 'bad-token', password: 'new-password' }],
  ['short password', { token: 'a'.repeat(64), password: 'short' }],
  ['long password', { token: 'a'.repeat(64), password: 'x'.repeat(129) }],
  ['non-string password', { token: 'a'.repeat(64), password: ['new-password'] }],
]) {
  test(`reset rejects ${label} server-side`, async () => {
    const response = await post('/reset-password', body)
    assert.equal(response.status, 400)
    assert.ok((await response.json()).details)
  })
}

test('invalid request email is rejected server-side', async () => {
  const response = await post('/forgot-password', { email: 'not-an-email' })
  assert.equal(response.status, 400)
  assert.equal(delivered.length, 0)
})

test('reset endpoints share a rate limit and return JSON errors', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await post('/forgot-password', { email: 'unknown@example.com' })).status, 200)
  }
  const response = await reset('a'.repeat(64))
  assert.equal(response.status, 429)
  assert.match((await response.json()).error, /Too many/)
})

test('repository failures are logged and surfaced without success', async () => {
  const log = mock.method(console, 'error', () => {})
  mock.method(resets, 'save', async () => { throw new Error('Database unavailable') })
  const response = await requestReset()
  assert.equal(response.status, 500)
  assert.equal(delivered.length, 0)
  assert.equal(log.mock.callCount(), 1)
})

test('disabled delivery fails explicitly before any user lookup', async () => {
  const lookup = mock.fn()
  const service = new PasswordResetService({ findByEmail: lookup }, resets, undefined)
  await assert.rejects(service.request('ada@example.com'), PasswordResetUnavailableError)
  assert.equal(lookup.mock.callCount(), 0)
})

test('reset does not claim success when token consumption loses a race', async () => {
  await requestReset()
  mock.method(resets, 'consume', async () => false)
  const response = await reset(delivered[0])
  assert.equal(response.status, 400)
  assert.equal(await argon2.verify(users.get(1).passwordHash, 'old-password'), true)
})

test('console delivery prints a local reset link and refuses unsafe configuration', async () => {
  const previous = Object.fromEntries(['PASSWORD_RESET_DELIVERY', 'FRONTEND_BASE_URL', 'NODE_ENV'].map(key => [key, process.env[key]]))
  try {
    process.env.NODE_ENV = 'development'
    process.env.PASSWORD_RESET_DELIVERY = 'console'
    process.env.FRONTEND_BASE_URL = 'https://localhost:3000'
    const log = mock.method(console, 'info', () => {})
    await createConsoleResetDelivery()('a'.repeat(64))
    assert.ok(log.mock.calls[0].arguments[0].includes(`https://localhost:3000/reset-password?token=${'a'.repeat(64)}`))
    process.env.NODE_ENV = 'production'
    assert.throws(createConsoleResetDelivery, /outside production/)
    process.env.NODE_ENV = 'development'
    process.env.FRONTEND_BASE_URL = 'http://example.com'
    assert.throws(createConsoleResetDelivery, /HTTPS origin/)
    delete process.env.FRONTEND_BASE_URL
    assert.throws(createConsoleResetDelivery, /FRONTEND_BASE_URL/)
    delete process.env.PASSWORD_RESET_DELIVERY
    assert.equal(createConsoleResetDelivery(), undefined)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
