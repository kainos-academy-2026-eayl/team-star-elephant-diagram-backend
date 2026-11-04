import type { AdminUser } from '../models/AdminUser';
import prisma from '../prismaClient';

const DASHBOARD_RECENT_ROWS = 5;

export interface AdminOrderMetrics {
	totalOrders: number;
	pendingOrders: number;
	revenue: number;
	recentOrders: Array<{ orderId: number; customer: string; placedAt: Date; status: string }>;
}

export interface AdminInventoryMetrics {
	unitsInStock: number;
	lowStockLines: number;
	recentStockChanges: Array<{ product: string; quantity: number; modifiedAt: Date }>;
}

export interface adminRepository {
	findByEmail(email: string): Promise<AdminUser | null>;
	findById(adminId: number): Promise<AdminUser | null>;
	getOrderMetrics(): Promise<AdminOrderMetrics>;
	getInventoryMetrics(): Promise<AdminInventoryMetrics>;
}

export const prismaAdminUserRepository: adminRepository = {
	async findByEmail(email: string) {
		return prisma.adminUser.findUnique({
			where: { email },
		});
	},
	async findById(adminId: number) {
		return prisma.adminUser.findUnique({
			where: { adminId },
		});
	},
	async getOrderMetrics() {
		const [totalOrders, pendingOrders, revenue, recent] = await prisma.$transaction([
			prisma.order.count(),
			prisma.order.count({ where: { orderStatus: 'PENDING' } }),
			prisma.order.aggregate({ _sum: { cost: true }, where: { orderStatus: { not: 'CANCELLED' } } }),
			prisma.order.findMany({
				select: {
					orderId: true,
					orderPlacedAt: true,
					orderStatus: true,
					user: { select: { forename: true, surname: true } },
				},
				orderBy: [{ orderPlacedAt: 'desc' }, { orderId: 'desc' }],
				take: DASHBOARD_RECENT_ROWS,
			}),
		]);
		return {
			totalOrders,
			pendingOrders,
			revenue: Number(revenue._sum.cost?.toString() ?? 0),
			recentOrders: recent.map((order) => ({
				orderId: order.orderId,
				customer: `${order.user.forename} ${order.user.surname}`,
				placedAt: order.orderPlacedAt,
				status: order.orderStatus,
			})),
		};
	},
	async getInventoryMetrics() {
		const [stock, lowStockLines, recent] = await prisma.$transaction([
			prisma.inventory.aggregate({ _sum: { quantity: true } }),
			prisma.inventory.count({ where: { quantity: { lte: prisma.inventory.fields.reorderLevel } } }),
			prisma.inventory.findMany({
				select: { quantity: true, modifiedAt: true, product: { select: { name: true } } },
				orderBy: [{ modifiedAt: 'desc' }, { inventoryId: 'desc' }],
				take: DASHBOARD_RECENT_ROWS,
			}),
		]);
		return {
			unitsInStock: stock._sum.quantity ?? 0,
			lowStockLines,
			recentStockChanges: recent.map((row) => ({
				product: row.product.name,
				quantity: row.quantity,
				modifiedAt: row.modifiedAt,
			})),
		};
	},
};
