import type { PrismaClient } from '@prisma/client';
import prismaClient from '../prismaClient';

export interface ReservationRecord {
	reservationId: number;
	userId: number;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
	items: Map<number, number>; // productId -> quantity
}

export interface ReservationRepository {
	create(userId: number, expiresAt: Date): Promise<number>;
	addItem(reservationId: number, productId: number, quantity: number): Promise<boolean>;
	findByUserId(userId: number): Promise<ReservationRecord | null>;
	findByReservationId(reservationId: number): Promise<ReservationRecord | null>;
	delete(reservationId: number): Promise<boolean>;
	findExpired(now?: Date): Promise<ReservationRecord[]>;
}

function toRecord(reservation: {
	reservationId: number;
	userId: number;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
	items: { productId: number; quantity: number }[];
}): ReservationRecord {
	return {
		reservationId: reservation.reservationId,
		userId: reservation.userId,
		createdAt: reservation.createdAt,
		updatedAt: reservation.updatedAt,
		expiresAt: reservation.expiresAt,
		items: new Map(reservation.items.map((item) => [item.productId, item.quantity])),
	};
}

export function createDatabaseReservationRepository(prisma: PrismaClient): ReservationRepository {
	return {
		async create(userId: number, expiresAt: Date): Promise<number> {
			const reservation = await prisma.reservation.create({
				data: {
					userId,
					expiresAt,
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
				where: { userId, status: 'ACTIVE' },
				include: { items: true },
			});

			return reservation ? toRecord(reservation) : null;
		},

		async findByReservationId(reservationId: number): Promise<ReservationRecord | null> {
			const reservation = await prisma.reservation.findUnique({
				where: { reservationId },
				include: { items: true },
			});

			return reservation ? toRecord(reservation) : null;
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

		async findExpired(now: Date = new Date()): Promise<ReservationRecord[]> {
			const reservations = await prisma.reservation.findMany({
				where: {
					status: 'ACTIVE',
					expiresAt: {
						lte: now,
					},
				},
				include: { items: true },
			});

			return reservations.map(toRecord);
		},
	};
}

export const prismaReservationRepository = createDatabaseReservationRepository(prismaClient);
