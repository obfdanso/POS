-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyalty_points_restored" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_discount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Redeemed points can't go negative, their value is part of the sale discount, and returns can't give back more than were spent
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_points_redemption_check" CHECK (
  "loyalty_points_redeemed" >= 0
  AND "points_discount" >= 0
  AND "points_discount" <= "discount_amount"
  AND "loyalty_points_restored" BETWEEN 0 AND "loyalty_points_redeemed"
);
