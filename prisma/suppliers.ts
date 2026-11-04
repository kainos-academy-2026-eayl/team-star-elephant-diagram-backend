import type { Prisma } from '@prisma/client';

// Fictional supplier that every seeded product is stocked from.
export const seedSupplier = {
    name: 'Elephant Wholesale Ltd',
    email: 'orders@elephantwholesale.example.com',
    address: '1 Warehouse Way, Manchester, M1 1AA',
} satisfies Prisma.SupplierCreateInput;

// Starting stock for seeded products that have no inventory yet.
export const seedStock = {
    quantity: 50,
    maximumQuantity: 100,
    reorderLevel: 10,
};
