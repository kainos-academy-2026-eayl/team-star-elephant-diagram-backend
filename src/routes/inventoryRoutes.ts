import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import { InventoryController } from '../controllers/inventoryController';
import { requireAdmin, requirePermission } from '../middleware/requireAdmin';
import type { AdminUserService } from '../services/AdminUserService';
import { InventoryError, type InventoryService } from '../services/inventoryService';
import type { TokenService } from '../services/tokenService';
import {
	inventoryIdSchema, inventoryPaginationSchema, inventoryQuerySchema,
	stockAdjustmentSchema, thresholdSchema,
} from '../validators/inventorySchema';

const validate: RequestHandler = (req, res, next) => {
	const input = res.locals.inventoryRequest ?? {};
	if (req.params.id !== undefined) input.productId = inventoryIdSchema.parse(req.params).id;
	if (req.method === 'GET') {
		if (req.params.id === undefined) input.query = inventoryQuerySchema.parse(req.query);
		else input.pagination = inventoryPaginationSchema.parse(req.query);
	} else if (req.path.endsWith('/stock')) {
		input.adjustment = stockAdjustmentSchema.parse(req.body);
	} else {
		input.threshold = thresholdSchema.parse(req.body);
	}
	res.locals.inventoryRequest = input;
	next();
};

export const inventoryErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
	if (error instanceof z.ZodError) {
		res.status(400).json({ error: 'Invalid inventory request', details: z.flattenError(error).fieldErrors });
		return;
	}
	if (error instanceof InventoryError) {
		res.status(error.status).json({ error: error.message });
		return;
	}
	console.error('Inventory request failed', error);
	res.status(500).json({ error: 'Internal server error' });
};

export function createInventoryRouter(service: InventoryService, admins: AdminUserService, tokens: TokenService) {
	const router = Router();
	const controller = new InventoryController(service);
	// A valid customer JWT is authenticated but never authorised for the admin inventory API.
	router.use(async (req, res, next) => {
		const header = req.headers.authorization ?? '';
		const token = header.startsWith('Bearer ') ? header.slice(7) : '';
		if (token && await tokens.verifyCustomerAccessToken(token)) {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}
		next();
	});
	router.use(requireAdmin(tokens));
	router.use(async (_req, res, next) => {
		const admin = await admins.findById(res.locals.admin?.adminId ?? -1);
		if (!admin) {
			res.status(401).json({ error: 'Authentication required' });
			return;
		}
		if (admin.role !== 'InventoryManager' && admin.role !== 'WarehouseStaff') {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}
		res.locals.currentAdmin = admin;
		res.set('Cache-Control', 'no-store');
		next();
	});
	router.get('/', requirePermission('inventory', 'view'), validate, controller.getInventory);
	router.get('/:id', requirePermission('inventory', 'view'), validate, controller.getInventoryItem);
	router.get('/:id/history', requirePermission('inventory', 'view'), validate, controller.getHistory);
	router.patch('/:id/stock', requirePermission('inventory', 'update'), validate, controller.adjustStock);
	router.patch('/:id/threshold', (_req, res, next) => {
		if (res.locals.currentAdmin?.role !== 'InventoryManager') {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}
		next();
	}, requirePermission('inventory', 'update'), validate, controller.updateThreshold);
	router.use(inventoryErrorHandler);
	return router;
}
