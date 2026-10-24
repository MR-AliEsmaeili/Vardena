# Accounting Operational Readiness Audit — 2026-10-24

## Base and method

- Audited `main` at `e69de2726b48b1713a4a095efaf1acdbf84bbea7` (merge of PR #204).
  No PRs were open at audit time. Latest CI for that exact SHA: run
  [40075877907](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/40075877907),
  all jobs successful (classify, backend, frontend, generated-api-client,
  owner-artifact-store-windows, docs, ci-gate).
- Sources of truth used: live code, `backend/prisma/schema/accounting.prisma`,
  `docs/accounting/task-index.md` (Tasks 10.2/10.3/10.4 and successors),
  generated OpenAPI types, backend e2e suites, and frontend component tests.
  `README.md`'s "no Accounting write UI" statement is stale (superseded by
  FE-UX-08 and this milestone) and is not used as evidence.
- Status meanings: **verified** = code + tests + CI evidence on the base SHA;
  **unverified** = code exists without adequate test/CI proof; **partial** =
  some workflow steps exist; **missing**; **blocked**.

## Capability matrix

| Capability | Backend / endpoints | Frontend | DB / schema | Tests | CI evidence | Status |
|---|---|---|---|---|---|---|
| Financial periods & accounting dates | `GET/POST /accounting-periods`, `close/reopen/seal`; fiscal years/areas CRUD+lifecycle; BusinessDate (`IsBusinessDate`, Jalali declared input) per ADR-0042 | Area/year create exist in the financial-context gate; period list was read-only — **this PR adds the Open-period form** | `accounting_periods`, `fiscal_years`, `financial_areas` (accounting.prisma) | `accounting-period-lifecycle-live.e2e-spec.ts` (13), period domain specs; new form test | Base-SHA CI green | Backend **implemented & verified**; UI now **implemented (this PR)**, pending CI |
| Chart of accounts, hierarchy, postable rules | `GET/POST/PATCH /accounts`, enable/disable, chart-tree read; root requires ACTIVE config **and** ACTIVE coding structure with coherent level digit-lengths (ODR-1, `AccountsService.createAccount`); leaf-only posting | Chart tree + account list/detail read-only; **this PR adds chart setup (create+publish coding structure & configuration from one user-entered level set) and account create form** | `accounts` with both pins NOT NULL, `coding_structure_versions/_levels`, `accounting_configurations/_levels` | `account-structure-live`, configuration live suites, domain `account-code`/`account-placement` specs; new form tests | Base-SHA CI green | Backend **implemented & verified**; UI was the blocker, now **implemented (this PR)** |
| Voucher create/edit/validate/draft/numbering/lifecycle | `POST/PATCH /accounting-documents`, `issue`, `finalize`, `reverse`, `DELETE`; `draft → temporary → final`, Foundation numbering, operation-key idempotency ledger | Create/edit/detail/list pages exist (FE-UX-08) | `accounting_documents`, `_lines`, posting-operations ledger | `accounting-documents-live` (11), `accounting-documents.e2e` (10), document domain specs | Base-SHA CI green | **Implemented & verified** |
| Finalization & posting semantics | `PostingService`, immutable `ledger_entries`, balance projection, period-close/freeze gates inside finalize | Finalize action in document detail | `ledger_entries`, balance projections | `posting.service.spec.ts`, period-lifecycle live suite (closed/sealed refuse, race orders) | Base-SHA CI green | **Implemented & verified** |
| General ledger & read models | `GET /accounting/general-ledger`, ledger movements, account statements | GL page, account statement page | over `ledger_entries` | `general-ledger.service.spec`, `account-statements-live` (11) | Base-SHA CI green | **Implemented & verified** |
| Trial balance | `GET /accounting/trial-balance` with POSTING/AGGREGATION roll-up | Trial balance page | over `ledger_entries` + chart hierarchy | `trial-balance.service.spec` | Base-SHA CI green | **Implemented & verified** |
| Org isolation, permissions, audit, concurrency, idempotency | `assertOrganizationInScope`, per-code RBAC (49 accounting codes), operation-key ledger, lock-order matrix, audited rebuilds | Permission-gated routes/nav; org-scoped query keys | organization FK on every accounting table | `accounting-authorization.spec`, isolation cases in live suites | Base-SHA CI green | **Implemented & verified** (browser E2E absent — see below) |
| Auth → organization selection → accounting bootstrap | Auth/session, membership, `OrganizationProvider`, financial-context gate (area → year selection/creation) | Login, org selection, area/year gate implemented | users/rbac/organization schemas | frontend context tests; bootstrap e2e | Base-SHA CI green | **Implemented & verified** for area/year; fresh-org chain then stalled at period/chart (this PR) |

## Root cause of the user-visible blocker

The end-to-end target workflow failed on a **fresh organization** in the UI,
not in the backend: after creating a financial area and fiscal year there was
**no UI to open an accounting period, no UI to publish the ACTIVE coding
structure + accounting configuration pair that root-account creation
requires, and no UI to create accounts**. Consequently the (complete) voucher
form had no open period and no postable accounts to post against. This is the
"PARTIALLY SUPPORTED (administration)" gap already recorded in
`docs/tasks/fe-ux-06-07-accounting-master-data/final-report.md` §2–§6.

## Milestone implemented in this PR (bounded, frontend-only)

**Accounting master-data setup UI** — exposes only existing, already-verified
backend contracts; no backend, schema, migration, permission, or lifecycle
change; no new Posting Engine work (10.2/10.3 foundations are consumed, not
rebuilt; 10.4 lifecycle is untouched):

1. `PeriodCreateForm` on the Periods page (`Accounting.AccountingPeriod.Open`)
   — fiscal-year select, sequence, title, BusinessDate start/end sent via the
   shared `toBusinessDateInput` (Jalali-declared), server remains authority
   for year-bounds/overlap.
2. `ChartSetupForm` on the Accounts page
   (`Accounting.AccountingConfiguration.Configure` +
   `Accounting.CodingStructure.Configure`) — creates and publishes a coding
   structure and an accounting configuration from **one user-entered level
   set** (titles, digit lengths, postable defaults), satisfying the ODR-1
   pin-coherence rule with no invented default pattern; shows a ready state
   when both are already ACTIVE (404 → null mapping in the API client).
3. `AccountCreateForm` on the Accounts page (`Accounting.Account.Create`) —
   code/title/parent (non-postable active accounts)/nature/type/postable;
   level and code shape are backend-derived.

After this milestone the fresh-organization path is: select organization →
create area → create fiscal year → open period → activate chart structure →
create accounts (incl. postable leaves) → create voucher → issue/finalize →
ledger → general ledger / trial balance (all pre-existing UI).

## Known limitations / not claimed

- No browser-level (Playwright) UI-to-API E2E exists in this repository; the
  workflow is proven by backend live-DB e2e suites + frontend component
  tests, not by a browser run. Accounting is therefore **not** declared
  operational until the Product Owner runs the manual acceptance below on a
  real deployment and this PR's CI is green.
- Period close/reopen/seal and account edit/enable/disable remain API-only
  (deliberately out of this bounded milestone).
- Base-chart template adoption remains API-only; manual account creation is
  the supported UI path in this milestone.

## Manual acceptance steps for the Product Owner

1. Log in, select (or create) an organization; create a financial area and a
   fiscal year in the gate if prompted.
2. Accounting → Periods → open period 1 inside the fiscal year.
3. Accounting → Accounts → "activate chart structure" with your own levels
   (e.g. 2 digits non-postable + 3 digits postable); confirm the ready state.
4. Create a root account and a postable child account (codes matching the
   level digit pattern).
5. Accounting → Documents → new voucher with balanced debit/credit lines on
   postable accounts dated inside the open period; save, issue, finalize.
6. Open General Ledger and Trial Balance for the period/year; confirm the
   voucher amounts reconcile (trial-balance debits = credits).
7. Negative checks: finalize in a closed period is refused (API-only lifecycle
   for now); a voucher with unequal debit/credit is refused by the backend.

## Test evidence

- New: `frontend/src/features/accounting/master-data/master-data-write-forms.test.tsx`
  (4 tests: period payload with Jalali BusinessDate inputs, chart setup
  create+publish call sequence for both aggregates, already-active ready
  state, account create payload).
- Local: typecheck, lint, format check and the full frontend suite (see PR).
- Heavier backend integration/E2E: unchanged backend; rely on GitHub Actions
  for this PR's SHA.
