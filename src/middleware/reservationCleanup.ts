import { Request, Response, NextFunction } from 'express';
import { cleanupExpiredReservations } from '../services/reservationService';

let lastCleanupTime = Date.now();
const CLEANUP_INTERVAL_MS = 60000; // Run cleanup every 1 minute

/**
 * Middleware to periodically clean up expired reservations
 * Runs every 1 minute to prevent old reservations from blocking stock
 */
export async function reservationCleanupMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const now = Date.now();

  // Only run cleanup if enough time has passed since last cleanup
  if (now - lastCleanupTime >= CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;

    try {
      await cleanupExpiredReservations().catch(error => {
        console.error('Reservation cleanup middleware error:', error);
        // Don't block the request on cleanup error
      });
    } catch (error) {
      console.error('Reservation cleanup error:', error);
      // Continue regardless of cleanup errors
    }
  }

  next();
}

export default reservationCleanupMiddleware;
