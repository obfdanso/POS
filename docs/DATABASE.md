# Database Schema

- **Database:** PostgreSQL 15+ (developed on 18)
- **ORM:** Prisma 5. The schema lives in `server/prisma/schema.prisma` and every change goes through a migration in `server/prisma/migrations/`.
- **Keys:** every primary key is a UUID.
- **Timestamps:** every table has `created_at` and `updated_at`.

---

## Enums

| Enum | Values |
|---|---|
| `Role` | `ADMIN`, `MANAGER`, `CASHIER` |
| `PaymentMethod` | `CASH`, `MOBILE_MONEY`, `CARD`, `SPLIT` (sales and refunds only; a `CHECK` keeps it off `Payment` rows) |
| `PaymentStatus` | `COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `PENDING` |
| `ShiftStatus` | `OPEN`, `CLOSED` |
| `PurchaseOrderStatus` | `ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED` |
| `GatewayRefundStatus` | `NOT_SENT`, `PENDING`, `PROCESSING`, `PROCESSED`, `FAILED` |
| `InventoryChangeType` | `SALE`, `RESTOCK`, `ADJUSTMENT`, `RETURN` |

---

## Tables

### User
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `username` | String | Unique. Login is case-insensitive, and new usernames are checked case-insensitively |
| `email` | String | Unique |
| `password_hash` | String | bcrypt, cost 12. Never returned by the API |
| `full_name` | String | |
| `role` | Role | Default `CASHIER` |
| `is_active` | Boolean | Default `true`. Inactive users can't log in |
| `failed_login_attempts` | Int | Default 0 |
| `locked_until` | DateTime? | `NULL` = not locked (see *Account lockout*) |
| `tokens_valid_after` | DateTime? | Sessions issued earlier are rejected. Set on password change or reset |

### Category
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | Unique |
| `description` | String? | |

### Supplier
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | Unique |
| `phone`, `email`, `address`, `website` | String? | |

### Product
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | |
| `sku` | String | Unique, indexed |
| `barcode` | String? | Unique, indexed (EAN-13 in the seed data) |
| `category_id` | UUID FK | → Category, `ON DELETE RESTRICT` |
| `supplier_id` | UUID FK? | → Supplier, `ON DELETE SET NULL` |
| `price` | Decimal(10,2) | `CHECK >= 0` |
| `cost_price` | Decimal(10,2)? | `CHECK >= 0`. Used by the profit report |
| `quantity` | Int | `CHECK >= 0`. Changed only through sales, refunds, and inventory endpoints |
| `low_stock_threshold` | Int | Default 10, `CHECK >= 0` |
| `image_url` | String? | `/uploads/products/…` (uploaded) or `/product-images/…` (seeded) |
| `is_active` | Boolean | Soft-delete flag |
| `parent_id` | UUID FK? | → the main Product when this is a variant (size, flavour), `ON DELETE RESTRICT`. One level only. `CHECK` it isn't the product itself. Indexed |
| `variant_name` | String? | The option's label, e.g. `1.5L`. `CHECK` required for variants. Unique with `parent_id` |

### Customer
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | |
| `phone` | String? | Unique, indexed |
| `email` | String? | Unique |
| `address` | String? | |
| `loyalty_points` | Int | Default 0, `CHECK >= 0` |

### Sale
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `transaction_id` | String | Unique, indexed. Format `TXN-YYYYMMDD-NNNN`, numbered per day |
| `user_id` | UUID FK | → User (who rang it up), `ON DELETE RESTRICT` |
| `customer_id` | UUID FK? | → Customer, `ON DELETE SET NULL`. `NULL` = walk-in |
| `subtotal` | Decimal(10,2) | Sum of line totals |
| `discount_amount` | Decimal(10,2) | Cart discount, default 0 |
| `tax_amount` | Decimal(10,2) | Tax on (subtotal − discount), default 0 |
| `total_amount` | Decimal(10,2) | subtotal − discount + tax |
| `payment_method` | PaymentMethod | |
| `client_ref` | String? | Unique. The till's id for the sale, so a resend is never recorded twice |
| `payment_status` | PaymentStatus | Default `COMPLETED`; `PARTIALLY_REFUNDED` after a return, `REFUNDED` once every unit is back |
| `notes` | String? | |
| `loyalty_points_earned` | Int | Points awarded for this sale, so a refund reverses exactly that |
| `refunded_amount` | Decimal(10,2) | Running total of refunds, default 0. `CHECK` between 0 and `total_amount`. Reports subtract it |
| `loyalty_points_reversed` | Int | Points taken back by returns so far, default 0 |
| `loyalty_points_redeemed` | Int | Points the customer spent on this sale, default 0 |
| `points_discount` | Decimal(10,2) | Value of those points. Included in `discount_amount`, so reports already net it out. `CHECK` between 0 and `discount_amount` |
| `loyalty_points_restored` | Int | Redeemed points given back by returns so far. `CHECK` between 0 and `loyalty_points_redeemed` |
| `shift_id` | UUID FK? | → Shift it was rung up in, `ON DELETE SET NULL`. Indexed |

All amounts have `CHECK >= 0`. Indexed on `transaction_id` and `created_at`.

### SaleItem
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sale_id` | UUID FK | → Sale, `ON DELETE CASCADE` |
| `product_id` | UUID FK | → Product, `ON DELETE RESTRICT` |
| `quantity` | Int | `CHECK > 0` |
| `unit_price` | Decimal(10,2) | Price **at the time of sale** |
| `unit_cost` | Decimal(10,2)? | Cost price at the time of sale (used by the profit report) |
| `discount` | Decimal(10,2) | Line discount, default 0 |
| `total` | Decimal(10,2) | unit_price × quantity − discount |
| `refunded_quantity` | Int | Units returned so far, default 0. `CHECK` between 0 and `quantity`. Reports count only `quantity − refunded_quantity` |
| `promotion_id` | UUID FK? | → Promotion applied automatically, `ON DELETE SET NULL` |
| `promotion_discount` | Decimal(10,2) | The promotion's part of `discount` (which also holds any cashier discount). `CHECK` between 0 and `discount` |

### Refund
One return against a sale.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sale_id` | UUID FK | → Sale, `ON DELETE CASCADE`. Indexed |
| `user_id` | UUID FK | → User who processed it |
| `shift_id` | UUID FK? | → that user's open shift, `ON DELETE SET NULL`. Cash refunds come out of its drawer. Indexed |
| `amount` | Decimal(10,2) | Money paid back, `CHECK >= 0` |
| `method` | PaymentMethod | The sale's payment method |
| `cash_amount` | Decimal(10,2) | The part paid back in cash from the drawer: all of a cash refund, cash first on a split sale. `CHECK` between 0 and `amount` |
| `gateway_status` | GatewayRefundStatus? | The card / Mobile Money part's progress through Paystack. Null for cash refunds |
| `gateway_amount` | Decimal(10,2)? | That part's amount, `CHECK` above 0 and at most `amount` |
| `gateway_reference` | String? | The Paystack charge it goes back to (null when it must be sent from the dashboard) |
| `gateway_refund_id` | String? | Paystack's refund id, unique; matches webhook events |
| `gateway_error` | String? | Why Paystack refused it, or couldn't be reached |
| `reason` | String | Why the items came back |

### RefundItem
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `refund_id` | UUID FK | → Refund, `ON DELETE CASCADE` |
| `sale_item_id` | UUID FK | → SaleItem, `ON DELETE CASCADE`. Indexed |
| `quantity` | Int | Units returned, `CHECK > 0` |
| `amount` | Decimal(10,2) | This line's share of the refund |
| `restocked` | Boolean | `false` for damaged goods that didn't go back on the shelf |

### Shift
A cash drawer session.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK | → User working the till. A partial unique index allows only one `OPEN` shift per user |
| `status` | ShiftStatus | `OPEN` until counted and closed |
| `opening_float` | Decimal(10,2) | Cash in the drawer at the start, `CHECK >= 0` |
| `expected_cash` | Decimal(10,2)? | Set at close: float + cash sales − cash refunds |
| `counted_cash` | Decimal(10,2)? | Set at close, `CHECK >= 0` |
| `difference` | Decimal(10,2)? | counted − expected; negative means the drawer was short |
| `opened_at` / `closed_at` | DateTime / DateTime? | |
| `closed_by_id` | UUID FK? | → User who closed it (a manager can close a cashier's shift) |
| `notes` | String? | Opening and closing notes |

### PurchaseOrder
Stock ordered from a supplier.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `po_number` | String | Unique, `PO-YYYYMMDD-NNNN` |
| `supplier_id` | UUID FK | → Supplier, `ON DELETE RESTRICT` (suppliers with orders can't be deleted). Indexed |
| `created_by_id` | UUID FK | → User who placed it |
| `status` | PurchaseOrderStatus | Indexed |
| `total_cost` | Decimal(12,2) | Σ quantity ordered × unit cost, `CHECK >= 0` |
| `expected_at` / `received_at` | DateTime? | Expected delivery; when the last unit arrived |
| `notes` | String? | |

### PurchaseOrderItem
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `purchase_order_id` | UUID FK | → PurchaseOrder, `ON DELETE CASCADE` |
| `product_id` | UUID FK | → Product, `ON DELETE RESTRICT`. Unique per order |
| `quantity_ordered` | Int | `CHECK > 0` |
| `quantity_received` | Int | Default 0. `CHECK` between 0 and `quantity_ordered` |
| `unit_cost` | Decimal(10,2) | `CHECK >= 0`. Becomes the product's cost price on receipt (optional) |

### Promotion
An automatic percentage off.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | Shown on receipts |
| `percent_off` | Decimal(5,2) | `CHECK` above 0 and at most 100 |
| `product_id` / `category_id` | UUID FK? | One product, one category, or neither (whole store); never both (`CHECK`). `ON DELETE CASCADE` |
| `starts_at` / `ends_at` | DateTime / DateTime? | `CHECK ends_at > starts_at` |
| `is_active` | Boolean | Default true. Indexed with `starts_at` |

### Payment
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sale_id` | UUID FK | → Sale, `ON DELETE CASCADE` |
| `method` | PaymentMethod | |
| `amount_paid` | Decimal(10,2) | `CHECK >= 0` |
| `change_given` | Decimal(10,2) | Cash only, default 0, `CHECK >= 0` |
| `reference` | String? | Paystack reference for mobile money and card. **Unique**, so one payment can't pay for two sales |

### InventoryLog
One row for every stock change.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `product_id` | UUID FK | → Product, `ON DELETE RESTRICT` |
| `change_type` | InventoryChangeType | `SALE`, `RESTOCK` (incl. opening stock), `ADJUSTMENT`, `RETURN` (refund) |
| `quantity_change` | Int | Positive adds stock, negative removes it |
| `previous_quantity` / `new_quantity` | Int | Stock before and after, `CHECK >= 0` |
| `user_id` | UUID FK | → User who made the change |
| `notes` | String? | e.g. `Sale TXN-20260319-0001` |

### AuthLog
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK? | → User, `ON DELETE SET NULL` (unknown usernames are logged with `NULL`) |
| `event_type` | String | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_BLOCKED`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`, `LOGOUT`, `TOKEN_REFRESH` |
| `ip_address`, `user_agent`, `details` | String? | |

### AuditLog
Who performed destructive or sensitive operations.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK? | → User who acted, `ON DELETE SET NULL` |
| `action` | String | `SALE_REFUNDED`, `PRODUCT_DEACTIVATED`, `PRODUCT_REACTIVATED`, `SUPPLIER_DELETED`, `SETTINGS_UPDATED`, `USER_CREATED`, `USER_UPDATED`, `PASSWORD_RESET` |
| `entity` / `entity_id` | String / String? | What was changed, e.g. `Sale` + its id. Indexed |
| `details` | String? | Human-readable summary, e.g. `TXN-20261016-0002 refunded (27.81 via CASH)` |

### RevokedToken
Refresh tokens that were logged out or rotated. Kept in the database so they stay revoked after a server restart.

| Column | Type | Notes |
|---|---|---|
| `jti` | String PK | The token's JWT id. The unique key means two simultaneous refreshes with one token can't both succeed |
| `expires_at` | DateTime | When the token would have expired. Rows past this are deleted. Indexed |

### Settings
Key–value store, edited on the Settings page.

| Key | Meaning |
|---|---|
| `store_name`, `store_address`, `store_phone` | Printed on receipts |
| `tax_rate` | Percentage applied to every sale |
| `loyalty_points_rate` | GHS spent per loyalty point (0 turns loyalty off) |
| `loyalty_point_value` | Money off per point redeemed at checkout (0 turns redemption off; the seed uses 0.10) |
| `currency_symbol` | Shown before every amount, e.g. `GH₵` |
| `receipt_footer` | Last line of the receipt |
| `require_open_shift` | `true` makes cashiers open a shift before selling (default `false`) |

---

## Design decisions

- **Soft-deleted products.** Deactivating sets `is_active = false`. `SaleItem.product_id` is `ON DELETE RESTRICT`, so a product with sales history can never be removed.
- **Historical prices.** `SaleItem.unit_price` and `unit_cost` record the price and cost when the sale happened, and `Sale.loyalty_points_earned` the points awarded, so later changes don't rewrite old sales, profit reports, or refunds.
- **Atomic sales.** The sale, its items, the payment, stock deductions, inventory logs, and loyalty points are all written in one `prisma.$transaction`. Any failure rolls back everything.
- **No overselling.** Stock is decremented with a conditional update (`WHERE quantity >= n`) inside the transaction, so two tills selling the last unit at the same moment can't both succeed. The `CHECK (quantity >= 0)` constraint is a final safety net.
- **Safe refunds.** A refund flips the status with a conditional update, so even simultaneous refund requests restore stock exactly once.
- **Sign out everywhere.** Changing or resetting a password sets `User.tokens_valid_after`. Every access and refresh token issued before it stops working.
- **Account lockout.** Failed attempts are counted with an atomic increment, so parallel guesses can't outrun the lock. The 5th consecutive failed login locks the account until an admin unlocks it (`POST /api/users/:id/unlock`, or resetting the password). If no admin can log in, run `npm run unlock-user -- <username>` on the server.
- **Report queries** use SQL aggregation (`SUM`, `COUNT`, `GROUP BY`). The daily report uses `generate_series`, so days without sales appear as zero.

---

## Seed data

`npx prisma db seed` **wipes** every table, then creates:

- 3 users (admin, manager, cashier) and default settings: 3% tax, 1 point per GHS 8
- 6 categories, 25 Ghanaian suppliers, 52 products with images and EAN-13 barcodes, each with an opening-stock log entry
- 10 customers with loyalty points
- 20 sales over the past 30 days, two of them earlier today and one refunded, with matching stock deductions, inventory logs, and loyalty points

The sample sales are generated deterministically, so every reseed produces the same data, apart from the dates, which are relative to today.
