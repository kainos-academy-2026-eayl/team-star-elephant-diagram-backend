import { z } from 'zod';

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Product ID must be a positive number'),
});

export type ProductIdParams = z.infer<typeof productIdParamSchema>;
