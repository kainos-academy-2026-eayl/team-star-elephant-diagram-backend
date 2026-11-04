import type { PrismaClient } from '@prisma/client';
import prismaClient from '../prismaClient';

export interface ReservationRecord {
	reservationId: number;
	userId: number;
	createdAt: Date;
	updatedAt: Date;
	items: Map<number, number>; // productId -> quantity
}

export interface ReservationRepository {
	create(userId: number): Promise<number>;
	addItem(reservationId: number, productId: number, quantity: number): Promise<boolean>;
	findByUserId(userId: number): Promise<ReservationRecord | null>;
	findByReservationId(reservationId: number): Promise<ReservationRecord | null>;
	delete(reservationId: number): Promise<boolean>;
	findExpired(expirationMinutes: number): Promise<ReservationRecord[]>;
}

export function createDatabaseReservationRepository(prisma: PrismaClient): ReservationRepository {
	return {
		async create(userId: number): Promise<number> {
			const reservation = await prisma.reservation.create({
				data: {
					userId,
				},
			});
			return reservation.reservationId;
		},

		async addItem(reservationId: number, productId: number, quantity: number): Promise<boolean> {
			try {
				await prisma.reservationItem.upsert({
					where: {
						reservationId_productId: {
							reservationId,
							productId,
						},
					},
					update: {
						quantity,
					},
					create: {
						reservationId,
						productId,
						quantity,
					},
				});
				return true;
			} catch {
				return false;
			}
		},

		async findByUserId(userId: number): Promise<ReservationRecord | null> {
			const reservation = await prisma.reservation.findFirst({
				where: { userId },
				include: { items: true },
			});

			if (!reservation) return null;

			return {
				reservationId: reservation.reservationId,
				userId: reservation.userId,
				createdAt: reservation.createdAt,
				updatedAt: reservation.updatedAt,
				items: new Map(reservation.items.map((item) => [item.productId, item.quantity])),
			};
		},

		async findByReservationId(reservationId: number): Promise<ReservationRecord | null> {
			const reservation = await prisma.reservation.findUnique({
				where: { reservationId },
				include: { items: true },
			});

			if (!reservation) return null;

			return {
				reservationId: reservation.reservationId,
				userId: reservation.userId,
				createdAt: reservation.createdAt,
				updatedAt: reservation.updatedAt,
				items: new Map(reservation.items.map((item) => [item.productId, item.quantity])),
			};
		},

		async delete(reservationId: number): Promise<boolean> {
			try {
				await prisma.reservation.delete({
					where: { reservationId },
				});
				return true;
			} catch {
				return false;
			}
		},

		async findExpired(expirationMinutes: number): Promise<ReservationRecord[]> {
			const expirationTime = new Date(Date.now() - expirationMinutes * 60 * 1000);
			const reservations = await prisma.reservation.findMany({
				where: {
					createdAt: {
						lt: expirationTime,
					},
				},
				include: { items: true },
			});

			return reservations.map((reservation) => ({
				reservationId: reservation.reservationId,
				userId: reservation.userId,
				createdAt: reservation.createdAt,
				updatedAt: reservation.updatedAt,
				items: new Map(reservation.items.map((item) => [item.productId, item.quantity])),
			}));
		},
	};
}

export const prismaReservationRepository = createDatabaseReservationRepository(prismaClient);
