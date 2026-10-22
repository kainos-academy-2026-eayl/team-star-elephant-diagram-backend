import { Router, type Request, type Response } from 'express';
import type { ProductService } from '../services/productService';

export function createProductRouter(productService: ProductService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const products = await productService.getProducts();
      res.status(200).json(products);
    } catch (error) {
      console.error('Product retrieval failed.', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
