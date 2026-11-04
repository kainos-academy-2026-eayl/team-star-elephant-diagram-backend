import { Router, type NextFunction, type Request, type Response } from 'express';
import { createAuthRateLimiter } from '../middleware/authRateLimiter';
import { requireAdmin } from '../middleware/requireAdmin';
import type { TokenService } from '../services/tokenService';
import ReservationController from './reservationController';

function requireCustomer(tokens: TokenService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? await tokens.verifyCustomerAccessToken(token) : null;

    if (!payload || typeof payload.userId !== 'number') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    res.locals.customerId = payload.userId;
    next();
  };
}

export function createReservationRouter(tokens: TokenService): Router {
  const router = Router();
  const requireCustomerAuth = requireCustomer(tokens);

  // Checkout - Create reservation from basket
  router.post('/checkout/reserve', createAuthRateLimiter(), requireCustomerAuth, ReservationController.createCheckoutReservation);

  // Get active reservation
  router.get('/reservations/active', createAuthRateLimiter(), requireCustomerAuth, ReservationController.getActiveReservation);

  // Cancel reservation (continue shopping)
  router.post('/reservations/cancel', createAuthRateLimiter(), requireCustomerAuth, ReservationController.cancelReservation);

  // Convert reservation to order (after payment)
  router.post('/orders/from-reservation', createAuthRateLimiter(), requireCustomerAuth, ReservationController.convertToOrder);

  // Get available quantity for product (accounting for reservations)
  router.get('/products/:productId/available-quantity', ReservationController.getAvailableQuantity);

  // Admin cleanup (for testing/admin)
  router.post('/admin/cleanup-reservations', createAuthRateLimiter(), requireAdmin(tokens), ReservationController.cleanupExpiredReservations);

  return router;
}

export default createReservationRouter;
