import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { Options as RateLimitOptions } from 'express-rate-limit';
import nunjucks from 'nunjucks';
import { join } from 'node:path';
import { createBasketRouter } from './controllers/basketController';
import { createProductRouter } from './controllers/productController';
import { createCheckoutRouter } from './controllers/checkoutController';
import { createPaymentRouter } from './controllers/paymentController';
import { createDatabaseBasketRepository, type BasketRepository } from './repositories/basketRepository';
import { createDatabaseReservationRepository, type ReservationRepository } from './repositories/reservationRepository';
import { createDatabaseInventoryRepository, type InventoryRepository } from './repositories/inventoryRepository';
import { productRepository, type ProductRepository } from './repositories/productRepository';
import { prismaUserRepository, type UserRepository } from './repositories/userRepository';
import { prismaAdminUserRepository, type adminRepository } from './repositories/adminRepository';
import { AdminUserService } from './services/AdminUserService';
import { createTokenService, type TokenService } from './services/tokenService';
import { adminController } from './controllers/adminController';
import { BasketService } from './services/basketService';
import { ProductService } from './services/productService';
import { UserService } from './services/userService';
import { ReservationService } from './services/checkoutReservationService';
import { OrderService } from './services/orderService';
import { ReservationExpirationJob } from './services/reservationExpirationJob';
import { userController } from './controllers/userController';
import { authController } from './controllers/authController';
import { AuthSessionService } from './services/authSessionService';
import { prismaRefreshSessionRepository, type RefreshSessionRepository } from './repositories/refreshSessionRepository';
import { prismaPasswordResetRepository, type PasswordResetRepository } from './repositories/passwordResetRepository';
import { createConsoleResetDelivery, PasswordResetService, type PasswordResetDelivery } from './services/passwordResetService';
import { passwordResetController } from './controllers/passwordResetController';
import { createReservationRouter } from './controllers/reservationRouter';
import { reservationCleanupMiddleware } from './middleware/reservationCleanup';
import prisma from './prismaClient';

export interface AppDependencies {
	productRepository?: ProductRepository;
	basketRepository?: BasketRepository;
	reservationRepository?: ReservationRepository;
	inventoryRepository?: InventoryRepository;
	userRepository?: UserRepository;
	adminRepository?: adminRepository;
	tokenService?: TokenService;
	refreshSessionRepository?: RefreshSessionRepository;
	authRateLimitOptions?: Partial<RateLimitOptions>;
	trustedProxyAddresses?: string[];
	passwordResetRepository?: PasswordResetRepository;
	passwordResetDelivery?: PasswordResetDelivery;
	startReservationExpirationJob?: boolean;
}

export interface AppWithServices extends Express {
	reservationExpirationJob?: ReservationExpirationJob;
}

export function createApp({
	productRepository: productsRepository = productRepository,
	basketRepository = createDatabaseBasketRepository(prisma),
	reservationRepository = createDatabaseReservationRepository(prisma),
	inventoryRepository = createDatabaseInventoryRepository(prisma),
	userRepository = prismaUserRepository,
	adminRepository = prismaAdminUserRepository,
	tokenService = createTokenService(),
	refreshSessionRepository = prismaRefreshSessionRepository,
	authRateLimitOptions = {},
	trustedProxyAddresses = process.env.TRUSTED_PROXY_IPS?.split(',').map((address) => address.trim()).filter(Boolean) ?? [],
	passwordResetRepository = prismaPasswordResetRepository,
	passwordResetDelivery = createConsoleResetDelivery(),
	startReservationExpirationJob = true,
}: AppDependencies = {}): AppWithServices {
	const app = express() as AppWithServices;
	app.set('trust proxy', trustedProxyAddresses);

	nunjucks.configure(join(import.meta.dirname, 'views'), {
		autoescape: true,
		express: app,
		noCache: process.env.NODE_ENV !== 'production',
	});
	app.set('view engine', 'njk');

	app.use(express.json({ limit: '100kb' }));
	app.use(cookieParser());

	// app.get('/', (_req: Request, res: Response) => {
	//   res.render('index');
	// }); commented out as don't require nunjucks files for backend

	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'UP', time: new Date().toISOString() });
	});
	const userService = new UserService(userRepository);
	const basketService = new BasketService(productsRepository, basketRepository);
	const adminService = new AdminUserService(adminRepository, userRepository, basketService);
	const sessions = new AuthSessionService(tokenService, refreshSessionRepository);

	const productService = new ProductService(productsRepository);
	const reservationService = new ReservationService(
		reservationRepository,
		inventoryRepository,
		productsRepository,
		basketRepository,
	);
	const orderService = new OrderService(prisma, reservationRepository, productsRepository, basketRepository);

	app.use(reservationCleanupMiddleware);
	app.use(userController(userService, sessions, tokenService, authRateLimitOptions));
	app.use(createReservationRouter(tokenService));
	app.use('/products', createProductRouter(productService));
	app.use('/basket', createBasketRouter(basketService, tokenService));
	app.use('/checkout', createCheckoutRouter(reservationService, tokenService));
	app.use('/payment', createPaymentRouter(orderService, tokenService));
	app.use(adminController(adminService, tokenService, sessions, productService, authRateLimitOptions));
	app.use(authController(sessions, adminService, userService));
	app.use(passwordResetController(new PasswordResetService(userRepository, passwordResetRepository, passwordResetDelivery)));

	// Start reservation expiration job
	if (startReservationExpirationJob) {
		const expirationJob = new ReservationExpirationJob(reservationService);
		expirationJob.start();
		app.reservationExpirationJob = expirationJob;
	}

	app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
		if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
			res.status(400).json({ error: 'Malformed JSON body' });
			return;
		}
		next(error);
	});

	return app;
}
