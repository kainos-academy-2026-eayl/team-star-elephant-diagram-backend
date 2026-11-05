CREATE TABLE "ReservationInventoryAllocation" (
    "allocation_id" SERIAL NOT NULL,
    "reservation_item_id" INTEGER NOT NULL,
    "inventory_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ReservationInventoryAllocation_pkey" PRIMARY KEY ("allocation_id")
);

CREATE UNIQUE INDEX "ReservationInventoryAllocation_reservation_item_id_inventory_id_key"
ON "ReservationInventoryAllocation"("reservation_item_id", "inventory_id");
CREATE INDEX "ReservationInventoryAllocation_inventory_id_idx"
ON "ReservationInventoryAllocation"("inventory_id");

ALTER TABLE "ReservationInventoryAllocation"
ADD CONSTRAINT "ReservationInventoryAllocation_reservation_item_id_fkey"
FOREIGN KEY ("reservation_item_id") REFERENCES "ReservationItem"("reservation_item_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationInventoryAllocation"
ADD CONSTRAINT "ReservationInventoryAllocation_inventory_id_fkey"
FOREIGN KEY ("inventory_id") REFERENCES "Inventory"("inventory_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
