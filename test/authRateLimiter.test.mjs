import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.ts'
import { AUTH_RATE_LIMIT_OPTIONS } from '../src/middleware/authRateLimiter.ts'
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs'
import './helpers/authEnvironment.mjs'

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security'

const emptyUserRepository = {
  async findByEmail() {
    return null
  },
  async create() {
    throw new Error('not used')
  },
}
const emptyAdminRepository = {
  async findByEmail() {
    return null
  },
  async findById() {
    return null
  },
}

let server
let baseUrl

before(async () => {
  server = createApp({
    userRepository: emptyUserRepository,
    adminRepository: emptyAdminRepository,
    refreshSessionRepository: memoryRefreshSessions(),
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

// Invalid bodies are rejected by validation, so these requests never reach argon2 and stay fast.
const post = (path) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })

test('auth rate limiter uses 10 requests per 15 minutes with standard headers only', () => {
  assert.equal(AUTH_RATE_LIMIT_OPTIONS.limit, 10)
  assert.equal(AUTH_RATE_LIMIT_OPTIONS.windowMs, 15 * 60 * 1000)
  assert.equal(AUTH_RATE_LIMIT_OPTIONS.standardHeaders, true)
  assert.equal(AUTH_RATE_LIMIT_OPTIONS.legacyHeaders, false)
})

for (const path of ['/login', '/admin/login', '/register']) {
  test(`POST ${path} is blocked with 429 after ${AUTH_RATE_LIMIT_OPTIONS.limit} requests`, async () => {
    for (let i = 0; i < AUTH_RATE_LIMIT_OPTIONS.limit; i++) {
      const response = await post(path)
      assert.equal(response.status, 400, `request ${i + 1} should reach the controller`)
      assert.equal(response.headers.get('ratelimit-limit'), String(AUTH_RATE_LIMIT_OPTIONS.limit), 'standard RateLimit headers should be present')
      assert.equal(response.headers.get('x-ratelimit-limit'), null, 'legacy headers should be disabled')
    }

    const blocked = await post(path)
    assert.equal(blocked.status, 429)
    assert.deepEqual(await blocked.json(), { error: 'Too many requests, please try again later' })
  })
}

test('trusted proxy forwarding gives each client an independent auth rate limit', async () => {
  const proxyServer = createApp({
    userRepository: emptyUserRepository,
    adminRepository: emptyAdminRepository,
    refreshSessionRepository: memoryRefreshSessions(),
    authRateLimitOptions: { limit: 1 },
    trustedProxyAddresses: ['127.0.0.1'],
  }).listen(0, '127.0.0.1')
  await once(proxyServer, 'listening')
  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`

  const postWithForwardedAddress = (address) =>
    fetch(`${proxyBaseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
      body: JSON.stringify({}),
    })

  try {
    assert.equal((await postWithForwardedAddress('203.0.113.10')).status, 400)
    assert.equal((await postWithForwardedAddress('203.0.113.11')).status, 400)
    assert.equal((await postWithForwardedAddress('203.0.113.10')).status, 429)
  } finally {
    await new Promise((resolve) => proxyServer.close(resolve))
  }
})

test('untrusted forwarding headers do not change the auth rate-limit key', async () => {
  const proxyServer = createApp({
    userRepository: emptyUserRepository,
    adminRepository: emptyAdminRepository,
    refreshSessionRepository: memoryRefreshSessions(),
    authRateLimitOptions: { limit: 1 },
    trustedProxyAddresses: ['192.0.2.1'],
  }).listen(0, '127.0.0.1')
  await once(proxyServer, 'listening')
  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`

  const postWithForwardedAddress = (address) =>
    fetch(`${proxyBaseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
      body: JSON.stringify({}),
    })

  try {
    assert.equal((await postWithForwardedAddress('203.0.113.10')).status, 400)
    assert.equal((await postWithForwardedAddress('203.0.113.11')).status, 429)
  } finally {
    await new Promise((resolve) => proxyServer.close(resolve))
  }
})
