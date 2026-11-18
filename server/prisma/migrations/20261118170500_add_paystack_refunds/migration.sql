-- CreateEnum
CREATE TYPE "GatewayRefundStatus" AS ENUM ('NOT_SENT', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "gateway_amount" DECIMAL(10,2),
ADD COLUMN     "gateway_error" TEXT,
ADD COLUMN     "gateway_reference" TEXT,
ADD COLUMN     "gateway_refund_id" TEXT,
ADD COLUMN     "gateway_status" "GatewayRefundStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gateway_refund_id_key" ON "Refund"("gateway_refund_id");


ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_gateway_amount_in_range" CHECK ("gateway_amount" IS NULL OR ("gateway_amount" > 0 AND "gateway_amount" <= "amount"));
