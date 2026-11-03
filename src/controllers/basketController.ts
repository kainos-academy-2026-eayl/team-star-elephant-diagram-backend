import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { BasketQuantityError, type BasketService } from '../services/basketService';
import { ProductNotFoundError } from '../services/productService';
import { addToBasketSchema } from '../validators/basketSchema';
import type { TokenService } from '../services/tokenService';

function extractAccessToken(req: Request): string | undefined {
    const header = req.get('authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/);
    return match?.[1];
}

export function createBasketRouter(basketService: BasketService, tokenService: TokenService): Router {
    const router = Router();

    async function requireCustomerAuth(req: Request, res: Response): Promise<number | null> {
        const token = extractAccessToken(req);
        if (!token) {
            res.status(401).json({ error: 'Authentication required' });
            return null;
        }

        const payload = await tokenService.verifyCustomerAccessToken(token);
        if (!payload || typeof (payload as { userId?: unknown }).userId !== 'number') {
            res.status(401).json({ error: 'Invalid or expired token' });
            return null;
        }

        return (payload as { userId: number }).userId;
    }

    router.get('/', async (req: Request, res: Response) => {
        const userId = await requireCustomerAuth(req, res);
        if (userId === null) return;

        try {
            res.status(200).json(await basketService.getBasket(userId));
        } catch (error) {
            console.error('Basket retrieval failed.', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/', async (req: Request, res: Response) => {
        const userId = await requireCustomerAuth(req, res);
        if (userId === null) return;

        const parsed = addToBasketSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid basket item', details: z.flattenError(parsed.error).fieldErrors });
            return;
        }

        try {
            const basket = await basketService.addItem(userId, parsed.data.productId, parsed.data.quantity);
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
