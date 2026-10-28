import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.ts';
import prisma from '../src/prismaClient.ts';
import { productRepository } from '../src/repositories/productRepository.ts';

let server;
let baseUrl;
let products;
let serviceError;

before(async () => {
  const app = createApp({ productRepository: {
    async findAll() {
      if (serviceError) throw serviceError;
      return products;
    },
  } });
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
