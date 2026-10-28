import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { products } from './products';
import { adminUsers } from './adminUsers';

const prisma = new PrismaClient();

async function main() {
    const users = [
        {
            forename: 'Amelia',
            surname: 'Carter',
            email: 'amelia.carter@example.com',
            passwordHash: 'dummy-hash',
            address: '58 Ullswater Avenue',
            city: 'London',
            postcode: 'NW3 5QX'

        },
        {
            forename: 'Oliver',
            surname: 'Hughes',
            email: 'oliver.hughes@example.com',
            passwordHash: 'dummy-hash',
            address: '6 Glan Y Nant Road',
            city: 'Cardiff',
            postcode: 'CF14 3AA'
        },
        {
            forename: 'Isla',
            surname: 'Thompson',
            email: 'isla.thompson@example.com',
            passwordHash: 'dummy-hash',
            address: '6 Edward Road',
            city: 'Manchester',
            postcode: 'M14 4AB'
        },
        {
            forename: 'George',
            surname: 'Patel',
            email: 'george.patel@example.com',
            passwordHash: 'dummy-hash',
            address: '20 Heol Fargoed, Bargoed',
            city: 'Bargoed',
            postcode: 'CF81 8AA'
        },
        {
            forename: 'Freya',
            surname: 'Williams',
            email: 'freya.williams@example.com',
            passwordHash: 'dummy-hash',
            address: 'Kilpin Court, Lobley Street',
            city: 'Liverpool',
            postcode: 'L1 8JQ'
        },
        {
            forename: 'Noah',
            surname: 'Clarke',
            email: 'noah.clarke@example.com',
            passwordHash: 'dummy-hash',
            address: '16 Haverfield Gardens',
            city: 'Bristol',
            postcode: 'BS8 1TH'
        },
        {
            forename: 'Poppy',
            surname: 'Robinson',
            email: 'poppy.robinson@example.com',
            passwordHash: 'dummy-hash',
            address: '3 Chalk Road',
            city: 'Oxford',
            postcode: 'OX1 4AJ'
        },
        {
            forename: 'Arthur',
            surname: 'Davies',
            email: 'arthur.davies@example.com',
            passwordHash: 'dummy-hash',
            address: '8 Sir Henry Jake Close',
            city: 'Cardiff',
            postcode: 'CF14 3AA'
        },
        {
            forename: 'Maya',
            surname: 'Singh',
            email: 'maya.singh@example.com',
            passwordHash: 'dummy-hash',
            address: 'Cornwall Gardens Court',
            city: 'London',
            postcode: 'SW7 2AZ'
        },
        {
            forename: 'Harry',
            surname: 'Wilson',
            email: 'harry.wilson@example.com',
            passwordHash: 'dummy-hash',
            address: '6 Emley House',
            city: 'Leeds',
            postcode: 'LS1 4AB'
        },
        {
            forename: 'Grace',
            surname: 'Bennett',
            email: 'grace.bennett@example.com',
            passwordHash: 'dummy-hash',
            address: '241 Heneage Street',
            city: 'Sheffield',
            postcode: 'S3 7QJ'
        },
        {
            forename: 'Jack',
            surname: "O'Connor",
            email: 'jack.oconnor@example.com',
            passwordHash: 'dummy-hash',
            address: 'Westside, Meadow View',
            city: 'Dublin',
            postcode: 'D02 X285'
        },
        {
            forename: 'Evie',
            surname: 'Walker',
            email: 'evie.walker@example.com',
            passwordHash: 'dummy-hash',
            address: 'Morina, Llanarth',
            city: 'Carmarthenshire',
            postcode: 'SA32 8QH'
        },
        {
            forename: 'Muhammad',
            surname: 'Khan',
            email: 'muhammad.khan@example.com',
            passwordHash: 'dummy-hash',
            address: 'Millfield Road',
            city: 'Manchester',
            postcode: 'M14 4AB'
        },
        {
            forename: 'Sophie',
            surname: 'Wright',
            email: 'sophie.wright@example.com',
            passwordHash: 'dummy-hash',
            address: '',
            city: '',
            postcode: ''
        },
        {
            forename: 'Leo',
            surname: 'Morgan',
            email: 'leo.morgan@example.com',
            passwordHash: 'dummy-hash',
            address: 'Grange Barn',
            city: 'Bath',
            postcode: 'BA1 2AA'
        },
        {
            forename: 'Charlotte',
            surname: 'Evans',
            email: 'charlotte.evans@example.com',
            passwordHash: 'dummy-hash',
            address: '160 Sidwell Street',
            city: 'Exeter',
            postcode: 'EX4 6PX'
        },
        {
            forename: 'Alfie',
            surname: 'Brown',
            email: 'alfie.brown@example.com',
            passwordHash: 'dummy-hash',
            address: '14 Poppy Gardens',
            city: 'London',
            postcode: 'E1 6AN'
        },
        {
            forename: 'Aisha',
            surname: 'Ahmed',
            email: 'aisha.ahmed@example.com',
            passwordHash: 'dummy-hash',
            address: '45 Hays Walk',
            city: 'London',
            postcode: 'E1 8QS'
        },
        {
            forename: 'Theodore',
            surname: 'Lewis',
            email: 'theodore.lewis@example.com',
            passwordHash: 'dummy-hash',
            address: '4 Tithe Barn Road',
            city: 'Oxford',
            postcode: 'OX1 3DP'
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

    if ((await prisma.adminUser.count()) === 0) {
        const result = await prisma.adminUser.createMany({
            data: adminUsers,
            skipDuplicates: true,
        });

        console.log(`${result.count} admin users seeded`);
    } else {
        console.log('Admin users already exist, skipping seed');
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