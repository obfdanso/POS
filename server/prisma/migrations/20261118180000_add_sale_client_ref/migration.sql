-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "client_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_client_ref_key" ON "Sale"("client_ref");

