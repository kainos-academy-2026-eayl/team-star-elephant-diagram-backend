import { z } from 'zod';
import { StockStatus } from '@prisma/client';

export const MAX_STOCK = 2_147_483_647;
export const RECENT_ADJUSTMENTS_LIMIT = 20;

const stockInteger = z.number().int().min(-MAX_STOCK).max(MAX_STOCK);
export const stockAdjustmentSchema = z.strictObject({
	adjustment: stockInteger,
	reason: z.string().trim().min(3).max(255),
	notes: z.string().optional(),
});
export const thresholdSchema = z.strictObject({
	lowStockThreshold: stockInteger.nonnegative(),
});
export const inventoryIdSchema = z.object({
	id: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().max(MAX_STOCK)),
});
export const inventoryPaginationSchema = z.object({
	page: z.coerce.number().int().positive().max(100_000).default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
});
export const inventoryQuerySchema = inventoryPaginationSchema.extend({
	search: z.string().trim().max(100).optional(),
	status: z.enum(StockStatus).optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type ThresholdInput = z.infer<typeof thresholdSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type InventoryPagination = z.infer<typeof inventoryPaginationSchema>;
