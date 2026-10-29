import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.ts';
import prisma from '../src/prismaClient.ts';
import { productRepository } from '../src/repositories/productRepository.ts';
import { ExpandProductService } from '../src/services/expandProductService.ts';

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long-for-security';

const catalogue = [
    { productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop', price: 349.99, imageURL: 'https://example.com/1.jpg', inventory: { quantity: 5 } },
    { productId: 2, name: 'CoreBook 15 Everyday', category: 'Laptops', description: 'Laptop', price: 549.99, imageURL: 'https://example.com/2.jpg', inventory: { quantity: 0 } },
    { productId: 3, name: 'AirLite 13 Ultrabook', category: 'Laptops', description: 'Laptop', price: 849.99, imageURL: 'https://example.com/3.jpg', inventory: { quantity: 2 } },
];

let server;
let baseUrl;
let repositoryError;

before(async () => {
    const app = createApp({
        productRepository: {
            async findAll() { return catalogue; },
            async findById(id) {
                if (repositoryError) throw repositoryError;
                return catalogue.find((product) => product.productId === id) ?? null;
            },
            async findByIds(ids) { return catalogue.filter((product) => ids.includes(product.productId)); },
        }
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
}));

beforeEach(() => { repositoryError = undefined; });

test('findById loads the product with summed inventory and keeps prices in pounds', async (t) => {
    const originalFindUnique = prisma.product.findUnique;
    const findUnique = t.mock.fn(async () => ({
        productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop',
        price: new Prisma.Decimal('349.99'), imageURL: 'https://example.com/1.jpg',
        createdAt: new Date(), modifiedAt: new Date(),
        inventory: [{ quantity: 3 }, { quantity: 4 }],
    }));
    prisma.product.findUnique = findUnique;
    t.after(() => { prisma.product.findUnique = originalFindUnique; });

    assert.deepEqual(await productRepository.findById(1), {
        productId: 1, name: 'CoreBook 14 Essential', category: 'Laptops', description: 'Laptop',
        price: 349.99, imageURL: 'https://example.com/1.jpg', inventory: { quantity: 7 },
    });
    assert.deepEqual(findUnique.mock.calls[0].arguments, [{
        where: { productId: 1 },
        include: { inventory: { select: { quantity: true } } },
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

test('findByIds selects only basket display fields in one query', async (t) => {
    const originalFindMany = prisma.product.findMany;
    const findMany = t.mock.fn(async () => [
        { productId: 1, name: 'CoreBook 14 Essential', price: new Prisma.Decimal('349.99'), imageURL: 'https://example.com/1.jpg' },
        { productId: 3, name: 'AirLite 13 Ultrabook', price: new Prisma.Decimal('849.99'), imageURL: 'https://example.com/3.jpg' },
    ]);
    prisma.product.findMany = findMany;
    t.after(() => { prisma.product.findMany = originalFindMany; });

    assert.deepEqual(await productRepository.findByIds([1, 3]), [
        { productId: 1, name: 'CoreBook 14 Essential', price: 349.99, imageURL: 'https://example.com/1.jpg' },
        { productId: 3, name: 'AirLite 13 Ultrabook', price: 849.99, imageURL: 'https://example.com/3.jpg' },
    ]);
    assert.deepEqual(findMany.mock.calls[0].arguments, [{
        where: { productId: { in: [1, 3] } },
        select: { productId: true, name: true, price: true, imageURL: true },
    }]);
});

test('ExpandProductService does not alter the price', async () => {
    const service = new ExpandProductService({
        async findById() { return catalogue[0]; },
        async findByIds() { return []; },
    });
    assert.equal((await service.getProductExpanded(1)).price, 349.99);
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
    for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
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
    const response = await fetch(`${baseUrl}/products`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 3);
});

async function addToBasket(body, cookie) {
    return fetch(`${baseUrl}/basket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
    });
}

test('POST /basket adds items, sets a session cookie and accumulates quantity', async () => {
    const first = await addToBasket({ productId: '1', quantity: '2' });
    assert.equal(first.status, 200);
    const setCookie = first.headers.get('set-cookie');
    assert.match(setCookie, /basketId=[0-9a-f-]{36}/);
    assert.match(setCookie, /HttpOnly/);
    const cookie = setCookie.split(';')[0];

    const second = await addToBasket({ productId: 1, quantity: 1 }, cookie);
    await addToBasket({ productId: 3 }, cookie);
    assert.equal(second.status, 200);

    const response = await fetch(`${baseUrl}/basket`, { headers: { Cookie: cookie } });
    assert.deepEqual(await response.json(), {
        items: [
            { productId: 1, productName: 'CoreBook 14 Essential', quantity: 3, unitPrice: 349.99, imageURL: 'https://example.com/1.jpg' },
            { productId: 3, productName: 'AirLite 13 Ultrabook', quantity: 1, unitPrice: 849.99, imageURL: 'https://example.com/3.jpg' },
        ],
        subtotal: 1899.96,
    });
});

test('POST /basket returns 404 for an unknown product', async () => {
    const response = await addToBasket({ productId: 999, quantity: 1 });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('set-cookie'), null);
});

test('POST /basket rejects invalid quantities', async () => {
    for (const quantity of [0, -1, 1.5, 100, 'abc']) {
        const response = await addToBasket({ productId: 1, quantity });
        assert.equal(response.status, 400, String(quantity));
    }
});

test('POST /basket rejects product IDs outside the PostgreSQL Int range', async () => {
    const response = await addToBasket({ productId: 2147483648, quantity: 1 });
    assert.equal(response.status, 400);
});

test('POST /basket rejects quantities that exceed the per-item limit when combined', async () => {
    const first = await addToBasket({ productId: 2, quantity: 99 });
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const response = await addToBasket({ productId: 2, quantity: 1 }, cookie);
    assert.equal(response.status, 400);
});

test('GET /basket returns an empty basket without a session', async () => {
    const response = await fetch(`${baseUrl}/basket`);
    assert.deepEqual(await response.json(), { items: [], subtotal: 0 });
});
