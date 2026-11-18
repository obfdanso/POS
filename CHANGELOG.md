# Changelog

Notable changes to QuickMart POS, newest first.

## 2026-11-18

### Added
- **Loyalty points redemption.** Cashiers can spend a customer's points as money off at the till ("Use Points", with a Max button). An admin sets what a point is worth under Settings → Customer & Loyalty (0 turns it off; the seed uses GH₵ 0.10). Points come off after the cart discount and before tax, are deducted in the sale's transaction so two tills can't spend the same points, and appear as their own line on receipts. Returns give the points back in proportion to the goods returned. API: `redeem_points` on `POST /api/sales`.
- **Refund slips.** Each return in a sale's refund history has a *Print slip* button that prints an 80mm slip with the items returned, the amount, the reason, who processed it, and a signature line.
- **Installable app (PWA).** A web app manifest, icons and a service worker let QuickMart be installed on tablets and desktops. Its screens load without a connection (API calls are never cached), and a banner warns staff when they're offline.
- **Cash drawer shifts.** Open a shift with a counted float and close it by counting the drawer; the expected cash (float + cash sales − cash refunds) and the over/short difference are recorded. Sales and refunds are linked to the open shift. Managers and admins review every shift on the new **Shifts** page and can close shifts left open. An admin setting, *Require an Open Shift to Sell*, blocks charging until a shift is open (on by default in the seed data). API: `/api/shifts`.
- **Partial returns.** `POST /api/sales/:id/refund` takes optional `items` (sale line, quantity, restock) and a `reason`. Each unit is refunded at its share of what the customer paid; the last return refunds exactly what is left. Damaged goods can be refunded without restocking. Sales show `PARTIALLY_REFUNDED`, a refund history, and running `refunded_amount` / `refunded_quantity` totals. Reports, the dashboard and customer spending subtract returns. Loyalty points are reduced in proportion.
- **Docker.** `docker compose up --build` runs PostgreSQL, the API and the web app (nginx) together. See *Or run everything with Docker* in the README.
- **CI.** GitHub Actions lints, tests and builds the server and client on every push and pull request.
- `COOKIE_SECURE=false` allows refresh cookies over plain HTTP on a private network (e.g. shop tablets reaching a Docker install).

### Fixed
- Transaction numbers now follow the highest number issued that day, so removing one of today's sales can't cause a duplicate ID.
- Card and mobile money: the POS rechecks prices, stock and tax before charging, and retries a failed sale with the same Paystack reference instead of charging the customer again. Cash sales no longer store a payment reference, and non-cash sales record the verified total as the amount paid.
- Tax and totals round half-pesewa amounts up. The profit report counts the cost of fully discounted items. Reports given only an end date default to the 30 days before it.
- Logged-out and rotated refresh tokens are stored in the database, so they stay revoked after a restart.
- CSV exports escape quotes and neutralise spreadsheet formulas.
- Malformed input (repeated query parameters, non-text fields, oversized bodies) gets 4xx responses instead of 500s.
- Several lists ignore stale responses when filters change quickly; the POS shortcuts ignore open dialogs; Enter confirms card and mobile money payments; item discounts appear on receipts; missing status colours were added.
