import { Router, type Request, type Response } from 'express';
import type { OrderService } from '../services/orderService';
import type { TokenService } from '../services/tokenService';
import { OrderError, ReservationNotFoundError } from '../services/orderService';

export function createPaymentRouter(
	orderService: OrderService,
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

	router.post('/complete-payment', async (req: Request, res: Response) => {
		const userId = await requireCustomerAuth(req, res);
		if (userId === null) return;

		const { reservationId } = req.body ?? {};
		if (!Number.isInteger(reservationId) || reservationId <= 0 || reservationId > 2147483647) {
			res.status(400).json({ error: 'reservationId is required and must be a positive 32-bit integer' });
			return;
		}

		try {
			const order = await orderService.createOrderFromReservation(userId, reservationId);
			res.status(201).json({
				order: {
					orderId: order.orderId,
					items: order.items,
					cost: order.cost,
					shippingFee: order.shippingFee,
					orderStatus: order.orderStatus,
					orderPlacedAt: order.orderPlacedAt,
				},
			});
		} catch (error) {
			if (error instanceof ReservationNotFoundError) {
				res.status(404).json({ error: error.message });
				return;
			}
			if (error instanceof OrderError) {
				res.status(400).json({ error: error.message });
				return;
			}
			console.error('Order creation failed.', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	router.get('/', async (_req: Request, res: Response) => {
		try {
			res.status(200).json({ message: 'Payment service is available' });
		} catch (error) {
			console.error('Payment details retrieval failed.', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	return router;
}

