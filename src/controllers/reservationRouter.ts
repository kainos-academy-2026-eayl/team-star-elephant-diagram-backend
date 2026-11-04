import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import ReservationController from './reservationController';

export function createReservationRouter(): Router {
  const router = Router();

  // Checkout - Create reservation from basket
  router.post('/checkout/reserve', authenticateToken, ReservationController.createCheckoutReservation);

  // Get active reservation
  router.get('/reservations/active', authenticateToken, ReservationController.getActiveReservation);

  // Cancel reservation (continue shopping)
  router.post('/reservations/cancel', authenticateToken, ReservationController.cancelReservation);

  // Convert reservation to order (after payment)
  router.post('/orders/from-reservation', authenticateToken, ReservationController.convertToOrder);

  // Get available quantity for product (accounting for reservations)
  router.get('/products/:productId/available-quantity', ReservationController.getAvailableQuantity);

  // Admin cleanup (for testing/admin)
  router.post('/admin/cleanup-reservations', authenticateToken, ReservationController.cleanupExpiredReservations);

  return router;
}

export default createReservationRouter;
