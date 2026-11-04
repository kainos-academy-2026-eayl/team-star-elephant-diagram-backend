# Reservation Tables Schema

## Overview
This document describes the SQL schema and migration for the Reservation and ReservationItem tables.

## Migration Details
- **Migration Name**: `20261104110202_add_reservation_tables`
- **Location**: `prisma/migrations/20261104110202_add_reservation_tables/migration.sql`

## Database Schema

### Reservation Table
```sql
CREATE TABLE "Reservation" (
    "reservation_id" SERIAL NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE
);
```

**Columns:**
- `reservation_id` (SERIAL): Unique primary key for each reservation
- `userId` (INTEGER): Foreign key referencing the User table
- `created_at` (TIMESTAMP): Timestamp when the reservation was created
- `updated_at` (TIMESTAMP): Timestamp of the last update

**Indexes:**
- `Reservation_reservation_id_key`: Unique constraint on `reservation_id`

---

### ReservationItem Table
```sql
CREATE TABLE "ReservationItem" (
    "reservation_item_id" SERIAL NOT NULL PRIMARY KEY,
    "reservationId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("reservation_id") ON DELETE CASCADE,
    FOREIGN KEY ("productId") REFERENCES "Product"("prodid")
);
```

**Columns:**
- `reservation_item_id` (SERIAL): Unique primary key for each reservation item
- `reservationId` (INTEGER): Foreign key referencing the Reservation table
- `productId` (INTEGER): Foreign key referencing the Product table
- `quantity` (INTEGER): Quantity of the reserved product
- `created_at` (TIMESTAMP): Timestamp when the item was added to the reservation

**Indexes:**
- `ReservationItem_reservation_item_id_key`: Unique constraint on `reservation_item_id`
- `ReservationItem_reservationId_productId_key`: Unique compound constraint to prevent duplicate items in a reservation

---

## Prisma Models

### Reservation Model
```prisma
model Reservation {
  reservationId  Int       @id @unique @default(autoincrement()) @map("reservation_id")
  userId         Int  
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

## Relationships

- **User → Reservation**: One-to-Many relationship (one user can have multiple reservations)
- **Reservation → ReservationItem**: One-to-Many relationship (one reservation can have multiple items)
- **Product → ReservationItem**: One-to-Many relationship (one product can be in multiple reservation items)

## Cascade Delete Behavior
- When a User is deleted, all their Reservations are automatically deleted
- When a Reservation is deleted, all its ReservationItems are automatically deleted
- When a Product is deleted, the ReservationItems remain (RESTRICT would prevent deletion)

## File Locations
- **Migration SQL**: `/team-star-elephant-diagram-backend/prisma/migrations/20261104110202_add_reservation_tables/migration.sql`
- **Schema Definition**: `/team-star-elephant-diagram-backend/prisma/schema.prisma`
