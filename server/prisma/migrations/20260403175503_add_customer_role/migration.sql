/*
  Warnings:

  - A unique constraint covering the columns `[user_id]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CUSTOMER';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_user_id_key" ON "Customer"("user_id");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
