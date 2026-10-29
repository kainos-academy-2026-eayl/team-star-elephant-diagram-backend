import { z } from 'zod';

export const expandProductParamSchema = z.object({
  id: z.coerce.number().int().positive('Product ID must be a positive number').max(2_147_483_647),
});

export type ExpandProductParams = z.infer<typeof expandProductParamSchema>;

 