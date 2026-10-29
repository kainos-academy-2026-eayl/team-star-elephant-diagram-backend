import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import argon2 from 'argon2'
import { createApp } from '../src/app.ts'
import { ARGON2_OPTIONS } from '../src/services/userService.ts'

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security'

const admins = new Map()
let failLookup = false
const inMemoryAdminRepository = {
  async findByEmail(email) {
    if (failLookup) throw new Error('db down')
    return admins.get(email) ?? null
  },
  async findById(adminId) {
    return [...admins.values()].find((admin) => admin.adminId === adminId) ?? null
  },
}

let server
let baseUrl

before(async () => {
  const passwordHash = await argon2.hash('correct-horse', ARGON2_OPTIONS)
  const roles = ['Admin', 'SuperAdmin', 'InventoryManager', 'FinanceManager', 'CustomerService']
  roles.forEach((role, index) => {
    const email = index === 0 ? 'admin@example.com' : `${role.toLowerCase()}@example.com`
    admins.set(email, { adminId: index + 1, forename: 'Test', surname: role, email, role, passwordHash })
  })
  admins.set('broken@example.com', { adminId: 10, forename: 'B', surname: 'B', email: 'broken@example.com', role: 'Admin', passwordHash: 'PLACEHOLDER_HASH' })
  admins.set('norole@example.com', { adminId: 11, forename: 'N', surname: 'R', email: 'norole@example.com', role: 'Intern', passwordHash })
  server = createApp({ adminRepository: inMemoryAdminRepository }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

const login = (body) =>
  fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('POST /admin/login succeeds with valid credentials', async () => {
  const response = await login({ email: 'Admin@Example.com', password: 'correct-horse' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.status, 'Success')
  assert.equal(typeof body.token, 'string')
  assert.equal(body.admin.role, 'Admin')
  assert.equal(body.admin.dashboard, 'admin')
  assert.equal(body.admin.passwordHash, undefined)
})

test('POST /admin/login returns the dashboard matching each role', async () => {
  const expected = {
    'superadmin@example.com': ['SuperAdmin', 'super-admin'],
    'inventorymanager@example.com': ['InventoryManager', 'inventory'],
    'financemanager@example.com': ['FinanceManager', 'finance'],
    'customerservice@example.com': ['CustomerService', 'customer-service'],
  }
  for (const [email, [role, dashboard]] of Object.entries(expected)) {
    const body = await (await login({ email, password: 'correct-horse' })).json()
    assert.equal(body.admin.role, role)
    assert.equal(body.admin.dashboard, dashboard)
  }
})

test('POST /admin/login returns 403 for an admin with an unrecognised role', async () => {
  const response = await login({ email: 'norole@example.com', password: 'correct-horse' })
  assert.equal(response.status, 403)
})

const tokenFor = async (email) => (await (await login({ email, password: 'correct-horse' })).json()).token
const get = (path, token) =>
  fetch(`${baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

test('GET /admin/me requires a valid token and returns the admin', async () => {
  assert.equal((await get('/admin/me')).status, 401)
  assert.equal((await get('/admin/me', 'garbage.token')).status, 401)
  const tampered = `${(await tokenFor('admin@example.com')).split('.')[0]}.AAAA`
  assert.equal((await get('/admin/me', tampered)).status, 401)

  const response = await get('/admin/me', await tokenFor('financemanager@example.com'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).admin.dashboard, 'finance')
})

test('GET /admin/dashboards/:key only allows the matching role, or SuperAdmin', async () => {
  const inventory = await tokenFor('inventorymanager@example.com')
  assert.equal((await get('/admin/dashboards/inventory', inventory)).status, 200)
  assert.equal((await get('/admin/dashboards/finance', inventory)).status, 403)
  assert.equal((await get('/admin/dashboards/inventory')).status, 401)

  const superAdmin = await tokenFor('superadmin@example.com')
  assert.equal((await get('/admin/dashboards/finance', superAdmin)).status, 200)
})

test('GET /admin/dashboards/:key uses the current admin account and role', async () => {
  const inventoryAdmin = admins.get('inventorymanager@example.com')
  const inventoryToken = await tokenFor('inventorymanager@example.com')
  inventoryAdmin.role = 'Admin'
  try {
    assert.equal((await get('/admin/dashboards/inventory', inventoryToken)).status, 403)

    admins.delete(inventoryAdmin.email)
    assert.equal((await get('/admin/dashboards/inventory', inventoryToken)).status, 401)
  } finally {
    inventoryAdmin.role = 'InventoryManager'
    admins.set(inventoryAdmin.email, inventoryAdmin)
  }
})

test('POST /admin/login rejects wrong password, unknown email and placeholder hash', async () => {
  for (const body of [
    { email: 'admin@example.com', password: 'wrong' },
    { email: 'nobody@example.com', password: 'correct-horse' },
    { email: 'broken@example.com', password: 'correct-horse' },
  ]) {
    const response = await login(body)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'Invalid email or password' })
  }
})

test('POST /admin/login rejects invalid input', async () => {
  const response = await login({ email: 'not-an-email', password: '' })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'Invalid login details')
})

test('POST /admin/login returns 500 on repository failure', async () => {
  failLookup = true
  try {
    const response = await login({ email: 'admin@example.com', password: 'correct-horse' })
    assert.equal(response.status, 500)
  } finally {
    failLookup = false
  }
})
