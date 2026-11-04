# Reservation Tables Migration

## Overview
Created SQL migration for `Reservation` and `ReservationItem` tables to support product reservations functionality in the e-commerce system.

## Migration Details

### Migration File
- **Name**: `20261104150000_add_reservation_tables`
- **Location**: `prisma/migrations/20261104150000_add_reservation_tables/migration.sql`
- **Status**: ✅ Applied

## Table Schemas

### Reservation Table
```sql
CREATE TABLE "Reservation" (
    "reservation_id" SERIAL NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL UNIQUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE
);
```

**Columns:**
- `reservation_id` - Primary key, auto-incrementing serial
- `userId` - Foreign key to User table, unique (one reservation per user)
- `created_at` - Timestamp when reservation was created
- `updated_at` - Timestamp when reservation was last updated

**Constraints:**
- Primary key on `reservation_id`
- Unique index on `userId` (one active reservation per user)
- Foreign key to User with CASCADE delete

### ReservationItem Table
```sql
CREATE TABLE "ReservationItem" (
    "reservation_item_id" SERIAL NOT NULL PRIMARY KEY,
    "reservationId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("reservation_id") ON DELETE CASCADE,
    FOREIGN KEY ("productId") REFERENCES "Product"("prodid") ON DELETE RESTRICT,
    UNIQUE ("reservationId", "productId")
);
```

**Columns:**
- `reservation_item_id` - Primary key, auto-incrementing serial
- `reservationId` - Foreign key to Reservation table
- `productId` - Foreign key to Product table
- `quantity` - Number of items reserved
- `created_at` - Timestamp when item was added to reservation

**Constraints:**
- Primary key on `reservation_item_id`
- Composite unique index on `(reservationId, productId)` - prevents duplicate products in same reservation
- Foreign key to Reservation with CASCADE delete
- Foreign key to Product with RESTRICT delete (prevents deleting products with active reservations)

## Prisma Schema Models

### Reservation Model
```prisma
model Reservation {
  reservationId  Int       @id @unique @default(autoincrement()) @map("reservation_id")
  userId         Int       @unique
  user           User      @relation(fields: [userId], references: [userId], onDelete: Cascade)
  items          ReservationItem[]
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at")
}
```

### ReservationItem Model
```prisma
model ReservationItem {
  reservationItemId Int    @id @unique @default(autoincrement()) @map("reservation_item_id")
  reservationId     Int
  reservation       Reservation @relation(fields: [reservationId], references: [reservationId], onDelete: Cascade)
  productId         Int
  product           Product @relation(fields: [productId], references: [productId])
  quantity          Int
  createdAt         DateTime @default(now()) @map("created_at")

  @@unique([reservationId, productId])
}
```

## Key Features

✅ **One Reservation Per User** - `userId` is unique, ensuring each user has at most one active reservation
✅ **Cascade Delete** - When a user is deleted, their reservation and all reservation items are automatically deleted
✅ **Duplicate Prevention** - Composite unique constraint prevents the same product from being added to a reservation multiple times
✅ **Product Protection** - ReservationItem has RESTRICT delete on products to prevent data inconsistency
✅ **Timestamps** - Track when reservations and items are created/updated
✅ **Inventory Integration** - Can reference existing products and inventory system

## Usage Examples

### Create a Reservation
```typescript
const reservation = await prisma.reservation.create({
  data: {
    userId: 1,
    items: {
      create: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 }
      ]
    }
  },
  include: { items: { include: { product: true } } }
});
```

### Get User's Reservation
```typescript
const reservation = await prisma.reservation.findUnique({
  where: { userId: 1 },
  include: { items: { include: { product: true } } }
});
```

### Add Item to Reservation
```typescript
const reservationItem = await prisma.reservationItem.create({
  data: {
    reservationId: 1,
    productId: 3,
    quantity: 1
  }
});
```

### Update Item Quantity
```typescript
const updated = await prisma.reservationItem.update({
  where: {
    reservationId_productId: {
      reservationId: 1,
      productId: 1
    }
  },
  data: { quantity: 5 }
});
```

### Delete Reservation (cascades to items)
```typescript
await prisma.reservation.delete({
  where: { reservationId: 1 }
});
```

## Related Files

- **Schema**: [prisma/schema.prisma](./schema.prisma)
- **Migration**: [prisma/migrations/20261104150000_add_reservation_tables/migration.sql](./migrations/20261104150000_add_reservation_tables/migration.sql)

## Testing

To verify the migration:

```bash
# Check migration status
npx prisma migrate status

# Generate Prisma Client
npx prisma generate

# Test the models
npx prisma studio
```

## Notes

- Reservation and ReservationItem models mirror the Basket and BasketItem structure for consistency
- Each user can only have one active reservation at a time
- Reservations support multiple items with varying quantities
- Deletion cascades ensure referential integrity
