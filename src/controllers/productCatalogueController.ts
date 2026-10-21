import { Router, type Request, type Response } from 'express';
import type { ProductCatalogueService } from '../services/productCatalogueService';

export function createProductCatalogueRouter(productCatalogueService: ProductCatalogueService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const products = await productCatalogueService.getProducts();
      res.status(200).json(products);
    } catch (error) {
      console.error('Product catalogue retrieval failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
