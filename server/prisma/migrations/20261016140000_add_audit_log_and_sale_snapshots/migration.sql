-- Audit trail, per-sale snapshots (cost price, loyalty points), session cut-off,
-- and one-sale-per-Paystack-reference.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokens_valid_after" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "unit_cost" DECIMAL(10,2);

-- Backfill: cost snapshot from each product's current cost price
UPDATE "SaleItem" si
SET "unit_cost" = p."cost_price"
FROM "Product" p
WHERE p."id" = si."product_id" AND si."unit_cost" IS NULL;

-- Backfill: points earned by existing completed customer sales, at the current loyalty rate (default 10)
WITH rate AS (
  SELECT COALESCE((SELECT NULLIF("value", '')::numeric FROM "Settings" WHERE "key" = 'loyalty_points_rate'), 10) AS r
)
UPDATE "Sale" s
SET "loyalty_points_earned" = FLOOR(s."total_amount" / rate.r)::int
FROM rate
WHERE s."customer_id" IS NOT NULL AND s."payment_status" = 'COMPLETED' AND rate.r > 0;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entity_entity_id_idx" ON "AuditLog"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- Before enforcing uniqueness, keep any references already reused by more than one sale
-- (possible before this fix) but mark the later ones so the unique index can be created
UPDATE "Payment" p
SET "reference" = p."reference" || ' [duplicate ' || p."id" || ']'
WHERE p."reference" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Payment" earlier
    WHERE earlier."reference" = p."reference" AND (earlier."created_at", earlier."id") < (p."created_at", p."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
