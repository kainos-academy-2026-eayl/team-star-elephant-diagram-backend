BEGIN;

LOCK TABLE "Inventory", "Product" IN SHARE ROW EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sku" VARCHAR(64) NOT NULL DEFAULT ('SKU-'::text || (gen_random_uuid())::text),
ADD COLUMN     "stockQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stockStatus" "StockStatus" NOT NULL DEFAULT 'OUT_OF_STOCK';

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "adjustedById" INTEGER NOT NULL,
    "adjustment" INTEGER NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "newStock" INTEGER NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAdjustment_productId_createdAt_id_idx" ON "StockAdjustment"("productId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "StockAdjustment_adjustedById_idx" ON "StockAdjustment"("adjustedById");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_stockStatus_prodid_idx" ON "Product"("stockStatus", "prodid");

CREATE INDEX "Inventory_product_id_inventory_id_idx" ON "Inventory"("product_id", "inventory_id");

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("prodid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "AdminUser"("adminId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_stockQuantity_nonnegative" CHECK ("stockQuantity" >= 0),
    ADD CONSTRAINT "Product_lowStockThreshold_nonnegative" CHECK ("lowStockThreshold" >= 0);
ALTER TABLE "Inventory"
    ADD CONSTRAINT "Inventory_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "StockAdjustment"
    ADD CONSTRAINT "StockAdjustment_balanced" CHECK (
        "previousStock" >= 0 AND "newStock" >= 0
        AND "previousStock"::bigint + "adjustment"::bigint = "newStock"::bigint
        AND char_length(trim("reason")) BETWEEN 3 AND 255
    );

CREATE FUNCTION inventory_stock_status(stock integer, threshold integer)
RETURNS "StockStatus" LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE WHEN stock = 0 THEN 'OUT_OF_STOCK'::"StockStatus"
                WHEN stock <= threshold THEN 'LOW_STOCK'::"StockStatus"
                ELSE 'IN_STOCK'::"StockStatus" END
$$;

UPDATE "Product" p SET
    "stockQuantity" = COALESCE((SELECT SUM(i."quantity") FROM "Inventory" i WHERE i."product_id" = p."prodid"), 0),
    "lowStockThreshold" = COALESCE((SELECT MAX(i."reorder_level") FROM "Inventory" i WHERE i."product_id" = p."prodid"), 0);
UPDATE "Product" SET "stockStatus" = inventory_stock_status("stockQuantity", "lowStockThreshold");

CREATE FUNCTION refresh_product_stock_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW."stockStatus" := inventory_stock_status(NEW."stockQuantity", NEW."lowStockThreshold");
    RETURN NEW;
END;
$$;
CREATE TRIGGER product_stock_status
BEFORE INSERT OR UPDATE OF "stockQuantity", "lowStockThreshold", "stockStatus" ON "Product"
FOR EACH ROW EXECUTE FUNCTION refresh_product_stock_status();

-- Apply deltas rather than SUM queries so concurrent checkout writes cannot lose updates.
CREATE FUNCTION synchronize_product_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."product_id" = OLD."product_id" THEN
        IF NEW."quantity" <> OLD."quantity" THEN
            UPDATE "Product" SET "stockQuantity" = "stockQuantity" + (NEW."quantity" - OLD."quantity"),
                "modified_at" = CURRENT_TIMESTAMP WHERE "prodid" = NEW."product_id";
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            UPDATE "Product" SET "stockQuantity" = "stockQuantity" - OLD."quantity",
                "modified_at" = CURRENT_TIMESTAMP WHERE "prodid" = OLD."product_id";
        END IF;
        IF TG_OP <> 'DELETE' THEN
            UPDATE "Product" SET "stockQuantity" = "stockQuantity" + NEW."quantity",
                "modified_at" = CURRENT_TIMESTAMP WHERE "prodid" = NEW."product_id";
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER inventory_product_stock
AFTER INSERT OR UPDATE OF "quantity", "product_id" OR DELETE ON "Inventory"
FOR EACH ROW EXECUTE FUNCTION synchronize_product_inventory();

COMMIT;
