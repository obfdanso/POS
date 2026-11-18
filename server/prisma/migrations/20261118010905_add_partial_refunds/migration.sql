-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "loyalty_points_reversed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "refunded_quantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundItem" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "sale_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_sale_id_idx" ON "Refund"("sale_id");

-- CreateIndex
CREATE INDEX "Refund_shift_id_idx" ON "Refund"("shift_id");

-- CreateIndex
CREATE INDEX "Refund_created_at_idx" ON "Refund"("created_at");

-- CreateIndex
CREATE INDEX "RefundItem_sale_item_id_idx" ON "RefundItem"("sale_item_id");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sales refunded before partial refunds existed were refunded in full
UPDATE "Sale" SET "refunded_amount" = "total_amount", "loyalty_points_reversed" = "loyalty_points_earned"
WHERE "payment_status" = 'REFUNDED';
UPDATE "SaleItem" si SET "refunded_quantity" = si."quantity"
FROM "Sale" s WHERE s."id" = si."sale_id" AND s."payment_status" = 'REFUNDED';

-- Returns can never exceed what was sold
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_refunded_quantity_in_range" CHECK ("refunded_quantity" >= 0 AND "refunded_quantity" <= "quantity");
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_refunded_amount_in_range" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total_amount");
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "RefundItem"
  ADD CONSTRAINT "RefundItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "RefundItem_amount_non_negative" CHECK ("amount" >= 0);

-- Cash refunds can leave a drawer expecting less than nothing, so only the float and the count must be non-negative
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_cash_non_negative";
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_cash_non_negative" CHECK ("opening_float" >= 0 AND ("counted_cash" IS NULL OR "counted_cash" >= 0));
