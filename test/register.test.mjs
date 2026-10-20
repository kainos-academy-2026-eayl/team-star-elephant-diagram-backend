import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, beforeEach, test } from 'node:test'
import argon2 from 'argon2'
import { createApp } from '../src/app.ts'
import { DuplicateEmailError } from '../src/repositories/userRepository.ts'
import { ARGON2_OPTIONS } from '../src/services/userService.ts'

const users = new Map()
const inMemoryUserRepository = {
  async create(newUser) {
    if (users.has(newUser.email)) throw new DuplicateEmailError()
    const user = { id: users.size + 1, ...newUser }
    users.set(user.email, user)
    const { passwordHash: _passwordHash, ...createdUser } = user
    return createdUser
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

const validBody = { forename: 'Ada', surname: 'Lovelace', email: 'ada@example.com', password: 'correct-horse' }

const register = (body) =>
  fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

test('POST /register returns 201 with status created and normalises the email and names', async () => {
  const response = await register({ ...validBody, forename: ' Ada ', surname: ' Lovelace ', email: 'Ada@Example.com ' })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { status: 'created' })
  const stored = users.get('ada@example.com')
  assert.equal(stored.forename, 'Ada')
  assert.equal(stored.surname, 'Lovelace')
})

test('POST /register passes matching created and modified timestamps to the repository', async () => {
  const before = Date.now()
  await register(validBody)
  const after = Date.now()
  const { createdAt, modifiedAt } = users.get('ada@example.com')

  assert.ok(createdAt instanceof Date)
  assert.ok(createdAt.getTime() >= before && createdAt.getTime() <= after)
  assert.equal(modifiedAt.getTime(), createdAt.getTime())
})

test('POST /register stores only a one-way argon2id hash of the password', async () => {
  await register(validBody)
  const stored = users.get('ada@example.com')

  assert.equal(stored.password, undefined)
  assert.notEqual(stored.passwordHash, 'correct-horse')
  assert.ok(stored.passwordHash.startsWith('$argon2id$'))
  // needsRehash parses the PHC string, so this checks the cost values rather than the order argon2 serialises them in
  assert.equal(argon2.needsRehash(stored.passwordHash, ARGON2_OPTIONS), false)
  assert.ok(await argon2.verify(stored.passwordHash, 'correct-horse'))
  assert.equal(await argon2.verify(stored.passwordHash, 'wrong-horse'), false)
})

test('POST /register accepts passwords longer than 72 bytes', async () => {
  const response = await register({ ...validBody, password: 'x'.repeat(100) })

  assert.equal(response.status, 201)
  assert.ok(await argon2.verify(users.get('ada@example.com').passwordHash, 'x'.repeat(100)))
})

test('POST /register returns 400 and creates no duplicate for an already registered email', async () => {
  assert.equal((await register(validBody)).status, 201)
  const response = await register({ ...validBody, email: 'ADA@example.com', password: 'another-pass' })

  assert.equal(response.status, 400)
  assert.equal(users.size, 1)
})

for (const [name, body] of [
  ['invalid email', { ...validBody, email: 'not-an-email' }],
  ['short password', { ...validBody, password: 'short' }],
  ['password over 128 characters', { ...validBody, password: 'x'.repeat(129) }],
  ['missing forename', { ...validBody, forename: undefined }],
  ['blank surname', { ...validBody, surname: '   ' }],
  ['forename over 100 characters', { ...validBody, forename: 'x'.repeat(101) }],
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
