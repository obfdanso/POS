-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "variant_name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_parent_id_variant_name_key" ON "Product"("parent_id", "variant_name");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A product can't be its own variant, and every variant names its option
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "Product_variant_named" CHECK ("parent_id" IS NULL OR length(trim("variant_name")) > 0);

-- Listing a product's variants
CREATE INDEX "Product_parent_id_idx" ON "Product"("parent_id");
