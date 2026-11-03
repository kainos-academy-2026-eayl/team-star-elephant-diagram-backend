-- CreateTable
CREATE TABLE "ProductImage" (
    "image_id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "alt_text" VARCHAR(255),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("image_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_product_id_position_key" ON "ProductImage"("product_id", "position");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("prodid") ON DELETE CASCADE ON UPDATE CASCADE;
