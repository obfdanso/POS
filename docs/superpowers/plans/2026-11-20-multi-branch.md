# Multi-branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create branches and have stock, sales, shifts, returns, purchase orders and reports work per branch, with one shared product list.

**Architecture:** A `BranchStock` table replaces `Product.quantity`/`low_stock_threshold`. All stock writes go through one helper. A `resolveBranch` middleware puts the acting branch on `req.branchId`: the user's own branch for cashiers and managers, and the `X-Branch-Id` header (or null for "all") for admins. Services take `branchId` and filter by it. The client keeps the admin's chosen branch in a context and sends it on every request.

**Tech Stack:** Express + Prisma 5 + PostgreSQL, Jest/Supertest; React 18 + Vite + Tailwind, Vitest; Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-20-multi-branch-design.md`. Read it first, especially "Calls made after the builder check" and the cross-branch returns rules.

## Global Constraints

- Schema changes only through Prisma migrations: `npx prisma migrate dev --create-only --name <name>`, edit the SQL, then `npx prisma migrate dev`.
- `BranchStock.quantity` has `CHECK (quantity >= 0)`. Every stock change writes an `InventoryLog` row with `branch_id`.
- Transaction ID format stays `TXN-YYYYMMDD-NNNN`, numbered chain-wide.
- API responses keep the standard `{ success, data, meta }` / `{ success:false, error }` shapes. Validation errors are 422 with `details[{field,message}]`.
- Reports use SQL aggregation; branch filters use `Prisma.sql` fragments (`Prisma.empty` when null), never string interpolation.
- No `console.log`, `alert()`, `confirm()`, or commented-out code. Money is formatted with `formatCurrency`.
- Run backend tests with `npm test` (serial). Plain `npx jest` runs files in parallel and they clash over shared settings.
- Commits: small, one plain sentence, no `Co-Authored-By` line (user preference). Several commits per task are welcome.
- PostgreSQL service must be running (`postgresql-x64-18`).

## Review Focus

1. A cashier or manager sending `X-Branch-Id` for another branch: the header is ignored and they still act on their own branch (Task 3 test).
2. An admin in "All branches" mode selling, adjusting stock, opening a shift or creating a PO: 422 "Choose a branch first" (Task 3 middleware test, Task 6 sale test).
3. Posting a sale for a product that exists but isn't stocked at the branch: 422 naming the product, "not stocked at this branch" (Task 6).
4. Same product at two branches: selling all of branch A's stock leaves branch B's count untouched, and the oversell guard is per branch (Task 6).
5. A deactivated branch: its staff can't log in or use existing tokens, and an admin can't pick it for stock changes (Task 3).

---

## Shared interfaces (defined once, used everywhere)

- `server/src/middleware/branch.js`
  - `resolveBranch(req, res, next)`: after `authenticate`, sets `req.branchId: string | null`.
    - Non-admin: `req.user.branch_id`.
    - Admin: `req.headers['x-branch-id']` if it names an existing **active** branch, otherwise null. An unknown or inactive id gives 422 field `branch`.
  - `requireBranch(req, res, next)`: 422 `ValidationError('Choose a branch first', [{ field: 'branch', message: 'Choose a branch first' }])` when `req.branchId` is null.
- `server/src/utils/branchStock.js`
  - `changeStock(tx, { branchId, productId, change, type, userId, notes, createIfMissing = false })` → `Promise<{ previous: number, quantity: number, log: InventoryLog }>`. This is the only code that writes `BranchStock.quantity`.
    - Uses a conditional `updateMany` (`quantity >= -change` when change < 0), then logs.
    - A missing row with `createIfMissing` creates it with quantity 0 first.
    - A missing row without it throws `ValidationError` field `items`, message `"<product name>" is not stocked at this branch`.
    - Going negative throws field `quantity`, message `Cannot reduce below 0. Current stock: N`.
- `server/src/services/branchService.js`: `listBranches({ active })`, `getBranch(id)`, `createBranch(data, userId)`, `updateBranch(id, data, userId)`, `branchStockFor(productIds, branchId)` (returns a `Map productId → { quantity, low_stock_threshold }`; with `branchId` null it sums across branches).
- Product, inventory and sale responses keep the field names `quantity` and `low_stock_threshold`, filled from the acting branch's row (or summed for "all"). Product detail also returns `stocks: [{ branch_id, branch: { name, code }, quantity, low_stock_threshold }]`.
- Sale includes `branch: { id, name, code, address, phone }`. Refund includes `branch_id`.
- Test helper (`server/src/__tests__/helpers.js`):
  - `createUserWithToken(role, prefix, { branchId } = {})` → `{ user, token, headers }`. Non-admins get `branchId ?? (await testBranch()).id`. `headers` = `{ Authorization, 'X-Branch-Id': branchId }`, and admins also get the test branch header.
  - `testBranch()` (find-or-create `{ name: 'Test Branch', code: 'TEST' }`).
  - `createTestProduct(data, { quantity = 0, low_stock_threshold = 10, branchId } = {})`: creates the product and its stock row at `branchId ?? testBranch`.
  - `stockAt(productId, branchId)` → number.
- Client:
  - `client/src/services/api.js`: `setBranchId(id | null)`. The request interceptor adds `X-Branch-Id` when set.
  - `client/src/context/BranchContext.jsx`: `useBranch()` → `{ branches, branchId, setBranchId, currentBranch, isAllBranches, canSwitch }`. Admin choice is kept in localStorage key `quickmart.branchId` inside try/catch.
  - `client/src/services/branches.js`: `list(params)`, `get(id)`, `create(data)`, `update(id, data)`.

---

### Task 1: Schema and data migration

**Files:** Modify `server/prisma/schema.prisma`; Create `server/prisma/migrations/<ts>_branches/migration.sql`; Test `server/src/__tests__/branch-migration.test.js`

- [ ] **Step 1: Schema.** Add `Branch` (`name` unique, `code` unique, `address?`, `phone?`, `is_active` default true, timestamps) and `BranchStock` (`branch_id`, `product_id`, `quantity Int @default(0)`, `low_stock_threshold Int @default(10)`, timestamps, `@@unique([branch_id, product_id])`, `@@index([product_id])`, both relations `onDelete: Restrict`).
  - Add `branch_id`: optional on `User`, required on `Sale`, `Shift`, `InventoryLog`, `Refund`, `PurchaseOrder`, each with `@@index([branch_id])`.
  - Remove `Product.quantity` and `Product.low_stock_threshold`.
- [ ] **Step 2: Create the migration with `--create-only` and hand-edit its SQL** in this order:
  1. Create the tables.
  2. `INSERT` one branch `'Main Branch'`, code `'MAIN'`, with address/phone from `"Settings"` keys `store_address`/`store_phone` (subselects).
  3. `INSERT INTO "BranchStock"` one row per product (`gen_random_uuid()`, its quantity and threshold).
  4. Add each `branch_id` column as nullable, `UPDATE` all rows to the main branch (users: only `role <> 'ADMIN'`), then `SET NOT NULL` (except `User`) and add the FKs.
  5. `ADD CONSTRAINT "BranchStock_quantity_check" CHECK (quantity >= 0)`.
  6. Drop the two product columns.
- [ ] **Step 3: Apply.** Run `cd server && npx prisma migrate dev`. Expected: "Your database is now in sync", with the client generated.
- [ ] **Step 4: Write the test** `branch-migration.test.js`:
  - `every product has at least one stock row`: count of products with no `stocks` is 0.
  - `stock can't go negative in the database`: `prisma.branchStock.update({ data: { quantity: -1 } })` rejects.
  - `non-admin users all have a branch`.
- [ ] **Step 5: Run.** Run `npx jest src/__tests__/branch-migration.test.js`. Expected: PASS. The rest of the suite is now red until Task 7; that is expected.
- [ ] **Step 6: Commit** the schema and migration, then the test, as two commits.

### Task 2: Seed data

**Files:** Modify `server/prisma/seed.js`

- [ ] **Step 1: Branches.** Seed two branches:
  - Kumasi Central (`KSI`, the current `store_address`/`store_phone`)
  - Accra Mall (`ACC`, `'Accra Mall, Spintex Rd, Accra'`, `'030-281-5500'`)
- [ ] **Step 2: Stock rows.**
  - Every product gets a Kumasi row with its current seed quantity and threshold.
  - The first ~35 products (deterministic, e.g. every product whose index % 3 !== 2, plus all variants of a stocked parent) also get an Accra row at about half the quantity.
- [ ] **Step 3: Users.**
  - `manager` and `cashier` go to Kumasi.
  - Add `cashier2 / cashier123` (full name "Akosua Boateng", CASHIER) at Accra.
  - `admin` has no branch.
- [ ] **Step 4: Sales and shifts.**
  - The 20 sample sales alternate branches: Accra sales are made by cashier2, use only Accra-stocked products and deduct Accra stock.
  - Every sale, log and shift gets `branch_id`.
- [ ] **Step 5: Run** `npx prisma migrate reset --force` (runs the seed). Expected: completes without errors. Check: `node -e` count of `branchStock` ≥ 85.
- [ ] **Step 6: Commit.**

### Task 3: Branch context, branch API, test helpers

**Files:**
- Create: `server/src/middleware/branch.js`, `server/src/services/branchService.js`, `server/src/controllers/branchController.js`, `server/src/routes/branches.js`, `server/src/utils/branchStock.js`
- Modify: `server/src/middleware/auth.js` (select `branch_id` and `branch: { select: { is_active: true } }`; non-admin whose branch is inactive → 401 "Your branch is closed"), `server/src/services/authService.js` (same check at login, logged as a failed attempt, plus `/auth/me` returns `branch { id, name, code }`), `server/src/app.js` (mount `/api/branches`, apply `resolveBranch` after authenticate on every protected router), `server/src/__tests__/helpers.js`
- Test: `server/src/__tests__/branches.test.js`

**Interfaces:** Produces everything in "Shared interfaces" for the server and test helpers.

- [ ] **Step 1: Write the failing tests** in `branches.test.js`:
  - `admin creates, edits and deactivates a branch`: POST 201 with `{ name, code: 'TST2' }`; duplicate code 409; code `'k1'` 422; PUT `is_active:false` 200.
  - `managers and cashiers can't manage branches`: POST as manager → 403. GET `?active=true` as cashier → 200 with only `id,name,code` keys.
  - `staff of a closed branch are signed out`: deactivate a branch holding a test cashier. That cashier's existing token → 401, and login → 401.
  - `staff can't act on another branch by header`: a cashier at branch A sends `X-Branch-Id: B` to `GET /api/inventory`; every row has `branch_id === A`. Assert after Task 5; mark it `it.todo` until then.
  - `admin needs a branch for stock changes`: admin with no header → `POST /api/inventory/restock` → 422 `details[0].field === 'branch'`. Assert after Task 5.
- [ ] **Step 2: Run** `npx jest src/__tests__/branches.test.js`. Expected: FAIL (route 404).
- [ ] **Step 3: Implement** the middleware, `changeStock`, `branchService`, routes (`express-validator`: `name` 2–80 chars, `code` matching `/^[A-Z]{2,6}$/`, optional `address` ≤ 200, `phone` ≤ 30), audit `BRANCH_CREATED`/`BRANCH_UPDATED`, and the helpers.
- [ ] **Step 4: Run** the same command. Expected: PASS (todos pending).
- [ ] **Step 5: Commit**: middleware, branch API, auth closed-branch check and helpers as separate commits.

### Task 4: Products with branch stock

**Files:** Modify `server/src/services/productService.js`, `server/src/routes/products.js`, `server/src/controllers/productController.js`; Test `server/src/__tests__/products.test.js` (+ new cases)

**Interfaces:**
- `listProducts({ ..., branchId })`: a branch → `where.stocks = { some: { branch_id } }`, quantity from that row. Null → all products with summed quantity via `branchStockFor`. `status: 'low'|'out'` filters use the branch row.
- `getProductById(id, branchId)`, `getProductByBarcode(code, branchId)`: with a branch and no row → `NotFoundError('Not stocked at this branch')`.
- `createProduct(data, user, branchId)` and `updateProduct(id, data, user, branchId)` take `stocks: [{ branch_id, quantity?, low_stock_threshold? }]`.
  - Create with `stocks` omitted means every active branch for an admin and the own branch for a manager.
  - Rows for a branch other than the manager's own → 403.
  - On update, a listed branch with no row is added, and its quantity goes through `changeStock(type 'RESTOCK', notes 'Starting stock')` when > 0.
  - On update, an existing row not listed is deleted only if its quantity is 0, otherwise 422 field `stocks`, message `"<branch>" still has N in stock`. A manager's update only considers their own branch's row.
- Variant grouping (`group_variants=true`): only variants stocked at the branch.

- [ ] **Step 1: Write failing tests:**
  - `lists only products stocked at the branch`
  - `scanning a product not stocked here says so` (404, message `Not stocked at this branch`)
  - `starting stock is logged` (log `RESTOCK`, notes `Starting stock`, `branch_id`)
  - `a manager can't stock another branch` (403)
  - `can't stop stocking a branch that still has stock` (422)
  - `all-branches view sums quantities` (admin, no header: 5 + 7 → 12)
- [ ] **Step 2: Convert** the existing setups in `products.test.js` to `createTestProduct` and `who.headers`.
- [ ] **Step 3: Run** `npx jest src/__tests__/products.test.js`. Expected: new tests FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** in pieces (listing, lookup, create/update stocks, tests).

### Task 5: Inventory per branch

**Files:** Modify `server/src/services/inventoryService.js`, `server/src/controllers/inventoryController.js`, `server/src/routes/inventory.js`; Test `server/src/__tests__/inventory.test.js`

**Interfaces:**
- `listInventory({ ..., branchId })` queries `BranchStock` (include product + category + branch) so sorting by `quantity`/`low_stock_threshold` is a plain column sort. Each row returns `{ id: product_id, branch_id, branch, name, sku, quantity, low_stock_threshold, price, category }`. A null branch lists every branch's rows.
- `getLowStockCount(branchId)` and `getLowStock(branchId)` use raw SQL on `"BranchStock"` joined to `"Product"` (active products only) with an optional `Prisma.sql` branch filter.
- `adjustStock(productId, change, type, userId, notes, branchId)` and `restockProduct(...)` go through `changeStock`. The routes use `requireBranch`. `PUT /inventory/:productId/threshold` is optional; the threshold is edited via the product form.
- `getInventoryLog(productId, { page, per_page, branchId })` filters by branch when set and includes `branch: { name, code }`.

- [ ] **Step 1: Write failing tests:**
  - `restocking one branch leaves the other alone`
  - `low stock is per branch` (qty 2 / threshold 5 at A, 50 at B → listed for A only)
  - Enable the two `branches.test.js` todos from Task 3.
- [ ] **Step 2: Run** `npx jest src/__tests__/inventory.test.js src/__tests__/branches.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Sales, returns and the sale lookup

**Files:** Modify `server/src/services/salesService.js`, `server/src/controllers/salesController.js`, `server/src/routes/sales.js`; Test `server/src/__tests__/sales.test.js`, `returns.test.js`, `shifts.test.js`, new cases in `branches.test.js`

**Interfaces:**
- `createSale(data, userId, branchId)`: the route uses `requireBranch`.
  - Validation reads stock with `branchStockFor(ids, branchId)`. A missing row → 422 field `items`, `"<name>" is not stocked at this branch`.
  - Deduction goes through `changeStock(type 'SALE')`.
  - Sets `Sale.branch_id`.
  - The shift is the user's open shift only if `shift.branch_id === branchId`. Otherwise no shift, or `noOpenShiftError()` when `require_open_shift` is 'true'.
  - The idempotent `client_ref` replay is unchanged.
- `listSales({ ..., branchId })` filters when set. Cashier-own filtering is unchanged.
- `getSaleById(id, user, branchId)`: non-admins get 404 for another branch's sale.
- `getSaleByTransactionId(txn)`: route `GET /api/sales/lookup/:transactionId`, MANAGER/ADMIN, any branch. Same shape as `getSaleById`.
- `processRefund(saleId, userId, { items, reason }, branchId)`:
  - Route `requireBranch`; works on any branch's sale.
  - Restock goes through `changeStock(type 'RETURN', createIfMissing: true)` at `branchId`.
  - Sets `Refund.branch_id = branchId`.
  - `refundShiftId` becomes `(tx, userId, sale, cashAmount, branchId)`: the user's open shift only if it is at `branchId`, then the sale's still-open shift only if `sale.branch_id === branchId`, then the existing require/null rule.
- Receipt data (`GET /sales/:id/receipt`) includes `branch`.

- [ ] **Step 1: Write failing tests** (in `branches.test.js`):
  - `sells from the branch's own stock only`: product with 3 at A and 3 at B; cashier A sells 3 → A is 0, B still 3; selling 1 more at A → 422.
  - `refuses a product not stocked at the branch`.
  - `returns at another branch go into that branch's stock`: sale at A, manager at B looks it up by transaction ID (200), returns 1 → B +1, A unchanged, `refund.branch_id === B`.
  - `a cashier can't open another branch's sale by id` (404).
  - `an admin's shift at A isn't used for a sale at B`.
- [ ] **Step 2: Convert** fixtures in `sales.test.js`, `returns.test.js`, `shifts.test.js`.
- [ ] **Step 3: Run** those four files. Expected: new tests FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** in pieces (sale stock, sale scoping, lookup, refund branch, tests).

### Task 7: Remaining backend fixtures, so the full suite is green

**Files:** Modify every other test file listed by `grep -l "product.create" server/src/__tests__` that isn't converted yet (customers, email-receipt, loyalty-redemption, offline-sales, paystack-refunds, promotions, purchase-orders, reports, sms-receipt, split-payments, suppliers, sweep-regressions, sweep2-regressions).

- [ ] **Step 1: Convert** each file: `createTestProduct(data, { quantity })` instead of `quantity` on the product, `who.headers` instead of the local `auth()`, and reads of `product.quantity` become `stockAt(id, branchId)`.
- [ ] **Step 2: Run** `cd server && npm test`. Expected: all suites pass apart from those owned by Tasks 8–10 (shift lists, POs, reports). Fix those files' fixtures now if they only fail on fixtures.
- [ ] **Step 3: Commit** per file group.

### Task 8: Shifts per branch

**Files:** Modify `server/src/services/shiftService.js`, `server/src/routes/shifts.js`; Test `shifts.test.js`

- [ ] **Step 1: Write failing tests:**
  - `a shift records its branch` (`branch_id` equals the user's branch)
  - `a manager only sees and closes shifts at their branch` (manager at B closing a shift at A → 404)
- [ ] **Step 2: Implement.**
  - `openShift(userId, body, branchId)`: the route uses `requireBranch`.
  - `listShifts({ ..., branchId })` filters by branch.
  - `closeShift` and `getShift`: non-admins get 404 when `shift.branch_id !== user.branch_id`.
  - Include `branch: { name, code }` in lists.
- [ ] **Step 3: Run** `npx jest src/__tests__/shifts.test.js`. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 9: Purchase orders per branch

**Files:** Modify `server/src/services/purchaseOrderService.js`, `server/src/routes/purchaseOrders.js`; Test `purchase-orders.test.js`

- [ ] **Step 1: Write failing tests:**
  - `receiving adds stock at the order's branch`
  - `receiving a product the branch didn't stock starts stocking it`
  - `suggestions use the branch's low stock`
- [ ] **Step 2: Implement.**
  - `createPurchaseOrder(data, userId, branchId)` (`requireBranch`).
  - `listPurchaseOrders({ ..., branchId })`.
  - `receivePurchaseOrder` uses `changeStock(type 'RESTOCK', createIfMissing: true, branchId: po.branch_id)`.
  - `getReorderSuggestions(supplierId, branchId)` (`requireBranch`).
  - Non-admins can't receive or cancel another branch's PO (404).
- [ ] **Step 3: Run** the file. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 10: Reports, dashboard and branch comparison

**Files:** Modify `server/src/services/reportService.js`, `server/src/controllers/reportController.js`, `server/src/routes/reports.js`; Test `reports.test.js`

**Interfaces:**
- Every report function gains `branchId` in its params object, and the SQL adds `AND s.branch_id = ${branchId}` via `Prisma.sql` (or `Prisma.empty`).
- `getInventoryStatus(branchId)` reads `BranchStock`.
- `getDashboardSummary(branchId)`.
- `getCashierStats(userId)` is unchanged.
- New `getBranchPerformance({ start_date, end_date })` → `[{ label: branch name, value: net revenue, transactions, refunds }]`, grouped by `Sale.branch_id`, with net = total − refunded_amount (matching the existing summary's netting). Route `GET /api/reports/branch-performance`, ADMIN.

- [ ] **Step 1: Write failing tests:**
  - `summary is filtered by branch` (sales of 10 at A and 20 at B → admin with header A sees revenue 10, no header sees ≥ 30)
  - `branch performance lists each branch with its net revenue`
  - `managers can't see branch comparison` (403)
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `npx jest src/__tests__/reports.test.js`, then the full `npm test`. Expected: ALL PASS.
- [ ] **Step 4: Commit.**

### Task 11: Users, customers, receipts on the server

**Files:** Modify `server/src/routes/users.js` (and its service/controller), `server/src/services/customerService.js`, `server/src/utils/receiptEmail.js`, `server/src/utils/sms.js` (receipt text); Test `users.test.js` (or `branches.test.js`), `customers.test.js`, `email-receipt.test.js`

- [ ] **Step 1: Write failing tests:**
  - `a cashier or manager must have a branch` (create without `branch_id` → 422 field `branch_id`)
  - `admins have no branch` (create admin with `branch_id` → saved as null)
  - `can't move someone with an open shift` (422 field `branch_id`)
  - `purchase history shows the branch` (`branch.name` on each row)
  - `emailed receipt shows the branch address` (HTML contains the branch address)
- [ ] **Step 2: Implement.**
  - Users: `branch_id` optional `isUUID`, must be an active branch.
  - Customer purchases include `branch: { name }`.
  - Email/SMS header: store name + branch name, with the branch address/phone falling back to the settings.
- [ ] **Step 3: Run** those files. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 12: Client branch state and Branches page

**Files:**
- Create: `client/src/context/BranchContext.jsx`, `client/src/services/branches.js`, `client/src/pages/BranchesPage.jsx`, `client/src/components/BranchSwitcher.jsx`
- Modify: `client/src/services/api.js`, `client/src/main.jsx` or `App.jsx` (provider inside AuthProvider; route `/branches` ADMIN), `client/src/layouts/DashboardLayout.jsx` (switcher for admins, branch name label for others, nav "Branches" for admin, `<Outlet key={branchId ?? 'all'} />` so pages refetch on switch), `client/src/context/CartContext.jsx` (clear the cart when the branch changes)
- Test: `client/src/context/BranchContext.test.jsx`

- [ ] **Step 1: Write failing Vitest tests:**
  - `admin choice is remembered and sent as a header` (`setBranchId` called with the stored id)
  - `non-admins always use their own branch`
  - `an unknown stored id falls back to All branches`
- [ ] **Step 2: Implement.** Branches page: Table (name, code, address, phone, status) with a create/edit Modal using Input and inline errors from `fieldErrors` in `utils/apiErrors.js`, and toasts.
- [ ] **Step 3: Run** `cd client && npx vitest run && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 4: Commit** in pieces (api header, context, switcher, page).

### Task 13: Client product, inventory and till changes

**Files:** Modify `client/src/pages/ProductFormPage.jsx`, `ProductsPage.jsx`, `InventoryPage.jsx`, `components/InventoryHistoryModal.jsx`, `POSPage.jsx`, `utils/offlineQueue.js`

- [ ] **Step 1: Product form, "Stocked at" section.** One row per branch the user may edit: checkbox, starting quantity (new rows only), low-stock level. Send it as `stocks`. Show the 422 `stocks` error inline.
- [ ] **Step 2: Inventory.** Add a Branch column when `isAllBranches`. Disable Adjust/Restock in all-branches mode, with the tooltip "Choose a branch first". History shows the branch.
- [ ] **Step 3: Till.** In admin all-branches mode, show a centred card with the text "Choose a branch to sell" and the switcher instead of the till. A scan or Enter that gets the 404 "Not stocked at this branch" shows that as an error toast.
- [ ] **Step 4: Offline queue.** Store `branch_id` with each queued sale and send it as the `X-Branch-Id` header when flushing. Update its existing Vitest test to assert the header.
- [ ] **Step 5: Run** `npx vitest run && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** per page.

### Task 14: Client returns lookup, receipts, users, shifts, orders, reports

**Files:** Modify `client/src/pages/SalesPage.jsx`, `components/Receipt.jsx`, `utils/refundReceipt.js`, `pages/UsersPage.jsx`, `ShiftsPage.jsx`, `PurchaseOrdersPage.jsx`, `ReportsPage.jsx`, `DashboardPage.jsx`, `CustomerDetailPage.jsx`, `services/sales.js`, `services/reports.js`

- [ ] **Step 1: Sales page.** Add a "Return from another branch" button (MANAGER/ADMIN) that opens a small modal. The modal takes a transaction ID and calls `salesService.lookup(txn)`, then opens the existing sale detail / Return dialog for that sale. Show the 404 inline as "No sale with that transaction ID".
- [ ] **Step 2: Receipts.** Receipt and refund slip show the branch name, address and phone under the store name, falling back to the settings. Update `refundReceipt` tests.
- [ ] **Step 3: Users form.** Add a Branch select: required and shown for Cashier/Manager, hidden for Admin. The table gets a Branch column.
- [ ] **Step 4: Branch columns.** Shifts, Orders and Customer purchases get a Branch column when it isn't redundant: always for admin all-branches mode, and always on customer purchases.
- [ ] **Step 5: Reports and dashboard.** Reports gets a "Branches" bar chart from `/reports/branch-performance`, admin + all-branches only. The dashboard shows a small branches table in that mode.
- [ ] **Step 6: Run** `npx vitest run && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 7: Commit** per page.

### Task 15: E2E, docs, wrap-up

**Files:** Create `e2e/tests/branches.spec.js`; Modify `e2e/tests/helpers.js` (add `cashier2`), `docs/API.md`, `docs/DATABASE.md`, `README.md`, `CHANGELOG.md`, `server/.env.example` (no new vars expected; confirm), `D:\POS\TODO.local.md` (local only)

- [ ] **Step 1: E2E test** `admin creates a branch, stocks a product there and a sale there leaves Kumasi alone`:
  - Via the UI, create branch `E2E <timestamp>`.
  - Edit a product to stock 5 there.
  - Switch to it, open a shift, sell 1.
  - Assert Inventory shows 4 there and the Kumasi count is unchanged.
  - Deactivate the branch in `afterAll`.
- [ ] **Step 2: Run** `cd e2e && npx playwright test`. Expected: all pass. Reset the dev DB after with `npx prisma migrate reset --force` if the user agrees (it wipes local test leftovers).
- [ ] **Step 3: Docs.**
  - API.md: branches endpoints, the `X-Branch-Id` header, the lookup and branch-performance endpoints.
  - DATABASE.md: the Branch and BranchStock tables and the new columns.
  - README: a Multi-branch feature line, the `cashier2` login, and a screenshot of the Branches page plus the switcher.
  - CHANGELOG entry.
  - TODO.local: tick multi-branch; add manual checks (switching branches, cross-branch return, receipt shows branch).
- [ ] **Step 4: Full verification:**
  - `cd server && npm test && npx eslint src`
  - `cd client && npx vitest run && npm run lint && npm run build`
  - Expected: all green.
- [ ] **Step 5: Commit and push** (`git push origin main`), then check CI is green.
