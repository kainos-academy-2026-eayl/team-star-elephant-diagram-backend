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
    pagination: { page: number; pageSize: number; totalPages: number; totalBaskets: number };
}

export interface AdminBasketDetailsResponse {
    basket: {
        basketId: number;
        createdAt: string;
        lastActivity: string;
        status: string;
        customer: { id: number; name: string; email: string };
        items: Array<{
            productId: number;
            productName: string;
            quantity: number;
            unitPrice: string;
            totalPrice: string;
            // Sellable stock right now; quantity above this cannot be fulfilled at checkout.
            availableStock: number;
            maxQuantity: number;
            exceedsStock: boolean;
        }>;
        itemCount: number;
        total: string;
    };
    // Products an admin can add, with live stock so the picker reflects inventory.
    products: Array<{ productId: number; name: string; unitPrice: string; availableStock: number; maxQuantity: number }>;
}
// Role-scoped admin dashboard; must match frontend AdminDashboard in src/services/adminService.ts.
export interface AdminDashboardResponse {
    inventoryPermissions: { view: boolean; create: boolean; update: boolean; delete: boolean };
    basketPermissions: { view: boolean; create: boolean; update: boolean; delete: boolean };
    inventorySummary: { totalProducts: number; lowStockProducts: number; outOfStockProducts: number } | null;
    lowStock: {
        total: number;
        items: Array<{ inventoryId: number; product: string; supplier: string; quantity: number; reorderLevel: number }>;
    } | null;
    staff: { name: string };
    role: string;
    dashboard: string;
    sections: Array<{ label: string }>;
    quickActions: Array<{ label: string }>;
    cards: Array<{ label: string; value: string }>;
    recentOrders: Array<{ id: number; customer: string; date: string; status: string }>;
    newUsers: Array<{ name: string; email: string; joined: string }>;
    stockChanges: Array<{ product: string; amount: string; reason: string }>;
}

// Admin order management API response shapes (KAN-101). Status values are the Prisma OrderStatus enum names.
export interface AdminOrderSummary {
    orderId: number;
    customer: { id: number; name: string; email: string };
    status: string;
    orderDate: string;
    totalCost: number;
}

export interface AdminOrderListResponse {
    orders: AdminOrderSummary[];
    pagination: { page: number; pageSize: number; totalPages: number; totalOrders: number };
}

export interface AdminOrderDetailsResponse {
    order: {
        orderId: number;
        status: string;
        orderDate: string;
        lastUpdated: string;
        customer: {
            id: number;
            name: string;
            email: string;
            address: { line1: string; line2: string; city: string; postcode: string };
        };
        items: Array<{ productId: number; productName: string; quantity: number; unitPrice: number; itemTotal: number }>;
        itemCount: number;
        orderTotal: number;
        allowedTransitions: string[];
    };
}
