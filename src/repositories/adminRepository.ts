import type { Prisma, OrderStatus } from '@prisma/client';
import type { AdminUser } from '../models/AdminUser';
import prisma from '../prismaClient';

const DASHBOARD_RECENT_ROWS = 5;

export interface AdminOrderListQuery {
	search?: string | undefined;
	status?: OrderStatus | undefined;
	skip: number;
	take: number;
}

export interface AdminOrderCustomerRecord {
	userId: number;
	forename: string;
	surname: string;
	email: string;
	addressLine1: string;
	addressLine2: string;
	city: string;
	postcode: string;
}

export interface AdminOrderSummaryRecord {
	orderId: number;
	orderPlacedAt: Date;
	orderStatus: OrderStatus;
	cost: { toString(): string };
	user: Pick<AdminOrderCustomerRecord, 'userId' | 'forename' | 'surname' | 'email'>;
}

export interface AdminOrderDetailsRecord extends Omit<AdminOrderSummaryRecord, 'user'> {
	modifiedAt: Date;
	user: AdminOrderCustomerRecord;
	orderItems: Array<{
		productId: number;
		quantity: number;
		product: { name: string; price: { toString(): string } };
	}>;
}

export interface AdminOrderMetrics {
	totalOrders: number;
	pendingOrders: number;
	revenue: number;
	recentOrders: Array<{ orderId: number; customer: string; placedAt: Date; status: string }>;
}

export interface AdminInventoryMetrics {
	totalProducts: number;
	lowStockProducts: number;
	outOfStockProducts: number;
	unitsInStock: number;
	lowStockLines: number;
	lowStockItems: Array<{ inventoryId: number; product: string; supplier: string; quantity: number; reorderLevel: number }>;
	recentStockChanges: Array<{ product: string; quantity: number; modifiedAt: Date }>;
}

export interface AdminProductStockRecord {
	productId: number;
	name: string;
	price: number;
	// Sellable units: inventory on hand minus units reserved by checkouts.
	availableStock: number;
}

export interface adminRepository {
	findByEmail(email: string): Promise<AdminUser | null>;
	findById(adminId: number): Promise<AdminUser | null>;
	getOrderMetrics(): Promise<AdminOrderMetrics>;
	getInventoryMetrics(): Promise<AdminInventoryMetrics>;
	listOrders(query: AdminOrderListQuery): Promise<{ orders: AdminOrderSummaryRecord[]; total: number }>;
	findOrderById(orderId: number): Promise<AdminOrderDetailsRecord | null>;
	// Compare-and-set: only updates when the order is still in `from`, so concurrent updates cannot skip a transition.
	updateOrderStatus(orderId: number, from: OrderStatus, to: OrderStatus): Promise<boolean>;
	// Omit productIds to list every product (capped) for admin pickers.
	getProductStock(productIds?: readonly number[]): Promise<AdminProductStockRecord[]>;
}

const PRODUCT_STOCK_LIMIT = 500;

const MAX_ORDER_ID = 2_147_483_647;

// Every whitespace-separated term must match the order ID, customer forename, surname or email.
function orderSearchFilter(search: string | undefined, status: OrderStatus | undefined): Prisma.OrderWhereInput {
	const terms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
	return {
		...(status ? { orderStatus: status } : {}),
		AND: terms.map((term) => {
			const id = term.replace(/^#/, '');
			const or: Prisma.OrderWhereInput[] = [
				{ user: { forename: { contains: term, mode: 'insensitive' } } },
				{ user: { surname: { contains: term, mode: 'insensitive' } } },
				{ user: { email: { contains: term, mode: 'insensitive' } } },
			];
			if (/^\d{1,10}$/.test(id) && Number(id) <= MAX_ORDER_ID) or.push({ orderId: Number(id) });
			return { OR: or };
		}),
	};
}

const orderSummarySelect = {
	orderId: true,
	orderPlacedAt: true,
	orderStatus: true,
	cost: true,
	user: { select: { userId: true, forename: true, surname: true, email: true } },
} as const satisfies Prisma.OrderSelect;

export const prismaAdminUserRepository: adminRepository = {
	async getProductStock(productIds) {
		const rows = await prisma.product.findMany({
			where: productIds ? { productId: { in: [...productIds] } } : {},
			take: productIds ? productIds.length : PRODUCT_STOCK_LIMIT,
			select: {
				productId: true,
				name: true,
				price: true,
				inventory: { select: { quantity: true, reservedQuantity: true } },
			},
			orderBy: [{ name: 'asc' }, { productId: 'asc' }],
		});
		return rows.map((row) => ({
			productId: row.productId,
			name: row.name,
			price: Number(row.price.toString()),
			availableStock: row.inventory.reduce(
				(total, line) => total + Math.max(0, line.quantity - line.reservedQuantity),
				0,
			),
		}));
	},
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
		const [stock, lowStockLines, recent, lowStock, totalProducts, lowStockProducts, outOfStockProducts] = await prisma.$transaction([
			prisma.inventory.aggregate({ _sum: { quantity: true } }),
			prisma.inventory.count({ where: { quantity: { lte: prisma.inventory.fields.reorderLevel } } }),
			prisma.inventory.findMany({
				select: { quantity: true, modifiedAt: true, product: { select: { name: true } } },
				orderBy: [{ modifiedAt: 'desc' }, { inventoryId: 'desc' }],
				take: DASHBOARD_RECENT_ROWS,
			}),
			prisma.inventory.findMany({
				where: { quantity: { lte: prisma.inventory.fields.reorderLevel } },
				select: {
					inventoryId: true,
					quantity: true,
					reorderLevel: true,
					product: { select: { name: true } },
					supplier: { select: { name: true } },
				},
				orderBy: [{ quantity: 'asc' }, { inventoryId: 'asc' }],
				take: DASHBOARD_RECENT_ROWS,
			}),
			prisma.product.count(),
			prisma.product.count({ where: { stockStatus: 'LOW_STOCK' } }),
			prisma.product.count({ where: { stockStatus: 'OUT_OF_STOCK' } }),
		]);
		return {
			totalProducts, lowStockProducts, outOfStockProducts,
			unitsInStock: stock._sum.quantity ?? 0,
			lowStockLines,
			lowStockItems: lowStock.map((row) => ({
				inventoryId: row.inventoryId,
				product: row.product.name,
				supplier: row.supplier.name,
				quantity: row.quantity,
				reorderLevel: row.reorderLevel,
			})),
			recentStockChanges: recent.map((row) => ({
				product: row.product.name,
				quantity: row.quantity,
				modifiedAt: row.modifiedAt,
			})),
		};
	},
	async listOrders({ search, status, skip, take }) {
		const where = orderSearchFilter(search, status);
		const [orders, total] = await prisma.$transaction([
			prisma.order.findMany({
				where,
				select: orderSummarySelect,
				orderBy: [{ orderPlacedAt: 'desc' }, { orderId: 'desc' }],
				skip,
				take,
			}),
			prisma.order.count({ where }),
		]);
		return { orders, total };
	},
	findOrderById(orderId) {
		return prisma.order.findUnique({
			where: { orderId },
			select: {
				orderId: true,
				orderPlacedAt: true,
				orderStatus: true,
				cost: true,
				modifiedAt: true,
				user: {
					select: {
						userId: true,
						forename: true,
						surname: true,
						email: true,
						addressLine1: true,
						addressLine2: true,
						city: true,
						postcode: true,
					},
				},
				orderItems: {
					select: { productId: true, quantity: true, product: { select: { name: true, price: true } } },
					orderBy: { productId: 'asc' },
				},
			},
		});
	},
	async updateOrderStatus(orderId, from, to) {
		const { count } = await prisma.order.updateMany({
			where: { orderId, orderStatus: from },
			data: { orderStatus: to, modifiedAt: new Date() },
		});
		return count === 1;
	},
};
