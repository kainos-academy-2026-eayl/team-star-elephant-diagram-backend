export const ADMIN_ROLES = ['SuperAdmin', 'Admin', 'InventoryManager', 'WarehouseStaff', 'FinanceManager', 'CustomerService'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

// Dashboard key per role; the frontend maps each key to its own route.
export const DASHBOARD_BY_ROLE: Record<AdminRole, string> = {
    SuperAdmin: 'super-admin',
    Admin: 'admin',
    InventoryManager: 'inventory',
    WarehouseStaff: 'inventory',
    FinanceManager: 'finance',
    CustomerService: 'customer-service',
};

export function isAdminRole(role: string): role is AdminRole {
    return (ADMIN_ROLES as readonly string[]).includes(role);
}

// Actions that can be granted on each admin portal resource.
export const ADMIN_RESOURCE_ACTIONS = {
    users: ['view', 'create', 'update', 'delete', 'suspend', 'reactivate'],
    baskets: ['view'],
    orders: ['view', 'create', 'update', 'delete'],
    inventory: ['view', 'create', 'update', 'delete'],
    finance: ['view', 'create', 'update', 'delete'],
    admins: ['view', 'create', 'update', 'delete', 'manage'],
    permissions: ['view', 'create', 'update', 'delete', 'manage'],
} as const;

export type AdminResource = keyof typeof ADMIN_RESOURCE_ACTIONS;
export type AdminAction<R extends AdminResource = AdminResource> = (typeof ADMIN_RESOURCE_ACTIONS)[R][number];
export type AdminPermission = { [R in AdminResource]: { resource: R; action: AdminAction<R> } }[AdminResource];
export type ResourcePermissions = { readonly [R in AdminResource]?: readonly AdminAction<R>[] };

// Role -> Resource -> Action. Unlisted resources/actions are denied. SuperAdmin bypasses this table.
export const ROLE_PERMISSIONS: Readonly<Record<Exclude<AdminRole, 'SuperAdmin'>, ResourcePermissions>> = {
    Admin: {
        users: ['view', 'suspend', 'reactivate'],
        baskets: ['view'],
        orders: ['view', 'update'],
        inventory: ['view'],
        finance: ['view'],
    },
    CustomerService: {
        users: ['view'],
        baskets: ['view'],
        orders: ['view'],
        inventory: ['view'],
    },
    InventoryManager: {
        inventory: ['view', 'create', 'update', 'delete'],
        orders: ['view'],
    },
    WarehouseStaff: {
        inventory: ['view', 'update'],
    },
    FinanceManager: {
        finance: ['view', 'update'],
        orders: ['view'],
        inventory: ['view'],
    },
};

export function hasPermission(role: string, resource: AdminResource, action: string): boolean {
    if (!isAdminRole(role)) return false;
    if (role === 'SuperAdmin') return true;
    const granted: readonly string[] = ROLE_PERMISSIONS[role][resource] ?? [];
    return granted.includes(action);
}
