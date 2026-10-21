import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import nunjucks from 'nunjucks';
import { join } from 'node:path';
import { createProductCatalogueRouter } from './controllers/productCatalogueController';
import { createRegisterRouter } from './controllers/registerController';
import { productCatalogueRepository, type ProductCatalogueRepository } from './repositories/productCatalogueRepository';
import { prismaUserRepository, type UserRepository } from './repositories/userRepository';
import { ProductCatalogueService } from './services/productCatalogueService';
import { UserService } from './services/userService';
import { userController } from './controllers/userController';

export interface AppDependencies {
  productCatalogueRepository?: ProductCatalogueRepository;
  userRepository?: UserRepository;
}

export function createApp({
  productCatalogueRepository: catalogueRepository = productCatalogueRepository,
  userRepository = prismaUserRepository,
}: AppDependencies = {}): Express {
  const app = express();

  nunjucks.configure(join(import.meta.dirname, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  });
  app.set('view engine', 'njk');

  app.use(express.json({ limit: '100kb' }));

  // app.get('/', (_req: Request, res: Response) => {
  //   res.render('index');
  // }); commented out as don't require nunjucks files for backend

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'UP', time: new Date().toISOString() });
  });
  const userService = new UserService(userRepository);

  app.use('/register', createRegisterRouter(new UserService(userRepository)));
  app.use('/product_catalogue', createProductCatalogueRouter(new ProductCatalogueService(catalogueRepository)));

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    next(error);
  });

  return app;
}
