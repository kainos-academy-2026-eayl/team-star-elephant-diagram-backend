import { Prisma, type PrismaClient, StockStatus } from '@prisma/client';
import type { InventoryDetails, InventoryItem, PaginatedInventory } from '../models/inventory';
import {
	MAX_STOCK, RECENT_ADJUSTMENTS_LIMIT, inventoryIdSchema, inventoryPaginationSchema,
	inventoryQuerySchema, stockAdjustmentSchema, thresholdSchema,
	type InventoryPagination, type InventoryQuery,
} from '../validators/inventorySchema';

export class InventoryError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

const productSelect = {
	productId: true, name: true, description: true, sku: true, stockQuantity: true,
	lowStockThreshold: true, stockStatus: true, createdAt: true, modifiedAt: true,
} satisfies Prisma.ProductSelect;
const historyOrder = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.StockAdjustmentOrderByWithRelationInput[];
const TRANSACTION_ATTEMPTS = 3;

function paginate<T>(items: T[], totalItems: number, { page, limit }: InventoryPagination): PaginatedInventory<T> {
	return { items, totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page };
}

export class InventoryService {
	constructor(private readonly db: PrismaClient) {}

	calculateStockStatus(stock: number, threshold: number): StockStatus {
		if (stock === 0) return StockStatus.OUT_OF_STOCK;
		return stock <= threshold ? StockStatus.LOW_STOCK : StockStatus.IN_STOCK;
	}

	async getInventory(query: Partial<InventoryQuery> = {}): Promise<PaginatedInventory<InventoryItem>> {
		const options = inventoryQuerySchema.parse(query);
		const { search, status, page, limit } = options;
		const where: Prisma.ProductWhereInput = {
			...(status ? { stockStatus: status } : {}),
			...(search ? { OR: [
				{ name: { contains: search, mode: 'insensitive' } },
				{ sku: { contains: search, mode: 'insensitive' } },
			] } : {}),
		};
		return this.db.$transaction(async (tx) => {
			const total = await tx.product.count({ where });
			const items = await tx.product.findMany({
				where, select: productSelect, orderBy: { productId: 'asc' }, skip: (page - 1) * limit, take: limit,
			});
			return paginate(items, total, options);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	async getInventoryById(productId: number): Promise<InventoryDetails> {
		this.validateId(productId);
		return this.db.$transaction(async (tx) => {
			const product = await this.findProduct(tx, productId);
			const recentAdjustments = await tx.stockAdjustment.findMany({
				where: { productId }, orderBy: historyOrder, take: RECENT_ADJUSTMENTS_LIMIT,
			});
			return { product, recentAdjustments };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	async adjustStock(productId: number, adjustment: number, reason: string, notes: string | undefined, userId: number): Promise<InventoryItem> {
		this.validateId(productId);
		this.validateId(userId);
		const input = stockAdjustmentSchema.parse({ adjustment, reason, notes });
		return this.writeTransaction(async (tx) => {
			// Inventory first, then product: match checkout's lock order to avoid deadlocks.
			const rows = await tx.$queryRaw<{ inventoryId: number; quantity: number; reservedQuantity: number }[]>`
				SELECT "inventory_id" AS "inventoryId", "quantity", "reserved_quantity" AS "reservedQuantity"
				FROM "Inventory" WHERE "product_id" = ${productId} ORDER BY "inventory_id" FOR UPDATE`;
			await this.lockProduct(tx, productId);
			const product = await this.findProduct(tx, productId);
			const newStock = product.stockQuantity + input.adjustment;
			if (newStock < 0) throw new InventoryError(400, 'Stock cannot become negative');
			if (newStock > MAX_STOCK) throw new InventoryError(400, 'Stock exceeds the maximum supported quantity');

			if (input.adjustment < 0) {
				const available = rows.reduce((sum, row) => sum + row.quantity - row.reservedQuantity, 0);
				if (available < -input.adjustment) throw new InventoryError(400, 'Cannot remove reserved stock');
				let remaining = -input.adjustment;
				for (const row of rows) {
					const removed = Math.min(row.quantity - row.reservedQuantity, remaining);
					if (removed > 0) {
						await tx.inventory.update({
							where: { inventoryId: row.inventoryId }, data: { quantity: { decrement: removed } },
						});
						remaining -= removed;
					}
					if (remaining === 0) break;
				}
			} else if (input.adjustment > 0) {
				const primary = rows[0];
				if (primary) {
					await tx.inventory.update({
						where: { inventoryId: primary.inventoryId }, data: { quantity: { increment: input.adjustment } },
					});
				} else {
					const supplier = await tx.productSupplier.findFirst({ where: { productId }, orderBy: { supplierId: 'asc' } });
					if (!supplier) throw new InventoryError(400, 'Assign a supplier before adding stock');
					await tx.inventory.create({
						data: { productId, supplierId: supplier.supplierId, quantity: input.adjustment, marketValue: 0 },
					});
				}
			}
			const updated = await tx.product.update({
				where: { productId }, data: { stockStatus: this.calculateStockStatus(newStock, product.lowStockThreshold) },
				select: productSelect,
			});
			await tx.stockAdjustment.create({
				data: {
					productId, adjustedById: userId, adjustment: input.adjustment,
					previousStock: product.stockQuantity, newStock, reason: input.reason, notes: input.notes ?? null,
				},
			});
			return updated;
		});
	}

	async updateThreshold(productId: number, threshold: number): Promise<InventoryItem> {
		this.validateId(productId);
		const { lowStockThreshold } = thresholdSchema.parse({ lowStockThreshold: threshold });
		return this.writeTransaction(async (tx) => {
			await this.lockProduct(tx, productId);
			const product = await this.findProduct(tx, productId);
			return tx.product.update({
				where: { productId },
				data: { lowStockThreshold, stockStatus: this.calculateStockStatus(product.stockQuantity, lowStockThreshold) },
				select: productSelect,
			});
		});
	}

	async getAdjustmentHistory(productId: number, query: Partial<InventoryPagination> = {}) {
		this.validateId(productId);
		const options = inventoryPaginationSchema.parse(query);
		return this.db.$transaction(async (tx) => {
			await this.findProduct(tx, productId);
			const total = await tx.stockAdjustment.count({ where: { productId } });
			const items = await tx.stockAdjustment.findMany({
				where: { productId }, orderBy: historyOrder, skip: (options.page - 1) * options.limit, take: options.limit,
			});
			return paginate(items, total, options);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	private validateId(id: number) {
		inventoryIdSchema.parse({ id: String(id) });
	}

	private async findProduct(tx: Prisma.TransactionClient, productId: number) {
		const product = await tx.product.findUnique({ where: { productId }, select: productSelect });
		if (!product) throw new InventoryError(404, 'Product not found');
		return product;
	}

	private async lockProduct(tx: Prisma.TransactionClient, productId: number) {
		await tx.$queryRaw`SELECT "prodid" FROM "Product" WHERE "prodid" = ${productId} FOR UPDATE`;
	}

	private async writeTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			} catch (error) {
				if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
				const rawConflict = error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
				if (error.code !== 'P2034' && !rawConflict) throw error;
				if (attempt === TRANSACTION_ATTEMPTS) throw new InventoryError(409, 'Inventory changed concurrently; please retry');
				console.warn('Retrying concurrent inventory transaction', { attempt });
			}
		}
	}
}
