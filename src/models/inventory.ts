import type { Product, StockAdjustment } from '@prisma/client';

export interface PaginatedInventory<T> {
	items: T[];
	totalItems: number;
	totalPages: number;
	currentPage: number;
}

export type InventoryItem = Pick<Product,
	'productId' | 'name' | 'description' | 'sku' | 'stockQuantity' |
	'lowStockThreshold' | 'stockStatus' | 'createdAt' | 'modifiedAt'
>;

export interface InventoryDetails {
	product: InventoryItem;
	recentAdjustments: StockAdjustment[];
}
