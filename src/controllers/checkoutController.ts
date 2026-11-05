import { Router, type Request, type Response } from 'express';
import type { ReservationService } from '../services/checkoutReservationService';
import type { TokenService } from '../services/tokenService';
import { ReservationError, InsufficientInventoryError } from '../services/checkoutReservationService';

export function createCheckoutRouter(
	reservationService: ReservationService,
	tokenService: TokenService,
): Router {
	const router = Router();

	async function requireCustomerAuth(req: Request, res: Response): Promise<number | null> {
		const header = req.get('authorization') ?? '';
		const match = header.match(/^Bearer\s+(.+)$/);
		const token = match?.[1];

		if (!token) {
			res.status(401).json({ error: 'Authentication required' });
			return null;
		}

		const payload = await tokenService.verifyCustomerAccessToken(token);
		if (!payload || typeof (payload as { userId?: unknown }).userId !== 'number') {
			res.status(401).json({ error: 'Invalid or expired token' });
			return null;
		}

		return (payload as { userId: number }).userId;
	}

	router.post('/reservation', async (req: Request, res: Response) => {
		const userId = await requireCustomerAuth(req, res);
		if (userId === null) return;

		try {
			const reservation = await reservationService.createFromBasket(userId);
			res.status(201).json({
				reservation: {
					reservationId: reservation.reservationId,
					items: reservation.items,
					expiresAt: reservation.expiresAt,
				},
			});
		} catch (error) {
			if (error instanceof InsufficientInventoryError) {
				res.status(400).json({ error: error.message });
				return;
			}
			if (error instanceof ReservationError) {
				res.status(400).json({ error: error.message });
				return;
			}
			console.error('Reservation creation failed.', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	router.get('/reservation', async (req: Request, res: Response) => {
		const userId = await requireCustomerAuth(req, res);
		if (userId === null) return;

		try {
			const reservation = await reservationService.getReservation(userId);
			if (!reservation) {
				res.status(404).json({ error: 'No active reservation' });
				return;
			}

			res.status(200).json({ reservation });
		} catch (error) {
			console.error('Reservation retrieval failed.', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	return router;
}
