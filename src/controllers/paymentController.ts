import { Router, type Request, type Response } from 'express';
import type { PaymentService } from '../services/paymentService';

export function createPaymentRouter(paymentService: PaymentService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const paymentDetails = await paymentService.getPaymentDetails();
      res.status(200).json(paymentDetails);
    } catch (error) {
      console.error('Payment details retrieval failed.', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
