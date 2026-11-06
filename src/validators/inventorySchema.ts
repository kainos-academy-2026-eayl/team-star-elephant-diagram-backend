import { z } from 'zod';
import { StockStatus } from '@prisma/client';
import { createProductSchema } from './productSchema';

export const MAX_STOCK = 2_147_483_647;
export const RECENT_ADJUSTMENTS_LIMIT = 20;

const stockInteger = z.number().int().min(-MAX_STOCK).max(MAX_STOCK);
export const stockAdjustmentSchema = z.strictObject({
	adjustment: stockInteger,
	reason: z.string().trim().min(3).max(255).refine((value) => [...value].length >= 3),
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
	sort: z.enum(['productId', 'name', 'sku', 'price', 'stockQuantity', 'lowStockThreshold', 'stockStatus']).optional(),
	direction: z.enum(['asc', 'desc']).optional(),
});

const inventoryProductSchema = createProductSchema.extend({
	imageURL: z.string().trim().min(1).max(255).pipe(z.union([
		z.url({ protocol: /^https?$/ }), z.string().regex(/^\/images\/[A-Za-z0-9_./-]+$/),
	])),
});
export const inventoryCreateSchema = inventoryProductSchema.extend({
	sku: z.string().trim().min(1).max(64),
	stockQuantity: stockInteger.nonnegative(),
	lowStockThreshold: stockInteger.nonnegative(),
	supplierId: z.number().int().positive().max(MAX_STOCK),
}).strict();
export const inventoryUpdateSchema = inventoryProductSchema.extend({
	stockQuantity: stockInteger.nonnegative(),
	lowStockThreshold: stockInteger.nonnegative(),
	reason: z.string().trim().min(3).max(255),
}).strict();

export type InventoryCreateInput = z.infer<typeof inventoryCreateSchema>;
export type InventoryUpdateInput = z.infer<typeof inventoryUpdateSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type ThresholdInput = z.infer<typeof thresholdSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type InventoryPagination = z.infer<typeof inventoryPaginationSchema>;
