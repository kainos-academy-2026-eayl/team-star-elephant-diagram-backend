import argon2 from 'argon2';
import type { OrderStatus } from '@prisma/client';
import {
	DASHBOARD_BY_ROLE,
	hasPermission,
	isAdminRole,
	type AdminPermission,
	type AdminResource,
	type AdminRole,
} from '../models/adminRoles';
import type {
	AdminBasketDetailsResponse,
	AdminBasketListResponse,
	AdminBasketSummary,
	AdminDashboardResponse,
	AdminOrderDetailsResponse,
	AdminOrderListResponse,
	AdminUserDetailsResponse,
	AdminUserListResponse,
	AdminUserStatusResponse,
	AdminUserSummary,
} from '../models/AdminUser';
import type { UserStatus } from '../models/user';
import type { adminRepository, AdminOrderSummaryRecord } from '../repositories/adminRepository';
import type { UserRepository, UserSummaryRecord } from '../repositories/userRepository';
import { BasketItemNotFoundError, BasketQuantityError, type BasketService, type PricedBasketRecord } from './basketService';
import { ProductNotFoundError } from './productService';
import { MAX_ITEM_QUANTITY } from '../validators/basketSchema';
import type { LoginRequest } from '../validators/loginSchema';

export type AdminBasketErrorCode = 'not_found' | 'customer_not_found' | 'product_not_found' | 'item_not_found' | 'exists' | 'stock';

// Carries an HTTP-mappable code so the controller can return a precise status and message.
export class AdminBasketError extends Error {
	constructor(
		readonly code: AdminBasketErrorCode,
		message: string,
		readonly basketId?: number,
	) {
		super(message);
	}
}

const ADMIN_USERS_PAGE_SIZE = 20;
const ADMIN_BASKETS_PAGE_SIZE = 20;
const ADMIN_ORDERS_PAGE_SIZE = 20;
const ADMIN_USER_RECENT_ORDERS = 5;

// Fulfilment workflow: PENDING -> PROCESSING -> SHIPPED -> DELIVERED; cancellation only before shipping.
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
	PENDING: ['PROCESSING', 'CANCELLED'],
	PROCESSING: ['SHIPPED', 'CANCELLED'],
	SHIPPED: ['DELIVERED'],
	DELIVERED: [],
	CANCELLED: [],
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus) => ORDER_STATUS_TRANSITIONS[from].includes(to);

export class InvalidOrderStatusTransitionError extends Error {
	constructor(
		readonly from: OrderStatus,
		readonly to: OrderStatus,
	) {
		super(`Cannot change order status from ${from} to ${to}`);
		this.name = 'InvalidOrderStatusTransitionError';
	}
}
const DASHBOARD_NEW_USERS = 5;

export class InvalidCredentialsError extends Error {
	constructor(message = 'Invalid email or password') {
		super(message);
		this.name = 'InvalidCredentialsError';
	}
}

export class UnknownAdminRoleError extends Error {
	constructor(role: string) {
		super(`Admin has unrecognised role: ${role}`);
		this.name = 'UnknownAdminRoleError';
	}
}

export interface AuthenticatedAdmin {
	adminId: number;
	forename: string;
	surname: string;
	email: string;
	role: AdminRole;
	dashboard: string;
}

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

const toAdminStatus = (status: UserStatus) =>
	status === 'SUSPENDED' ? 'suspended' : 'active';

const toUserSummary = (user: UserSummaryRecord): AdminUserSummary => ({
	id: user.userId,
	name: `${user.forename} ${user.surname}`,
	email: user.email,
	registeredAt: user.createdAt.toISOString(),
	status: toAdminStatus(user.status),
});

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const formatPrice = (amount: number) => gbp.format(amount);
const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const basketStatus = (basket: PricedBasketRecord) => (basket.itemCount > 0 ? 'Active' : 'Empty');

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

// Dashboard sections and quick actions, each shown only when the role holds the permission.
const DASHBOARD_SECTIONS = [
	{ label: 'Users', resource: 'users', action: 'view' },
	{ label: 'Baskets', resource: 'baskets', action: 'view' },
	{ label: 'Orders', resource: 'orders', action: 'view' },
	{ label: 'Inventory', resource: 'inventory', action: 'view' },
	{ label: 'Finance', resource: 'finance', action: 'view' },
] as const satisfies readonly (AdminPermission & { label: string })[];

const DASHBOARD_QUICK_ACTIONS = [
	{ label: 'Suspend or reactivate customers', resource: 'users', action: 'suspend' },
	{ label: 'Permanently delete customers', resource: 'users', action: 'delete' },
	{ label: 'Update order status', resource: 'orders', action: 'update' },
	{ label: 'Add product', resource: 'inventory', action: 'create' },
	{ label: 'Update finance records', resource: 'finance', action: 'update' },
] as const satisfies readonly (AdminPermission & { label: string })[];

const NO_PERMISSIONS = { view: false, create: false, update: false, delete: false } as const;

const stockMessage = (available: number, current: number): string => {
	const limit = Math.min(available, MAX_ITEM_QUANTITY);
	if (available < 1) return 'This product is out of stock';
	const room = Math.max(0, limit - current);
	return current > 0
		? `Only ${room} more can be added (${limit} maximum, ${current} already in basket)`
		: `Quantity cannot exceed ${limit} (${available} in stock)`;
};

const toBasketSummary = (basket: PricedBasketRecord): AdminBasketSummary => ({
	basketId: basket.basketId,
	customerName: `${basket.customer.forename} ${basket.customer.surname}`,
	customerEmail: basket.customer.email,
	itemCount: basket.itemCount,
	total: formatPrice(basket.subtotal),
	lastActivity: formatDate(basket.updatedAt),
	status: basketStatus(basket),
});

const toMoney = (amount: { toString(): string }) => Number(amount.toString());
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

const toOrderSummary = (order: AdminOrderSummaryRecord) => ({
	orderId: order.orderId,
	customer: { id: order.user.userId, name: `${order.user.forename} ${order.user.surname}`, email: order.user.email },
	status: order.orderStatus,
	orderDate: order.orderPlacedAt.toISOString(),
	totalCost: toMoney(order.cost),
});

export class AdminUserService {
	constructor(
		private readonly admins: adminRepository,
		private readonly users: UserRepository,
		private readonly baskets: BasketService,
	) {}

	async login(data: LoginRequest): Promise<AuthenticatedAdmin> {
		const admin = await this.admins.findByEmail(data.email);

		if (!admin) {
			throw new InvalidCredentialsError();
		}

		let valid = false;
		try {
			valid = await argon2.verify(admin.passwordHash, data.password);
		} catch {
			// Malformed stored hashes must not authenticate.
		}

		if (!valid) {
			throw new InvalidCredentialsError();
		}
		if (!isAdminRole(admin.role)) {
			throw new UnknownAdminRoleError(admin.role);
		}

		return {
			adminId: admin.adminId,
			forename: admin.forename,
			surname: admin.surname,
			email: admin.email,
			role: admin.role,
			dashboard: DASHBOARD_BY_ROLE[admin.role],
		};
	}

	async findById(adminId: number): Promise<AuthenticatedAdmin | null> {
		const admin = await this.admins.findById(adminId);
		if (!admin || !isAdminRole(admin.role)) return null;
		return {
			adminId: admin.adminId,
			forename: admin.forename,
			surname: admin.surname,
			email: admin.email,
			role: admin.role,
			dashboard: DASHBOARD_BY_ROLE[admin.role],
		};
	}

	async listUsers({ search, page = 1 }: { search?: string | undefined; page?: number | undefined }): Promise<AdminUserListResponse> {
		const pageSize = ADMIN_USERS_PAGE_SIZE;
		const { users, total } = await this.users.list({
			search,
			skip: (page - 1) * pageSize,
			take: pageSize,
		});
		return {
			users: users.map(toUserSummary),
			pagination: {
				page,
				pageSize,
				totalPages: Math.max(1, Math.ceil(total / pageSize)),
				totalUsers: total,
			},
		};
	}

	async getUserDetails(userId: number): Promise<AdminUserDetailsResponse | null> {
		const user = await this.users.findById(userId);
		if (!user) return null;
		const orders = await this.users.findRecentOrders(userId, ADMIN_USER_RECENT_ORDERS);
		const basket = await this.baskets.getBasket(userId);
		return {
			user: toUserSummary(user),
			recentOrders: orders.map((order) => ({
				id: order.orderId,
				placedAt: order.orderPlacedAt.toISOString(),
				status: order.orderStatus.toLowerCase(),
				total: Number(order.cost.toString()),
			})),
			basket: {
				itemCount: basket.items.reduce((count, item) => count + item.quantity, 0),
				subtotal: basket.subtotal,
				items: basket.items.map(({ productName, quantity }) => ({ productName, quantity })),
			},
		};
	}

	async listBaskets(search: string | undefined, page = 1): Promise<AdminBasketListResponse> {
		const { baskets, total } = await this.baskets.listBaskets(search, page);
		return {
			baskets: baskets.map(toBasketSummary),
			pagination: {
				page,
				pageSize: ADMIN_BASKETS_PAGE_SIZE,
				totalPages: Math.max(1, Math.ceil(total / ADMIN_BASKETS_PAGE_SIZE)),
				totalBaskets: total,
			},
		};
	}

	async getBasketDetails(basketId: number): Promise<AdminBasketDetailsResponse | null> {
		const basket = await this.baskets.getBasketById(basketId);
		if (!basket) return null;
		const summary = toBasketSummary(basket);
		const products = await this.admins.getProductStock();
		const stock = new Map(products.map((product) => [product.productId, product.availableStock]));
		const missing = basket.items.map((item) => item.productId).filter((id) => !stock.has(id));
		if (missing.length > 0) {
			for (const product of await this.admins.getProductStock(missing)) {
				stock.set(product.productId, product.availableStock);
			}
		}
		const inBasket = new Set(basket.items.map((item) => item.productId));
		return {
			basket: {
				basketId: summary.basketId,
				createdAt: formatDate(basket.createdAt),
				lastActivity: summary.lastActivity,
				status: summary.status,
				customer: { id: basket.userId, name: summary.customerName, email: summary.customerEmail },
				items: basket.items.map((item) => {
					const availableStock = stock.get(item.productId) ?? 0;
					return {
						productId: item.productId,
						productName: item.productName,
						quantity: item.quantity,
						unitPrice: formatPrice(item.unitPrice),
						totalPrice: formatPrice(Math.round(item.unitPrice * item.quantity * 100) / 100),
						availableStock,
						maxQuantity: Math.min(availableStock, MAX_ITEM_QUANTITY),
						exceedsStock: item.quantity > availableStock,
					};
				}),
				itemCount: summary.itemCount,
				total: summary.total,
			},
			products: products
				.filter((product) => product.availableStock > 0 && !inBasket.has(product.productId))
				.map((product) => ({
					productId: product.productId,
					name: product.name,
					unitPrice: formatPrice(product.price),
					availableStock: product.availableStock,
					maxQuantity: Math.min(product.availableStock, MAX_ITEM_QUANTITY),
				})),
		};
	}

	// Gets or creates the customer's single basket; throws 'exists' when one is already present.
	async createBasket(email: string): Promise<{ basketId: number }> {
		const user = await this.users.findByEmail(email);
		if (!user) throw new AdminBasketError('customer_not_found', 'No customer has that email address');
		const { basketId, created } = await this.baskets.createBasket(user.userId);
		if (!created) throw new AdminBasketError('exists', 'This customer already has a basket', basketId);
		return { basketId };
	}

	async addBasketItem(basketId: number, productId: number, quantity: number): Promise<AdminBasketDetailsResponse> {
		const basket = await this.requireBasket(basketId);
		const available = await this.availableStock(productId);
		const current = basket.items.find((item) => item.productId === productId)?.quantity ?? 0;
		const limit = Math.min(available, MAX_ITEM_QUANTITY);
		if (current + quantity > limit) {
			throw new AdminBasketError('stock', stockMessage(available, current));
		}
		try {
			await this.baskets.addItem(basket.userId, productId, quantity, limit);
		} catch (error) {
			throw this.toBasketError(error, available, current);
		}
		return this.requireDetails(basketId);
	}

	async updateBasketItem(basketId: number, productId: number, quantity: number): Promise<AdminBasketDetailsResponse> {
		const basket = await this.requireBasket(basketId);
		if (!basket.items.some((item) => item.productId === productId)) {
			throw new AdminBasketError('item_not_found', 'That product is not in this basket');
		}
		const available = await this.availableStock(productId);
		if (quantity > Math.min(available, MAX_ITEM_QUANTITY)) {
			throw new AdminBasketError('stock', stockMessage(available, 0));
		}
		try {
			await this.baskets.updateItemQuantity(basket.userId, productId, quantity, available);
		} catch (error) {
			throw this.toBasketError(error, available, 0);
		}
		return this.requireDetails(basketId);
	}

	async removeBasketItem(basketId: number, productId: number): Promise<AdminBasketDetailsResponse> {
		const basket = await this.requireBasket(basketId);
		try {
			await this.baskets.removeItem(basket.userId, productId);
		} catch (error) {
			throw this.toBasketError(error, 0, 0);
		}
		return this.requireDetails(basketId);
	}

	async clearBasket(basketId: number): Promise<AdminBasketDetailsResponse> {
		if (!(await this.baskets.clearBasket(basketId))) {
			throw new AdminBasketError('not_found', 'Basket not found');
		}
		return this.requireDetails(basketId);
	}

	async deleteBasket(basketId: number): Promise<boolean> {
		return this.baskets.deleteBasket(basketId);
	}

	private async requireBasket(basketId: number): Promise<PricedBasketRecord> {
		const basket = await this.baskets.getBasketById(basketId);
		if (!basket) throw new AdminBasketError('not_found', 'Basket not found');
		return basket;
	}

	private async requireDetails(basketId: number): Promise<AdminBasketDetailsResponse> {
		const details = await this.getBasketDetails(basketId);
		if (!details) throw new AdminBasketError('not_found', 'Basket not found');
		return details;
	}

	private async availableStock(productId: number): Promise<number> {
		const [product] = await this.admins.getProductStock([productId]);
		if (!product) throw new AdminBasketError('product_not_found', 'Product not found');
		return product.availableStock;
	}

	private toBasketError(error: unknown, available: number, current: number): unknown {
		if (error instanceof ProductNotFoundError) return new AdminBasketError('product_not_found', 'Product not found');
		if (error instanceof BasketItemNotFoundError) {
			return new AdminBasketError('item_not_found', 'That product is not in this basket');
		}
		if (error instanceof BasketQuantityError) return new AdminBasketError('stock', stockMessage(available, current));
		return error;
	}

	async listOrders({
		search,
		status,
		page = 1,
	}: {
		search?: string | undefined;
		status?: OrderStatus | undefined;
		page?: number | undefined;
	}): Promise<AdminOrderListResponse> {
		const pageSize = ADMIN_ORDERS_PAGE_SIZE;
		const { orders, total } = await this.admins.listOrders({
			search,
			status,
			skip: (page - 1) * pageSize,
			take: pageSize,
		});
		return {
			orders: orders.map(toOrderSummary),
			pagination: {
				page,
				pageSize,
				totalPages: Math.max(1, Math.ceil(total / pageSize)),
				totalOrders: total,
			},
		};
	}

	async getOrderDetails(orderId: number): Promise<AdminOrderDetailsResponse | null> {
		const order = await this.admins.findOrderById(orderId);
		if (!order) return null;
		const { customer, ...summary } = toOrderSummary(order);
		return {
			order: {
				orderId: summary.orderId,
				status: summary.status,
				orderDate: summary.orderDate,
				lastUpdated: order.modifiedAt.toISOString(),
				customer: {
					...customer,
					address: {
						line1: order.user.addressLine1,
						line2: order.user.addressLine2,
						city: order.user.city,
						postcode: order.user.postcode,
					},
				},
				items: order.orderItems.map((item) => {
					const unitPrice = toMoney(item.product.price);
					return {
						productId: item.productId,
						productName: item.product.name,
						quantity: item.quantity,
						unitPrice,
						itemTotal: roundMoney(unitPrice * item.quantity),
					};
				}),
				itemCount: order.orderItems.reduce((count, item) => count + item.quantity, 0),
				orderTotal: summary.totalCost,
				allowedTransitions: [...ORDER_STATUS_TRANSITIONS[order.orderStatus]],
			},
		};
	}

	// Returns null when the order does not exist; throws InvalidOrderStatusTransitionError for disallowed changes.
	async updateOrderStatus(orderId: number, status: OrderStatus): Promise<AdminOrderDetailsResponse | null> {
		const order = await this.admins.findOrderById(orderId);
		if (!order) return null;
		if (!canTransitionOrder(order.orderStatus, status)) {
			throw new InvalidOrderStatusTransitionError(order.orderStatus, status);
		}
		if (!(await this.admins.updateOrderStatus(orderId, order.orderStatus, status))) {
			// Status changed concurrently; report against the latest stored status.
			const latest = await this.admins.findOrderById(orderId);
			if (!latest) return null;
			throw new InvalidOrderStatusTransitionError(latest.orderStatus, status);
		}
		return this.getOrderDetails(orderId);
	}

	async setUserStatus(userId: number, status: UserStatus): Promise<AdminUserStatusResponse | null> {
		const updated = await this.users.updateStatus(userId, status);
		if (!updated) return null;
		return { user: { id: updated.userId, status: toAdminStatus(updated.status) } };
	}

	async deleteUser(userId: number): Promise<boolean> {
		return this.users.delete(userId);
	}

	// Only loads and returns data the admin's role is permitted to view.
	async getDashboard(admin: AuthenticatedAdmin): Promise<AdminDashboardResponse> {
		if (admin.role === 'FinanceManager') {
			const orders = await this.admins.getOrderMetrics();
			return {
				staff: { name: `${admin.forename} ${admin.surname}` },
				inventoryPermissions: NO_PERMISSIONS,
				basketPermissions: NO_PERMISSIONS,
				inventorySummary: null,
				role: admin.role,
				dashboard: admin.dashboard,
				sections: [],
				quickActions: [],
				cards: [
					{ label: 'Revenue', value: formatPrice(orders.revenue) },
					{ label: 'Orders', value: String(orders.totalOrders) },
					{ label: 'Pending orders', value: String(orders.pendingOrders) },
				],
				recentOrders: [],
				newUsers: [],
				stockChanges: [],
				lowStock: null,
			};
		}
		const can = (resource: AdminResource, action: string) => hasPermission(admin.role, resource, action);
		const [users, baskets, orders, inventory] = await Promise.all([
			can('users', 'view') ? this.users.list({ skip: 0, take: DASHBOARD_NEW_USERS }) : null,
			can('baskets', 'view') ? this.baskets.listBaskets(undefined, 1) : null,
			can('orders', 'view') || can('finance', 'view') ? this.admins.getOrderMetrics() : null,
			can('inventory', 'view') ? this.admins.getInventoryMetrics() : null,
		]);

		const cards: AdminDashboardResponse['cards'] = [];
		if (users) cards.push({ label: 'Customers', value: String(users.total) });
		if (baskets) cards.push({ label: 'Customer baskets', value: String(baskets.total) });
		if (orders && can('orders', 'view')) {
			cards.push({ label: 'Orders', value: String(orders.totalOrders) });
			cards.push({ label: 'Pending orders', value: String(orders.pendingOrders) });
		}
		if (orders && can('finance', 'view')) cards.push({ label: 'Revenue', value: formatPrice(orders.revenue) });
		if (inventory) {
			cards.push({ label: 'Units in stock', value: String(inventory.unitsInStock) });
			cards.push({ label: 'Low stock lines', value: String(inventory.lowStockLines) });
		}

		return {
			staff: { name: `${admin.forename} ${admin.surname}` },
			inventoryPermissions: {
				view: can('inventory', 'view'), create: can('inventory', 'create'),
				update: can('inventory', 'update'), delete: can('inventory', 'delete'),
			},
			basketPermissions: {
				view: can('baskets', 'view'), create: can('baskets', 'create'),
				update: can('baskets', 'update'), delete: can('baskets', 'delete'),
			},
			inventorySummary: inventory ? {
				totalProducts: inventory.totalProducts,
				lowStockProducts: inventory.lowStockProducts,
				outOfStockProducts: inventory.outOfStockProducts,
			} : null,
			lowStock: inventory ? { total: inventory.lowStockLines, items: inventory.lowStockItems } : null,
			role: admin.role,
			dashboard: admin.dashboard,
			sections: DASHBOARD_SECTIONS.filter((s) => can(s.resource, s.action)).map(({ label }) => ({ label })),
			quickActions: DASHBOARD_QUICK_ACTIONS.filter((a) => can(a.resource, a.action)).map(({ label }) => ({ label })),
			cards,
			recentOrders: can('orders', 'view')
				? (orders?.recentOrders ?? []).map((order) => ({
						id: order.orderId,
						customer: order.customer,
						date: formatDate(order.placedAt),
						status: titleCase(order.status),
					}))
				: [],
			newUsers: (users?.users ?? []).map((user) => ({
				name: `${user.forename} ${user.surname}`,
				email: user.email,
				joined: formatDate(user.createdAt),
			})),
			stockChanges: (inventory?.recentStockChanges ?? []).map((row) => ({
				product: row.product,
				amount: String(row.quantity),
				reason: `Stock level updated ${formatDate(row.modifiedAt)}`,
			})),
		};
	}
}
