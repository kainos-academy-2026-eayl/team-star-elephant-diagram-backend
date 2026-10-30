import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInMemoryBasketRepository } from '../src/repositories/basketRepository.ts';

test('in-memory baskets expire and capacity evicts the earliest-expiring basket', async () => {
    let currentTime = 0;
    const baskets = createInMemoryBasketRepository({
        maxBaskets: 2,
        ttlMs: 100,
        now: () => currentTime,
    });

    assert.equal(await baskets.addQuantity('expired', 1, 1, 99), true);
    currentTime = 101;
    assert.deepEqual([...await baskets.getItems('expired')], []);

    assert.equal(await baskets.addQuantity('oldest', 1, 1, 99), true);
    currentTime = 102;
    assert.equal(await baskets.addQuantity('newer', 1, 1, 99), true);
    currentTime = 103;
    assert.equal(await baskets.addQuantity('newest', 1, 1, 99), true);

    assert.deepEqual([...await baskets.getItems('oldest')], []);
    assert.deepEqual([...await baskets.getItems('newer')], [[1, 1]]);
    assert.deepEqual([...await baskets.getItems('newest')], [[1, 1]]);
});

test('concurrent quantity additions are atomic and enforce the item limit', async () => {
    const baskets = createInMemoryBasketRepository();

    const results = await Promise.all(
        Array.from({ length: 100 }, () => baskets.addQuantity('basket', 1, 1, 99)),
    );

    assert.equal(results.filter(Boolean).length, 99);
    assert.equal((await baskets.getItems('basket')).get(1), 99);
});
