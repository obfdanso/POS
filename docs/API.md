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

**Request IDs.** Every response has an `X-Request-Id` header (a well-formed incoming `X-Request-Id`, up to 64 letters, digits, `.`, `_` or `-`, is reused). It appears in every log line for that request, and unexpected `500` errors include it as `error.request_id`, so a reported error can be matched to its log entry.

### Validation rules that apply everywhere

- **Unexpected body fields are rejected.** A `POST`/`PUT` body may contain only the fields documented for that endpoint. Anything else returns `422` with `details: [{ "field": "<name>", "message": "Unexpected field \"<name>\"" }]`.
- **Pagination**: `page` (≥ 1, default 1) and `per_page` (1–100, default 20).
- **Sorting**: list endpoints marked *sortable* accept `sort=<field>` and `order=asc|desc`. Unknown sort fields return `422`.
- **Dates**: `start_date` / `end_date` are `YYYY-MM-DD` and inclusive. They're interpreted in the server's local time zone.
- **Money** is returned as decimal strings, e.g. `"12.5"`. Format it for display on the client.
- **Audit trail**: refunds (full and partial), shift closes, product (de)activation, supplier deletion, settings changes, and user creation, changes, and password resets are recorded in the `AuditLog` table with the user who did them. Stock changes are recorded in `InventoryLog`, and logins in `AuthLog`.

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

Signs out every **other** session of this user. The response carries a new `accessToken` and sets a new refresh cookie, so the current device stays signed in. A wrong `current_password` returns `422` with a `current_password` field error.

---

## Products

### GET /products — *sortable*
**Query:** `page`, `per_page`, `search` (matches name, SKU, or barcode), `category_id`, `status` (`active` default, `inactive`, `all`; cashiers always get `active`), `group_variants` (`true` lists only main products, each with its active `variants`; the till uses it for browsing). Every row includes `parent` (for a variant) and `_count.variants`.

**Sort fields:** `name` (default), `sku`, `category`, `price`, `cost_price`, `quantity`, `is_active`, `created_at`.

### GET /products/:id
Includes `parent` for a variant, and `variants` (all of them, by option name) for a main product.

### GET /products/barcode/:code
Exact barcode lookup, used by the POS scanner. Inactive products return `404`.

### POST /products — ADMIN, MANAGER
JSON, or `multipart/form-data` when uploading an `image` (JPG/PNG/WebP, max 5 MB).

**Body:** `name`, `sku`, `category_id`, `price` (> 0) are required. Optional: `barcode`, `supplier_id`, `cost_price`, `quantity` (opening stock, logged as a `RESTOCK`), `low_stock_threshold`, `is_active`, `variant_name`, `parent_id`.

**Variants** (sizes, flavours) are products of their own, with their own SKU, barcode, price and stock, so sales, inventory, purchase orders and reports treat them like any product. Send `parent_id` (a main product, which can't itself be a variant) and `variant_name` (e.g. `"1.5L"`, max 50 characters) to create one. A variant must be in its main product's category. Option names are unique within a group, ignoring case (`409`); the main product can have one too. `422` for a missing name, a variant of a variant, another category, or a missing main product.

### PUT /products/:id — ADMIN, MANAGER
Any of the create fields **except `quantity` and `parent_id`**, which are rejected with `422`: stock only changes through the inventory endpoints, so every change is logged, and a product's variant group is fixed when it is created. Send `image_url: null` to remove the image, or upload a new `image`. Changing `is_active` is **ADMIN only**. A variant's name can't be cleared and its category can't change; changing a main product's category moves its variants too.

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
  "payment_method": "CASH | MOBILE_MONEY | CARD | SPLIT",
  "amount_paid": 50.0,
  "payments": "SPLIT only, see below",
  "discount_amount": 5.0,
  "redeem_points": 0,
  "reference": "required for MOBILE_MONEY and CARD",
  "notes": "optional, max 500 chars"
}
```

- **Totals:** subtotal = Σ(unit price × qty − item discount). Tax = configured rate × (subtotal − cart discount). Every step is rounded to 2 dp, and the client's cart uses the same arithmetic.
- **Promotions:** each line gets the biggest running promotion that applies to its product, its category, or the whole store (on a tie, the most specific). Its share is `round(line gross × percent / 100)`. The item `discount` sent by the till is the cashier's extra discount and comes off what is left. The sale line stores the combined `discount`, plus `promotion_id` and `promotion_discount`.
- **Discounts:** an item discount can't exceed its line total after any promotion, and the cart discount can't exceed the subtotal.
- **Loyalty points:** `redeem_points` spends that many of the customer's points at the `loyalty_point_value` setting each, after the cart discount and before tax. It needs a `customer_id`, redemption turned on (point value above 0), enough points, and points worth no more than what is left after discounts; otherwise `422` with a `redeem_points` field error, before any payment verification. The points are deducted in the sale's transaction, so two tills can't spend the same points. The sale records `loyalty_points_redeemed` and `points_discount`, and `discount_amount` includes the points' value.
- **Limits:** 1–200 items per sale, 1–100,000 units per line, amounts up to GH₵ 1,000,000.
- **customer_id**, if given, must exist (`422` otherwise). This is checked before any payment verification.
- **CASH:** `amount_paid` must cover the total; change is calculated.
- **MOBILE_MONEY / CARD:** `reference` is verified with Paystack. The charge must be in GHS and equal the total **including tax**. A reference can pay for **one sale only**: reuse returns `409`.
- **SPLIT:** instead of `amount_paid` and `reference`, send `payments`: 2–3 parts, each method at most once, e.g. `[{ "method": "CASH", "amount": 40 }, { "method": "MOBILE_MONEY", "amount": 20, "reference": "QM-…" }]`. Each card or Mobile Money part needs its own Paystack reference, verified for exactly its `amount`. A cash part is the cash handed over for what is left (total − other parts); it must cover that, and change is given from it. With no cash part, the parts must add up to the total. `422` for parts that don't add up, a repeated method, a missing reference, or cash when the other parts already cover the total. Each part becomes its own `Payment` row.
- The cost price and the loyalty points awarded are recorded on the sale, so later price changes don't alter profit reports or refunds.
- **Transaction ID** format: `TXN-YYYYMMDD-NNNN`, numbered per day after the highest number already issued that day.
- **Shift:** the sale is linked to the cashier's open shift (`shift_id`). When the `require_open_shift` setting is `"true"`, selling with no open shift returns `422` with a `shift` field error, checked before any payment verification.

**Response `201`:** the full sale, including `items` (each with its `product`), `payments` (cash first) and `payment` (the first of them).

### GET /sales — *sortable*
Cashiers only ever see their own sales.

**Query:** `page`, `per_page`, `start_date`, `end_date`, `user_id`, `customer_id`, `payment_status` (`COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `PENDING`), `payment_method`, `search` (transaction ID contains).

**Sort fields:** `created_at` (default, newest first), `transaction_id`, `total_amount`, `payment_method`, `payment_status`, `cashier`, `customer`.

Each row includes `user`, `customer`, and `items_count`.

### GET /sales/:id
The full sale with `items`, `payment`, cashier, and customer. Cashiers can only open their own.

### GET /sales/:id/receipt
Receipt data for reprinting: `{ "store": { "name", "address", "phone" }, "sale": { … } }`.

### POST /sales/:id/email-receipt
Emails the receipt (HTML with a plain-text version) through the SMTP server in the environment. **Body:** `{ "email": "optional" }`; without it the receipt goes to the customer's email on file. Cashiers can only email their own sales (`403`). `422` when there is no address or it isn't valid; `503` (`EMAIL_NOT_CONFIGURED`) when `SMTP_HOST`/`MAIL_FROM` aren't set; `502` (`EMAIL_FAILED`) when the mail server refuses it. Limited to 10 per minute per user. Each send is written to the audit log (`RECEIPT_EMAILED`).

### POST /sales/:id/sms-receipt
Texts a short receipt (total, how it was paid, change, points earned) through Arkesel or Twilio. **Body:** `{ "phone": "optional" }`; without it the text goes to the customer's phone on file. Local numbers such as `024-123-4567` get `SMS_COUNTRY_CODE` (default `233`). Only numbers in that country, or in `SMS_ALLOWED_COUNTRY_CODES`, can be texted. Cashiers can only text their own sales (`403`). `422` when there is no number, it isn't valid, or it is in another country; `429` (`SMS_LIMIT`) once a receipt has been texted 3 times; `503` (`SMS_NOT_CONFIGURED`) when SMS isn't set up; `502` (`SMS_FAILED`) when the provider refuses it. Limited to 5 per minute per user. Each text is written to the audit log (`RECEIPT_TEXTED`).

### POST /sales/:id/refund — ADMIN, MANAGER
Returns some or all of a sale. **Body (all optional):**
```json
{
  "items": [{ "sale_item_id": "uuid", "quantity": 1, "restock": true }],
  "reason": "Damaged packaging"
}
```
- With no `items`, everything not yet returned is refunded (a full refund, as before).
- Each returned unit is refunded at its share of what the customer paid: `total_amount × (line total × qty / line quantity) / subtotal`, which spreads the cart discount and tax. The return that brings back the last unit refunds exactly what is left, so the refunds always add up to the sale total.
- `restock: false` (damaged goods) refunds the money but leaves stock unchanged. Restocked units get `RETURN` inventory logs.
- The sale becomes `PARTIALLY_REFUNDED`, then `REFUNDED` once every unit is back. `refunded_amount` and each item's `refunded_quantity` keep running totals, and `refunds` lists every return with its items, amount, reason and who processed it.
- Loyalty points are reduced so the customer keeps only the points for what they kept (never below zero).
- Points redeemed on the sale are given back in proportion to the value of goods returned (all of them once the whole sale is back), and tracked in `loyalty_points_restored`. They are restored before earned points are taken back.
- If the refunding user has an open shift, the refund is linked to it, and cash refunds reduce that drawer's expected cash.
- A split sale's refunds are paid back in cash first, up to the cash the sale took (net of change) less cash already refunded; the rest goes back to the card or Mobile Money. Each refund records the cash part in `cash_amount`.
- `422` when returning more than is left, an item from another sale, the same line twice, or a sale already fully refunded. Simultaneous returns against one sale are processed one at a time.
- **Paystack refunds:** the card or Mobile Money part of a refund (all of it, or what isn't paid back in cash on a split sale) is sent back through Paystack's refund API once the return is saved, to the charge it came from, when `PAYSTACK_SECRET_KEY` is set (turn this off with `PAYSTACK_AUTO_REFUND=false`). The refund records `gateway_amount`, `gateway_reference`, `gateway_refund_id` and `gateway_status`: `NOT_SENT`, `PENDING`, `PROCESSING`, `PROCESSED` or `FAILED` (with `gateway_error`). A Paystack failure never undoes the return; it is kept as `FAILED` to retry. Cash refunds have no gateway status.

### POST /sales/:id/refunds/:refundId/paystack — ADMIN, MANAGER
Sends a `NOT_SENT` or `FAILED` refund to Paystack, or asks Paystack how a `PENDING` / `PROCESSING` one is going. Returns the sale. `409` while it is already being sent; `422` for a cash refund or one no single charge covers (send it from the Paystack dashboard); `503` when Paystack isn't set up. Sending is audited (`PAYSTACK_REFUND_SENT` / `PAYSTACK_REFUND_FAILED`).

### POST /paystack/webhook — Paystack only
Paystack's `refund.pending`, `refund.processing`, `refund.processed` and `refund.failed` events update the matching refund. The body must carry a valid `x-paystack-signature` (HMAC-SHA512 of the body with the secret key), or `401`. A refund already `PROCESSED` is never moved back. Set this URL in the Paystack dashboard under Settings → API Keys & Webhooks.

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

Loyalty: 1 point per *loyalty rate* GHS spent (Settings, default 10), awarded on each completed sale on the amount actually paid. Customers can spend points at checkout when *loyalty point value* is above 0 (see `redeem_points` on `POST /sales`).

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

## Purchase orders — ADMIN, MANAGER

Stock ordered from a supplier. Each order has a `po_number` (`PO-YYYYMMDD-NNNN`), a `status` (`ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`), `total_cost` (Σ quantity × unit cost), and `items` with `quantity_ordered`, `quantity_received` and `quantity_outstanding`. Creating, receiving and cancelling are audited.

### GET /purchase-orders — *sortable*
**Query:** `page`, `per_page`, `status`, `supplier_id`, `search` (order number), `start_date`, `end_date`, `sort` (`created_at`, `po_number`, `status`, `total_cost`, `expected_at`, `supplier`), `order`. Rows include `item_count`, `units_ordered`, `units_received`.

### GET /purchase-orders/suggestions?supplier_id=
The supplier's active products at or below their low-stock level, with `suggested_quantity` = twice the threshold minus stock minus anything already on open orders, and the last `unit_cost`.

### GET /purchase-orders/:id

### POST /purchase-orders
**Body:** `{ "supplier_id", "items": [{ "product_id", "quantity", "unit_cost" }], "expected_at"?, "notes"? }`. Each product once; products must be active.

### POST /purchase-orders/:id/receive
**Body (all optional):** `{ "items": [{ "item_id", "quantity" }], "update_cost": true, "notes" }`. Adds each quantity to stock with a `RESTOCK` inventory log ("Received on PO-…"). Without `items`, everything outstanding is received. `update_cost` (default `true`) sets each product's cost price to the order's unit cost. The order becomes `PARTIALLY_RECEIVED` or `RECEIVED`. `422` for more than is outstanding, an item from another order, or a closed order. The order row is locked, so the same delivery can't be received twice at once.

### POST /purchase-orders/:id/cancel
**Body:** `{ "reason"? }`. Only open orders. Goods already received stay in stock.

---

## Promotions

Automatic percentage discounts. `product_id` targets one product, `category_id` every product in a category, neither the whole store. A promotion runs while `is_active` is true, after `starts_at`, and before `ends_at` (if set). Responses include `status`: `ACTIVE`, `SCHEDULED`, `ENDED` or `OFF`.

### GET /promotions/active — any role
The running promotions (`id`, `name`, `percent_off`, `product_id`, `category_id`, `ends_at`), so the till can price the cart exactly as the server will.

### GET /promotions — ADMIN, MANAGER
Every promotion with its product or category, `status`, and `times_used` (sale lines it was applied to). **Query:** `status`.

### GET /promotions/:id — ADMIN, MANAGER

### POST /promotions — ADMIN, MANAGER
**Body:** `{ "name", "percent_off" (0.01–100), "product_id"?, "category_id"?, "starts_at"? (default now), "ends_at"?, "is_active"? }`. Not both `product_id` and `category_id`; `ends_at` must be after `starts_at`.

### PUT /promotions/:id — ADMIN, MANAGER
Any of the create fields, e.g. `{ "is_active": false }` to switch one off. Past sales keep the discount they got.

---

## Shifts

A shift is one person's session at a till: opened with a counted cash float, closed by counting the drawer. Every role can open and close its own shift; managers and admins can see and close anyone's. A user can have only one open shift.

Every shift response includes a `summary`: `sales_count`, `sales_total`, `by_method` (`CASH`, `MOBILE_MONEY`, `CARD`, each `{ count, total }` of money taken that way, so a split sale counts towards each method it used), `split_count`, `cash_sales`, `cash_refunds` (the cash part of refunds), and `expected_cash` (opening float + cash sales − cash refunds).

### GET /shifts/current
The caller's open shift with live totals, or `null`.

### POST /shifts/open
**Body:** `{ "opening_float": 200, "notes": "optional" }`. `409` if the caller already has an open shift.

### POST /shifts/:id/close
**Body:** `{ "counted_cash": 225.5, "notes": "optional" }`. Records `expected_cash`, `counted_cash`, `difference` (counted − expected; negative means short), who closed it and when, and writes a `SHIFT_CLOSED` audit record. `422` if already closed; `403` if a cashier tries to close someone else's.

### GET /shifts — *sortable*
**Query:** `page`, `per_page`, `status` (`OPEN`, `CLOSED`), `user_id`, `start_date`, `end_date` (by opening time), `sort` (`opened_at`, `closed_at`, `difference`, `cashier`), `order`. Cashiers only see their own. Each row includes `sales_count`.

### GET /shifts/:id
One shift with its `summary`. Cashiers can only view their own (`403`).

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
  "loyalty_point_value": "0.10",
  "receipt_footer": "Thank you for shopping with us!",
  "require_open_shift": "true"
}
```
`require_open_shift`: `"true"` makes cashiers open a shift before they can sell. `loyalty_point_value`: money off per point redeemed, 0–1000 (default `"0"`, which turns redemption off).

---

## Health

### GET /health
`{ "data": { "status": "ok", "timestamp": "…" } }`. No auth required. Answers whenever the process is up.

### GET /health/ready
Checks the database too: `200` with `{ "status": "ready", "database": "ok", "database_ms", "uptime_s" }`, or `503` (`SERVICE_UNAVAILABLE`) when the database can't be reached. No auth required. Docker Compose uses it as the API container's healthcheck.

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
