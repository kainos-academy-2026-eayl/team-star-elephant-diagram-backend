import { Prisma, type PrismaClient, StockStatus } from '@prisma/client';
import type { InventoryDetails, InventoryItem, PaginatedInventory } from '../models/inventory';
import {
	MAX_STOCK, RECENT_ADJUSTMENTS_LIMIT, inventoryIdSchema, inventoryPaginationSchema,
	inventoryQuerySchema, stockAdjustmentSchema, thresholdSchema,
	type InventoryPagination, type InventoryQuery,
	inventoryCreateSchema, inventoryUpdateSchema, type InventoryCreateInput, type InventoryUpdateInput,
} from '../validators/inventorySchema';

export class InventoryError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

const productSelect = {
	productId: true, name: true, description: true, sku: true, stockQuantity: true,
	lowStockThreshold: true, stockStatus: true, createdAt: true, modifiedAt: true,
	price: true, category: true, imageURL: true,
} satisfies Prisma.ProductSelect;
const historyInclude = { adjustedBy: { select: { adminId: true, forename: true, surname: true } } } satisfies Prisma.StockAdjustmentInclude;
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
				where, select: productSelect,
				orderBy: options.sort
					? [{ [options.sort]: options.direction ?? 'asc' }, { productId: 'asc' }]
					: { productId: 'asc' },
				skip: (page - 1) * limit, take: limit,
			});
			return paginate(items, total, options);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	async getInventoryById(productId: number): Promise<InventoryDetails> {
		this.validateId(productId);
		return this.db.$transaction(async (tx) => {
			const product = await this.findProduct(tx, productId);
			const recentAdjustments = await tx.stockAdjustment.findMany({
				where: { productId }, include: historyInclude, orderBy: historyOrder, take: RECENT_ADJUSTMENTS_LIMIT,
			});
			return { product, recentAdjustments };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	async adjustStock(productId: number, adjustment: number, reason: string, notes: string | undefined, userId: number): Promise<InventoryItem> {
		this.validateId(productId);
		this.validateId(userId);
		const input = stockAdjustmentSchema.parse({ adjustment, reason, notes });
		return this.writeTransaction((tx) => this.applyStock(tx, productId, input.adjustment, input.reason, input.notes, userId));
	}

	async getSuppliers() {
		return this.db.supplier.findMany({ select: { supplierId: true, name: true }, orderBy: { name: 'asc' } });
	}

	async createProduct(input: InventoryCreateInput, userId: number): Promise<InventoryItem> {
		const { supplierId, stockQuantity, ...data } = inventoryCreateSchema.parse(input);
		this.validateId(userId);
		return this.writeTransaction(async (tx) => {
			if (!await tx.supplier.findUnique({ where: { supplierId } })) {
				throw new InventoryError(400, 'Select an existing supplier');
			}
			const product = await tx.product.create({ data, select: productSelect });
			await tx.productSupplier.create({ data: { productId: product.productId, supplierId } });
			await tx.inventory.create({ data: { productId: product.productId, supplierId, quantity: stockQuantity, marketValue: data.price } });
			if (stockQuantity > 0) {
				await tx.stockAdjustment.create({ data: {
					productId: product.productId, adjustedById: userId, adjustment: stockQuantity,
					previousStock: 0, newStock: stockQuantity, reason: 'Initial stock',
				} });
			}
			return this.findProduct(tx, product.productId);
		});
	}

	async updateProduct(productId: number, input: InventoryUpdateInput, userId: number): Promise<InventoryItem> {
		this.validateId(productId);
		this.validateId(userId);
		const { stockQuantity, reason, ...data } = inventoryUpdateSchema.parse(input);
		return this.writeTransaction(async (tx) => {
			await this.applyStock(tx, productId, { stockQuantity }, reason, undefined, userId);
			const primaryImage = await tx.productImage.findFirst({ where: { productId }, orderBy: { position: 'asc' } });
			if (primaryImage) await tx.productImage.update({ where: { imageId: primaryImage.imageId }, data: { url: data.imageURL } });
			return tx.product.update({ where: { productId }, data, select: productSelect });
		});
	}

	async deleteProduct(productId: number): Promise<void> {
		this.validateId(productId);
		await this.writeTransaction(async (tx) => {
			const rows = await tx.$queryRaw<{ reservedQuantity: number }[]>`SELECT "reserved_quantity" AS "reservedQuantity" FROM "Inventory" WHERE "product_id" = ${productId} ORDER BY "inventory_id" FOR UPDATE`;
			if (rows.some((row) => row.reservedQuantity > 0)) throw new InventoryError(409, 'Products with reserved stock cannot be deleted');
			await this.lockProduct(tx, productId);
			await this.findProduct(tx, productId);
			// Order, basket and reservation references remain protected by their foreign keys.
			await tx.stockAdjustment.deleteMany({ where: { productId } });
			await tx.inventory.deleteMany({ where: { productId } });
			await tx.productSupplier.deleteMany({ where: { productId } });
			await tx.product.delete({ where: { productId } });
		});
	}

	private async applyStock(
		tx: Prisma.TransactionClient, productId: number, change: number | { stockQuantity: number },
		reason: string, notes: string | undefined, userId: number,
	): Promise<InventoryItem> {
			// Inventory first, then product: match checkout's lock order to avoid deadlocks.
			const rows = await tx.$queryRaw<{ inventoryId: number; quantity: number; reservedQuantity: number }[]>`
				SELECT "inventory_id" AS "inventoryId", "quantity", "reserved_quantity" AS "reservedQuantity"
				FROM "Inventory" WHERE "product_id" = ${productId} ORDER BY "inventory_id" FOR UPDATE`;
			await this.lockProduct(tx, productId);
			const product = await this.findProduct(tx, productId);
			const adjustment = typeof change === 'number' ? change : change.stockQuantity - product.stockQuantity;
			const newStock = product.stockQuantity + adjustment;
			if (newStock < 0) throw new InventoryError(400, 'Stock cannot become negative');
			if (newStock > MAX_STOCK) throw new InventoryError(400, 'Stock exceeds the maximum supported quantity');

			if (adjustment < 0) {
				const available = rows.reduce((sum, row) => sum + row.quantity - row.reservedQuantity, 0);
				if (available < -adjustment) throw new InventoryError(400, 'Cannot remove reserved stock');
				let remaining = -adjustment;
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
			} else if (adjustment > 0) {
				const primary = rows[0];
				if (primary) {
					await tx.inventory.update({
						where: { inventoryId: primary.inventoryId }, data: { quantity: { increment: adjustment } },
					});
				} else {
					const supplier = await tx.productSupplier.findFirst({ where: { productId }, orderBy: { supplierId: 'asc' } });
					if (!supplier) throw new InventoryError(400, 'Assign a supplier before adding stock');
					await tx.inventory.create({
						data: { productId, supplierId: supplier.supplierId, quantity: adjustment, marketValue: 0 },
					});
				}
			}
			const updated = await tx.product.update({
				where: { productId }, data: { stockStatus: this.calculateStockStatus(newStock, product.lowStockThreshold) },
				select: productSelect,
			});
			await tx.stockAdjustment.create({
				data: {
					productId, adjustedById: userId, adjustment,
					previousStock: product.stockQuantity, newStock, reason, notes: notes ?? null,
				},
			});
			return updated;
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
				where: { productId }, include: historyInclude, orderBy: historyOrder, skip: (options.page - 1) * options.limit, take: options.limit,
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
				if (error.code === 'P2002') throw new InventoryError(409, 'A product with this SKU already exists');
				if (error.code === 'P2003') throw new InventoryError(409, 'This product is referenced by other records and cannot be deleted or changed');
				const rawConflict = error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
				if (error.code !== 'P2034' && !rawConflict) throw error;
				if (attempt === TRANSACTION_ATTEMPTS) throw new InventoryError(409, 'Inventory changed concurrently; please retry');
				console.warn('Retrying concurrent inventory transaction', { attempt });
			}
		}
	}
}
