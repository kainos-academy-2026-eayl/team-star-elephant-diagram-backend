import assert from 'node:assert/strict'
import { test } from 'node:test'
import { products } from '../prisma/products.ts'

const hardwareCategories = ['Laptops', 'Monitors', 'Keyboards', 'Mice', 'Headsets']
const isHardware = (product) => hardwareCategories.includes(product.category)

test('product seed contains 99 uniquely named hardware and merchandise products', () => {
  assert.equal(products.length, 99)
  assert.equal(new Set(products.map((product) => product.name)).size, 99)

  const counts = {}
  for (const product of products) {
    counts[product.category] = (counts[product.category] ?? 0) + 1
  }

  assert.deepEqual(counts, {
    Laptops: 11,
    Monitors: 10,
    Keyboards: 10,
    Mice: 10,
    Headsets: 10,
    'T-Shirts': 6,
    Hats: 5,
    Scarves: 1,
    Keyrings: 4,
    Socks: 2,
    Sliders: 1,
    Drinkware: 2,
    Accessories: 1,
    Bags: 2,
    Home: 10,
    Toys: 2,
    Pets: 11,
    Jumpers: 1,
  })
})

test('product seed respects Prisma field limits and uses positive GBP decimal prices', () => {
  for (const product of products) {
    assert.ok(product.name.length > 0 && product.name.length <= 100)
    assert.ok(product.category.length <= 100)
    assert.ok(product.description.length >= 100 && product.description.length <= 255, product.name)
    assert.match(product.price, /^\d{1,8}\.\d{2}$/)
    assert.ok(Number(product.price) > 0)
    assert.ok(product.imageURL.length <= 255)
  }
})

test('hardware products use Unsplash stock photography', () => {
  for (const product of products.filter(isHardware)) {
    const image = new URL(product.imageURL)
    assert.equal(image.protocol, 'https:')
    assert.equal(image.hostname, 'images.unsplash.com')
    assert.match(image.pathname, /^\/photo-/)
  }
})

test('merchandise products use local frontend images with the main image first', () => {
  const merchandise = products.filter((product) => !isHardware(product))
  const allImages = merchandise.flatMap((product) => product.images)

  assert.equal(allImages.length, 83)
  assert.equal(new Set(allImages).size, allImages.length)
  for (const product of merchandise) {
    assert.ok(product.images.length > 0, product.name)
    assert.equal(product.imageURL, product.images[0])
    for (const url of product.images) {
      assert.match(url, /^\/images\/[A-Za-z]+-[a-z]+(-[a-z]+)?-(front|back|left|right|detail)\.(png|jpg)$/)
    }
  }
})
