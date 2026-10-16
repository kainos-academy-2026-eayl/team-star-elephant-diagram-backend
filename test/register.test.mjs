import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, beforeEach, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app.ts'
import { DuplicateEmailError } from '../src/repositories/userRepository.ts'

const users = new Map()
const inMemoryUserRepository = {
  async create(email, passwordHash) {
    if (users.has(email)) throw new DuplicateEmailError()
    const user = { id: users.size + 1, email, passwordHash, createdAt: new Date() }
    users.set(email, user)
    return { id: user.id, email: user.email, createdAt: user.createdAt }
  },
}

let server
let baseUrl

before(async () => {
  server = createApp({ userRepository: inMemoryUserRepository }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => users.clear())

const register = (body) =>
  fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

test('POST /register returns 200 and never exposes the password', async () => {
  const response = await register({ email: 'Ada@Example.com ', password: 'correct-horse' })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.email, 'ada@example.com')
  assert.equal(body.password, undefined)
  assert.equal(body.passwordHash, undefined)
})

test('POST /register stores only a one-way bcrypt hash of the password', async () => {
  await register({ email: 'ada@example.com', password: 'correct-horse' })
  const stored = users.get('ada@example.com')

  assert.notEqual(stored.passwordHash, 'correct-horse')
  assert.match(stored.passwordHash, /^\$2[aby]\$12\$/)
  assert.ok(await bcrypt.compare('correct-horse', stored.passwordHash))
})

test('POST /register returns 400 and creates no duplicate for an already registered email', async () => {
  assert.equal((await register({ email: 'ada@example.com', password: 'correct-horse' })).status, 200)
  const response = await register({ email: 'ADA@example.com', password: 'another-pass' })

  assert.equal(response.status, 400)
  assert.equal(users.size, 1)
})

for (const [name, body] of [
  ['invalid email', { email: 'not-an-email', password: 'correct-horse' }],
  ['short password', { email: 'ada@example.com', password: 'short' }],
  ['password over 72 bytes', { email: 'ada@example.com', password: 'x'.repeat(73) }],
  ['missing fields', {}],
  ['malformed JSON', '{"email":'],
]) {
  test(`POST /register returns 400 for ${name}`, async () => {
    const response = await register(body)
    assert.equal(response.status, 400)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal(users.size, 0)
  })
}
