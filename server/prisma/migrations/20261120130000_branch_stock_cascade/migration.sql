-- DropForeignKey
ALTER TABLE "BranchStock" DROP CONSTRAINT "BranchStock_product_id_fkey";
-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
