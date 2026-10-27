import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { products } from './products';

const prisma = new PrismaClient();

async function main() {
    const users = [
        {
            forename: 'Amelia',
            surname: 'Carter',
            email: 'amelia.carter@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Oliver',
            surname: 'Hughes',
            email: 'oliver.hughes@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Isla',
            surname: 'Thompson',
            email: 'isla.thompson@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'George',
            surname: 'Patel',
            email: 'george.patel@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Freya',
            surname: 'Williams',
            email: 'freya.williams@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Noah',
            surname: 'Clarke',
            email: 'noah.clarke@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Poppy',
            surname: 'Robinson',
            email: 'poppy.robinson@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Arthur',
            surname: 'Davies',
            email: 'arthur.davies@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Maya',
            surname: 'Singh',
            email: 'maya.singh@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Harry',
            surname: 'Wilson',
            email: 'harry.wilson@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Grace',
            surname: 'Bennett',
            email: 'grace.bennett@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Jack',
            surname: "O'Connor",
            email: 'jack.oconnor@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Evie',
            surname: 'Walker',
            email: 'evie.walker@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Muhammad',
            surname: 'Khan',
            email: 'muhammad.khan@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Sophie',
            surname: 'Wright',
            email: 'sophie.wright@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Leo',
            surname: 'Morgan',
            email: 'leo.morgan@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Charlotte',
            surname: 'Evans',
            email: 'charlotte.evans@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Alfie',
            surname: 'Brown',
            email: 'alfie.brown@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Aisha',
            surname: 'Ahmed',
            email: 'aisha.ahmed@example.com',
            passwordHash: 'dummy-hash',
        },
        {
            forename: 'Theodore',
            surname: 'Lewis',
            email: 'theodore.lewis@example.com',
            passwordHash: 'dummy-hash',
        },
    ];

    const userResult = await prisma.user.createMany({
        data: users,
        skipDuplicates: true,
    });

    console.log(`${userResult.count} users seeded`);

    if ((await prisma.product.count()) === 0) {
        const result = await prisma.product.createMany({
            data: products,
        });

        console.log(`${result.count} products seeded`);
    } else {
        console.log('Products already exist, skipping seed');
    }
}
main()
    .catch((error) => {
        console.error(error);
        //#process.exit(1);
        throw error;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });