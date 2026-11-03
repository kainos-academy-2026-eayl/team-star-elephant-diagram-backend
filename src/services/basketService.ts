import type { Basket, BasketItem } from '../models/basket';
import type { BasketRecord, BasketRepository } from '../repositories/basketRepository';
import type { ProductRepository } from '../repositories/productRepository';
import { MAX_ITEM_QUANTITY } from '../validators/basketSchema';
import { ProductNotFoundError } from './productService';

export class BasketQuantityError extends Error { }

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

    async addItem(userId: number, productId: number, quantity: number): Promise<Basket> {
        const product = await this.products.findById(productId);
        if (!product) {
            throw new ProductNotFoundError(productId);
        }

        const quantityAdded = await this.baskets.addQuantity(String(userId), productId, quantity, MAX_ITEM_QUANTITY);
        if (!quantityAdded) {
            throw new BasketQuantityError(`Quantity cannot exceed ${MAX_ITEM_QUANTITY}`);
        }

        return this.getBasket(userId);
    }

    async getBasket(userId: number): Promise<Basket> {
        const quantities = await this.baskets.getItems(String(userId));
        const { items, subtotal } = this.priceItems(quantities, await this.loadProducts([quantities]));
        return { userId, items, subtotal };
    }

    async listBaskets(search?: string): Promise<PricedBasketRecord[]> {
        const records = await this.baskets.list(search);
        const products = await this.loadProducts(records.map((record) => record.items));
        return records.map((record) => this.priceRecord(record, products));
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
