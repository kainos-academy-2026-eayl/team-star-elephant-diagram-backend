import type { NextFunction, Request, Response } from 'express';
import { cleanupExpiredReservations } from '../services/reservationService';

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupTime = Date.now();

/**
 * Marks expired reservations as EXPIRED (keeping the record) and returns their stock, at most once a minute.
 * Runs in the background so it never delays the request.
 */
export function reservationCleanupMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  const now = Date.now();
  if (now - lastCleanupTime >= CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    cleanupExpiredReservations().catch((error) => {
      console.error('Reservation cleanup failed:', error);
    });
  }
  next();
}

export default reservationCleanupMiddleware;
