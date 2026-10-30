import argon2 from 'argon2';
import { DASHBOARD_BY_ROLE, isAdminRole, type AdminRole } from '../models/adminRoles';
import type {
	AdminUserDetailsResponse,
	AdminUserListResponse,
	AdminUserStatusResponse,
	AdminUserSummary,
} from '../models/AdminUser';
import type { UserStatus } from '../models/user';
import type { adminRepository } from '../repositories/adminRepository';
import type { UserRepository, UserSummaryRecord } from '../repositories/userRepository';
import type { LoginRequest } from '../validators/loginSchema';

const ADMIN_USERS_PAGE_SIZE = 20;
const ADMIN_USER_RECENT_ORDERS = 5;

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

export class AdminUserService {
	constructor(
		private readonly admins: adminRepository,
		private readonly users: UserRepository,
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
		return {
			user: toUserSummary(user),
			recentOrders: orders.map((order) => ({
				id: order.orderId,
				placedAt: order.orderPlacedAt.toISOString(),
				status: order.orderStatus.toLowerCase(),
				total: Number(order.cost.toString()),
			})),
			// Baskets are session-scoped and not linked to customers yet (KAN-112), so none can be shown.
			basket: { itemCount: 0, subtotal: 0, items: [] },
		};
	}

	async setUserStatus(userId: number, status: UserStatus): Promise<AdminUserStatusResponse | null> {
		const updated = await this.users.updateStatus(userId, status);
		if (!updated) return null;
		return { user: { id: updated.userId, status: toAdminStatus(updated.status) } };
	}
}
