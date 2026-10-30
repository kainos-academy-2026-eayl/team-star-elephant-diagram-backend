import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loginSchema } from '../src/validators/loginSchema.ts'

test('loginSchema accepts a password of exactly 128 characters', () => {
  const result = loginSchema.safeParse({ email: 'ada@example.com', password: 'x'.repeat(128) })
  assert.equal(result.success, true)
})

test('loginSchema rejects a password longer than 128 characters', () => {
  const result = loginSchema.safeParse({ email: 'ada@example.com', password: 'x'.repeat(129) })
  assert.equal(result.success, false)
  assert.deepEqual(result.error.issues.map((issue) => issue.path.join('.')), ['password'])
})

test('loginSchema keeps existing validation for empty password and invalid email', () => {
  assert.equal(loginSchema.safeParse({ email: 'ada@example.com', password: '' }).success, false)
  assert.equal(loginSchema.safeParse({ email: 'not-an-email', password: 'secret' }).success, false)
  assert.deepEqual(loginSchema.parse({ email: ' Ada@Example.COM ', password: 'secret' }), { email: 'ada@example.com', password: 'secret' })
})
