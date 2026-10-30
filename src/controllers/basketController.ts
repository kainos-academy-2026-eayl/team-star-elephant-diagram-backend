import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { BasketQuantityError, type BasketService } from '../services/basketService';
import { ProductNotFoundError } from '../services/productService';
import { addToBasketSchema } from '../validators/basketSchema';

const BASKET_COOKIE = 'basketId';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readBasketId(req: Request): string | undefined {
    const header = req.get('cookie') ?? '';
    for (const part of header.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === BASKET_COOKIE) {
            const value = rest.join('=');
            return UUID_PATTERN.test(value) ? value : undefined;
        }
    }
    return undefined;
}

export function createBasketRouter(basketService: BasketService): Router {
    const router = Router();

    router.get('/', async (req: Request, res: Response) => {
        const basketId = readBasketId(req);
        if (!basketId) {
            res.status(200).json({ items: [], subtotal: 0 });
            return;
        }

        try {
            res.status(200).json(await basketService.getBasket(basketId));
        } catch (error) {
            console.error('Basket retrieval failed.', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/', async (req: Request, res: Response) => {
        const parsed = addToBasketSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid basket item', details: z.flattenError(parsed.error).fieldErrors });
            return;
        }

        const existingId = readBasketId(req);
        const basketId = existingId ?? randomUUID();

        try {
            const basket = await basketService.addItem(basketId, parsed.data.productId, parsed.data.quantity);
            if (!existingId) {
                res.cookie(BASKET_COOKIE, basketId, {
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: process.env.NODE_ENV === 'production',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                });
            }
            res.status(200).json(basket);
        } catch (error) {
            if (error instanceof ProductNotFoundError) {
                res.status(404).json({ error: 'Product not found' });
                return;
            }
            if (error instanceof BasketQuantityError) {
                res.status(400).json({ error: error.message });
                return;
            }
            console.error('Add to basket failed.', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
