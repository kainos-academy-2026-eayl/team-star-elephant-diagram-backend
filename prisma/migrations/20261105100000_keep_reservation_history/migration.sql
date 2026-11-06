-- Keep reservations as history instead of deleting them.

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'CONVERTED');

-- AlterTable
ALTER TABLE "Reservation"
    ADD COLUMN "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "released_at" TIMESTAMP(3),
    ADD COLUMN "order_id" INTEGER;

-- Reservations already past expiry are history, not active holds: return their stock first.
UPDATE "Inventory" AS i
SET "reserved_quantity" = GREATEST(0, i."reserved_quantity" - expired."quantity")
FROM (
    SELECT ri."productId", SUM(ri."quantity") AS "quantity"
    FROM "ReservationItem" ri
    JOIN "Reservation" r ON r."reservation_id" = ri."reservationId"
    WHERE r."expiresAt" < CURRENT_TIMESTAMP
    GROUP BY ri."productId"
) AS expired
WHERE i."inventory_id" = (
    SELECT MIN(inv."inventory_id") FROM "Inventory" inv WHERE inv."product_id" = expired."productId"
);

UPDATE "Reservation" SET "status" = 'EXPIRED', "released_at" = CURRENT_TIMESTAMP WHERE "expiresAt" < CURRENT_TIMESTAMP;

-- A user may now have many reservations, but only one ACTIVE at a time.
DROP INDEX IF EXISTS "Reservation_userId_key";
CREATE UNIQUE INDEX "Reservation_userId_active_key" ON "Reservation"("userId") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_order_id_key" ON "Reservation"("order_id");
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("order_id") ON DELETE SET NULL ON UPDATE CASCADE;
