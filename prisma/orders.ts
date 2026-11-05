import { type OrderStatus, Prisma, type PrismaClient } from '@prisma/client';

const customerEmails = [
    'amelia.carter@example.com',
    'oliver.hughes@example.com',
    'isla.thompson@example.com',
    'george.patel@example.com',
    'freya.williams@example.com',
];

const scenarios = [
    {
        status: 'PENDING',
        items: [{ productName: 'Star Elephant Logo T-Shirt', quantity: 1 }],
    },
    {
        status: 'PROCESSING',
        items: [
            { productName: 'Star Elephant Two-Tone Mug', quantity: 1 },
            { productName: 'Star Elephant Steel Water Bottle', quantity: 2 },
        ],
    },
    {
        status: 'SHIPPED',
        items: [{ productName: 'Star Elephant Steel Water Bottle', quantity: 3 }],
    },
    {
        status: 'DELIVERED',
        items: [
            { productName: 'Star Elephant Logo T-Shirt', quantity: 1 },
            { productName: 'Star Elephant Two-Tone Mug', quantity: 2 },
            { productName: 'Star Elephant Steel Water Bottle', quantity: 1 },
        ],
    },
    {
        status: 'CANCELLED',
        items: [{ productName: 'Star Elephant Two-Tone Mug', quantity: 1 }],
    },
] satisfies Array<{
    status: OrderStatus;
    items: Array<{ productName: string; quantity: number }>;
}>;

export const orders = customerEmails.flatMap((customerEmail, customerIndex) =>
    scenarios.map((scenario, scenarioIndex) => {
        const orderPlacedAt = new Date(Date.UTC(2026, 9, 1 + customerIndex * scenarios.length + scenarioIndex, 12));
        return {
            customerEmail,
            orderStatus: scenario.status,
            orderPlacedAt,
            modifiedAt: new Date(orderPlacedAt.getTime() + (scenario.status === 'PENDING' ? 0 : 86_400_000)),
            items: scenario.items,
        };
    }),
);

export async function seedOrders(prisma: PrismaClient): Promise<number> {
    return prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({
            where: { email: { in: customerEmails } },
            select: { userId: true, email: true },
        });
        const productNames = [...new Set(orders.flatMap((order) => order.items.map((item) => item.productName)))];
        const products = await tx.product.findMany({
            where: { name: { in: productNames } },
            select: { productId: true, name: true, price: true },
        });
        const usersByEmail = new Map(users.map((user) => [user.email, user]));
        const productsByName = new Map(products.map((product) => [product.name, product]));
        let created = 0;

        for (const order of orders) {
            const user = usersByEmail.get(order.customerEmail);
            if (!user) {
                throw new Error(`Cannot seed orders: customer ${order.customerEmail} is missing`);
            }
            // A fixed customer/date pair identifies each sample without reserving real order IDs.
            const existing = await tx.order.findFirst({
                where: { userId: user.userId, orderPlacedAt: order.orderPlacedAt },
                select: { orderId: true },
            });
            if (existing) continue;

            const items = order.items.map((item) => {
                const product = productsByName.get(item.productName);
                if (!product) {
                    throw new Error(`Cannot seed orders: product ${item.productName} is missing`);
                }
                return { product, quantity: item.quantity };
            });
            const cost = items.reduce(
                (total, item) => total.plus(item.product.price.mul(item.quantity)),
                new Prisma.Decimal(0),
            );
            await tx.order.create({
                data: {
                    userId: user.userId,
                    orderStatus: order.orderStatus,
                    orderPlacedAt: order.orderPlacedAt,
                    modifiedAt: order.modifiedAt,
                    cost,
                    orderItems: {
                        create: items.map(({ product, quantity }) => ({ productId: product.productId, quantity })),
                    },
                },
            });
            created++;
        }
        return created;
    });
}
