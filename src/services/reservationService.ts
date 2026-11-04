import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 15 minutes in milliseconds
const RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Creates a reservation from a basket when user proceeds to checkout
 * Reduces inventory reserved quantity
 */
export async function createCheckoutReservation(userId: number) {
  try {
    // Get user's basket with all items
    const basket = await prisma.basket.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                inventory: {
                  include: { supplier: true }
                }
              }
            }
          }
        }
      }
    });

    if (!basket || basket.items.length === 0) {
      throw new Error('Basket is empty');
    }

    // Check if user already has an active reservation
    const existingReservation = await prisma.reservation.findUnique({
      where: { userId }
    });

    // If existing reservation, delete it and return stock
    if (existingReservation) {
      await cancelReservation(existingReservation.reservationId);
    }

    // Verify all products have sufficient inventory
    for (const basketItem of basket.items) {
      const inventory = basketItem.product.inventory[0]; // Get first inventory record
      if (!inventory) {
        throw new Error(`No inventory found for product ${basketItem.product.productId}`);
      }

      const availableQuantity = inventory.quantity - inventory.reservedQuantity;
      if (availableQuantity < basketItem.quantity) {
        throw new Error(
          `Insufficient stock for ${basketItem.product.name}. Available: ${availableQuantity}, Requested: ${basketItem.quantity}`
        );
      }
    }

    // Create reservation with 15-minute expiry
    const expiresAt = new Date(Date.now() + RESERVATION_TIMEOUT_MS);

    const reservation = await prisma.reservation.create({
      data: {
        userId,
        expiresAt,
        items: {
          create: basket.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    // Update inventory reserved quantities
    for (const reservationItem of reservation.items) {
      await prisma.inventory.updateMany({
        where: { productId: reservationItem.productId },
        data: {
          reservedQuantity: {
            increment: reservationItem.quantity
          }
        }
      });
    }

    console.log(`✅ Reservation created: ${reservation.reservationId} for user ${userId}, expires at ${expiresAt}`);

    return {
      success: true,
      reservation,
      expiresAt,
      message: 'Reservation created successfully. You have 15 minutes to complete checkout.'
    };
  } catch (error) {
    console.error('❌ Error creating reservation:', error);
    throw error;
  }
}

/**
 * Cancels a reservation and returns stock to inventory
 * Called when user clicks "continue shopping" or reservation expires
 */
export async function cancelReservation(reservationId: number) {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { reservationId },
      include: { items: true }
    });

    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    // Return reserved quantities to inventory
    for (const item of reservation.items) {
      await prisma.inventory.updateMany({
        where: { productId: item.productId },
        data: {
          reservedQuantity: {
            decrement: item.quantity
          }
        }
      });
    }

    // Delete the reservation (cascades to items)
    await prisma.reservation.delete({
      where: { reservationId }
    });

    console.log(`✅ Reservation ${reservationId} cancelled, stock returned to inventory`);

    return {
      success: true,
      message: 'Reservation cancelled, stock returned to inventory.'
    };
  } catch (error) {
    console.error('❌ Error cancelling reservation:', error);
    throw error;
  }
}

/**
 * Converts a reservation to an order
 * Called when user completes payment
 */
export async function convertReservationToOrder(
  reservationId: number,
  userId: number,
  totalCost: number,
  _paymentMethod?: string
) {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { reservationId },
      include: { items: true }
    });

    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        userId,
        cost: totalCost,
        orderStatus: 'PENDING',
        orderItems: {
          create: reservation.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        }
      },
      include: {
        orderItems: true
      }
    });

    // Permanently reduce inventory (convert reserved to sold)
    for (const item of reservation.items) {
      await prisma.inventory.updateMany({
        where: { productId: item.productId },
        data: {
          quantity: { decrement: item.quantity },
          reservedQuantity: { decrement: item.quantity }
        }
      });
    }

    // Delete the reservation
    await prisma.reservation.delete({
      where: { reservationId }
    });

    console.log(`✅ Order ${order.orderId} created from reservation ${reservationId}, inventory permanently reduced`);

    return {
      success: true,
      order,
      message: 'Order created successfully, inventory updated.'
    };
  } catch (error) {
    console.error('❌ Error converting reservation to order:', error);
    throw error;
  }
}

/**
 * Cleans up expired reservations
 * Should be run periodically (e.g., every 1 minute via cron job or middleware)
 */
export async function cleanupExpiredReservations() {
  try {
    const now = new Date();

    // Find all expired reservations
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        expiresAt: {
          lt: now
        }
      },
      include: { items: true }
    });

    if (expiredReservations.length === 0) {
      console.log('✅ No expired reservations to cleanup');
      return { cleaned: 0 };
    }

    // Cancel each expired reservation (returns stock)
    for (const reservation of expiredReservations) {
      console.log(`⏰ Expiring reservation ${reservation.reservationId} for user ${reservation.userId}`);

      // Return reserved quantities
      for (const item of reservation.items) {
        await prisma.inventory.updateMany({
          where: { productId: item.productId },
          data: {
            reservedQuantity: {
              decrement: item.quantity
            }
          }
        });
      }

      // Delete reservation
      await prisma.reservation.delete({
        where: { reservationId: reservation.reservationId }
      });
    }

    console.log(`✅ Cleaned up ${expiredReservations.length} expired reservations`);
    return { cleaned: expiredReservations.length };
  } catch (error) {
    console.error('❌ Error cleaning up expired reservations:', error);
    throw error;
  }
}

/**
 * Gets active reservation for a user
 */
export async function getUserReservation(userId: number) {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!reservation) {
      return null;
    }

    // Check if reservation is expired
    if (new Date() > reservation.expiresAt) {
      // Expired, cancel it
      await cancelReservation(reservation.reservationId);
      return null;
    }

    // Calculate time remaining
    const timeRemaining = Math.max(0, reservation.expiresAt.getTime() - Date.now());
    const minutesRemaining = Math.floor(timeRemaining / 60000);

    return {
      ...reservation,
      minutesRemaining,
      isExpired: false
    };
  } catch (error) {
    console.error('❌ Error getting user reservation:', error);
    throw error;
  }
}

/**
 * Gets available quantity for a product (total - reserved)
 */
export async function getAvailableQuantity(productId: number) {
  try {
    const inventory = await prisma.inventory.findFirst({
      where: { productId }
    });

    if (!inventory) {
      return 0;
    }

    return Math.max(0, inventory.quantity - inventory.reservedQuantity);
  } catch (error) {
    console.error('❌ Error getting available quantity:', error);
    throw error;
  }
}

export default {
  createCheckoutReservation,
  cancelReservation,
  convertReservationToOrder,
  cleanupExpiredReservations,
  getUserReservation,
  getAvailableQuantity,
  RESERVATION_TIMEOUT_MS
};
