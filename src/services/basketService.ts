import type { Basket, BasketItem } from '../models/basket';
import type { BasketRecord, BasketRepository } from '../repositories/basketRepository';
import type { ProductRepository } from '../repositories/productRepository';
import { MAX_ITEM_QUANTITY } from '../validators/basketSchema';
import { ProductNotFoundError } from './productService';

export class BasketQuantityError extends Error { }

export class BasketItemNotFoundError extends Error {
    constructor(productId: number) {
        super(`Product ${productId} is not in the basket`);
    }
}

type BasketProduct = Awaited<ReturnType<ProductRepository['findByIds']>>[number];

export interface PricedBasketRecord extends Omit<BasketRecord, 'items'> {
    items: BasketItem[];
    itemCount: number;
    subtotal: number;
}

export class BasketService {
    constructor(
        private readonly products: ProductRepository,
        private readonly baskets: BasketRepository,
    ) { }

    // maxQuantity lets admin callers cap the line at available stock; it can never exceed MAX_ITEM_QUANTITY.
    async addItem(userId: number, productId: number, quantity: number, maxQuantity = MAX_ITEM_QUANTITY): Promise<Basket> {
        const product = await this.products.findById(productId);
        if (!product) {
            throw new ProductNotFoundError(productId);
        }

        const limit = Math.min(maxQuantity, MAX_ITEM_QUANTITY);
        const quantityAdded = await this.baskets.addQuantity(String(userId), productId, quantity, limit);
        if (!quantityAdded) {
            throw new BasketQuantityError(`Quantity cannot exceed ${limit}`);
        }

        return this.getBasket(userId);
    }

    async updateItemQuantity(
        userId: number,
        productId: number,
        quantity: number,
        maxQuantity = MAX_ITEM_QUANTITY,
    ): Promise<Basket> {
        const limit = Math.min(maxQuantity, MAX_ITEM_QUANTITY);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > limit) {
            throw new BasketQuantityError(
                limit < 1 ? 'This product is out of stock' : `Quantity must be between 1 and ${limit}`,
            );
        }
        if (!(await this.baskets.setQuantity(String(userId), productId, quantity))) {
            throw new BasketItemNotFoundError(productId);
        }
        return this.getBasket(userId);
    }

    async removeItem(userId: number, productId: number): Promise<Basket> {
        if (!(await this.baskets.removeItem(String(userId), productId))) {
            throw new BasketItemNotFoundError(productId);
        }
        return this.getBasket(userId);
    }

    async createBasket(userId: number): Promise<{ basketId: number; created: boolean }> {
        return this.baskets.createForUser(userId);
    }

    async clearBasket(basketId: number): Promise<boolean> {
        return this.baskets.clear(basketId);
    }

    async deleteBasket(basketId: number): Promise<boolean> {
        return this.baskets.delete(basketId);
    }

    async getBasket(userId: number): Promise<Basket> {
        const quantities = await this.baskets.getItems(String(userId));
        const { items, subtotal } = this.priceItems(quantities, await this.loadProducts([quantities]));
        return { userId, items, subtotal };
    }

    async listBaskets(search: string | undefined, page: number): Promise<{ baskets: PricedBasketRecord[]; total: number }> {
        const pageSize = 20;
        const { baskets: records, total } = await this.baskets.list(search, (page - 1) * pageSize, pageSize);
        const products = await this.loadProducts(records.map((record) => record.items));
        return { baskets: records.map((record) => this.priceRecord(record, products)), total };
    }

    async getBasketById(basketId: number): Promise<PricedBasketRecord | null> {
        const record = await this.baskets.findByBasketId(basketId);
        if (!record) return null;
        return this.priceRecord(record, await this.loadProducts([record.items]));
    }

    // Prices are re-read from the database so baskets always reflect current values.
    private async loadProducts(baskets: ReadonlyMap<number, number>[]): Promise<Map<number, BasketProduct>> {
        const productIds = [...new Set(baskets.flatMap((items) => [...items.keys()]))];
        const products = await this.products.findByIds(productIds);
        return new Map(products.map((product) => [product.productId, product]));
    }

    private priceItems(quantities: ReadonlyMap<number, number>, productsById: ReadonlyMap<number, BasketProduct>) {
        const items: BasketItem[] = [];
        for (const [productId, quantity] of quantities) {
            const product = productsById.get(productId);
            if (!product) continue;
            items.push({
                productId: product.productId,
                productName: product.name,
                quantity,
                unitPrice: product.price,
                imageURL: product.imageURL,
            });
        }

        const subtotal = Math.round(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
        return { items, subtotal };
    }

    private priceRecord(record: BasketRecord, productsById: ReadonlyMap<number, BasketProduct>): PricedBasketRecord {
        const { items, subtotal } = this.priceItems(record.items, productsById);
        return {
            ...record,
            items,
            itemCount: items.reduce((count, item) => count + item.quantity, 0),
            subtotal,
        };
    }
}
