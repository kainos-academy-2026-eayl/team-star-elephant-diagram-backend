import type { ReservationRepository } from '../repositories/reservationRepository';
import type { InventoryRepository } from '../repositories/inventoryRepository';
import type { ProductRepository } from '../repositories/productRepository';
import type { BasketRepository } from '../repositories/basketRepository';

export class ReservationError extends Error {}
export class InsufficientInventoryError extends Error {}

export interface ReservationItem {
	productId: number;
	quantity: number;
	productName: string;
	unitPrice: number;
}

export interface Reservation {
	reservationId: number;
	userId: number;
	items: ReservationItem[];
	createdAt: Date;
	expiresAt: Date;
}

export class ReservationService {
	private readonly RESERVATION_DURATION_MINUTES = 15;

	constructor(
		private readonly reservations: ReservationRepository,
		private readonly inventory: InventoryRepository,
		private readonly products: ProductRepository,
		private readonly baskets: BasketRepository,
	) {}

	async createFromBasket(userId: number): Promise<Reservation> {
		// Get current basket items
		const basketItems = await this.baskets.getItems(String(userId));
		if (basketItems.size === 0) {
			throw new ReservationError('Basket is empty');
		}

		// Check inventory availability for all items
		for (const [productId, quantity] of basketItems) {
			const hasStock = await this.inventory.hasAvailableQuantity(productId, quantity);
			if (!hasStock) {
				const product = await this.products.findById(productId);
				throw new InsufficientInventoryError(
					`Insufficient stock for ${product?.name || 'product'} (requested: ${quantity})`,
				);
			}
		}

		// Create reservation
		const expiresAt = new Date(Date.now() + this.RESERVATION_DURATION_MINUTES * 60 * 1000);
		const reservationId = await this.reservations.create(userId, expiresAt);

		// Reserve stock and add items to reservation
		for (const [productId, quantity] of basketItems) {
			const reserved = await this.reservations.addItem(reservationId, productId, quantity);
			if (!reserved) {
				await this.reservations.delete(reservationId);
				throw new ReservationError('Failed to create reservation');
			}

			// Decrease inventory
			const decreased = await this.inventory.decreaseQuantity(productId, quantity);
			if (!decreased) {
				await this.reservations.delete(reservationId);
				throw new ReservationError('Failed to reserve inventory');
			}
		}

		return this.formatReservation(
			await this.reservations.findByReservationId(reservationId),
			await this.loadProducts([...basketItems.keys()]),
		);
	}

	async releaseReservation(reservationId: number): Promise<void> {
		const reservation = await this.reservations.findByReservationId(reservationId);
		if (!reservation) {
			return; // Already released or doesn't exist
		}

		// Return stock to inventory
		for (const [productId, quantity] of reservation.items) {
			await this.inventory.increaseQuantity(productId, quantity);
		}

		// Delete reservation
		await this.reservations.delete(reservationId);
	}

	async getReservation(userId: number): Promise<Reservation | null> {
		const reservation = await this.reservations.findByUserId(userId);
		if (!reservation) return null;

		const products = await this.loadProducts([...reservation.items.keys()]);
		return this.formatReservation(reservation, products);
	}

	async expireOldReservations(): Promise<number> {
		const expiredReservations = await this.reservations.findExpired();

		for (const reservation of expiredReservations) {
			await this.releaseReservation(reservation.reservationId);
		}

		return expiredReservations.length;
	}

	private async loadProducts(productIds: number[]) {
		if (productIds.length === 0) return new Map();
		return new Map(
			(await this.products.findByIds(productIds)).map((product) => [
				product.productId,
				{
					name: product.name,
					price: product.price,
				},
			]),
		);
	}

	private formatReservation(
		reservationRecord: any,
		productsMap: Map<
			number,
			{
				name: string;
				price: number;
			}
		>,
	): Reservation {
		const items: ReservationItem[] = [];
		for (const [productId, quantity] of reservationRecord.items) {
			const product = productsMap.get(productId);
			if (product) {
				items.push({
					productId,
					quantity,
					productName: product.name,
					unitPrice: product.price,
				});
			}
		}

		return {
			reservationId: reservationRecord.reservationId,
			userId: reservationRecord.userId,
			items,
			createdAt: reservationRecord.createdAt,
			expiresAt: reservationRecord.expiresAt,
		};
	}
}
