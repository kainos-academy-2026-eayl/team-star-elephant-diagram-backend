import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, beforeEach, test } from 'node:test'
import * as jose from 'jose'
import { createApp } from '../src/app.ts'
import { InvalidUserCredentialsError, UserService } from '../src/services/userService.ts'
import { memoryRefreshSessions } from './helpers/refreshSessions.mjs'
import './helpers/authEnvironment.mjs'

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security'

const users = new Map()
const inMemoryUserRepository = {
  async findByEmail(email) {
    return users.get(email) ?? null
  },
  async create(newUser) {
    const user = { userId: users.size + 1, ...newUser }
    users.set(user.email, user)
    const { passwordHash: _passwordHash, ...createdUser } = user
    return createdUser
  },
}

let server
let baseUrl
let userService

before(async () => {
  userService = new UserService(inMemoryUserRepository)
  server = createApp({ userRepository: inMemoryUserRepository, refreshSessionRepository: memoryRefreshSessions(), authRateLimitOptions: { limit: 1000 } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => users.clear())

const validBody = { forename: 'Ada', surname: 'Lovelace', email: 'ada@example.com', password: 'correct-horse' }

const register = (body) =>
  fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const login = (credentials) =>
  fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })

test('POST /login returns a valid JWT token that can be verified', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  assert.equal(response.status, 200)

  const body = await response.json()
  const token = body.token

  const verified = await userService.verifyToken(token)
  assert.equal(verified.payload.email, validBody.email)
  assert.ok(verified.payload.userId)
  assert.ok(verified.payload.exp)
})

test('POST /login token contains correct user claims', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  const body = await response.json()
  const token = body.token

  const verified = await userService.verifyToken(token)
  assert.equal(verified.payload.kind, 'customer')
  assert.equal(verified.payload.tokenUse, 'access')
  assert.equal(verified.payload.exp - verified.payload.iat, 900)
  assert.equal(verified.payload.email, 'ada@example.com')
  assert.ok(Number.isInteger(verified.payload.userId))
})

test('POST /login token verification fails with tampered token', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  const body = await response.json()
  const token = body.token

  const tampered = token.slice(0, -10) + 'tampered00'

  await assert.rejects(
    async () => userService.verifyToken(tampered),
    { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }
  )
})

test('POST /login token verification fails when payload is modified', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  const body = await response.json()
  const token = body.token

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }

  const header = parts[0]
  const payload = parts[1]
  const signature = parts[2]

  const modifiedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64').toString()), email: 'attacker@example.com' })
  ).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const tamperedToken = `${header}.${modifiedPayload}.${signature}`

  await assert.rejects(
    async () => userService.verifyToken(tamperedToken),
    { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }
  )
})

test('POST /login token verification fails with expired token', async () => {
  await register(validBody)

  const secret = new TextEncoder().encode(process.env.JWT_SECRET)

  const expiredToken = await new jose.SignJWT({ userId: 1, email: 'ada@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('-1s')
    .sign(secret)

  await assert.rejects(
    async () => userService.verifyToken(expiredToken),
    { code: 'ERR_JWT_EXPIRED' }
  )
})

test('POST /login token is valid for the specified 15 minute duration', async () => {
  await register(validBody)

  const beforeLogin = Math.floor(Date.now() / 1000)
  const response = await login({ email: validBody.email, password: validBody.password })
  const afterLogin = Math.floor(Date.now() / 1000)

  const body = await response.json()
  const token = body.token

  const verified = await userService.verifyToken(token)
  const expiresAt = verified.payload.exp
  const fifteenMinutes = 15 * 60

  const minExpiration = beforeLogin + fifteenMinutes
  const maxExpiration = afterLogin + fifteenMinutes

  assert.ok(expiresAt >= minExpiration - 1, `Token expiration should be at least ${minExpiration}`)
  assert.ok(expiresAt <= maxExpiration + 1, `Token expiration should be at most ${maxExpiration}`)
})

test('POST /login token with wrong secret fails verification', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  const body = await response.json()
  const token = body.token

  const wrongSecret = new TextEncoder().encode('wrong-secret-key-at-least-32-characters-long')

  await assert.rejects(
    async () => jose.jwtVerify(token, wrongSecret),
    { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }
  )
})

test('POST /login returns token in response body', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: validBody.password })
  assert.equal(response.status, 200)

  const body = await response.json()
  assert.ok('token' in body, 'Response should contain token field')
  assert.equal(typeof body.token, 'string')
  assert.ok(body.token.length > 0)
  assert.equal(body.status, 'Success')

  const parts = body.token.split('.')
  assert.equal(parts.length, 3, 'Token should be a valid JWT with 3 parts')
})

test('POST /login returns 400 for a password longer than 128 characters', async () => {
  await register(validBody)

  const response = await login({ email: validBody.email, password: 'x'.repeat(129) })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error, 'Invalid login details')
  assert.ok(body.details.password)
})

test('POST /login returns 401, not 500, when the stored password hash is malformed', async () => {
  users.set('broken@example.com', { userId: 99, email: 'broken@example.com', passwordHash: 'PLACEHOLDER_HASH' })

  const response = await login({ email: 'broken@example.com', password: 'correct-horse' })
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Invalid email or password' })
})

test('UserService.authenticate treats a malformed stored hash the same as a wrong password', async () => {
  users.set('broken@example.com', { userId: 99, email: 'broken@example.com', passwordHash: 'not-an-argon2-hash' })

  await assert.rejects(
    () => userService.authenticate({ email: 'broken@example.com', password: 'correct-horse' }),
    InvalidUserCredentialsError
  )
})
