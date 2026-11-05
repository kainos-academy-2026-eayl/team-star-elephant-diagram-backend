import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seedStock, seedSupplier } from '../prisma/suppliers.ts'

test('supplier seed respects Prisma field limits', () => {
  assert.ok(seedSupplier.name.length > 0 && seedSupplier.name.length <= 100)
  assert.ok(seedSupplier.email.length <= 100)
  assert.match(seedSupplier.email, /^[^@\s]+@[^@\s]+\.example\.com$/)
  assert.ok(seedSupplier.address.length > 0 && seedSupplier.address.length <= 255)
})

test('seeded stock starts in stock and above its reorder level', () => {
  assert.ok(Number.isInteger(seedStock.quantity) && seedStock.quantity > seedStock.reorderLevel)
  assert.ok(seedStock.quantity <= seedStock.maximumQuantity)
})
