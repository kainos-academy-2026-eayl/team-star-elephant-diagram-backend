import type { Basket, BasketItem } from '../models/basket';
import type { BasketRepository } from '../repositories/basketRepository';
import type { ProductRepository } from '../repositories/productRepository';
import { MAX_ITEM_QUANTITY } from '../validators/basketSchema';
import { ProductNotFoundError } from './productService';

export class BasketQuantityError extends Error { }

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
        const items: BasketItem[] = [];
        const quantities = await this.baskets.getItems(String(userId));
        // Prices are re-read from the database so the basket always reflects current values.
        const products = await this.products.findByIds([...quantities.keys()]);
        const productsById = new Map(products.map((product) => [product.productId, product]));

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
        return { userId, items, subtotal };
    }
}
