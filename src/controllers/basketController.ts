import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { BasketItemNotFoundError, BasketQuantityError, type BasketService } from '../services/basketService';
import { ProductNotFoundError } from '../services/productService';
import type { TokenService } from '../services/tokenService';
import { addToBasketSchema, basketItemParamsSchema, updateBasketItemSchema } from '../validators/basketSchema';

function extractAccessToken(req: Request): string | undefined {
    const header = req.get('authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/);
    return match?.[1];
}

export function createBasketRouter(basketService: BasketService, tokens: TokenService): Router {
    const router = Router();

    async function requireCustomerAuth(req: Request, res: Response): Promise<number | null> {
        const token = extractAccessToken(req);
        if (!token) {
            res.status(401).json({ error: 'Authentication required' });
            return null;
        }

        const payload = await tokens.verifyCustomerAccessToken(token);
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

    router.patch('/items/:productId', async (req: Request, res: Response) => {
        const userId = await requireCustomerAuth(req, res);
        if (userId === null) return;

        const params = basketItemParamsSchema.safeParse(req.params);
        const body = updateBasketItemSchema.safeParse(req.body ?? {});
        if (!params.success || !body.success) {
            res.status(400).json({
                error: 'Invalid basket item',
                details: {
                    ...(params.success ? {} : z.flattenError(params.error).fieldErrors),
                    ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
                },
            });
            return;
        }

        try {
            res.status(200).json(await basketService.updateItemQuantity(userId, params.data.productId, body.data.quantity));
        } catch (error) {
            if (error instanceof BasketItemNotFoundError) {
                res.status(404).json({ error: 'Item not found in basket' });
                return;
            }
            if (error instanceof BasketQuantityError) {
                res.status(400).json({ error: error.message });
                return;
            }
            console.error('Basket quantity update failed.', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.delete('/items/:productId', async (req: Request, res: Response) => {
        const userId = await requireCustomerAuth(req, res);
        if (userId === null) return;

        const params = basketItemParamsSchema.safeParse(req.params);
        if (!params.success) {
            res.status(400).json({ error: 'Invalid basket item', details: z.flattenError(params.error).fieldErrors });
            return;
        }

        try {
            res.status(200).json(await basketService.removeItem(userId, params.data.productId));
        } catch (error) {
            if (error instanceof BasketItemNotFoundError) {
                res.status(404).json({ error: 'Item not found in basket' });
                return;
            }
            console.error('Basket item removal failed.', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
