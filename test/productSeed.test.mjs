import assert from 'node:assert/strict'
import { test } from 'node:test'
import { products } from '../prisma/products.ts'

test('product seed contains 50 uniquely named products, ten per category', () => {
  assert.equal(products.length, 50)
  assert.equal(new Set(products.map((product) => product.name)).size, 50)

  const counts = {}
  for (const product of products) {
    counts[product.category] = (counts[product.category] ?? 0) + 1
  }

  assert.deepEqual(counts, {
    Laptops: 10,
    Monitors: 10,
    Keyboards: 10,
    Mice: 10,
    Headsets: 10,
  })
})

test('product seed respects Prisma field limits and uses positive GBP decimal prices', () => {
  for (const product of products) {
    assert.ok(product.name.length > 0 && product.name.length <= 100)
    assert.ok(product.category.length <= 100)
    assert.ok(product.description.length >= 100 && product.description.length <= 255)
    assert.match(product.price, /^\d{1,8}\.\d{2}$/)
    assert.ok(Number(product.price) > 0)
    assert.ok(product.imageURL.length <= 255)

    const image = new URL(product.imageURL)
    assert.equal(image.protocol, 'https:')
    assert.equal(image.hostname, 'images.unsplash.com')
    assert.match(image.pathname, /^\/photo-/)
  }
})
