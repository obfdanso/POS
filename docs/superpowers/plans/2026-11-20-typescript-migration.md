# TypeScript migration

Goal: every server and client source file (tests, scripts and the seed included) becomes strict TypeScript, with every commit still building and passing tests.

## Rules for every batch

- `strict: true`. No `any` (explicit or implicit), no `@ts-ignore`/`@ts-nocheck`. `unknown` + narrowing is fine. `as` casts only where a value is truly known (e.g. after validation); prefer typing the source.
- Behaviour must not change. This is a type migration, not a refactor. Keep comments, names, and logic; fix only what the compiler proves is a real bug (and say so in the commit message).
- Rename with `git mv` so history follows the file.
- Prefer Prisma's generated types (`Prisma.ProductGetPayload<...>`, `Prisma.TransactionClient`, model types from `@prisma/client`) over hand-written copies. Shared hand-written types go in `server/src/types/` or `client/src/types/`.
- Money: Prisma `Decimal` stays `Prisma.Decimal` on the server; don't switch to numbers.
- Server modules: ES `import`/`export` syntax (compiled to CommonJS). A file that did `module.exports = x` gets `export default x`; while some importers are still JS, change those `require('./x')` calls to `require('./x').default`. Multi-value `module.exports = { a, b }` becomes named exports (JS `require` keeps working unchanged).
- Express: type `req.user`, `req.branchId` etc. by augmenting `Express.Request` in `server/src/types/express.d.ts` (one place).
- Jest mocks of converted modules: a mocked default export needs `{ __esModule: true, default: ... }`.
- Client: components become `.tsx`, plain modules `.ts`. Props get an interface/type next to the component. API response shapes go in `client/src/types/`.
- After each batch: `npx tsc --noEmit -p .` (server: also `npm run build`), lint, and the tests for that app must all pass. Backend tests: `npm test` in `server/` (runInBand; PostgreSQL must be running). Client: `npx vitest run` and `npm run build`.
- Commits: one per logical step (e.g. "convert the server utils to TypeScript"), one sentence starting with a lowercase letter, no Co-Authored-By line. Commit only the paths you touched (`git add <paths>` then `git commit`); another agent may be working in the other app at the same time. If `index.lock` exists, wait a few seconds and retry.
- Patch files with the Edit/Write tools; Bash heredocs with backticks break in this environment. Line endings are CRLF in the working tree for many files.

## Batches

Server (in order): 1 tooling + `utils/` + `middleware/` → 2 `services/` → 3 `controllers/`, `routes/`, `app` → 4 `__tests__/`, `scripts/`, `prisma/seed`, then `allowJs: false`.
Client (in order): 1 tooling + `utils/`, `services/`, `context/`, `hooks/` → 2 `components/`, `layouts/` → 3 `pages/`, `App`, `main` → 4 `test/`, then `allowJs: false`.
Finish: Dockerfiles, CI typecheck steps, e2e config (`node dist/app.js`), README/SETUP/CHANGELOG.
