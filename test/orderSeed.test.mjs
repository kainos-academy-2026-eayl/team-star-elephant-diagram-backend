import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { orders, seedOrders } from '../prisma/orders.ts';
import { products } from '../prisma/products.ts';

const statuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

test('order samples cover five customers and all statuses, with stable unique dates', () => {
    assert.equal(orders.length, 25);
    const emails = new Set(orders.map((order) => order.customerEmail));
    assert.equal(emails.size, 5);
    assert.equal(new Set(orders.map((order) => `${order.customerEmail}/${order.orderPlacedAt.toISOString()}`)).size, 25);
    for (const email of emails) {
        assert.deepEqual(orders.filter((order) => order.customerEmail === email).map((order) => order.orderStatus), statuses);
    }
    for (const order of orders) {
        assert.ok(order.orderPlacedAt >= new Date('2026-10-01T00:00:00Z'));
        assert.ok(order.orderPlacedAt < new Date('2026-10-26T00:00:00Z'));
        assert.ok(order.modifiedAt >= order.orderPlacedAt);
    }
});

test('order samples contain 40 valid product lines without duplicate composite keys', () => {
    assert.equal(orders.flatMap((order) => order.items).length, 40);
    for (const order of orders) {
        assert.ok(order.items.length >= 1 && order.items.length <= 3);
        assert.equal(new Set(order.items.map((item) => item.productName)).size, order.items.length);
        for (const item of order.items) {
            assert.ok(products.some((product) => product.name === item.productName));
            assert.ok(Number.isInteger(item.quantity) && item.quantity > 0);
        }
    }
});

test('order samples only use products with local merchandise images', () => {
    for (const item of orders.flatMap((order) => order.items)) {
        const product = products.find((candidate) => candidate.name === item.productName);
        assert.ok(product, item.productName);
        assert.match(product.imageURL, /^\/images\/[^/]+\.(png|jpg)$/);
        assert.ok(product.images.length > 0);
        for (const image of product.images) {
            assert.match(image, /^\/images\/[^/]+\.(png|jpg)$/);
        }
    }
});

function database() {
    const users = [...new Set(orders.map((order) => order.customerEmail))]
        .map((email, index) => ({ email, userId: 100 + index }));
    const productRows = products.map((product, index) => ({
        name: product.name,
        productId: 200 + index,
        price: new Prisma.Decimal(product.price),
    }));
    const saved = [];
    let transactions = 0;
    const tx = {
        user: { findMany: async () => users },
        product: { findMany: async () => productRows },
        order: {
            findFirst: async ({ where }) => saved.find((order) =>
                order.userId === where.userId && order.orderPlacedAt.getTime() === where.orderPlacedAt.getTime()),
            create: async ({ data }) => {
                const order = { ...data, orderId: saved.length + 500 };
                saved.push(order);
                return order;
            },
        },
    };
    return {
        users,
        productRows,
        saved,
        prisma: {
            $transaction: async (callback) => {
                transactions++;
                const before = saved.length;
                try {
                    return await callback(tx);
                } catch (error) {
                    saved.splice(before);
                    throw error;
                }
            },
        },
        get transactions() { return transactions; },
    };
}

test('order seed resolves database IDs and computes exact totals for nested order items', async () => {
    const db = database();
    assert.equal(await seedOrders(db.prisma), 25);
    assert.equal(db.transactions, 1);
    assert.equal(db.saved.length, 25);
    assert.equal(db.saved.flatMap((order) => order.orderItems.create).length, 40);
    for (const [index, order] of db.saved.entries()) {
        const fixture = orders[index];
        assert.equal(order.userId, db.users.find((user) => user.email === fixture.customerEmail).userId);
        assert.equal(order.orderStatus, fixture.orderStatus);
        assert.equal(order.orderPlacedAt, fixture.orderPlacedAt);
        assert.equal(order.modifiedAt, fixture.modifiedAt);
        const expectedTotal = fixture.items.reduce((total, item) => {
            const product = db.productRows.find((row) => row.name === item.productName);
            return total.plus(product.price.mul(item.quantity));
        }, new Prisma.Decimal(0));
        assert.ok(order.cost.equals(expectedTotal));
        assert.deepEqual(order.orderItems.create, fixture.items.map((item) => ({
            productId: db.productRows.find((product) => product.name === item.productName).productId,
            quantity: item.quantity,
        })));
    }
});

test('rerunning the order seed does not duplicate samples or reset edited statuses', async () => {
    const db = database();
    await seedOrders(db.prisma);
    db.saved[0].orderStatus = 'SHIPPED';
    const before = structuredClone(db.saved.map(({ cost, ...order }) => ({ ...order, cost: cost.toString() })));
    assert.equal(await seedOrders(db.prisma), 0);
    assert.deepEqual(db.saved.map(({ cost, ...order }) => ({ ...order, cost: cost.toString() })), before);
});

test('a missing customer aborts the transaction instead of leaving partial orders', async () => {
    const db = database();
    db.users.splice(1, 1);
    await assert.rejects(seedOrders(db.prisma), /customer oliver.hughes@example.com is missing/);
    assert.equal(db.saved.length, 0);
});

test('a missing product aborts the transaction instead of leaving partial orders', async () => {
    const db = database();
    const index = db.productRows.findIndex((product) => product.name === 'Star Elephant Two-Tone Mug');
    db.productRows.splice(index, 1);
    await assert.rejects(seedOrders(db.prisma), /product Star Elephant Two-Tone Mug is missing/);
    assert.equal(db.saved.length, 0);
});
