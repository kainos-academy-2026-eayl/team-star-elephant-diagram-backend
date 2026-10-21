import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, beforeEach, test } from 'node:test'
import express from 'express'
import { createProductCatalogueRouter } from '../src/controllers/productCatalogueController.ts'
import { ProductCatalogueService } from '../src/services/productCatalogueService.ts'

let server
let baseUrl
let products
let serviceError

before(async () => {
  const app = express()
  app.use('/product_catalouge', createProductCatalogueRouter(new ProductCatalogueService({
    async findAll() {
      if (serviceError) throw serviceError
      return products
    },
  })))
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve())
}))

beforeEach(() => {
  products = []
  serviceError = undefined
})

test('GET /product_catalouge returns the products from the service', async () => {
  products = [{ id: 1, name: 'Example product' }]

  const response = await fetch(`${baseUrl}/product_catalouge`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), products)
})

test('GET /product_catalouge returns an empty array for an empty catalogue', async () => {
  const response = await fetch(`${baseUrl}/product_catalouge`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [])
})

test('GET /product_catalouge logs service errors and returns a generic 500 response', async (t) => {
  serviceError = new Error('Database unavailable')
  const log = t.mock.method(console, 'error', () => {})

  const response = await fetch(`${baseUrl}/product_catalouge`)

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Internal server error' })
  assert.equal(log.mock.callCount(), 1)
  assert.deepEqual(log.mock.calls[0].arguments, ['Product catalogue retrieval failed', serviceError])
})
