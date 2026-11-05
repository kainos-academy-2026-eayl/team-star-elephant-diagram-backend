import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';

export const RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;

type Tx = Prisma.TransactionClient;
type ReleaseStatus = 'EXPIRED' | 'CANCELLED';

export class ReservationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// A product may have several inventory rows (one per supplier); always use the lowest id so reserve/release/sell hit the same row.
async function primaryInventory(tx: Tx, productId: number) {
  return tx.inventory.findFirst({ where: { productId }, orderBy: { inventoryId: 'asc' } });
}

async function returnReservedStock(tx: Tx, reservationId: number) {
  const items = await tx.reservationItem.findMany({ where: { reservationId } });
  for (const item of items) {
    const inventory = await primaryInventory(tx, item.productId);
    if (!inventory) continue;
    await tx.inventory.update({
      where: { inventoryId: inventory.inventoryId },
      data: { reservedQuantity: Math.max(0, inventory.reservedQuantity - item.quantity) },
    });
  }
}

/**
 * Moves an ACTIVE reservation to EXPIRED/CANCELLED and returns its stock. The reservation row is kept as history.
 * The status check makes this safe to race with payment or another cleanup: stock is only ever returned once.
 */
async function releaseReservation(tx: Tx, reservationId: number, status: ReleaseStatus, onlyIfExpired = false) {
  const now = new Date();
  const { count } = await tx.reservation.updateMany({
    where: { reservationId, status: 'ACTIVE', ...(onlyIfExpired ? { expiresAt: { lte: now } } : {}) },
    data: { status, releasedAt: now },
  });
  if (count === 0) return false;
  await returnReservedStock(tx, reservationId);
  return true;
}

async function findActiveReservation(tx: Tx, userId: number) {
  return tx.reservation.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { items: { include: { product: true } } },
  });
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Reserves every basket item for 15 minutes when the user continues to checkout.
 * Any previous active reservation for the user is marked CANCELLED and its stock returned.
 */
export async function createCheckoutReservation(userId: number) {
  try {
    const reservation = await prisma.$transaction(async (tx) => {
      const basket = await tx.basket.findUnique({ where: { userId }, include: { items: { include: { product: true } } } });
      if (!basket || basket.items.length === 0) {
        throw new ReservationError(400, 'Basket is empty');
      }

      const existing = await tx.reservation.findFirst({ where: { userId, status: 'ACTIVE' }, select: { reservationId: true } });
      if (existing) {
        await releaseReservation(tx, existing.reservationId, 'CANCELLED');
      }

      for (const item of basket.items) {
        const inventory = await primaryInventory(tx, item.productId);
        const available = inventory ? inventory.quantity - inventory.reservedQuantity : 0;
        if (!inventory || available < item.quantity) {
          throw new ReservationError(
            409,
            `Insufficient stock for ${item.product.name}. Available: ${Math.max(0, available)}, Requested: ${item.quantity}`,
          );
        }
        await tx.inventory.update({
          where: { inventoryId: inventory.inventoryId },
          data: { reservedQuantity: { increment: item.quantity } },
        });
      }

      return tx.reservation.create({
        data: {
          userId,
          expiresAt: new Date(Date.now() + RESERVATION_TIMEOUT_MS),
          items: { create: basket.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) },
        },
        include: { items: { include: { product: true } } },
      });
    });

    return {
      success: true,
      reservation,
      expiresAt: reservation.expiresAt,
      message: 'Reservation created successfully. You have 15 minutes to complete checkout.',
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReservationError(409, 'Checkout is already in progress. Please try again.');
    }
    throw error;
  }
}

/**
 * Continue shopping: marks the reservation CANCELLED and returns its stock.
 */
export async function cancelReservation(reservationId: number) {
  const released = await prisma.$transaction((tx) => releaseReservation(tx, reservationId, 'CANCELLED'));
  if (!released) {
    throw new ReservationError(404, 'No active reservation to cancel');
  }
  return { success: true, message: 'Reservation cancelled, stock returned to inventory.' };
}

/**
 * Payment complete: marks the user's reservation CONVERTED, records an order with status PROCESSING linked to it,
 * and permanently removes the reserved stock from inventory. Runs atomically.
 */
export async function convertReservationToOrder(userId: number) {
  const result = await prisma.$transaction(async (tx) => {
    const reservation = await findActiveReservation(tx, userId);
    if (!reservation) {
      throw new ReservationError(404, 'No active reservation. Please proceed to checkout again.');
    }

    if (reservation.expiresAt <= new Date()) {
      // Returned (not thrown) so the expiry is committed rather than rolled back.
      await releaseReservation(tx, reservation.reservationId, 'EXPIRED');
      return { expired: true as const };
    }

    const { count } = await tx.reservation.updateMany({
      where: { reservationId: reservation.reservationId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      data: { status: 'CONVERTED', releasedAt: new Date() },
    });
    if (count === 0) {
      throw new ReservationError(409, 'Your reservation is no longer active. Please proceed to checkout again.');
    }

    for (const item of reservation.items) {
      const inventory = await primaryInventory(tx, item.productId);
      if (!inventory) {
        throw new ReservationError(409, `No inventory found for ${item.product.name}`);
      }
      await tx.inventory.update({
        where: { inventoryId: inventory.inventoryId },
        data: {
          quantity: { decrement: item.quantity },
          reservedQuantity: Math.max(0, inventory.reservedQuantity - item.quantity),
        },
      });
    }

    const cost = reservation.items.reduce(
      (total, item) => total.add(item.product.price.mul(item.quantity)),
      new Prisma.Decimal(0),
    );

    const order = await tx.order.create({
      data: {
        userId,
        cost,
        orderStatus: 'PROCESSING',
        orderItems: {
          create: reservation.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.product.price,
          })),
        },
      },
      include: { orderItems: true },
    });

    await tx.reservation.update({ where: { reservationId: reservation.reservationId }, data: { orderId: order.orderId } });

    return { expired: false as const, order, reservationId: reservation.reservationId };
  });

  if (result.expired) {
    throw new ReservationError(410, 'Your reservation has expired. Please proceed to checkout again.');
  }

  const { order, reservationId } = result;
  return {
    success: true,
    reservationId,
    order: {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      cost: order.cost.toFixed(2),
      orderPlacedAt: order.orderPlacedAt,
      items: order.orderItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    },
    message: 'Order created successfully, inventory updated.',
  };
}

/**
 * Marks every ACTIVE reservation past its expiry as EXPIRED and returns its stock.
 * Run periodically by reservationCleanupMiddleware.
 */
export async function cleanupExpiredReservations() {
  const expired = await prisma.reservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
    select: { reservationId: true },
  });

  let cleaned = 0;
  for (const { reservationId } of expired) {
    if (await prisma.$transaction((tx) => releaseReservation(tx, reservationId, 'EXPIRED', true))) {
      cleaned += 1;
    }
  }

  return { cleaned };
}

/**
 * Returns the user's ACTIVE reservation, expiring it first if its time is up.
 */
export async function getUserReservation(userId: number) {
  const reservation = await findActiveReservation(prisma, userId);
  if (!reservation) return null;

  if (reservation.expiresAt <= new Date()) {
    await prisma.$transaction((tx) => releaseReservation(tx, reservation.reservationId, 'EXPIRED', true));
    return null;
  }

  const timeRemaining = Math.max(0, reservation.expiresAt.getTime() - Date.now());
  return { ...reservation, minutesRemaining: Math.floor(timeRemaining / 60000), isExpired: false };
}

/**
 * Stock that can still be reserved (quantity - reserved_quantity).
 */
export async function getAvailableQuantity(productId: number) {
  const inventory = await primaryInventory(prisma, productId);
  if (!inventory) return 0;
  return Math.max(0, inventory.quantity - inventory.reservedQuantity);
}

export default {
  createCheckoutReservation,
  cancelReservation,
  convertReservationToOrder,
  cleanupExpiredReservations,
  getUserReservation,
  getAvailableQuantity,
  RESERVATION_TIMEOUT_MS,
};
