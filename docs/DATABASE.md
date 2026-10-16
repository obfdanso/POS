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
| `PaymentMethod` | `CASH`, `MOBILE_MONEY`, `CARD` |
| `PaymentStatus` | `COMPLETED`, `REFUNDED`, `PENDING` |
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
| `payment_status` | PaymentStatus | Default `COMPLETED`, `REFUNDED` after a refund |
| `notes` | String? | |

All amounts have `CHECK >= 0`. Indexed on `transaction_id` and `created_at`.

### SaleItem
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sale_id` | UUID FK | → Sale, `ON DELETE CASCADE` |
| `product_id` | UUID FK | → Product, `ON DELETE RESTRICT` |
| `quantity` | Int | `CHECK > 0` |
| `unit_price` | Decimal(10,2) | Price **at the time of sale** |
| `discount` | Decimal(10,2) | Line discount, default 0 |
| `total` | Decimal(10,2) | unit_price × quantity − discount |

### Payment
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sale_id` | UUID FK | → Sale, `ON DELETE CASCADE` |
| `method` | PaymentMethod | |
| `amount_paid` | Decimal(10,2) | `CHECK >= 0` |
| `change_given` | Decimal(10,2) | Cash only, default 0, `CHECK >= 0` |
| `reference` | String? | Paystack reference for mobile money and card |

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

### Settings
Key–value store, edited on the Settings page.

| Key | Meaning |
|---|---|
| `store_name`, `store_address`, `store_phone` | Printed on receipts |
| `tax_rate` | Percentage applied to every sale |
| `loyalty_points_rate` | GHS spent per loyalty point (0 turns loyalty off) |
| `currency_symbol` | Shown before every amount, e.g. `GH₵` |
| `receipt_footer` | Last line of the receipt |

---

## Design decisions

- **Soft-deleted products.** Deactivating sets `is_active = false`. `SaleItem.product_id` is `ON DELETE RESTRICT`, so a product with sales history can never be removed.
- **Historical prices.** `SaleItem.unit_price` records the price when the sale happened, so later price changes don't rewrite old sales or reports.
- **Atomic sales.** The sale, its items, the payment, stock deductions, inventory logs, and loyalty points are all written in one `prisma.$transaction`. Any failure rolls back everything.
- **No overselling.** Stock is decremented with a conditional update (`WHERE quantity >= n`) inside the transaction, so two tills selling the last unit at the same moment can't both succeed. The `CHECK (quantity >= 0)` constraint is a final safety net.
- **Safe refunds.** A refund flips the status with a conditional update, so even simultaneous refund requests restore stock exactly once.
- **Account lockout.** The 5th consecutive failed login locks the account until an admin unlocks it (`POST /api/users/:id/unlock`, or resetting the password). If no admin can log in, run `npm run unlock-user -- <username>` on the server.
- **Report queries** use SQL aggregation (`SUM`, `COUNT`, `GROUP BY`). The daily report uses `generate_series`, so days without sales appear as zero.

---

## Seed data

`npx prisma db seed` **wipes** every table, then creates:

- 3 users (admin, manager, cashier) and default settings: 3% tax, 1 point per GHS 8
- 6 categories, 25 Ghanaian suppliers, 52 products with images and EAN-13 barcodes, each with an opening-stock log entry
- 10 customers with loyalty points
- 20 sales over the past 30 days, two of them earlier today and one refunded, with matching stock deductions, inventory logs, and loyalty points

The sample sales are generated deterministically, so every reseed produces the same data, apart from the dates, which are relative to today.
