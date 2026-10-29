import { z } from 'zod';

export const MAX_ITEM_QUANTITY = 99;

export const addToBasketSchema = z.object({
    productId: z.coerce.number().int().positive('Product ID must be a positive number'),
    quantity: z.coerce
        .number()
        .int('Quantity must be a whole number')
        .min(1, 'Quantity must be at least 1')
        .max(MAX_ITEM_QUANTITY, `Quantity cannot exceed ${MAX_ITEM_QUANTITY}`)
        .default(1),
});

export type AddToBasketInput = z.infer<typeof addToBasketSchema>;
