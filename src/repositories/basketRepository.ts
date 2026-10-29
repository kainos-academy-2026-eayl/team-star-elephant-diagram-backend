export interface BasketRepository {
    // Returns productId -> quantity for the basket.
    getItems(basketId: string): Promise<ReadonlyMap<number, number>>;
    setQuantity(basketId: string, productId: number, quantity: number): Promise<void>;
}

// Session-scoped baskets held in memory; contents are lost on restart.
export function createInMemoryBasketRepository(): BasketRepository {
    const baskets = new Map<string, Map<number, number>>();

    return {
        async getItems(basketId) {
            return new Map(baskets.get(basketId));
        },

        async setQuantity(basketId, productId, quantity) {
            const items = baskets.get(basketId) ?? new Map<number, number>();
            items.set(productId, quantity);
            baskets.set(basketId, items);
        },
    };
}
