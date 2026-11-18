-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'SPLIT';

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "cash_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Cash refunds so far were paid entirely from the drawer
UPDATE "Refund" SET "cash_amount" = "amount" WHERE "method" = 'CASH';

-- Compared as text: a new enum value can't be used in the transaction that adds it
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_cash_amount_in_range" CHECK ("cash_amount" >= 0 AND "cash_amount" <= "amount");

-- Each payment row is one real method; SPLIT only describes a whole sale or refund
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_method_not_split" CHECK ("method"::text <> 'SPLIT');
