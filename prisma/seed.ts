import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const users = [
        {
            forename: 'Karen',
            surname: 'O\'Rourke',
            email: 'karen@test.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'John',
            surname: 'Smith',
            email: 'john@test.com',
            passwordHash: 'dummy-hash',
        },
    ];

    // Only seed if there are no users
    if ((await prisma.user.count()) === 0) {
        await prisma.user.createMany({
            data: users,
        });

        console.log(`${users.length} users seeded`);
    } else {
        console.log('Users already exist, skipping seed');
    }
}
await prisma.product.createMany({
    data: [
        {
            name: "Laptop",
            category: "Electronics",
            description: "High performance laptop",
            price: 999.99,
            imageURL: "https://example.com/laptop.jpg"
        },
        {
            name: "Mouse",
            category: "Electronics",
            description: "Wireless mouse",
            price: 19.99,
            imageURL: "https://example.com/mouse.jpg"
        }
    ]
});
main()
    .catch((error) => {
        console.error(error);
        //#process.exit(1);
        throw error;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

    