import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../src/services/userService';
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
            addressLine1: '58 Ullswater Avenue',
            addressLine2: '',
            city: 'London',
            postcode: 'NW3 5QX'

        },
        {
            forename: 'Oliver',
            surname: 'Hughes',
            email: 'oliver.hughes@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '6 Glan Y Nant Road',
            addressLine2: '',
            city: 'Cardiff',
            postcode: 'CF14 3AA'
        },
        {
            forename: 'Isla',
            surname: 'Thompson',
            email: 'isla.thompson@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '6 Edward Road',
            addressLine2: '',
            city: 'Manchester',
            postcode: 'M14 4AB'
        },
        {
            forename: 'George',
            surname: 'Patel',
            email: 'george.patel@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '20 Heol Fargoed, Bargoed',
            addressLine2: '',
            city: 'Bargoed',
            postcode: 'CF81 8AA'
        },
        {
            forename: 'Freya',
            surname: 'Williams',
            email: 'freya.williams@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Kilpin Court, Lobley Street',
            addressLine2: '',
            city: 'Liverpool',
            postcode: 'L1 8JQ'
        },
        {
            forename: 'Noah',
            surname: 'Clarke',
            email: 'noah.clarke@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '16 Haverfield Gardens',
            addressLine2: '',
            city: 'Bristol',
            postcode: 'BS8 1TH'
        },
        {
            forename: 'Poppy',
            surname: 'Robinson',
            email: 'poppy.robinson@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '3 Chalk Road',
            addressLine2: '',
            city: 'Oxford',
            postcode: 'OX1 4AJ'
        },
        {
            forename: 'Arthur',
            surname: 'Davies',
            email: 'arthur.davies@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '8 Sir Henry Jake Close',
            addressLine2: '',
            city: 'Cardiff',
            postcode: 'CF14 3AA'
        },
        {
            forename: 'Maya',
            surname: 'Singh',
            email: 'maya.singh@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Cornwall Gardens Court',
            addressLine2: '',
            city: 'London',
            postcode: 'SW7 2AZ'
        },
        {
            forename: 'Harry',
            surname: 'Wilson',
            email: 'harry.wilson@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '6 Emley House',
            addressLine2: '',
            city: 'Leeds',
            postcode: 'LS1 4AB'
        },
        {
            forename: 'Grace',
            surname: 'Bennett',
            email: 'grace.bennett@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '241 Heneage Street',
            addressLine2: '',
            city: 'Sheffield',
            postcode: 'S3 7QJ'
        },
        {
            forename: 'Jack',
            surname: "O'Connor",
            email: 'jack.oconnor@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Westside, Meadow View',
            addressLine2: '',
            city: 'Dublin',
            postcode: 'D02 X285'
        },
        {
            forename: 'Evie',
            surname: 'Walker',
            email: 'evie.walker@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Morina, Llanarth',
            addressLine2: '',
            city: 'Carmarthenshire',
            postcode: 'SA32 8QH'
        },
        {
            forename: 'Muhammad',
            surname: 'Khan',
            email: 'muhammad.khan@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Millfield Road',
            addressLine2: '',
            city: 'Manchester',
            postcode: 'M14 4AB'
        },
        {
            forename: 'Sophie',
            surname: 'Wright',
            email: 'sophie.wright@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '',
            addressLine2: '',
            city: '',
            postcode: ''
        },
        {
            forename: 'Leo',
            surname: 'Morgan',
            email: 'leo.morgan@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: 'Grange Barn',
            addressLine2: '',
            city: 'Bath',
            postcode: 'BA1 2AA'
        },
        {
            forename: 'Charlotte',
            surname: 'Evans',
            email: 'charlotte.evans@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '160 Sidwell Street',
            addressLine2: '',
            city: 'Exeter',
            postcode: 'EX4 6PX'
        },
        {
            forename: 'Alfie',
            surname: 'Brown',
            email: 'alfie.brown@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '14 Poppy Gardens',
            addressLine2: '',
            city: 'London',
            postcode: 'E1 6AN'
        },
        {
            forename: 'Aisha',
            surname: 'Ahmed',
            email: 'aisha.ahmed@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '45 Hays Walk',
            addressLine2: '',
            city: 'London',
            postcode: 'E1 8QS'
        },
        {
            forename: 'Theodore',
            surname: 'Lewis',
            email: 'theodore.lewis@example.com',
            passwordHash: 'dummy-hash',
            addressLine1: '4 Tithe Barn Road',
            addressLine2: '',
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
        const seedPassword = process.env.ADMIN_SEED_PASSWORD;
        if (!seedPassword) {
            console.warn('ADMIN_SEED_PASSWORD not set: seeded admin users keep placeholder hashes and cannot log in');
        }
        const seedHash = seedPassword ? await argon2.hash(seedPassword, ARGON2_OPTIONS) : undefined;
        const result = await prisma.adminUser.createMany({
            data: adminUsers.map((user) => ({ ...user, passwordHash: seedHash ?? user.passwordHash })),
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