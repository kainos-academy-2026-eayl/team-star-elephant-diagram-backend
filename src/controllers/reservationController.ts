import { Request, Response } from 'express';
import {
  createCheckoutReservation,
  cancelReservation,
  convertReservationToOrder,
  cleanupExpiredReservations,
  getUserReservation,
  getAvailableQuantity
} from '../services/reservationService';

export class ReservationController {
  /**
   * POST /api/checkout/reserve
   * Creates a reservation from user's basket when proceeding to checkout
   */
  static async createCheckoutReservation(req: Request, res: Response) {
    try {
      const userId = (req.user as { id: number }).id;

      const result = await createCheckoutReservation(userId);
      res.status(201).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error creating reservation';
      res.status(400).json({ success: false, message });
    }
  }

  /**
   * GET /api/reservations/active
   * Gets the user's active reservation with remaining time
   */
  static async getActiveReservation(req: Request, res: Response) {
    try {
      const userId = (req.user as { id: number }).id;

      const reservation = await getUserReservation(userId);

      if (!reservation) {
        return res.status(404).json({
          message: 'No active reservation',
          reservation: null
        });
      }

      res.json({ reservation });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error fetching reservation';
      res.status(400).json({ message });
    }
  }

  /**
   * POST /api/reservations/cancel
   * Cancels the user's reservation and returns stock
   * Called when user clicks "continue shopping"
   */
  static async cancelReservation(req: Request, res: Response) {
    try {
      const userId = (req.user as { id: number }).id;

      const reservation = await getUserReservation(userId);

      if (!reservation) {
        return res.status(404).json({
          message: 'No active reservation to cancel'
        });
      }

      const result = await cancelReservation(reservation.reservationId);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error cancelling reservation';
      res.status(400).json({ message });
    }
  }

  /**
   * POST /api/orders/from-reservation
   * Converts user's reservation to an order after successful payment
   */
  static async convertToOrder(req: Request, res: Response) {
    try {
      const userId = (req.user as { id: number }).id;
      const { totalCost, paymentMethod } = req.body;

      if (!totalCost) {
        return res.status(400).json({ message: 'totalCost is required' });
      }

      const reservation = await getUserReservation(userId);

      if (!reservation) {
        return res.status(404).json({
          message: 'No active reservation. Please proceed to checkout again.'
        });
      }

      const result = await convertReservationToOrder(
        reservation.reservationId,
        userId,
        totalCost,
        paymentMethod
      );

      res.status(201).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error creating order from reservation';
      res.status(400).json({ message });
    }
  }

  /**
   * GET /api/products/:productId/available-quantity
   * Gets available quantity for a product (accounting for reservations)
   */
  static async getAvailableQuantity(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const available = await getAvailableQuantity(Number(productId));

      res.json({ productId: Number(productId), availableQuantity: available });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error fetching available quantity';
      res.status(400).json({ message });
    }
  }

  /**
   * POST /admin/cleanup-reservations
   * Manually cleanup expired reservations
   */
  static async cleanupExpiredReservations(req: Request, res: Response) {
    try {
      const result = await cleanupExpiredReservations();
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error cleaning up reservations';
      res.status(400).json({ message });
    }
  }
}

export default ReservationController;
