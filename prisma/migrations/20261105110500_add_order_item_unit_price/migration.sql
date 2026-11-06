ALTER TABLE "OrderItem" ADD COLUMN "unit_price" DECIMAL(10, 2);

UPDATE "OrderItem"
SET "unit_price" = "Product"."price"
FROM "Product"
WHERE "OrderItem"."productId" = "Product"."prodid";

ALTER TABLE "OrderItem" ALTER COLUMN "unit_price" SET NOT NULL;
