import type { Request, Response } from 'express';
import {
  createCheckoutReservation,
  cancelReservation,
  convertReservationToOrder,
  cleanupExpiredReservations,
  getUserReservation,
  getAvailableQuantity,
  ReservationError,
} from '../services/reservationService';

declare module 'express-serve-static-core' {
  interface Locals {
    customerId?: number;
  }
}

function getAuthenticatedCustomerId(res: Response): number | null {
  const userId = res.locals.customerId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return userId;
}

function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ReservationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

export class ReservationController {
  /** POST /checkout/reserve - reserve basket stock for 15 minutes when continuing to checkout */
  static async createCheckoutReservation(_req: Request, res: Response) {
    const userId = getAuthenticatedCustomerId(res);
    if (userId === null) return;
    try {
      res.status(201).json(await createCheckoutReservation(userId));
    } catch (error) {
      sendError(res, error, 'Error creating reservation');
    }
  }

  /** GET /reservations/active */
  static async getActiveReservation(_req: Request, res: Response) {
    const userId = getAuthenticatedCustomerId(res);
    if (userId === null) return;
    try {
      const reservation = await getUserReservation(userId);
      if (!reservation) {
        res.status(404).json({ error: 'No active reservation', reservation: null });
        return;
      }
      res.json({ reservation });
    } catch (error) {
      sendError(res, error, 'Error fetching reservation');
    }
  }

  /** POST /reservations/cancel - continue shopping: release reservation and return stock */
  static async cancelReservation(_req: Request, res: Response) {
    const userId = getAuthenticatedCustomerId(res);
    if (userId === null) return;
    try {
      const reservation = await getUserReservation(userId);
      if (!reservation) {
        res.status(404).json({ error: 'No active reservation to cancel' });
        return;
      }
      res.json(await cancelReservation(reservation.reservationId));
    } catch (error) {
      sendError(res, error, 'Error cancelling reservation');
    }
  }

  /** POST /orders/from-reservation - payment complete: delete reservation and create PROCESSING order */
  static async convertToOrder(_req: Request, res: Response) {
    const userId = getAuthenticatedCustomerId(res);
    if (userId === null) return;
    try {
      res.status(201).json(await convertReservationToOrder(userId));
    } catch (error) {
      sendError(res, error, 'Error creating order from reservation');
    }
  }

  /** GET /products/:productId/available-quantity */
  static async getAvailableQuantity(req: Request, res: Response) {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      res.status(400).json({ error: 'Invalid product id' });
      return;
    }
    try {
      res.json({ productId, availableQuantity: await getAvailableQuantity(productId) });
    } catch (error) {
      sendError(res, error, 'Error fetching available quantity');
    }
  }

  /** POST /admin/cleanup-reservations */
  static async cleanupExpiredReservations(_req: Request, res: Response) {
    try {
      res.json(await cleanupExpiredReservations());
    } catch (error) {
      sendError(res, error, 'Error cleaning up reservations');
    }
  }
}

export default ReservationController;
