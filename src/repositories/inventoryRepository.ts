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
	decreaseQuantity(reservationId: number, productId: number, quantity: number): Promise<boolean>;
	increaseQuantity(inventoryId: number, quantity: number): Promise<boolean>;
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

		async decreaseQuantity(reservationId: number, productId: number, quantity: number): Promise<boolean> {
			try {
				return await prisma.$transaction(async (tx) => {
					const inventories = await tx.inventory.findMany({
						where: { productId },
						orderBy: { inventoryId: 'asc' },
						select: { inventoryId: true, quantity: true },
					});
					if (inventories.reduce((total, inventory) => total + inventory.quantity, 0) < quantity) {
						return false;
					}

					const reservationItem = await tx.reservationItem.findUnique({
						where: { reservationId_productId: { reservationId, productId } },
						select: { reservationItemId: true },
					});
					if (!reservationItem) return false;

					let remaining = quantity;
					const allocations: { inventoryId: number; quantity: number }[] = [];
					for (const inventory of inventories) {
						const allocatedQuantity = Math.min(inventory.quantity, remaining);
						if (allocatedQuantity === 0) continue;

						const result = await tx.inventory.updateMany({
							where: {
								inventoryId: inventory.inventoryId,
								productId,
								quantity: { gte: allocatedQuantity },
							},
							data: {
								quantity: { decrement: allocatedQuantity },
								modifiedAt: new Date(),
							},
						});
						if (result.count !== 1) throw new Error('Inventory changed during reservation');

						allocations.push({ inventoryId: inventory.inventoryId, quantity: allocatedQuantity });
						remaining -= allocatedQuantity;
						if (remaining === 0) break;
					}

					if (remaining !== 0) throw new Error('Insufficient inventory');

					await tx.reservationInventoryAllocation.createMany({
						data: allocations.map((allocation) => ({
							reservationItemId: reservationItem.reservationItemId,
							inventoryId: allocation.inventoryId,
							quantity: allocation.quantity,
						})),
					});
					return true;
				});
			} catch {
				return false;
			}
		},

		async increaseQuantity(inventoryId: number, quantity: number): Promise<boolean> {
			try {
				await prisma.inventory.update({
					where: { inventoryId },
					data: {
						quantity: { increment: quantity },
						modifiedAt: new Date(),
					},
				});
				return true;
			} catch {
				return false;
			}
		},

		async getAvailableQuantity(productId: number): Promise<number> {
			const inventories = await prisma.inventory.findMany({
				where: { productId },
				select: { quantity: true },
			});
			return inventories.reduce((total, inventory) => total + inventory.quantity, 0);
		},

		async hasAvailableQuantity(productId: number, requestedQuantity: number): Promise<boolean> {
			const available = await this.getAvailableQuantity(productId);
			return available >= requestedQuantity;
		},
	};
}

export const prismaInventoryRepository = createDatabaseInventoryRepository(prismaClient);
