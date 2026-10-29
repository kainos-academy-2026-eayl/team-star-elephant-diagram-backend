export const ADMIN_ROLES = ['SuperAdmin', 'Admin', 'InventoryManager', 'FinanceManager', 'CustomerService'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

// Dashboard key per role; the frontend maps each key to its own route.
export const DASHBOARD_BY_ROLE: Record<AdminRole, string> = {
    SuperAdmin: 'super-admin',
    Admin: 'admin',
    InventoryManager: 'inventory',
    FinanceManager: 'finance',
    CustomerService: 'customer-service',
};

export function isAdminRole(role: string): role is AdminRole {
    return (ADMIN_ROLES as readonly string[]).includes(role);
}
