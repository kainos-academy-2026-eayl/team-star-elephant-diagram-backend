import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.ts';
import prisma from '../src/prismaClient.ts';
import { productRepository } from '../src/repositories/productRepository.ts';
import './helpers/authEnvironment.mjs';
import { generateCustomerAccessToken } from './helpers/tokenGenerator.mjs';
import { ProductService } from '../src/services/productService.ts';
import { TokenService } from '../src/services/tokenService.ts';

const catalogue = [
  { productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop', price: 349.99, imageURL: 'https://example.com/1.jpg', inventory: { quantity: 5 } },
  { productId: 2, name: 'CoreBook 15 Everyday', category: 'Laptops', description: 'Laptop', price: 549.99, imageURL: 'https://example.com/2.jpg', inventory: { quantity: 0 } },
  { productId: 3, name: 'AirLite 13 Ultrabook', category: 'Laptops', description: 'Laptop', price: 849.99, imageURL: 'https://example.com/3.jpg', inventory: { quantity: 2 } },
];

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security'

const tokens = new TokenService(
  'admin-access-secret-at-least-32-bytes',
  'refresh-secret-at-least-32-bytes-long',
  process.env.JWT_SECRET,
);
let customerToken;

let server;
let baseUrl;
let products;
let serviceError;
let repositoryError;
let baskets;

const basketRepository = {
  async getItems(basketId) {
    return baskets.get(basketId) ?? new Map();
  },
  async addQuantity(basketId, productId, quantity, maxQuantity) {
    const items = baskets.get(basketId) ?? new Map();
    const newQuantity = (items.get(productId) ?? 0) + quantity;
    if (newQuantity > maxQuantity) return false;
    items.set(productId, newQuantity);
    baskets.set(basketId, items);
    return true;
  },
};

before(async () => {
  customerToken = await tokens.signAccess({ kind: 'customer', userId: 1, email: 'ada@example.com' });
  const app = createApp({ tokenService: tokens, productRepository: {
    async findAll() {
      if (serviceError) throw serviceError;
      return products;
    },
    async findById(id) {
      if (repositoryError) throw repositoryError;
      return catalogue.find((product) => product.productId === id) ?? null;
    },
    async findByIds(ids) {
      if (repositoryError) throw repositoryError;
      return catalogue.filter((product) => ids.includes(product.productId));
    },
  }, basketRepository });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

beforeEach(() => {
  products = [];
  serviceError = undefined;
  repositoryError = undefined;
  baskets = new Map();
});

test('the default product repository reads stored products in ID order', async (t) => {
  const storedProducts = [{ productId: 1, name: 'Stored product', price: new Prisma.Decimal('12.99') }];
  const originalFindMany = prisma.product.findMany;
  const findMany = t.mock.fn(async () => storedProducts);
  prisma.product.findMany = findMany;
  t.after(() => { prisma.product.findMany = originalFindMany; });

  assert.deepEqual(await productRepository.findAll(), [{ productId: 1, name: 'Stored product', price: 12.99 }]);
  assert.deepEqual(findMany.mock.calls[0].arguments, [{ orderBy: { productId: 'asc' } }]);
});

test('GET /products returns the products from the service', async () => {
  products = [{ productId: 1, name: 'Example product' }];

  const response = await fetch(`${baseUrl}/products`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), products);
});

test('GET /products returns an empty array for an empty catalogue', async () => {
  const response = await fetch(`${baseUrl}/products`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test('GET /product_catalogue is no longer available', async () => {
  const response = await fetch(`${baseUrl}/product_catalogue`);

  assert.equal(response.status, 404);
});

test('GET /products logs service errors and returns a generic 500 response', async (t) => {
  serviceError = new Error('Database unavailable');
  const log = t.mock.method(console, 'error', () => { });

  const response = await fetch(`${baseUrl}/products`);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0].arguments, ['Product retrieval failed.', serviceError]);
});

test('findById loads the product with summed inventory, ordered images and prices in pounds', async (t) => {
  const originalFindUnique = prisma.product.findUnique;
  const findUnique = t.mock.fn(async () => ({
    productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop',
    price: new Prisma.Decimal('349.99'), imageURL: 'https://example.com/1.jpg',
    createdAt: new Date(), modifiedAt: new Date(),
    inventory: [{ quantity: 3 }, { quantity: 4 }],
    images: [
      { url: 'https://example.com/1-front.jpg', altText: 'Front' },
      { url: 'https://example.com/1-side.jpg', altText: null },
    ],
  }));
  prisma.product.findUnique = findUnique;
  t.after(() => { prisma.product.findUnique = originalFindUnique; });

  assert.deepEqual(await productRepository.findById(1), {
    productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop',
    price: 349.99, imageURL: 'https://example.com/1.jpg',
    images: [
      { url: 'https://example.com/1-front.jpg', altText: 'Front' },
      { url: 'https://example.com/1-side.jpg', altText: null },
    ],
    inventory: { quantity: 7 },
  });
  assert.deepEqual(findUnique.mock.calls[0].arguments, [{
    where: { productId: 1 },
    include: {
      inventory: { select: { quantity: true } },
      images: { orderBy: { position: 'asc' }, select: { url: true, altText: true } },
    },
  }]);
});

test('findById returns zero quantity when no inventory rows exist', async (t) => {
  const originalFindUnique = prisma.product.findUnique;
  prisma.product.findUnique = async () => ({ productId: 9, name: 'n', category: 'c', description: 'd', price: new Prisma.Decimal('1.00'), imageURL: '', inventory: [] });
  t.after(() => { prisma.product.findUnique = originalFindUnique; });

  assert.deepEqual((await productRepository.findById(9)).inventory, { quantity: 0 });
});

test('findById returns null for an unknown product', async (t) => {
  const originalFindUnique = prisma.product.findUnique;
  prisma.product.findUnique = async () => null;
  t.after(() => { prisma.product.findUnique = originalFindUnique; });

  assert.equal(await productRepository.findById(999), null);
});

test('ProductService.getProductById does not alter the price', async () => {
  const service = new ProductService({ async findById() { return catalogue[0]; } });
  assert.equal((await service.getProductById(1)).price, 349.99);
});

test('GET /products/:id returns a different product for each ID', async () => {
  for (const expected of catalogue) {
    const response = await fetch(`${baseUrl}/products/${expected.productId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
});

test('GET /products/:id returns 404 for an unknown product', async () => {
  const response = await fetch(`${baseUrl}/products/999`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Product not found' });
});

test('GET /products/:id returns 400 for an invalid ID', async () => {
  for (const id of ['abc', '0', '-1', '1.5']) {
    const response = await fetch(`${baseUrl}/products/${id}`);
    assert.equal(response.status, 400, id);
  }
});

test('GET /products/:id returns 500 on repository failure', async (t) => {
  repositoryError = new Error('Database unavailable');
  t.mock.method(console, 'error', () => { });
  const response = await fetch(`${baseUrl}/products/1`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
});

test('GET /products still returns the catalogue list', async () => {
  products = catalogue;
  const response = await fetch(`${baseUrl}/products`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 3);
});

async function addToBasket(body, cookie, token = customerToken) {
  return fetch(`${baseUrl}/basket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('POST /basket requires a logged-in customer', async () => {
  const anonymous = await addToBasket({ productId: 1, quantity: 1 }, undefined, null);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('set-cookie'), null);

  const invalid = await addToBasket({ productId: 1, quantity: 1 }, undefined, 'not-a-token');
  assert.equal(invalid.status, 401);

  const adminToken = await tokens.signAccessToken({ adminId: 1, role: 'SuperAdmin' });
  const admin = await addToBasket({ productId: 1, quantity: 1 }, undefined, adminToken);
  assert.equal(admin.status, 401);
});

test('POST /basket adds items and accumulates quantity', async () => {
  const token = customerToken;
  const first = await addToBasket({ productId: '1', quantity: '2' });
  assert.equal(first.status, 200);

  const second = await addToBasket({ productId: 1, quantity: 1 }, undefined, customerToken);
  await addToBasket({ productId: 3 }, undefined, customerToken);
  assert.equal(second.status, 200);

  const response = await fetch(`${baseUrl}/basket`, { 
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.deepEqual(await response.json(), {
    items: [
      { productId: 1, productName: 'CoreBook 14 Essential', quantity: 3, unitPrice: 349.99, imageURL: 'https://example.com/1.jpg' },
      { productId: 3, productName: 'AirLite 13 Ultrabook', quantity: 1, unitPrice: 849.99, imageURL: 'https://example.com/3.jpg' },
    ],
    subtotal: 1899.96,
    userId: 1,
  });
});

test('POST /basket returns 404 for an unknown product', async () => {
  const token = await generateCustomerAccessToken(1, 'test@example.com');
  const response = await addToBasket({ productId: 999, quantity: 1 }, token);
  assert.equal(response.status, 404);
});

test('POST /basket rejects invalid quantities', async () => {
  const token = await generateCustomerAccessToken(1, 'test@example.com');
  for (const quantity of [0, -1, 1.5, 100, 'abc']) {
    const response = await addToBasket({ productId: 1, quantity }, token);
    assert.equal(response.status, 400, String(quantity));
  }
});

test('POST /basket rejects quantities that exceed the per-item limit when combined', async () => {
  const token = await generateCustomerAccessToken(1, 'test@example.com');
  const first = await addToBasket({ productId: 1, quantity: 50 }, token);
  assert.equal(first.status, 200);
  const response = await addToBasket({ productId: 1, quantity: 50 }, token);
  assert.equal(response.status, 400);
});

test('GET /basket returns 401 without authentication', async () => {
  const response = await fetch(`${baseUrl}/basket`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
});
