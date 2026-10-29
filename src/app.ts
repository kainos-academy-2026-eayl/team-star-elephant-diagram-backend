import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import nunjucks from 'nunjucks';
import { join } from 'node:path';
import { createBasketRouter } from './controllers/basketController';
import { createExpandProductRouter } from './controllers/expandProductController';
import { createProductRouter } from './controllers/productController';
import { createInMemoryBasketRepository, type BasketRepository } from './repositories/basketRepository';
import { productRepository, type ProductRepository } from './repositories/productRepository';
import { prismaUserRepository, type UserRepository } from './repositories/userRepository';
import { prismaAdminUserRepository, type adminRepository } from './repositories/adminRepository';
import { AdminUserService } from './services/AdminUserService';
import { createTokenService, type TokenService } from './services/tokenService';
import { adminController } from './controllers/adminController';
import { BasketService } from './services/basketService';
import { ExpandProductService } from './services/expandProductService';
import { ProductService } from './services/productService';
import { UserService } from './services/userService';
import { userController } from './controllers/userController';

export interface AppDependencies {
	productRepository?: ProductRepository;
	basketRepository?: BasketRepository;
	userRepository?: UserRepository;
	adminRepository?: adminRepository;
	tokenService?: TokenService;
}

export function createApp({
	productRepository: productsRepository = productRepository,
	basketRepository = createInMemoryBasketRepository(),
	userRepository = prismaUserRepository,
	adminRepository = prismaAdminUserRepository,
	tokenService = createTokenService(),
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

	app.use(adminController(new AdminUserService(adminRepository), tokenService));
	app.use(userController(userService));
	app.use('/products', createProductRouter(new ProductService(productsRepository)));
	app.use('/products', createExpandProductRouter(new ExpandProductService(productsRepository)));
	app.use('/basket', createBasketRouter(new BasketService(productsRepository, basketRepository)));

	app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
		if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
			res.status(400).json({ error: 'Malformed JSON body' });
			return;
		}
		next(error);
	});

	return app;
}
