export interface BasketRepository {
    // Returns productId -> quantity for the basket.
    getItems(basketId: string): Promise<ReadonlyMap<number, number>>;
    addQuantity(basketId: string, productId: number, quantity: number, maxQuantity: number): Promise<boolean>;
}

// Session-scoped baskets held in memory; contents are lost on restart.
export function createInMemoryBasketRepository({
    maxBaskets = 10_000,
    ttlMs = 7 * 24 * 60 * 60 * 1000,
    now = Date.now,
}: {
    maxBaskets?: number;
    ttlMs?: number;
    now?: () => number;
} = {}): BasketRepository {
    if (!Number.isSafeInteger(maxBaskets) || maxBaskets < 1) {
        throw new RangeError('maxBaskets must be a positive safe integer');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new RangeError('ttlMs must be a positive finite number');
    }

    const baskets = new Map<string, { items: Map<number, number>; expiresAt: number }>();

    function removeExpiredBaskets(currentTime: number): void {
        for (const [basketId, basket] of baskets) {
            if (basket.expiresAt <= currentTime) {
                baskets.delete(basketId);
            }
        }
    }

    function evictOldestBasket(): void {
        let oldestBasketId: string | undefined;
        let oldestExpiration = Number.POSITIVE_INFINITY;
        for (const [basketId, basket] of baskets) {
            if (basket.expiresAt < oldestExpiration) {
                oldestBasketId = basketId;
                oldestExpiration = basket.expiresAt;
            }
        }
        if (oldestBasketId !== undefined) {
            baskets.delete(oldestBasketId);
        }
    }

    return {
        async getItems(basketId) {
            const currentTime = now();
            removeExpiredBaskets(currentTime);
            return new Map(baskets.get(basketId)?.items);
        },

        async addQuantity(basketId, productId, quantity, maxQuantity) {
            const currentTime = now();
            removeExpiredBaskets(currentTime);
            const basket = baskets.get(basketId);
            const items = basket?.items ?? new Map<number, number>();
            const newQuantity = (items.get(productId) ?? 0) + quantity;

            if (newQuantity > maxQuantity) {
                return false;
            }

            items.set(productId, newQuantity);
            if (!basket) {
                if (baskets.size >= maxBaskets) {
                    evictOldestBasket();
                }
                baskets.set(basketId, { items, expiresAt: currentTime + ttlMs });
            }
            return true;
        },
    };
}
