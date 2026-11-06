import type { Request, Response } from 'express';
import type { InventoryService } from '../services/inventoryService';
import type { InventoryCreateInput, InventoryUpdateInput, InventoryPagination, InventoryQuery, StockAdjustmentInput, ThresholdInput } from '../validators/inventorySchema';

export interface InventoryRequest {
	productId: number;
	query: InventoryQuery;
	pagination: InventoryPagination;
	adjustment: StockAdjustmentInput;
	threshold: ThresholdInput;
	create: InventoryCreateInput;
	update: InventoryUpdateInput;
}

declare module 'express-serve-static-core' {
	interface Locals {
		inventoryRequest?: Partial<InventoryRequest>;
	}
}

function validated<K extends keyof InventoryRequest>(res: Response, key: K): InventoryRequest[K] {
	const value = res.locals.inventoryRequest?.[key];
	if (value === undefined) throw new Error(`Missing validated inventory ${key}`);
	return value;
}

export class InventoryController {
	constructor(private readonly service: InventoryService) {}

	getSuppliers = async (_req: Request, res: Response): Promise<void> => {
		res.json({ suppliers: await this.service.getSuppliers() });
	};

	createProduct = async (_req: Request, res: Response): Promise<void> => {
		const admin = res.locals.currentAdmin;
		if (!admin) throw new Error('Missing authenticated inventory admin');
		res.status(201).json(await this.service.createProduct(validated(res, 'create'), admin.adminId));
	};

	updateProduct = async (_req: Request, res: Response): Promise<void> => {
		const admin = res.locals.currentAdmin;
		if (!admin) throw new Error('Missing authenticated inventory admin');
		res.json(await this.service.updateProduct(validated(res, 'productId'), validated(res, 'update'), admin.adminId));
	};

	deleteProduct = async (_req: Request, res: Response): Promise<void> => {
		await this.service.deleteProduct(validated(res, 'productId'));
		res.json({ deleted: true });
	};

	getInventory = async (_req: Request, res: Response): Promise<void> => {
		res.json(await this.service.getInventory(validated(res, 'query')));
	};

	getInventoryItem = async (_req: Request, res: Response): Promise<void> => {
		res.json(await this.service.getInventoryById(validated(res, 'productId')));
	};

	adjustStock = async (_req: Request, res: Response): Promise<void> => {
		const admin = res.locals.currentAdmin;
		if (!admin) throw new Error('Missing authenticated inventory admin');
		const { adjustment, reason, notes } = validated(res, 'adjustment');
		res.json(await this.service.adjustStock(validated(res, 'productId'), adjustment, reason, notes, admin.adminId));
	};

	updateThreshold = async (_req: Request, res: Response): Promise<void> => {
		res.json(await this.service.updateThreshold(validated(res, 'productId'), validated(res, 'threshold').lowStockThreshold));
	};

	getHistory = async (_req: Request, res: Response): Promise<void> => {
		res.json(await this.service.getAdjustmentHistory(validated(res, 'productId'), validated(res, 'pagination')));
	};
}
