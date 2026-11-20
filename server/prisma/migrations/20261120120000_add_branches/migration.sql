-- Branches: one shared product list, stock kept per branch.
-- Existing data moves into a "Main Branch" so no stock or history is lost.

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchStock" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BranchStock_quantity_check" CHECK ("quantity" >= 0)
);

CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");
CREATE INDEX "BranchStock_product_id_idx" ON "BranchStock"("product_id");
CREATE UNIQUE INDEX "BranchStock_branch_id_product_id_key" ON "BranchStock"("branch_id", "product_id");

-- The existing shop becomes the main branch, with the store's address and phone
INSERT INTO "Branch" ("id", "name", "code", "address", "phone", "updated_at")
VALUES (
    gen_random_uuid()::text,
    'Main Branch',
    'MAIN',
    (SELECT "value" FROM "Settings" WHERE "key" = 'store_address'),
    (SELECT "value" FROM "Settings" WHERE "key" = 'store_phone'),
    CURRENT_TIMESTAMP
);

-- Every product's current stock moves to the main branch
INSERT INTO "BranchStock" ("id", "branch_id", "product_id", "quantity", "low_stock_threshold", "updated_at")
SELECT gen_random_uuid()::text, (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN'), p."id", p."quantity", p."low_stock_threshold", CURRENT_TIMESTAMP
FROM "Product" p;

-- Add branch columns, fill them with the main branch, then make them required
ALTER TABLE "User" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "Sale" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "Shift" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "Refund" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "InventoryLog" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "branch_id" TEXT;

UPDATE "User" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN') WHERE "role" <> 'ADMIN';
UPDATE "Sale" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN');
UPDATE "Shift" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN');
UPDATE "Refund" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN');
UPDATE "InventoryLog" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN');
UPDATE "PurchaseOrder" SET "branch_id" = (SELECT "id" FROM "Branch" WHERE "code" = 'MAIN');

ALTER TABLE "Sale" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "Shift" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "Refund" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "InventoryLog" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "branch_id" SET NOT NULL;

CREATE INDEX "User_branch_id_idx" ON "User"("branch_id");
CREATE INDEX "Sale_branch_id_idx" ON "Sale"("branch_id");
CREATE INDEX "Shift_branch_id_idx" ON "Shift"("branch_id");
CREATE INDEX "Refund_branch_id_idx" ON "Refund"("branch_id");
CREATE INDEX "InventoryLog_branch_id_idx" ON "InventoryLog"("branch_id");
CREATE INDEX "PurchaseOrder_branch_id_idx" ON "PurchaseOrder"("branch_id");

ALTER TABLE "User" ADD CONSTRAINT "User_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLog" ADD CONSTRAINT "InventoryLog_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stock now lives in BranchStock
ALTER TABLE "Product" DROP COLUMN "low_stock_threshold",
DROP COLUMN "quantity";
