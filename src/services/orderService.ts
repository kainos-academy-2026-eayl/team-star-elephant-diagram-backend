import type { PrismaClient } from '@prisma/client';
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
	shippingFee: number;
	items: OrderItem[];
	orderStatus: string;
	orderPlacedAt: Date;
}

export class OrderService {
	constructor(
		private readonly prisma: PrismaClient,
		private readonly products: ProductRepository,
		private readonly baskets: BasketRepository,
	) {}

	private calculateShippingFee(subtotal: number): number {
		return subtotal > 200 ? 30 : 20;
	}

	async createOrderFromReservation(userId: number, reservationId: number): Promise<OrderRecord> {
		const { order, orderItems } = await this.prisma.$transaction(async (tx) => {
			const reservation = await tx.reservation.findUnique({
				where: { reservationId },
				include: { items: true },
			});
			if (!reservation) {
				throw new ReservationNotFoundError(`Reservation ${reservationId} not found`);
			}

			if (reservation.userId !== userId) {
				throw new OrderError('Reservation does not belong to this user');
			}

			const now = new Date();
			if (reservation.status !== 'ACTIVE' || reservation.expiresAt <= now) {
				throw new OrderError('Reservation is no longer active');
			}

			const { count } = await tx.reservation.updateMany({
				where: { reservationId, userId, status: 'ACTIVE', expiresAt: { gt: now } },
				data: { status: 'CONVERTED', releasedAt: now },
			});
			if (count === 0) {
				throw new OrderError('Reservation is no longer active');
			}

			const productIds = reservation.items.map((item) => item.productId);
			const productsData = await this.products.findByIds(productIds);
			const productsMap = new Map(productsData.map((product) => [product.productId, product]));

			let totalCost = 0;
			const orderItems: OrderItem[] = [];

			for (const { productId, quantity } of reservation.items) {
				const product = productsMap.get(productId);
				if (!product) {
					throw new OrderError(`Product ${productId} not found`);
				}

				const unitPriceNum = typeof product.price === 'number' ? product.price : Number(product.price);
				totalCost += unitPriceNum * quantity;
				orderItems.push({ productId, quantity, unitPrice: unitPriceNum, productName: product.name });
			}

			const shippingFee = this.calculateShippingFee(totalCost);
			const createdOrder = await tx.order.create({
				data: {
					userId,
					cost: totalCost,
					shippingFee,
					orderStatus: 'PENDING',
				},
			});

			for (const item of orderItems) {
				await tx.orderItem.create({
					data: {
						orderId: createdOrder.orderId,
						productId: item.productId,
						quantity: item.quantity,
						unitPrice: item.unitPrice,
					},
				});
			}

			await tx.reservation.update({
				where: { reservationId },
				data: { orderId: createdOrder.orderId },
			});

			return { order: createdOrder, orderItems };
		});

		// Clear basket
		const basketItems = await this.baskets.getItems(String(userId));
		for (const productId of basketItems.keys()) {
			await this.baskets.removeItem(String(userId), productId);
		}

		return {
			orderId: order.orderId,
			userId: order.userId,
			cost: Number(order.cost),
			shippingFee: Number(order.shippingFee),
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
			shippingFee: Number(order.shippingFee),
			items: order.orderItems.map((oi) => ({
				productId: oi.productId,
				quantity: oi.quantity,
				unitPrice: Number(oi.unitPrice),
				productName: oi.product.name,
			})),
			orderStatus: order.orderStatus,
			orderPlacedAt: order.orderPlacedAt,
		};
	}
}
