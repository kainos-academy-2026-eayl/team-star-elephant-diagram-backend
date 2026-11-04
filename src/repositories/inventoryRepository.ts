import type { PrismaClient } from '@prisma/client';
import prismaClient from '../prismaClient';

export interface InventoryRecord {
	inventoryId: number;
	quantity: number;
	maximumQuantity: number;
	reorderLevel: number;
	marketValue: number;
	productId: number;
	supplierId: number;
	modifiedAt: Date;
}

export interface InventoryRepository {
	findByProductId(productId: number): Promise<InventoryRecord | null>;
	decreaseQuantity(productId: number, quantity: number): Promise<boolean>;
	increaseQuantity(productId: number, quantity: number): Promise<boolean>;
	getAvailableQuantity(productId: number): Promise<number>;
	hasAvailableQuantity(productId: number, requestedQuantity: number): Promise<boolean>;
}

export function createDatabaseInventoryRepository(prisma: PrismaClient): InventoryRepository {
	return {
		async findByProductId(productId: number): Promise<InventoryRecord | null> {
			const inventory = await prisma.inventory.findFirst({
				where: { productId },
			});
			if (!inventory) return null;
			return {
				inventoryId: inventory.inventoryId,
				quantity: inventory.quantity,
				maximumQuantity: inventory.maximumQuantity,
				reorderLevel: inventory.reorderLevel,
				marketValue: Number(inventory.marketValue),
				productId: inventory.productId,
				supplierId: inventory.supplierId,
				modifiedAt: inventory.modifiedAt,
			};
		},

		async decreaseQuantity(productId: number, quantity: number): Promise<boolean> {
			try {
				const result = await prisma.inventory.updateMany({
					where: {
						productId,
						quantity: { gte: quantity },
					},
					data: {
						quantity: {
							decrement: quantity,
						},
						modifiedAt: new Date(),
					},
				});
				return result.count > 0;
			} catch {
				return false;
			}
		},

		async increaseQuantity(productId: number, quantity: number): Promise<boolean> {
			try {
				await prisma.inventory.updateMany({
					where: { productId },
					data: {
						quantity: {
							increment: quantity,
						},
						modifiedAt: new Date(),
					},
				});
				return true;
			} catch {
				return false;
			}
		},

		async getAvailableQuantity(productId: number): Promise<number> {
			const inventory = await this.findByProductId(productId);
			return inventory?.quantity ?? 0;
		},

		async hasAvailableQuantity(productId: number, requestedQuantity: number): Promise<boolean> {
			const available = await this.getAvailableQuantity(productId);
			return available >= requestedQuantity;
		},
	};
}

export const prismaInventoryRepository = createDatabaseInventoryRepository(prismaClient);
