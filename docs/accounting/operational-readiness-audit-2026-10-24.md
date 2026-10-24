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

## Corrective addendum (PR #205 review, 2026-10-24)

Confirmed defects found on review of the first implementation and fixed:

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | High | Chart setup was gated on `AccountingConfiguration.Configure` only, while it also creates/publishes the coding structure (`CodingStructure.Configure`): a config-only user was offered a flow that must 403 mid-sequence, and a coding-only user never saw it. | Page gate removed; `ChartSetupForm` checks both codes, runs only authorized sides, and shows `setupMissingPermission` when a needed side is unauthorized. Server-side guards unchanged and authoritative. |
| 2 | High | Multi-request sequence restarted blindly after partial failure, creating duplicate drafts, and re-derived levels from current form input even when one aggregate was already ACTIVE (could publish a divergent configuration that ODR-1 then rejects at root creation). | Authoritative state (actives + DRAFT lists) is classified by `chart-setup-state.ts`; retries reuse a committed matching draft or the active side's locked digit shape; mismatched drafts are never published over a locked shape. |
| 3 | High | Both-active state was reported "ready" without checking ODR-1 compatibility. | Compatibility = equal level count and per-level digit lengths (`shapesCompatible`, mirroring `AccountsService.assertPinCoherence`); incompatible actives block with an explanatory alert and zero mutations — nothing is auto-deactivated or overwritten. |
| 4 | Medium | A non-404 fetch failure (500/network/403) left `data` undefined and the form treated the organization as unconfigured, enabling creation against unknown state. | Loading → explicit loading text; error → `ApiErrorAlert` (permission-specific copy for 401/403) with retry refetch; creation is not rendered while state is unknown. Only HTTP 404 from the `/active` endpoints maps to "absent" (existing client behavior, now covered by tests). |
| 5 | Medium | Cache refresh used one broad `queryKeys.accounting.all(org)` invalidation. | Dedicated keys `codingStructureActive/Drafts`, `accountingConfigurationActive/Drafts`; mutations invalidate exactly these keys on settle (success **and** partial failure), so retry planning is always from server truth and unrelated modules are not refetched. |
| 6 | Low | Success feedback could render from mutation state before refetched actives confirmed compatibility. | Success is shown only by the `ready` classification of refetched state. |

Failure-scenario coverage: coding publish failure + draft-reuse retry,
fetch 500, fetch 403, incompatible actives, permission combinations
(both / coding-only / config-only / neither), period reversed range,
account 409 — in `master-data-write-forms.test.tsx`; the 9-state initial
matrix is table-driven in `chart-setup-state.test.ts`. Timeout-after-commit
and page-refresh recovery use the same path as the publish-failure test:
on settle/refresh the drafts+actives are refetched and classification plans
only the remaining steps. Concurrency: classification is recomputed from
refetched state before every attempt; a concurrent activation turns the
form `ready` and removes the action rather than overwriting it.

## Fresh-organization manual acceptance checklist

Prerequisites: a user whose role carries `Accounting.FinancialArea.Create`,
`FiscalYear.Create`, `AccountingPeriod.Open`, `CodingStructure.Configure`,
`AccountingConfiguration.Configure`, `Account.Create`, `Document.*` as needed;
a second user without the Configure codes for step 11. Never use production
accounting data for destructive tests.

1. Log in, select/create the organization; create financial area + fiscal year in the gate.
2. Accounting → Periods: open period 1 inside the year (Jalali dates); confirm it lists as «باز».
3. Accounting → Accounts: in chart setup, enter your levels (e.g. 2-digit non-postable + 3-digit postable) and activate; confirm both steps show «انجام شده» and the ready message.
4. Create a root account whose code matches level 1 width; create a postable leaf account under it (root parents must be non-postable — server enforces).
5. (Optional resume check) repeat step 3 in a second organization but abandon after a forced failure (e.g. go offline mid-submit); return and confirm only the remaining step is offered and no duplicate structure was created.
6. Accounting → Documents → new: confirm postable accounts and the open period are offered; create a balanced voucher (equal debit/credit).
7. Issue and finalize the voucher from its detail page.
8. Accounting → General Ledger: confirm the voucher's lines appear.
9. Accounting → Trial Balance: confirm debits equal credits and the leaf balances roll up to the root.
10. Close the period (API-only today) and confirm via API that finalizing a new voucher dated in it is refused.
11. Log in as the unauthorized user: confirm chart setup explains the missing permissions and direct API calls return 403.

API-only workflows remaining (not in UI): period close/reopen/seal, account
edit/enable/disable, base-chart adoption, configuration/coding-structure
version editing. Known limitation: no browser Playwright E2E exists in this
repository; the checklist above is the human verification that automation
cannot replace yet.
