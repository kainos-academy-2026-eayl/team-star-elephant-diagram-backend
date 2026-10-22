import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductService } from '../src/services/productService.ts'

test('getProducts calls the repository once and returns its products unchanged', async () => {
  const products = [{ id: 1, name: 'Example product' }]
  let calls = 0
  const service = new ProductService({
    async findAll() {
      calls += 1
      return products
    },
  })

  assert.equal(await service.getProducts(), products)
  assert.equal(calls, 1)
})

test('getProducts returns an empty catalogue from the repository', async () => {
  const service = new ProductService({
    async findAll() {
      return []
    },
  })

  assert.deepEqual(await service.getProducts(), [])
})

test('getProducts propagates repository errors to the controller', async () => {
  const error = new Error('Database unavailable')
  const service = new ProductService({
    async findAll() {
      throw error
    },
  })

  await assert.rejects(service.getProducts(), (actual) => actual === error)
})
