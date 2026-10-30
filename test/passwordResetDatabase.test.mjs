import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import argon2 from 'argon2'
import './helpers/authEnvironment.mjs'

test('password reset persists atomically in PostgreSQL and rejects concurrent reuse', {
  skip: !process.env.PASSWORD_RESET_TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.PASSWORD_RESET_TEST_DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local test database')
  assert.match(url.pathname, /^\/password_reset_test_[a-z0-9_]+$/, 'Use a dedicated password_reset_test_* database')
  process.env.DATABASE_URL = url.href
  process.env.JWT_SECRET = 'test-customer-secret-at-least-32-characters-long'
  const { createApp } = await import('../src/app.ts')
  const { default: prisma } = await import('../src/prismaClient.ts')
  const { prismaPasswordResetRepository } = await import('../src/repositories/passwordResetRepository.ts')
  const tokens = []
  const server = createApp({ passwordResetDelivery: async token => { tokens.push(token) } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  const email = `reset-${Date.now()}@example.com`
  let userId
  try {
    assert.equal((await post('/register', { forename: 'Reset', surname: 'Test', email, password: 'old-password' })).status, 201)
    const before = await prisma.user.findUniqueOrThrow({ where: { email } })
    userId = before.userId
    const login = await post('/login', { email, password: 'old-password' })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    assert.equal((await post('/forgot-password', { email })).status, 200)
    const token = tokens[0]
    const requested = await prisma.user.findUniqueOrThrow({ where: { email } })
    assert.notEqual(requested.passwordResetTokenHash, token)
    assert.match(requested.passwordResetTokenHash, /^[a-f0-9]{64}$/)
    const responses = await Promise.all(['new-password-one', 'new-password-two'].map(password =>
      post('/reset-password', { token, password })))
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400])
    const winningPassword = responses[0].status === 200 ? 'new-password-one' : 'new-password-two'
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } })
    assert.notEqual(stored.passwordHash, before.passwordHash)
    assert.equal(await argon2.verify(stored.passwordHash, winningPassword), true)
    assert.ok(stored.modifiedAt > before.modifiedAt)
    assert.equal(stored.passwordResetTokenHash, null)
    assert.equal(stored.passwordResetExpiresAt, null)
    assert.equal((await post('/login', { email, password: 'old-password' })).status, 401)
    assert.equal((await post('/login', { email, password: winningPassword })).status, 200)
    assert.equal((await post('/auth/refresh', {}, { cookie })).status, 401)
    assert.equal((await post('/reset-password', { token, password: 'another-password' })).status, 400)

    await post('/forgot-password', { email })
    const oldToken = tokens.at(-1)
    await post('/forgot-password', { email })
    assert.equal((await post('/reset-password', { token: oldToken, password: 'another-password' })).status, 400)
    await prisma.user.update({ where: { userId }, data: { passwordResetExpiresAt: new Date(Date.now() - 1) } })
    assert.equal((await post('/reset-password', { token: tokens.at(-1), password: 'another-password' })).status, 400)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { userId } })).passwordHash, stored.passwordHash)

    await post('/forgot-password', { email })
    const beforeRollback = await prisma.user.findUniqueOrThrow({ where: { userId } })
    await prisma.$executeRaw`CREATE FUNCTION reset_test_failure() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN RAISE EXCEPTION ''test session revocation failure''; END'`
    try {
      await prisma.$executeRaw`CREATE TRIGGER reset_test_failure BEFORE UPDATE ON "RefreshSession"
        FOR EACH STATEMENT EXECUTE FUNCTION reset_test_failure()`
      await assert.rejects(prismaPasswordResetRepository.consume(
        beforeRollback.passwordResetTokenHash, 'must-not-be-committed', new Date(),
      ))
      const afterRollback = await prisma.user.findUniqueOrThrow({ where: { userId } })
      assert.equal(afterRollback.passwordHash, beforeRollback.passwordHash)
      assert.equal(afterRollback.passwordResetTokenHash, beforeRollback.passwordResetTokenHash)
      assert.equal(afterRollback.modifiedAt.getTime(), beforeRollback.modifiedAt.getTime())
    } finally {
      await prisma.$executeRaw`DROP TRIGGER IF EXISTS reset_test_failure ON "RefreshSession"`
      await prisma.$executeRaw`DROP FUNCTION reset_test_failure()`
    }
    assert.equal((await post('/reset-password', { token: tokens.at(-1), password: 'final-password' })).status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
    if (userId) {
      await prisma.refreshSession.deleteMany({ where: { principalId: userId, principalKind: 'customer' } })
      await prisma.user.delete({ where: { userId } })
    }
    await prisma.$disconnect()
  }
})
