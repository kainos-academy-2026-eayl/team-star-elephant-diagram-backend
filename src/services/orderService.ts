import type { PrismaClient } from '@prisma/client';
import type { ReservationRepository } from '../repositories/reservationRepository';
import type { ProductRepository } from '../repositories/productRepository';
import type { BasketRepository } from '../repositories/basketRepository';

export class OrderError extends Error {}
export class ReservationNotFoundError extends Error {}

export interface OrderItem {
	productId: number;
	quantity: number;
	unitPrice: number;
	productName: string;
}

export interface OrderRecord {
	orderId: number;
	userId: number;
	cost: number;
	items: OrderItem[];
	orderStatus: string;
	orderPlacedAt: Date;
}

export class OrderService {
	constructor(
		private readonly prisma: PrismaClient,
		private readonly reservations: ReservationRepository,
		private readonly products: ProductRepository,
		private readonly baskets: BasketRepository,
	) {}

	async createOrderFromReservation(userId: number, reservationId: number): Promise<OrderRecord> {
		// Get reservation
		const reservation = await this.reservations.findByReservationId(reservationId);
		if (!reservation) {
			throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
		}

		if (reservation.userId !== userId) {
			throw new OrderError('Reservation does not belong to this user');
		}

		// Load products for pricing
		const productIds = [...reservation.items.keys()];
		const productsData = await this.products.findByIds(productIds);
		const productsMap = new Map(productsData.map((p) => [p.productId, p]));

		// Calculate total cost and prepare order items
		let totalCost = 0;
		const orderItems: OrderItem[] = [];

		for (const [productId, quantity] of reservation.items) {
			const product = productsMap.get(productId);
			if (!product) {
				throw new OrderError(`Product ${productId} not found`);
			}

			const unitPriceNum = typeof product.price === 'number' ? product.price : Number(product.price);
			const itemCost = unitPriceNum * quantity;
			totalCost += itemCost;

			orderItems.push({
				productId,
				quantity,
				unitPrice: unitPriceNum,
				productName: product.name,
			});
		}

		// Create order and order items in a transaction
		const order = await this.prisma.$transaction(async (tx) => {
			// Create order
			const createdOrder = await tx.order.create({
				data: {
					userId,
					cost: totalCost,
					orderStatus: 'PENDING',
				},
			});

			// Create order items
			for (const item of orderItems) {
				await tx.orderItem.create({
					data: {
						orderId: createdOrder.orderId,
						productId: item.productId,
						quantity: item.quantity,
					},
				});
			}

			return createdOrder;
		});

		// Clear basket
		const basketItems = await this.baskets.getItems(String(userId));
		for (const productId of basketItems.keys()) {
			await this.baskets.removeItem(String(userId), productId);
		}

		// Delete reservation
		await this.reservations.delete(reservationId);

		return {
			orderId: order.orderId,
			userId: order.userId,
			cost: Number(order.cost),
			items: orderItems,
			orderStatus: order.orderStatus,
			orderPlacedAt: order.orderPlacedAt,
		};
	}

	async getOrder(orderId: number, userId: number): Promise<OrderRecord | null> {
		const order = await this.prisma.order.findUnique({
			where: { orderId },
			include: { orderItems: { include: { product: true } } },
		});

		if (!order || order.userId !== userId) {
			return null;
		}

		return {
			orderId: order.orderId,
			userId: order.userId,
			cost: Number(order.cost),
			items: order.orderItems.map((oi) => ({
				productId: oi.productId,
				quantity: oi.quantity,
				unitPrice: typeof oi.product.price === 'number' ? oi.product.price : Number(oi.product.price),
				productName: oi.product.name,
			})),
			orderStatus: order.orderStatus,
			orderPlacedAt: order.orderPlacedAt,
		};
	}
}
