-- Database-level guarantees for values the application already validates,
-- so a bug or a manual edit can never store negative stock, prices, or money.

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_price_non_negative" CHECK ("price" >= 0),
  ADD CONSTRAINT "Product_cost_price_non_negative" CHECK ("cost_price" IS NULL OR "cost_price" >= 0),
  ADD CONSTRAINT "Product_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "Product_low_stock_threshold_non_negative" CHECK ("low_stock_threshold" >= 0);

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_loyalty_points_non_negative" CHECK ("loyalty_points" >= 0);

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_amounts_non_negative" CHECK (
    "subtotal" >= 0 AND "discount_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0
  );

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "SaleItem_amounts_non_negative" CHECK ("unit_price" >= 0 AND "discount" >= 0 AND "total" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amounts_non_negative" CHECK ("amount_paid" >= 0 AND "change_given" >= 0);

ALTER TABLE "InventoryLog"
  ADD CONSTRAINT "InventoryLog_quantities_non_negative" CHECK ("previous_quantity" >= 0 AND "new_quantity" >= 0);
