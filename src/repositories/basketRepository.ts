import type { PrismaClient } from '@prisma/client';

export interface BasketRepository {
    // Returns productId -> quantity for the basket.
    getItems(basketId: string): Promise<ReadonlyMap<number, number>>;
    addQuantity(basketId: string, productId: number, quantity: number, maxQuantity: number): Promise<boolean>;
}

// Database-backed baskets using Prisma.
export function createDatabaseBasketRepository(prisma: PrismaClient): BasketRepository {
    return {
        async getItems(basketId) {
            const userId = parseInt(basketId, 10);
            if (!Number.isSafeInteger(userId) || userId <= 0) {
                return new Map();
            }

            const basketItems = await prisma.basketItem.findMany({
                where: {
                    basket: {
                        userId,
                    },
                },
            });

            const items = new Map<number, number>();
            for (const item of basketItems) {
                items.set(item.productId, item.quantity);
            }
            return items;
        },

        async addQuantity(basketId, productId, quantity, maxQuantity) {
            const userId = parseInt(basketId, 10);
            if (!Number.isSafeInteger(userId) || userId <= 0) {
                return false;
            }

            // Get or create basket for user
            let basket = await prisma.basket.findUnique({
                where: { userId },
            });

            if (!basket) {
                basket = await prisma.basket.create({
                    data: { userId },
                });
            }

            // Get current quantity for this product in the basket
            const existingItem = await prisma.basketItem.findUnique({
                where: {
                    basketId_productId: {
                        basketId: basket.basketId,
                        productId,
                    },
                },
            });

            const currentQuantity = existingItem?.quantity ?? 0;
            const newQuantity = currentQuantity + quantity;

            if (newQuantity > maxQuantity) {
                return false;
            }

            if (existingItem) {
                await prisma.basketItem.update({
                    where: {
                        basketId_productId: {
                            basketId: basket.basketId,
                            productId,
                        },
                    },
                    data: { quantity: newQuantity },
                });
            } else {
                await prisma.basketItem.create({
                    data: {
                        basketId: basket.basketId,
                        productId,
                        quantity: newQuantity,
                    },
                });
            }

            return true;
        },
    };
}
