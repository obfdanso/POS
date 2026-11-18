-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "promotion_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promotion_id" TEXT;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent_off" DECIMAL(5,2) NOT NULL,
    "product_id" TEXT,
    "category_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_is_active_starts_at_idx" ON "Promotion"("is_active", "starts_at");

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A promotion targets one product, one category, or (neither) the whole store, never both;
-- its percentage is real, and it ends after it starts
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_rules_check" CHECK (
  "percent_off" > 0 AND "percent_off" <= 100
  AND NOT ("product_id" IS NOT NULL AND "category_id" IS NOT NULL)
  AND ("ends_at" IS NULL OR "ends_at" > "starts_at")
);

-- The promotion's share of a line's discount can't be negative or more than the whole discount
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_promotion_discount_check" CHECK (
  "promotion_discount" >= 0 AND "promotion_discount" <= "discount"
);
