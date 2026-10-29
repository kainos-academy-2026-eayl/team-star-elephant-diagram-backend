import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ProductNotFoundError, type ExpandProductService } from '../services/expandProductService';
import { expandProductParamSchema } from '../validators/expandProductSchema';

export function createExpandProductRouter(expandProductService: ExpandProductService): Router {
  const router = Router();

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = expandProductParamSchema.parse({ id: req.params.id });

      const product = await expandProductService.getProductExpanded(id);
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


