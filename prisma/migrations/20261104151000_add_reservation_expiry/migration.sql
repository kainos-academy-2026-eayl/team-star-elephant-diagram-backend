-- Add expiration timestamp to Reservation table for 15-minute timeout
ALTER TABLE "Reservation" ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes');

-- Create index on expiresAt for efficient cleanup queries
CREATE INDEX "Reservation_expiresAt_idx" ON "Reservation"("expiresAt");

-- Add reserved quantity column to Inventory to track reserved vs available stock
ALTER TABLE "Inventory" ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;

-- Create index for quick lookup of reserved inventory
CREATE INDEX "Inventory_reserved_quantity_idx" ON "Inventory"("reserved_quantity");
