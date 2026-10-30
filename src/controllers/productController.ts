import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ProductNotFoundError, type ProductService } from '../services/productService';
import { productIdParamSchema } from '../validators/productIdSchema';

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

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = productIdParamSchema.parse({ id: req.params.id });

      const product = await productService.getProductById(id);
      res.status(200).json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid product ID', details: z.flattenError(error).fieldErrors });
        return;
      }

      if (error instanceof ProductNotFoundError) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      console.error('Product retrieval failed.', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
