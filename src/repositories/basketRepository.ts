import type { Prisma, PrismaClient } from '@prisma/client';

export interface BasketRecord {
    basketId: number;
    userId: number;
    createdAt: Date;
    updatedAt: Date;
    customer: { forename: string; surname: string; email: string };
    // productId -> quantity
    items: ReadonlyMap<number, number>;
}

export interface BasketListResult {
    baskets: BasketRecord[];
    total: number;
}

export interface BasketRepository {
    // Returns productId -> quantity for the basket.
    getItems(basketId: string): Promise<ReadonlyMap<number, number>>;
    addQuantity(basketId: string, productId: number, quantity: number, maxQuantity: number): Promise<boolean>;
    list(search: string | undefined, skip: number, take: number): Promise<BasketListResult>;
    findByBasketId(basketId: number): Promise<BasketRecord | null>;
}

const basketRecordInclude = {
    user: { select: { forename: true, surname: true, email: true } },
    items: { select: { productId: true, quantity: true } },
} as const;

type BasketRow = Prisma.BasketGetPayload<{ include: typeof basketRecordInclude }>;

const toBasketRecord = (row: BasketRow): BasketRecord => ({
    basketId: row.basketId,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customer: row.user,
    items: new Map(row.items.map((item) => [item.productId, item.quantity])),
});

// Every whitespace-separated term must match the basket ID, customer forename, surname or email.
function basketSearchFilter(search: string | undefined): Prisma.BasketWhereInput {
    const terms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
    return {
        AND: terms.map((term) => {
            const parsedId = /^\d{1,10}$/.test(term) ? Number(term) : null;
            const id = parsedId !== null && parsedId <= 2_147_483_647 ? parsedId : null;
            return {
                OR: [
                    ...(id === null ? [] : [{ basketId: id }]),
                    { user: { forename: { contains: term, mode: 'insensitive' } } },
                    { user: { surname: { contains: term, mode: 'insensitive' } } },
                    { user: { email: { contains: term, mode: 'insensitive' } } },
                ],
            };
        }),
    };
}

// Database-backed baskets using Prisma.
export function createDatabaseBasketRepository(prisma: PrismaClient): BasketRepository {
    return {
        async list(search, skip, take) {
            const where = basketSearchFilter(search);
            const [rows, total] = await prisma.$transaction([
                prisma.basket.findMany({
                    where,
                    include: basketRecordInclude,
                    orderBy: [{ updatedAt: 'desc' }, { basketId: 'desc' }],
                    skip,
                    take,
                }),
                prisma.basket.count({ where }),
            ]);
            return { baskets: rows.map(toBasketRecord), total };
        },

        async findByBasketId(basketId) {
            const row = await prisma.basket.findUnique({ where: { basketId }, include: basketRecordInclude });
            return row ? toBasketRecord(row) : null;
        },

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

            return prisma.$transaction(async (tx) => {
                let basket = await tx.basket.findUnique({
                    where: { userId },
                });

                if (!basket) {
                    basket = await tx.basket.create({
                        data: { userId },
                    });
                }

                const existingItem = await tx.basketItem.findUnique({
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
                    await tx.basketItem.update({
                        where: {
                            basketId_productId: {
                                basketId: basket.basketId,
                                productId,
                            },
                        },
                        data: { quantity: newQuantity },
                    });
                } else {
                    await tx.basketItem.create({
                        data: {
                            basketId: basket.basketId,
                            productId,
                            quantity: newQuantity,
                        },
                    });
                }

                await tx.basket.update({
                    where: { basketId: basket.basketId },
                    data: { updatedAt: new Date() },
                });

                return true;
            });
        },
    };
}
