# API Reference

Base URL: `http://localhost:3001/api`

Every endpoint except `POST /auth/login` and `POST /auth/refresh` needs an access token:
`Authorization: Bearer <accessToken>`.

---

## Conventions

### Response format

**Success**
```json
{ "success": true, "data": { ... }, "message": "Product created successfully" }
```

**Success with pagination**
```json
{
  "success": true,
  "data": [ ... ],
  "meta": { "page": 1, "per_page": 20, "total": 150, "total_pages": 8 }
}
```

**Error**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "price", "message": "Price must be greater than 0" }]
  }
}
```
`details` lists the fields at fault. It's present for validation errors and for conflicts on a single field, such as a duplicate SKU.

### Validation rules that apply everywhere

- **Unexpected body fields are rejected.** A `POST`/`PUT` body may contain only the fields documented for that endpoint. Anything else returns `422` with `details: [{ "field": "<name>", "message": "Unexpected field \"<name>\"" }]`.
- **Pagination**: `page` (≥ 1, default 1) and `per_page` (1–100, default 20).
- **Sorting**: list endpoints marked *sortable* accept `sort=<field>` and `order=asc|desc`. Unknown sort fields return `422`.
- **Dates**: `start_date` / `end_date` are `YYYY-MM-DD` and inclusive. They're interpreted in the server's local time zone.
- **Money** is returned as decimal strings, e.g. `"12.5"`. Format it for display on the client.
- **Audit trail**: refunds, product (de)activation, supplier deletion, settings changes, and user creation, changes, and password resets are recorded in the `AuditLog` table with the user who did them. Stock changes are recorded in `InventoryLog`, and logins in `AuthLog`.

### Rate limits (per IP)

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 10 requests / minute |
| `POST /auth/refresh` | 60 requests / minute. It runs on every page load, and all tills in a shop usually share one IP |
| `POST /sales` | 60 requests / minute |

---

## Authentication

### POST /auth/login
**Body:** `{ "username": "admin", "password": "admin123" }`. Usernames are case-insensitive.

**Response `200`**
```json
{ "data": { "accessToken": "<jwt>", "user": { "id": "…", "username": "admin", "email": "…", "full_name": "…", "role": "ADMIN" } } }
```
Also sets the refresh token as an `httpOnly`, `SameSite=Strict` cookie (`secure` in production).

After 5 failed attempts the account is locked until an admin unlocks it (`POST /users/:id/unlock`). If no admin can log in, run `npm run unlock-user -- <username>` in `server/`.

### POST /auth/refresh
Exchanges the refresh-token cookie for a new access token, and **rotates** the cookie. Each refresh token works once; reusing one returns `401`.

**Response `200`** `{ "data": { "accessToken": "…" } }`

### POST /auth/logout
Revokes the refresh token and clears the cookie.

### GET /auth/me
The signed-in user's profile.

### PUT /auth/profile
Update your own profile. **Body (any of):** `full_name`, `email`.

### POST /auth/change-password
**Body:** `{ "current_password": "…", "new_password": "at least 6 chars" }`

Signs out every **other** session of this user. The response carries a new `accessToken` and sets a new refresh cookie, so the current device stays signed in.

---

## Products

### GET /products — *sortable*
**Query:** `page`, `per_page`, `search` (matches name, SKU, or barcode), `category_id`, `status` (`active` default, `inactive`, `all`; cashiers always get `active`).

**Sort fields:** `name` (default), `sku`, `category`, `price`, `cost_price`, `quantity`, `is_active`, `created_at`.

### GET /products/:id
### GET /products/barcode/:code
Exact barcode lookup, used by the POS scanner. Inactive products return `404`.

### POST /products — ADMIN, MANAGER
JSON, or `multipart/form-data` when uploading an `image` (JPG/PNG/WebP, max 5 MB).

**Body:** `name`, `sku`, `category_id`, `price` (> 0) are required. Optional: `barcode`, `supplier_id`, `cost_price`, `quantity` (opening stock, logged as a `RESTOCK`), `low_stock_threshold`, `is_active`.

### PUT /products/:id — ADMIN, MANAGER
Any of the create fields **except `quantity`**: stock only changes through the inventory endpoints, so every change is logged. Send `image_url: null` to remove the image, or upload a new `image`. Changing `is_active` is **ADMIN only**.

### DELETE /products/:id — ADMIN
Soft delete: sets `is_active = false`. Past sales keep their history.

---

## Categories

### GET /categories
Every category, with its product count in `_count.products`.

### POST /categories — ADMIN, MANAGER
**Body:** `{ "name": "Beverages", "description": "optional" }`

### PUT /categories/:id — ADMIN, MANAGER
Same body as create.

---

## Suppliers

### GET /suppliers
**Query:** `page`, `per_page` (default 50), `search`.

### GET /suppliers/:id
The supplier and its active products.

### POST /suppliers — ADMIN, MANAGER
### PUT /suppliers/:id — ADMIN, MANAGER
**Body:** `name` (required), `phone`, `email`, `address`, `website`.

### DELETE /suppliers/:id — ADMIN
Refused with `409` while active products still reference the supplier.

---

## Inventory

### GET /inventory — *sortable*
**Query:** `page`, `per_page`, `search` (name or SKU), `status=out` (out of stock only).

**Sort fields:** `name` (default), `category`, `quantity`, `low_stock_threshold`, `price`.

### GET /inventory/low-stock
Active products at or below their `low_stock_threshold`, including those at 0. Lowest stock first.

### POST /inventory/restock — ADMIN, MANAGER
**Body:** `{ "product_id": "uuid", "quantity": 50, "notes": "Supplier delivery" }`

### POST /inventory/adjust — ADMIN, MANAGER
**Body:** `{ "product_id": "uuid", "quantity_change": -3, "notes": "Damaged items" }`. `quantity_change` must be non-zero, and stock can't go below 0.

Stock changes are applied atomically, so a sale and an adjustment made at the same moment never overwrite each other.

### GET /inventory/log/:productId
Paginated stock history: sales, restocks, adjustments, and returns, newest first.

---

## Sales

### POST /sales
Processes the whole sale in one database transaction: validate stock, calculate totals, create the sale, items, and payment, deduct stock, write inventory logs, and award loyalty points.

```json
{
  "items": [{ "product_id": "uuid", "quantity": 2, "discount": 0 }],
  "customer_id": "uuid or null",
  "payment_method": "CASH | MOBILE_MONEY | CARD",
  "amount_paid": 50.0,
  "discount_amount": 5.0,
  "reference": "required for MOBILE_MONEY and CARD",
  "notes": "optional, max 500 chars"
}
```

- **Totals:** subtotal = Σ(unit price × qty − item discount). Tax = configured rate × (subtotal − cart discount). Every step is rounded to 2 dp, and the client's cart uses the same arithmetic.
- **Discounts:** an item discount can't exceed its line total, and the cart discount can't exceed the subtotal.
- **Limits:** 1–200 items per sale, 1–100,000 units per line, amounts up to GH₵ 1,000,000.
- **customer_id**, if given, must exist (`422` otherwise). This is checked before any payment verification.
- **CASH:** `amount_paid` must cover the total; change is calculated.
- **MOBILE_MONEY / CARD:** `reference` is verified with Paystack. The charge must be in GHS and equal the total **including tax**. A reference can pay for **one sale only**: reuse returns `409`.
- The cost price and the loyalty points awarded are recorded on the sale, so later price changes don't alter profit reports or refunds.
- **Transaction ID** format: `TXN-YYYYMMDD-NNNN`, numbered per day.

**Response `201`:** the full sale, including `items` (each with its `product`) and `payment`.

### GET /sales — *sortable*
Cashiers only ever see their own sales.

**Query:** `page`, `per_page`, `start_date`, `end_date`, `user_id`, `customer_id`, `payment_status` (`COMPLETED`, `REFUNDED`, `PENDING`), `payment_method`, `search` (transaction ID contains).

**Sort fields:** `created_at` (default, newest first), `transaction_id`, `total_amount`, `payment_method`, `payment_status`, `cashier`, `customer`.

Each row includes `user`, `customer`, and `items_count`.

### GET /sales/:id
The full sale with `items`, `payment`, cashier, and customer. Cashiers can only open their own.

### GET /sales/:id/receipt
Receipt data for reprinting: `{ "store": { "name", "address", "phone" }, "sale": { … } }`.

### POST /sales/:id/refund — ADMIN, MANAGER
Full refund. It marks the sale `REFUNDED`, restores stock with `RETURN` inventory logs, removes exactly the loyalty points that sale awarded (never below zero), and writes an audit record of who refunded it. Refunding an already-refunded sale returns `422`, even if several requests arrive at once. Card and Mobile Money money must be returned through Paystack separately.

---

## Customers

### GET /customers — *sortable*
**Query:** `page`, `per_page`, `search` (name, phone, or email).
**Sort fields:** `name` (default), `phone`, `email`, `loyalty_points`, `created_at`.
Each row includes `total_purchases`: lifetime spend on completed sales.

### GET /customers/:id
The customer plus `purchase_summary`: `{ total_spent, purchase_count, average_purchase, last_purchase_at }`.

### POST /customers — ADMIN, MANAGER, CASHIER
**Body:** `name` (required), `phone`, `email`, `address`. Phone and email must be unique.

### PUT /customers/:id — ADMIN, MANAGER
Any of the create fields.

### GET /customers/:id/purchases
Paginated purchases, newest first, each with `items_count`, `payment_method`, and `payment_status`. Cashiers only see the sales they rang up themselves.

Loyalty: 1 point per *loyalty rate* GHS spent (Settings, default 10), awarded on each completed sale.

---

## Reports — ADMIN, MANAGER

All reports accept `start_date` and `end_date` (default: the last 30 days). Every figure is calculated with SQL aggregation over completed sales.

**Revenue definitions.** `sales-summary` and `dashboard` revenue is what customers paid: after discounts, including tax. Product, category, and profit revenue is **net sales**: each line's share after the cart discount, excluding tax. Profit cost uses the cost price recorded at the time of sale.

| Endpoint | Returns |
|---|---|
| `GET /reports/dashboard` | Today's revenue and transaction count, low-stock alert count, all-time top 5 products |
| `GET /reports/sales-summary` | `total_revenue`, `transaction_count`, `average_sale`, `total_discount`, `total_tax` |
| `GET /reports/sales-by-day` | `[{ label: "2026-03-01", value, transactions }]`, one entry per day, including days with no sales |
| `GET /reports/top-products` | `[{ label, sku, value, quantity }]`. **Query:** `limit` (1–100, default 10), `by` (`revenue` or `quantity`) |
| `GET /reports/category-performance` | `[{ label, value, quantity }]` per category |
| `GET /reports/cashier-performance` | `[{ label, username, value, transactions }]` per cashier |
| `GET /reports/inventory-status` | Totals plus up to 20 low-stock and out-of-stock products (no date range) |
| `GET /reports/profit` | `[{ name, sku, revenue, cost, profit, margin }]` using `cost_price` |

### GET /reports/cashier-stats — any role
The signed-in user's figures for today, plus their 5 most recent sales.

---

## Users

### GET /users/staff — ADMIN, MANAGER
`[{ id, full_name, role }]` for filters such as "sales by cashier".

**Every other user endpoint is ADMIN only.**

### GET /users
Every user, with an `is_locked` flag.

### POST /users
**Body:** `{ "username", "email", "password" (≥ 6), "full_name", "role": "ADMIN | MANAGER | CASHIER" }`. Usernames are unique regardless of case.

### PUT /users/:id
**Body (any of):** `full_name`, `email`, `role`, `is_active`. Admins can't remove their own admin role or deactivate themselves.

### POST /users/:id/reset-password
**Body:** `{ "password": "…" }`. Also unlocks the account and signs out all of that user's sessions.

### POST /users/:id/unlock
Clears the lockout and failed-attempt counter. Recorded in the auth log.

---

## Settings

### GET /settings — any role
### PUT /settings — ADMIN
**Body (any of):**
```json
{
  "store_name": "QuickMart POS",
  "store_address": "27 Kwame Nkrumah Ave, Kumasi, Ghana",
  "store_phone": "032-204-1234",
  "currency_symbol": "GH₵",
  "tax_rate": "3",
  "loyalty_points_rate": "10",
  "receipt_footer": "Thank you for shopping with us!"
}
```

---

## Health

### GET /health
`{ "data": { "status": "ok", "timestamp": "…" } }`. No auth required.

---

## Status and error codes

| HTTP | Error code | Meaning |
|---|---|---|
| 200 / 201 | — | OK / Created |
| 400 | `BAD_REQUEST` | Body is not valid JSON |
| 401 | `UNAUTHORIZED` | Missing, invalid, or expired token; bad credentials; locked account |
| 403 | `FORBIDDEN` | Your role can't do this |
| 404 | `NOT_FOUND` | No such record or route |
| 409 | `CONFLICT` | Duplicate unique value (SKU, barcode, phone, …) or a record still in use |
| 422 | `VALIDATION_ERROR` | Invalid input, unexpected fields, insufficient stock or payment |
| 429 | `RATE_LIMIT` / `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `INTERNAL_ERROR` | Paystack verification unavailable |
