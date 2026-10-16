# Setup Guide — QuickMart POS

How to get the system running from scratch on a development machine, and what to change for production.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| npm | 10+ | Comes with Node.js |
| PostgreSQL | 15+ | [postgresql.org](https://www.postgresql.org). `pg_dump`/`pg_restore` must be on your PATH for backups |
| Git | any | |

```bash
node --version   # v20 or higher
npm --version    # 10 or higher
psql --version   # 15 or higher
```

---

## 1. Clone

```bash
git clone <repo-url>
cd pos-system
```

## 2. Create the database

The simplest option is to use the `postgres` superuser and point `DATABASE_URL` at it:

```bash
createdb -U postgres pos_db
```

To use a dedicated user instead, PostgreSQL 15+ needs two extra grants: one for the `public` schema, and `CREATEDB` for the temporary shadow database `prisma migrate dev` creates.

```sql
-- psql -U postgres
CREATE DATABASE pos_db;
CREATE USER pos_user WITH ENCRYPTED PASSWORD 'choose-a-password';
ALTER USER pos_user CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE pos_db TO pos_user;
\c pos_db
GRANT ALL ON SCHEMA public TO pos_user;
```

## 3. Backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env`. Every variable is described in [`server/.env.example`](../server/.env.example):

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@localhost:5432/pos_db` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | yes | Two **different** 256-bit random strings (see below) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | no | Default `15m` / `7d` |
| `PORT` | no | Default `3001` |
| `NODE_ENV` | no | `development` or `production` |
| `CORS_ORIGIN` | no | Frontend URL. Default `http://localhost:5173` |
| `PAYSTACK_SECRET_KEY` | for card / MoMo | Paystack secret key (`sk_test_…` while testing) |
| `TRUST_PROXY` | behind a proxy | Set to `1` behind nginx/Caddy so client IPs are correct |

Generate each JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store details, tax rate, loyalty rate, and currency symbol aren't environment variables. Admins set them on the **Settings** page.

Apply the migrations, then load the sample data:

```bash
npx prisma migrate deploy   # applies every migration in prisma/migrations
npx prisma db seed          # WIPES all tables, then loads sample data
```

The seed creates 3 users, 6 categories, 25 suppliers, 52 products, 10 customers, and 20 sales from the last 30 days. See [DATABASE.md](DATABASE.md#seed-data).

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Cashier | `cashier` | `cashier123` |

Start the API:

```bash
npm run dev
curl http://localhost:3001/api/health   # {"success":true,"data":{"status":"ok",…}}
```

## 4. Frontend

```bash
cd ../client
npm install
npm run dev     # http://localhost:5173
```

The Vite dev server proxies `/api`, `/uploads`, and `/product-images` to the backend on port 3001, so the browser only ever talks to port 5173.

**Card and mobile money (optional).** Copy `client/.env.example` to `client/.env.local` and set `VITE_PAYSTACK_PUBLIC_KEY` (`pk_test_…`). It must come from the same Paystack account as `PAYSTACK_SECRET_KEY`. Restart `npm run dev` afterwards. Cash sales work without it.

## 5. Check it works

1. Open http://localhost:5173 and log in as `admin` / `admin123`.
2. The dashboard shows today's revenue from the two seeded sales.
3. Open **New Sale**, type `BEV-001`, press **Enter**, then **F2**, choose **Exact**, and press **Enter**. A receipt appears.

---

## Scripts

### Backend (`server/`)

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-restart (nodemon) |
| `npm start` | API without auto-restart |
| `npm test` | Jest + Supertest with coverage (see *Tests* below) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate dev`: create and apply a migration after editing `schema.prisma` |
| `npm run db:seed` | Wipe and reload sample data |
| `npm run db:studio` | Prisma Studio, a visual database browser |
| `npm run db:backup` | `pg_dump` to `server/backups/pos_backup_<timestamp>.dump` |
| `npm run db:restore -- --file <path>` | Restore a `.dump` or `.sql` backup (overwrites current data) |
| `npm run unlock-user -- <username>` | Unlock an account from the server console, for when every admin is locked out |
| `npm run clear-sales` | Delete all sales, payments, and sale inventory logs, put the sold stock back, and reset loyalty points |
| `npm run import-images` | Copy `product-images/<SKU>.jpg` into uploads and link them to products |

### Frontend (`client/`)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Vitest component tests |
| `npm run lint` | ESLint |

### Tests

Backend tests are integration tests against the database in `server/.env`:

- They create their own users, products, and customers, and delete them afterwards.
- While they run, they set the tax rate to 0% and the loyalty rate to 10, and restore your values at the end.
- Paystack is mocked, so no keys are needed.

Avoid running them while someone is ringing up real sales on the same database.

---

## Production notes

- Set `NODE_ENV=production`. Refresh cookies become `secure` (HTTPS required), logs switch to JSON, and error responses stop including internal messages.
- Set `CORS_ORIGIN` to the real frontend URL, and `TRUST_PROXY=1` behind a reverse proxy.
- Build the frontend with `npm run build` and serve `client/dist/` as static files.

Example nginx config:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /path/to/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # single-page app routing
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /uploads/        { proxy_pass http://localhost:3001; }
    location /product-images/ { proxy_pass http://localhost:3001; }
}
```

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:5432` / `P1001: Can't reach database server`.** PostgreSQL isn't running, or `DATABASE_URL` is wrong.
- Windows: run `Start-Service postgresql-x64-18` in an **admin** PowerShell. To start it automatically with Windows: `Set-Service postgresql-x64-18 -StartupType Automatic`.
- macOS: `brew services start postgresql@15`. Linux: `sudo systemctl start postgresql`.

**`permission denied for schema public` during migrate.** Run the `GRANT ALL ON SCHEMA public` step from section 2.

**Prisma says the schema is out of sync.** Run `npx prisma migrate deploy`.

**`EPERM: operation not permitted, rename … query_engine-windows.dll.node`.** Prisma is regenerating its client while the API server has the file open. Stop `npm run dev`, run `npx prisma generate`, then start it again.

**Logged out after a few page reloads, or a `429` from `/api/auth/refresh`.** More than 60 refreshes per minute are coming from one IP. Behind a proxy, set `TRUST_PROXY=1`.

**An account is locked.** An admin can unlock it on the Users page. If no admin can log in: `npm run unlock-user -- admin`.

**CORS errors.** `CORS_ORIGIN` must exactly match the browser's URL, including the port, with no trailing slash.

**`JsonWebTokenError: invalid signature`.** The JWT secrets changed after tokens were issued. Clear cookies and log in again.

**The seed fails partway.** The seed doesn't use one transaction, so fix the error and run `npx prisma db seed` again; it starts by wiping every table.

---

## Project structure

```
pos-system/
├── client/                     React 19 + Vite + Tailwind
│   └── src/
│       ├── components/         Button, Input, Modal, Table (sortable), Badge, Pagination,
│       │                       Receipt (80mm print), InventoryHistoryModal, ErrorBoundary
│       ├── pages/              Login, POS, Dashboard, Sales, Products, ProductForm, Inventory,
│       │                       Customers, CustomerDetail, Reports, Users, Settings, Cashier*
│       ├── layouts/            AuthLayout, DashboardLayout
│       ├── context/            AuthContext, CartContext, SettingsContext
│       ├── hooks/              useAuth
│       ├── services/           Axios client (token refresh) + one file per API module
│       └── utils/              formatCurrency, date, apiErrors
├── server/                     Node.js + Express
│   ├── src/
│   │   ├── routes/             auth, products, categories, suppliers, inventory, sales,
│   │   │                       customers, reports, users, settings
│   │   ├── controllers/        Request handlers, one per module
│   │   ├── services/           Business logic, one per module
│   │   ├── middleware/         auth, validate, exactBody, pagination, sorting, errorHandler, logger
│   │   ├── utils/              prismaClient, errors, generateTransactionId, dateRange, paystack
│   │   └── __tests__/          Jest + Supertest integration tests
│   ├── prisma/                 schema.prisma, migrations/, seed.js
│   ├── scripts/                backup, restore, unlock-user, clear-sales, import-product-images
│   └── product-images/         Seed product photos, served at /product-images
└── docs/                       API.md, DATABASE.md, SETUP.md, screenshots/
```
