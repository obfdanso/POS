-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "shift_id" TEXT;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float" DECIMAL(10,2) NOT NULL,
    "expected_cash" DECIMAL(10,2),
    "counted_cash" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_user_id_status_idx" ON "Shift"("user_id", "status");

-- CreateIndex
CREATE INDEX "Shift_opened_at_idx" ON "Shift"("opened_at");

-- CreateIndex
CREATE INDEX "Sale_shift_id_idx" ON "Sale"("shift_id");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A cashier can have only one open shift at a time
CREATE UNIQUE INDEX "Shift_one_open_per_user" ON "Shift"("user_id") WHERE "status" = 'OPEN';

-- Money in a shift is never negative
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_cash_non_negative" CHECK (
    "opening_float" >= 0 AND ("expected_cash" IS NULL OR "expected_cash" >= 0) AND ("counted_cash" IS NULL OR "counted_cash" >= 0)
  );
