# Multi-branch support: design

Date: 2026-11-20 · Status: awaiting approval

## Why

QuickMart should run as a chain, not a single shop. An admin creates branches (e.g. "Kumasi Central", "Accra Mall"), and every existing feature (till, stock, shifts, returns, purchase orders, reports) works per branch. It is the last big feature of the capstone before the TypeScript showcase, so it also has to demo clearly.

## Decisions made with the user

1. **One shared product list.** Products, prices, categories and variants are created once and are the same at every branch.
2. **Each branch stocks its own subset.** A bigger branch can carry products a smaller one doesn't. A product is either stocked at a branch (with its own count and low-stock level) or not stocked there.
3. **One branch per staff member.** Cashiers and managers belong to exactly one branch and only see and work in it. Admins belong to no branch. They get a branch switcher with each branch plus "All branches" for combined views.

## Goals

- Admin can create, edit and deactivate branches (name, short code, address, phone).
- Stock, sales, shifts, returns, inventory history, purchase orders and reports are all per branch.
- The till only offers products stocked at its branch.
- Admin sees any one branch or all of them combined, and can compare branches in reports.
- Existing data upgrades cleanly into a "Main Branch" with no stock lost.

## Non-goals (possible later work)

- Moving stock between branches (transfers). For now a manager can adjust stock down at one branch and up at the other, which is logged at both.
- Different prices per branch.
- Branch-specific promotions, tax rates or loyalty rates (these stay chain-wide).
- Staff working at several branches.

## Anti-goals (a failure even if it "works")

- A sale, return or restock changing another branch's stock.
- A cashier or manager seeing or changing another branch's data by editing a request.
- Old sales, reports or receipts breaking or losing figures after the upgrade.

## Constraints

- Prisma migrations only (`npx prisma migrate dev`), with the data move in the migration SQL.
- Stock can never go negative: keep a CHECK constraint (`quantity >= 0`) on the new table.
- Every stock change still writes an `InventoryLog` row, now with its branch.
- Reports keep using SQL aggregation.
- The 274 backend, 76 client and 9 E2E tests must keep passing, updated where stock moved.
- Spec's transaction ID format `TXN-YYYYMMDD-NNNN` stays.

## Approaches considered

- **A. Branch stock table (chosen).** New `BranchStock(branch_id, product_id, quantity, low_stock_threshold)`, unique per pair. `Product.quantity` and `Product.low_stock_threshold` are removed. One way to read stock everywhere; "not stocked here" is simply no row.
- **B. Keep `Product.quantity` as the main branch's stock, plus a table for other branches.** Fewer changes up front, but two code paths for every stock read and write. Bugs would hide in whichever path is tested less.
- **C. Copy products per branch.** Ruled out by the user (shared list).

## Design

### Data model

- `Branch`: id, `name` (unique), `code` (unique, 2–6 uppercase letters, e.g. `KSI`), `address`, `phone`, `is_active`, timestamps.
- `BranchStock`: id, `branch_id`, `product_id`, `quantity` (int, ≥ 0), `low_stock_threshold` (default 10), timestamps. `@@unique([branch_id, product_id])`. Both FKs `onDelete: Restrict`.
- `User.branch_id` (nullable FK). Required for CASHIER and MANAGER and always null for ADMIN. The API enforces this, since Prisma can't express it.
- `branch_id` (required FK) added to `Sale`, `Shift`, `InventoryLog`, `Refund` (the branch that processed the return), `PurchaseOrder` (the branch the goods are delivered to). Indexes on each.
- `Product.quantity` and `Product.low_stock_threshold` are dropped.

**Migration:** create a branch "Main Branch" (code `MAIN`, address/phone copied from the `store_address`/`store_phone` settings). Insert a `BranchStock` row for every product, active or not, with its current quantity and threshold. Set every non-admin user's, sale's, shift's, log's and PO's `branch_id` to it. Then drop the old columns.

### Which branch a request acts on

- Cashier/manager: always their own `branch_id`, taken from the database user on each request. Anything the client sends is ignored.
- Admin: the client sends an `X-Branch-Id` header from the switcher.
  - Reading lists and reports with no header means **all branches** combined.
  - Anything that changes stock or money (sell, return, adjust, restock, open a shift, create or receive a PO) needs a branch. Without one the API returns 422: "Choose a branch first".
- A middleware puts the resolved `req.branchId` (or null for "all") on every request. Services take it as an argument.
- Inactive branches can't be chosen for new sales, shifts or stock changes, and their staff can't log in. Their history stays readable.

### Branches API and page (admin only)

- `GET/POST /api/branches`, `GET/PUT /api/branches/:id` (deactivate via `is_active`).
- A branch with sales can't be deleted, only deactivated; there is no delete endpoint.
- New **Branches** page under Admin: table plus create/edit modal.
- Every authenticated user can call `GET /api/branches?active=true`, since the switcher and product form need it. It returns only id, name and code.

### Products and stock

- **Product form:** a "Stocked at" section with one row per active branch: a checkbox, a starting quantity and a low-stock level. New products default to all branches checked with quantity 0.
- On edit, ticking a new branch adds a stock row. Unticking is only allowed when that branch's quantity is 0. It deletes the row, and history is kept in the logs.
- **Product list / search / barcode lookup / till:** for a single branch, return only products stocked there, with `quantity` and `low_stock_threshold` taken from that branch's row. The response keeps the same field names, so most client code is unchanged.
  - In admin "All branches" mode the products list shows every product with `quantity` = the total across branches. The till is not available in this mode.
- **Barcode scan of a product not stocked here:** 404 with the message "Not stocked at this branch".
- **Inventory page, low stock, adjust, restock, history:** all per branch. The history modal shows the branch column in admin "All branches" mode.
- **Variants:** each variant is its own product, so it has its own stock rows. The variant picker only lists variants stocked at the branch.

### Sales, returns, shifts

- Sale creation locks and decrements `BranchStock` rows for the sale's branch (same `FOR UPDATE` / conditional-decrement pattern as today) and writes `branch_id` on the sale and logs.
- **Returns can be made at any branch** (decided with the user). Staff at another branch find the sale only by its exact transaction ID (`GET /api/sales/lookup/:transactionId`, branch-scoped lists stay as they are), then return items as usual. Returned goods go back into the stock of the **branch processing the return**, because that is where they physically are now. If that branch doesn't stock the product yet, a stock row is created. The `Refund` records its own `branch_id` (the branch that paid out). The `RETURN` inventory log goes to that branch.
- Cash for a return comes out of the returning branch's drawer: the refunder's open shift if it's at that branch. Otherwise, when the return is at the sale's own branch, the sale's still-open shift (the fix from 2026-11-20). Otherwise refuse when shifts are required, or attach no shift.
- Reports: sales count at the selling branch. Refunds are netted out at the selling branch, so a sale's figures stay together. The returning branch's drawer and stock reflect the cash and goods.
- Shifts carry `branch_id`. The one-open-shift-per-user rule stays.
- Offline queued sales need no change: the server resolves the branch from the logged-in user. For an admin, the queue stores the branch header with each queued sale.
- Transaction IDs stay global (`TXN-YYYYMMDD-NNNN`); the receipt shows the branch.

### Receipts, refund slips, emails, SMS

- Header shows the chain `store_name` and then the **branch name, address and phone**. If the branch's address or phone is empty, the store settings are used instead.

### Purchase orders

- A PO belongs to a branch. Suggestions use that branch's low stock. Receiving adds stock at that branch and creates the stock row if the branch didn't stock the product yet, which is how a branch starts carrying something new.

### Reports and dashboard

- Every report endpoint filters by the resolved branch, or none for "all".
- New `GET /api/reports/branch-performance` (admin): revenue, transactions and net of returns per branch for a date range, as `{label, value}` rows. It's shown as a bar chart on Reports and a small table on the dashboard in "All branches" mode.
- Inventory-status report counts per branch's stock rows.

### Users

- The user form gets a Branch select, required for Cashier/Manager and hidden for Admin.
- Changing a user's branch while they have an open shift is refused.

### Client

- A branch switcher in the header for admins: a dropdown with "All branches" and each active branch. The choice is remembered in localStorage and sent as `X-Branch-Id` by the API client.
- Non-admins see their branch name as a label instead.
- When an admin in "All branches" mode opens the till, it shows "Choose a branch to sell" with the switcher.

### Seed data

- Two branches:
  - Kumasi Central (`KSI`, the current store address)
  - Accra Mall (`ACC`), stocking about 35 of the 50+ products
- Existing manager and cashier go to Kumasi. Add `cashier2 / cashier123` at Accra.
- The 20 sample sales are spread across both branches.

### Testing

- New `branches.test.js`:
  - Branch CRUD and permissions.
  - Branch isolation: a cashier can't see, sell from or restock another branch, even when sending a header.
  - Admin needs a branch for stock changes.
  - "Not stocked here" at the till.
  - Stock rows when a product is created or edited.
  - Migration-equivalent check that products have stock rows.
- Update existing tests that read `product.quantity` to read branch stock. A test helper creates a product with stock at a branch.
- E2E: one test where the admin creates a branch, stocks a product there, and a sale at that branch leaves the other branch's stock unchanged.

## Calls made after the builder check (Claude's, open to correction)

- **Product form scope:** managers see and change only their own branch's row in "Stocked at". Admins see every branch. The API enforces this, and a manager's request touching another branch is 403.
- **Customers are chain-wide.** Loyalty points already are, so the same customer is recognised at every branch. Purchase history shows all their sales with a Branch column. Seeing a customer's own history across branches is acceptable; it isn't another branch's operational data.
- **Shift must match the branch.** A sale or cash refund attaches only to the user's open shift if that shift is at the same branch. An admin with an open shift at branch A who sells at branch B is refused when shifts are required, and otherwise gets no shift. Opening a shift records the current branch.
- **Starting stock is logged.** A non-zero starting quantity, on create or when ticking a new branch on edit, writes an `InventoryLog` row (`RESTOCK`, note "Starting stock") at that branch in the same transaction as the product change.

## Left to the builder

- Exact UI layout of the "Stocked at" section and the Branches page, following existing patterns (Modal, Table, Input).
- Where helper functions live: a `branchService.js` plus a small `branchContext` middleware is the expected shape.
- Commit granularity: small, one-sentence commits, one per step (the user wants many granular commits).
