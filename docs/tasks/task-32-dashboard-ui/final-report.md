# Task 32 — Dashboard UI Implementation (Final Report)

## Summary

Native implementation of the `docs/frontend/reference/simpledashboard.html` visual contract on real backend read models. The dashboard is a new lazy-loaded route (`/app` → `DashboardPage`) composed of a KPI row, four chart cards, a server-paged recent-documents table, and side widgets (workflow, inventory, fiscal periods, reconciliation) — every section derived from live contracts, none faked.

## Scope delivered

| Reference element | Production mapping |
| --- | --- |
| KPI row (4 cards) | Complete paginated `GET /accounting/balances` scope (debit/credit/net/periods with non-zero turnover) |
| Income vs expense trend | Debit/credit turnover per period (`GroupedBarChart`, lazy SVG) |
| Branch sales donut | Net turnover share per period (`ShareBars`, lazy SVG) |
| Weekly cash flow | Net per period grouped bars (debit/credit) |
| Largest debtors | Top accounts by turnover (`RankedBars`) |
| Period-close banner | Real fiscal-period state (non-open periods), dismissible view state |
| Recent documents table | `GET /accounting-documents`, TanStack Table, URL-backed page/pageSize/sort (`?page=&pageSize=&sort=`), allow-listed sort fields only |
| Approvals widget | `GET /workflow/instances`, DISPLAY ONLY — decide action intentionally not reproduced (documented gap) |
| Lowest on-hand inventory | `GET /inventory/balances`, ordered and displayed by backend-supported `onHand`; it does not claim availability-alert ordering |
| Fiscal period status | Real periods of the scoped fiscal year |
| Reconciliation card | Empty state + CTA to `/app/accounting/trial-balance` (permissioned) |
| Topbar search / Alt+D | Additive topbar search field (Ctrl K hint); Alt+D intentionally inert (dashboard is its own page); Alt+N not bound (no document-creation surface exists) |

## Architecture compliance

- **Feature isolation**: no feature-to-feature imports. Dashboard reads accounting reference data through `src/api` (application-wide layer) with shared query keys (`use-dashboard-references.ts`).
- **Shared extraction**: `sortingToParam`/`sortingFromParam` moved to `src/lib/sort-param.ts`; `AmountCell` to `src/ui/patterns/amount-cell.tsx`; accounting feature re-exports preserved.
- **Rule-as-code gates**: no hard-coded Persian literals in JSX (all strings via `t` dictionary); amounts display digit-for-digit via central formatters (`formatAmount`/`formatQuantity`), never parsed/recomputed; no fake actions.
- **Permissions (AR-21)**: every dashboard query is disabled without the endpoint's backend permission (no guaranteed-403 requests); widgets render an honest "capability unavailable" state instead.
- **Honest state machine**: loading → success/empty/error per section; queries disabled by missing scope or permissions are NOT treated as pending (eternal-skeleton bug found in visual verification and fixed: `isScopeReady` + `scopeMissing` props).

## API surface consumed

`/accounting/balances`, `/accounting-documents`, `/accounting/periods` (fiscal-year scoped), `/fiscal-years`, `/financial-areas`, `/inventory/balances`, `/workflow/instances` — all through `frontend/src/api/dashboard.api.ts` with generated DTO types and organization-scoped query keys.

## Files

New: `src/api/dashboard.api.ts`, `src/features/dashboard/**` (page, scope/data hooks, lib, components, charts, tests), `src/app/routes/dashboard-route.tsx`, `src/app/layouts/topbar-search.tsx`, `src/lib/sort-param.ts`, `src/ui/patterns/amount-cell.tsx`.
Modified: `src/api/contracts.ts`, `src/api/query-keys.ts`, `src/lib/i18n.ts`, `src/lib/format.ts`, `src/app/router.tsx`, `src/app/navigation.ts`, `src/app/layouts/app-shell.tsx`, `src/features/permissions/permission-codes.ts`, accounting shared re-exports, `src/test/fixtures.ts`.

## Verification

- `npm run typecheck` — clean.
- `npm run lint` (oxlint) — 0 warnings, 0 errors.
- `npx vitest run` — **19 files / 111 tests passed** (dashboard coverage includes exact signed decimals, complete balance pagination and cancellation, KPI semantics, permission gating, widget state machines, inventory ordering, tables and URL state).
- `npm run build` — OK; dashboard chunks lazy: `dashboard-page` 26.95 kB (7.52 gzip), charts separately split.
- Rule-as-code grep gates (Persian literals in JSX, chart libs) — clean.
- **Visual verification** (dev server + seeded org): RTL layout matches reference (right sidebar, grouped nav, active highlight; topbar search + Ctrl K; 2:1 and 1:1 chart grids; 4 KPI cards). Empty org → scope-missing notices; missing accounting setup → honest disabled states; documents error state with correlation id + retry; reconciliation CTA renders with permission. Mobile 390px: single column, hamburger nav, no overflow. Dark mode: app is light-only by design; dashboard follows the app's existing intent.

## Environment notes (dev DB, not product bugs)

- The dev Postgres was empty; seeded one organization via API to exercise data paths.
- Backend scope registration for the seeded org is pending, so accounting endpoints answer "out of scope" — the dashboard renders these as honest error/empty states (exercising exactly the degradation paths).
- Dev session TTL is short; re-login during verification was a session artifact, not a frontend defect.

## Known gaps (documented, not faked)

1. Approvals are display-only: deciding an approval is a separate backend capability not wired to a dashboard surface.
2. Alt+N quick-new is not bound (no document-creation surface exists yet).
3. Dark mode is not part of the app's current design intent; dashboard follows suit.
