export interface AdminUser {
    adminId: number;
    forename: string;
    surname: string;
    email: string;
    role: string;
    passwordHash: string;
    createdAt: Date;
    modifiedAt: Date;
}

// Admin user-management API response shapes; must match frontend src/models/adminUser.ts.
export type AdminUserStatus = 'active' | 'suspended';

export interface AdminUserSummary {
    id: number;
    name: string;
    email: string;
    registeredAt: string;
    status: AdminUserStatus;
}

export interface AdminUserListResponse {
    users: AdminUserSummary[];
    pagination: { page: number; pageSize: number; totalPages: number; totalUsers: number };
}

export interface AdminUserDetailsResponse {
    user: AdminUserSummary;
    recentOrders: Array<{ id: number; placedAt: string; status: string; total: number }>;
    basket: { itemCount: number; subtotal: number; items: Array<{ productName: string; quantity: number }> };
}

export interface AdminUserStatusResponse {
    user: Pick<AdminUserSummary, 'id' | 'status'>;
}

// Admin basket API response shapes; must match frontend src/models/adminBasket.ts.
export interface AdminBasketSummary {
    basketId: number;
    customerName: string;
    customerEmail: string;
    itemCount: number;
    total: string;
    lastActivity: string;
    status: string;
}

export interface AdminBasketListResponse {
    baskets: AdminBasketSummary[];
}

export interface AdminBasketDetailsResponse {
    basket: {
        basketId: number;
        createdAt: string;
        lastActivity: string;
        status: string;
        customer: { name: string; email: string };
        items: Array<{ productName: string; quantity: number; unitPrice: string; totalPrice: string }>;
        itemCount: number;
        total: string;
    };
}