# Task 17A — Accounting Ledger Movement Read Source — Implementation & Acceptance Report

**Status: ACCEPTED (2026-09-25).** Merged into `main` via PR #39 (`130fab9`).
The Repository Owner explicitly authorized and accepted the bounded implementation introduced by PR #39 as Task 17A.

| | |
|---|---|
| Slice | Task 17A — the Accounting-owned, read-only **ledger movement source**, and one narrow read endpoint over it |
| Branch / base / merge | PR #39 merged into `main` (`130fab9`) |
| Contract references | `docs/accounting/domain-contract.md` §12/§13/§15/§19/§22 (AC-D-30, AC-D-31, AC-D-34, AC-I-01/05/06/07/09/16/19/22), ADR-0009, ADR-0021 §4, ADR-0022 §3, ADR-0025, AR-07/AR-11/AR-21/AR-22/AR-24/AR-29 |
| Reporting references | `docs/reporting-strategy.md` §1/§2/§3/§5, `docs/tasks/task-17/brief.md`, `docs/tasks/task-17/next-step-recommendation.md`, `docs/tasks/task-17/task-17a-acceptance-record.md` |
| Not implemented here | Task 17 (the Accounting Reporting Foundation). It remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (OQ-25, OQ-43)**. |

---

## 1. Gates, authorization and the conflict this slice was written under

### 1.1 The repository's recorded gate

The repository records, in three independent places, that Accounting Reporting
implementation must not start while OQ-25 and OQ-43 are open and no approved interim
posture + owner authorization exists:

- `docs/tasks/task-17/brief.md` §7 and `docs/tasks/task-17/prompt.md` STOP conditions 1–2
  and 6;
- `docs/accounting/task-index.md` §4 (Task 17 status);
- `STATE.md` §7–§8 ("Production implementation is **NOT AUTHORIZED**").

`docs/tasks/task-17/next-step-recommendation.md` (documentation-only, class C/D) is
explicit: the first-slice **start condition is "NOT MET"**, and its proposed minimal
deliverable excludes *"any executable public endpoint, Report registry/platform or
permissions installed merely as dormant scaffolding"*.

### 1.2 What this slice was instructed to do

The Task 17A instruction authorized the implementation of the bounded ledger movement
read source **including** a narrow Accounting-owned, permission-enforced endpoint with
OpenAPI documentation.

### 1.3 Resolution & Acceptance Recorded Here

The Owner explicitly authorized and accepted Task 17A as implemented in PR #39 (effective 2026-09-25):

- **Owner Authorization & Acceptance:** The bounded, read-only ledger movement source (`GET /api/v1/accounting/ledger-movements`) and its permission `Accounting.LedgerMovement.View` are accepted as the Task 17A implementation.
- **OQ-25 and OQ-43 remain OPEN;** no Open Question, ADR, or complete Task 17 status was changed.
- **Task 17 is NOT complete:** no reporting builder, registry, layout, export, print, statutory books, or aggregation platform exists here.
- The deviation from `next-step-recommendation.md`'s "no executable public endpoint" recommendation and the addition of `Accounting.LedgerMovement.View` to `docs/accounting/domain-contract.md` §22 are formally accepted and documented.
- Nothing in this report may be read as clearing OQ-25 or OQ-43, completing Task 17, or absorbing Task 12's P1 follow-up. Those statuses remain unchanged.

---

## 2. Scope

### 2.1 In scope (as implemented)

| Item | Where |
|---|---|
| Read-only application boundary for posted ledger movements | `application/ledger-movements.service.ts` |
| Accounting-owned, read-only repository read (`listMovements`) | `data/ledger-entries.repository.ts`, widened `data/accounting-rows.ts` |
| Framework-free movement projection (one ledger entry → one movement) | `domain/ledger-movement.ts` |
| Narrow versioned endpoint `GET /api/v1/accounting/ledger-movements` | `api/accounting-ledger-movements.controller.ts` |
| Query/response DTOs + OpenAPI decoration | `api/dto/ledger-movement.dto.ts` |
| One new read permission | `domain/accounting-permissions.ts` |
| Unit + HTTP e2e + live-PostgreSQL suites | `*.spec.ts`, `test/*-e2e-spec.ts` |
| Module doc (`docs/modules.md`) + this report | docs |

### 2.2 Explicitly not in scope (and not implemented)

Generic reporting engine or shared Reporting pipeline; Report Builder; Excel/CSV
export; Print/PDF; Iranian Electronic Books; financial statements; Trial Balance /
Income Statement / Balance Sheet; any aggregation, book configuration or bucketing;
P&L closing; frontend; AR/AP/Treasury/Sales/Purchase; universal report/document tables;
EAV/JSONB; user SQL; workflow/script engines; speculative indexes/migrations; a second
accounting truth; Redis or any new infrastructure; posting changes; ledger mutation;
balance-projection redesign.

---

## 3. Source of truth and reconciliation semantics

- **Source:** `accounting.ledger_entries` — the immutable posted evidence materialized
  inside `finalizeChecked` (Task 10.7), one row per stored voucher line, written between
  the state change and the idempotency row so the three commit or roll back together.
- **One movement = one ledger entry.** No derived row, no book entry, no snapshot table,
  no join fan-out: the source cannot disagree with the ledger because there is nothing
  else in it (AC-D-30; `docs/reporting-strategy.md` §2).
- **The Task 12 balance projection is not consulted** (it is derived/rebuildable, never
  authority, AC-D-31), and operational modules are never read to recompute anything.
- **Stored resolutions only.** Financial area, fiscal year, accounting period, voucher,
  line, serial and account come from the stored snapshot; nothing is recomputed from
  dates (AC-I-14), so a later calendar change cannot reinterpret history.
- **Cancellations/reversals do not delete facts.** Existing behaviour is preserved: a
  reversal posts a NEW voucher with NEW entries; the original entries stay in the source
  and are not suppressed. Linking the two sides is a document-level fact (`correction_kind`
  /typed links) and is deliberately **not** projected here (§15.4 — no correction-header
  join in this slice).
- **Reconciliation evidence that exists today:** the suites assert that each finalized
  voucher's movements still satisfy the balancing invariant on the movement source
  (Σ debit = Σ credit per voucher, exact strings) and that the entry set equals the
  stored line set (1:1 by `voucher_line_id`).

---

## 4. Filters (whitelisted, parameterized, always organization-scoped)

| Query parameter | Stored predicate | Notes |
|---|---|---|
| `organizationId` (**required**) | `organization_id = $1` | Tenant scope; never optional; must be a ULID |
| `financialAreaId` | `financial_area_id = $n` | Stored bookkeeping scope |
| `fiscalYearId` | `fiscal_year_id = $n` | Stored year resolution |
| `accountingPeriodId` | `accounting_period_id = $n` | Stored period resolution |
| `accountId` | `account_id = $n` | Account-ledger filter |
| `voucherId` | `voucher_id = $n` | Voucher traceability filter |
| `voucherNumber` | `voucher_number = $n` | Exact serial match (≤ 32 chars, the column width) |
| `dateFrom` / `dateTo` | `document_date >= $n` / `<= $n` | Inclusive business-date bounds, `YYYY-MM-DD` only, parsed to UTC date-only |
| `page`, `pageSize`, `sort` | shared list conventions | See §9 |

**Deliberate absences** (each is a property of the facts, not an omission):

- **no `status` filter** — `ledger_entries` has no status column. Non-posted vouchers
  have no ledger rows at all (§8), so a status filter would invent a lifecycle the
  ledger does not have.
- **no `currency`** — no currency/rate column exists (§24.1, OQ-03 → base currency only);
  no currency field, filter or FX conversion is invented.
- **no account code/title/hierarchy** — the chart's classification inputs
  (`account_type`, `is_temporary`, control roles) are OQ-25-gated and not stored
  (§8.3), so only the authoritative `accountId` is returned. No grouping, level meaning
  or classification is inferred.
- **no branch, no dimensions, no search/narration `like`, no bucket or book parameters** —
  branch/dimension/calendar/book semantics are later, separately authorized work
  (OQ-11/OQ-23/OQ-40/OQ-41).
- **no arbitrary filter fields** — the DTO enumerates them; unknown query parameters are
  rejected by the global validation pipe (400).

Parameterization: filters become Prisma `where` values (driver-bound parameters).
No client input ever reaches a SQL identifier, fragment, table, column or join.

---

## 5. Returned fields (the movement contract)

`LedgerMovementDto` (`domain/ledger-movement.ts`) — ledger-native columns only:

| Field | Source column | Reason included |
|---|---|---|
| `id` | `id` | Entry identity (immutable ULID; never the voucher's, never the posting-operation's) |
| `organizationId` | `organization_id` | Tenant scope of the fact |
| `financialAreaId` | `financial_area_id` | Stored bookkeeping scope |
| `fiscalYearId` | `fiscal_year_id` | Stored year resolution |
| `accountingPeriodId` | `accounting_period_id` | Stored period resolution |
| `voucherId` | `voucher_id` | Source document identity |
| `voucherNumber` | `voucher_number` | Immutable serial snapshot, text (§18, AC-I-22) |
| `voucherLineId` | `voucher_line_id` | The 1:1 traceability key to the stored line |
| `lineNo` | `line_no` | Dense 1-based ordinal inside the voucher (§12.5) |
| `accountId` | `account_id` | Postable account reference (AC-I-09) |
| `debitAmount`, `creditAmount` | `debit_amount`, `credit_amount` | Exact decimal strings, `numeric(18,2)` |
| `description` | `description` | Line narration (nullable); the header narration is not copied |
| `documentDate` | `document_date` | Business date, rendered `YYYY-MM-DD` (date-only, UTC) |
| `postingTimestamp` | `posting_timestamp` | Instant of the posting act, ISO-8601 — distinct from the business date |
| `origin` | `origin` | `manual` \| `system` (closed code-defined list) |
| `sourceModule`, `sourceEntityType`, `sourceEntityId`, `sourceOperation` | same-named columns | System-origin source snapshot (§16.3); all `null` for manual entries |

Deliberately **not returned**: account code/title, area/year/period codes or titles,
voucher header fields other than the serial (state, narration, correction links, branch),
balances/opening/closing, any grouping, subtotal, currency, bucket, ordinal or layout
column. Consumers resolve related entities through their owning read APIs using the
returned ids — this source re-derives nothing.

---

## 6. Organization isolation and tenant safety

- `organizationId` is **mandatory** at the DTO and at the service type level; there is no
  call shape that reads without it.
- Resolution is server-side and ordered: `assertOrganizationInScope` first (ADR-0025
  deployment pin → **404** for any other organization, never 403, so the API never
  confirms that an out-of-pin id exists), then `requireUsableOrganization`
  (missing/inactive → 404).
- Every other filter is a **predicate inside** that organization. A foreign
  area/year/period/account/voucher id therefore matches nothing — exactly like an
  unknown id. The response is a legitimate empty page, **never** an existence oracle and
  never another organization's rows.
- `total` is counted over the same predicate as the page, so a page can never report a
  total from a different scope.
- No join, no relation load, no cross-module read (AR-07/AR-16).
- Tested both ways: HTTP suite (foreign voucher/account/area filters → empty; org B's
  rows unreachable; pinned deployment → 404) and the live suite (two real organizations
  in the same table; every filter combination unreachable across organizations).

---

## 7. Permission used

**`Accounting.LedgerMovement.View`** — a NEW, read-only code (#35 in the module
registry; `ACCOUNTING_PERMISSION_DEFINITIONS`), mirrored into `rbac.permissions` at
startup exactly like the other 34.

Why not reuse an existing code (both were considered and rejected as *inapt*, not as
*insufficient*):

| Candidate | Why it was not used |
|---|---|
| `Accounting.Balance.View` | Its contract meaning is *projection reads* (§19.3, AC-D-31) and the projection is explicitly **not** the ledger. Using it would silently widen an approved code's meaning from "read the derived balance projection" to "read the immutable ledger". |
| `Accounting.Document.View` | It governs the *editable document aggregate* and its lifecycle (draft/temporary/final, edits, deletion). The movement source is posted-only immutable evidence; the two are different authorities over different resources. |
| `Report.<id>.View` | That vocabulary belongs to the Reporting module for *report definitions*. No report definition exists in this slice, and Accounting must not register Reporting's codes. |

Consequences that are recorded rather than hidden:

- A new code is an **addition to the §22 vocabulary table** of the domain contract. The
  contract says the table "is the contract" while codes are "registered by the
  implementing task". This slice therefore records an explicit
  **REQUIRES OWNER CONFIRMATION** item (§12): add
  `Accounting.LedgerMovement | View` to §22, or direct that an existing code be reused.
  The contract file itself was **not** edited (a DECIDED section is an owner decision).
- No wildcard, no superuser, no bypass, no role was created. Denials are the repository
  standard: anonymous → **401**, authenticated without the code → **403**; enforcement
  happens both at the route guard and inside the service (defence in depth).

---

## 8. Posted / non-posted rules

- **Posted-only by construction.** Ledger rows are inserted only during finalization;
  a `draft` or `temporary` voucher has **zero** rows. There is no "posted" flag to filter
  on and no draft twin to exclude.
- Tested as a lifecycle property, not as a query clause: the HTTP suite finalizes
  vouchers and shows the rows appear; the live suite counts rows in
  `accounting.ledger_entries` for a draft and a temporary voucher and asserts **0**.
- Deleted/discarded pre-final vouchers leave nothing (there was nothing to leave);
  rejected posting attempts roll back atomically, so they leave nothing either.
- `final` documents are never deleted (AC-I-05/06) and the source exposes no path that
  could mutate or remove an entry.
- Reversed originals remain visible (§3); the reversal appears as its own posted entries.

---

## 9. Pagination and ordering

- Shared list conventions: `page` (1-based, default 1), `pageSize` (default 100, **hard
  max 500**), `sort` syntax validated by `PageQueryDto`.
- **Deterministic total order.** Default: `documentDate asc, voucherNumber asc,
  lineNo asc, id asc` (the legal-book reading order, terminating in the unique entry id).
- If a client supplies `sort`, only `documentDate` and `postingTimestamp` are allowed
  (allow-list in the service; anything else → **400**), and the server **always appends
  the stable tie-breakers** (`voucherNumber`, `lineNo`, `id`) minus any already chosen.
  A caller can therefore change the leading axis but cannot create a non-total order.
- `total` comes from `count()` over the same predicate; the page comes from
  `findMany({where, orderBy, skip, take})`. There is no unbounded fetch: every request is
  bounded by `pageSize ≤ 500` and both statements are org-scoped.
- No relations are loaded (no N+1); a page is one `findMany` plus one `count`.

---

## 10. Decimal handling

- Storage is `numeric(18,2)`; the domain carries money as **decimal strings** end to end
  (§13.1/§13.5). The repository maps Prisma `Decimal` → string via `toString()`, and
  **refuses** a JS `number` loudly rather than stringifying it (a `number` is float
  semantics wearing a decimal costume).
- `canonicalizeAmount` trims trailing zeros the way every Accounting read does
  (`1250.50` → `1250.5`, `0.00` → `0`); a malformed value throws rather than being
  coerced.
- Nothing in the projection parses, sums, rounds or converts money. Tests assert exact
  round trips: HTTP suite `0.01`, `1250.5`, canonical zeros; live suite `numeric(18,2)`
  exactness (`0.01`, `250.5`) and per-voucher balance after the database round trip.

---

## 11. API contract

```
GET /api/v1/accounting/ledger-movements
```

- **One method only.** The controller declares a single `GET`; there is no POST, PATCH,
  PUT or DELETE on the resource. The repository class exposes no movement write path,
  and the `LedgerEntriesRepository.prototype` surface is asserted exhaustively in
  `posting.service.spec.ts` (now `client`, `constructor`, `findByVoucher`,
  `listMovements`).
- **Guards:** `AuthGuard` + `AuthorizationGuard` with
  `@RequirePermission(Accounting.LedgerMovement.View)`; the service re-checks the code.
- **Query (validated at the edge):** `organizationId` (required ULID), `financialAreaId`,
  `fiscalYearId`, `accountingPeriodId`, `accountId`, `voucherId` (optional ULIDs),
  `voucherNumber` (≤ 32 chars), `dateFrom`/`dateTo` (`YYYY-MM-DD` only), `page`,
  `pageSize`, `sort`. Malformed values → **400**; pinned-foreign/unknown organization →
  **404**; missing permission → **403**; anonymous → **401**.
- **Response:** the standard envelope `{ items, total, page, pageSize }` built by
  `toPaginatedResult`; each item is the movement DTO of §5 with amounts as strings.
  Empty result = `{ items: [], total: 0, page, pageSize }` (200, not 404).
- **OpenAPI:** `@ApiTags`, `@ApiOperation`, `@ApiOkResponse` with the paginated schema,
  plus 401/403/404/400 responses and documented field descriptions/examples (amounts
  shown as canonical strings, `format: date` / `date-time` where applicable). The route
  is versioned and registered in the module's existing `accounting/...` family.

---

## 12. Deviations, gaps and REQUIRES OWNER CONFIRMATION items

1. **Endpoint + permission vs. the recommendation's non-goal.** `next-step-recommendation.md`
   proposed a source-only slice with no executable endpoint and no permissions. The
   instruction required a narrow endpoint with an enforced permission. Everything about
   that surface is isolation-tested and read-only, and no report, registry or layout was
   added — but the deviation stands and is listed here for the owner.
2. **New permission code not in the §22 vocabulary table.** See §7. Smallest owner
   decision: add `Accounting.LedgerMovement | View` to §22 (recommended, read-only), or
   direct reuse of an existing code (a one-line change).
3. **Gate posture.** OQ-25/OQ-43 remain OPEN and Task 17 remains blocked as a whole; this
   slice is bounded and non-statutory. Owner confirmation of the interim posture is the
   remaining gate (§1.3).
4. **No index and no migration were added.** Measured plan evidence (§16) shows the
   equality filters are served by the existing org-leading indexes and the unfiltered
   tenant page costs a tenant-wide scan + sort (65 ms at 100k tenant rows in the
   rehearsal, 214 ms at OFFSET 49,900 with a spill to disk). The candidate index
   `(organization_id, document_date, id)` — or the wider
   `(organization_id, document_date, voucher_number, line_no, id)` — is recorded but NOT
   created, per AR-29/"no unapproved index additions". Decision needed if the approved
   dataset is expected far beyond 100k rows per tenant.
5. **No approved dataset/consumer.** The performance evidence is a rehearsal on a
   synthetic dataset, not the recommended 100k-row representative dataset of an approved
   consumer; no latency target exists yet.
6. **Field-set gaps by policy:** no currency (OQ-03 open), no account code/title or
   classification (OQ-25 open), no dimensions (OQ-41 open), no branch filter, no
   cross-period bucket/carry-forward semantics (OQ-11/OQ-23 open).
7. **Local live-PostgreSQL execution is impossible in this sandbox** (no Postgres, no `prisma generate`); the live suite executed in CI instead (§13.3).

---

## 13. Tests and evidence

### 13.1 Unit (in-memory, Vitest, `backend/`)

| Suite | Tests | Result |
|---|---|---|
| `src/modules/accounting/domain/ledger-movement.spec.ts` | 7 | pass |
| `src/modules/accounting/application/ledger-movements.service.spec.ts` | 12 | pass |
| `src/modules/accounting/application/posting.service.spec.ts` (surface lock updated) | — | pass |
| Full unit suite `npm test` | 91 files / 1043 tests | pass |

The service suite covers: permission required (403 through the real authorization
service), deployment-pin 404, unknown organization 404, filter → `where` translation
(org predicate first, inclusive date bounds), vendor neutral order resolution + appended
tie-breakers, allow-list rejection, `page`/`pageSize` → `skip`/`take`, and the mapping's
decimal exactness. The domain suite covers the pure projection: canonical amounts, date
rendering, ISO timestamp, null source fields, identity/traceability fields.

### 13.2 HTTP end-to-end (`backend/test/accounting-ledger-movements.e2e-spec.ts`)

28 tests, all pass. Boots the real application through the production HTTP pipeline
(controllers, guards, permission registry + startup mirror, DTO validation, error
envelope) over in-memory stores, and asserts:

- 401 anonymous; 403 without `Accounting.LedgerMovement.View`; a document-view holder
  does **not** qualify (the code is genuinely the boundary);
- posted-only: a draft and an issued-but-not-finalized voucher contribute zero rows,
  and the same vouchers appear once finalized;
- exact decimal strings (`0.01`, `1250.5`, `0`) and capital-free JSON numbers;
- organization isolation: org B rows never answer for org A; foreign voucher/account/area
  filters return empty pages, never foreign rows; pinned deployment → 404 (never 403);
- filters: account, inclusive business-date window, stored period and year, voucher id;
- ordering: legal-book order, page 1 + page 2 = the full ordered list, stable repeats,
  page beyond the end = empty page with the true total;
- 400 table: malformed organization/account/area/voucher ids, over-long voucher number,
  non-calendar dates, `page=0`, `pageSize` above the cap, unknown filter, non-whitelisted
  sort;
- empty result → standard envelope, not 404;
- no mutation path: POST/PATCH/DELETE answer 404 (no route exists).

### 13.3 Live-PostgreSQL suite (`backend/test/ledger-movements-live.e2e-spec.ts`)

13 tests, `describe.skipIf(process.env.VARDENA_TEST_DATABASE_URL === undefined)`. It
posts through the production entry point (`PostingService.postVoucher`) after
`createChecked`/`issueChecked`, uses two real organizations, and asserts: posted-only
(the draft and temporary vouchers are proven to have **0** ledger rows by count),
business-date ordering, isolation through every filter combination (including foreign
ids), account filter with an exact summed total, inclusive date bounds, serial/voucher
filters, deterministic paging (no gaps/duplicates, identical repeats), `numeric(18,2)`
round-trip exactness, scope/traceability snapshots, unknown organization → 404, invalid
date/sort → 400. Cleanup removes every row it created, in FK order, in `afterAll`.

**CI execution (evidence, not inherited):** PR **#39**, head `63f8548`, run
**36048743757** — job `backend` **`completed success`**; the step
`E2E tests (incl. live-DB suites)` (which runs with the job-level
`VARDENA_TEST_DATABASE_URL` pointing at the `postgres:16` service) passed, so the 13
tests of this suite executed there rather than being skipped. The same job also ran
`Prisma validate`, `Prisma generate`, lint, typecheck, format, the full unit suite,
build, `migrate deploy` and the Task 11 migration rehearsal green.

### 13.4 Commands actually executed (and what could not run)

| Command (`backend/`) | Result |
|---|---|
| `npm test` (`vitest run --config ./vitest.config.ts`) | **PASS** — 91 files, 1043 tests |
| `npm run test:e2e` (`vitest run --config ./vitest.config.e2e.ts`) | **PASS** — 16 files passed, 10 skipped; 218 passed, 74 skipped |
| `npx vitest run --config ./vitest.config.ts src/modules/accounting/domain/ledger-movement.spec.ts src/modules/accounting/application/ledger-movements.service.spec.ts` | **PASS** — 2 files, 19 tests |
| `npx vitest run --config ./vitest.config.e2e.ts test/accounting-ledger-movements.e2e-spec.ts` | **PASS** — 1 file, 28 tests |
| `npx vitest run --config ./vitest.config.e2e.ts test/ledger-movements-live.e2e-spec.ts` | **SKIPPED locally** — 13 tests skipped: no `VARDENA_TEST_DATABASE_URL` in this sandbox. **Executed and green in CI** (run `36048743757`, see §13.3) |
| `npx tsc --noEmit` | **PASS** — no diagnostics |
| `npm run format:check` | **PASS** — all files Prettier-clean |
| `npm run lint` (`oxlint .`) | **PASS with 6 pre-existing warnings, 0 errors** — all six are in files this task does not touch (`coding-structure-accounts.spec.ts` ×2, `accounts.service.ts`, `accounting-document-errors.ts` ×2, `accounting-configurations.repository.ts`) |
| `npm run build` (`nest build`) | **PASS** — `dist/main.js` produced |
| `npm run prisma:validate` | **NOT RUNNABLE HERE** — the Prisma CLI must fetch its schema engine from `binaries.prisma.sh`, which this sandbox blocks (TLS). With no `DATABASE_URL` it fails earlier with `PrismaConfigEnvError`. CI runs it against the real schema. |
| `npm run prisma:generate` | **NOT RUNNABLE HERE** — same engine fetch. `src/generated/prisma/client.ts` is the repository's checked-in stub (it throws "Prisma Client has not been generated"), which is exactly why live suites are CI-only in this environment. |
| migration rehearsal / live suites (`postgres:16` service, job-level `VARDENA_TEST_DATABASE_URL` in `.github/workflows/ci.yml`) | **NOT RUN HERE** — CI-only; nothing here is claimed as executed live evidence. |

Environment facts (recorded so the next reader does not re-litigate them): the sandbox
has Node v22.22.3 and npm 10.9.8, **no** `docker`/`psql`/`postgres` binaries, an
`apt-get` that cannot reach Debian mirrors, and blocked access to
`binaries.prisma.sh`; npm registry access works.

---

## 14. Environment rehearsal actually executed (PostgreSQL 17.5 WASM)

To obtain *some* real-database signal without a server, a **scratch** rehearsal (outside
the repository, nothing committed, not a project dependency) ran the repository's own 15
migrations against **PGlite / PostgreSQL 17.5 (wasm32)** exposed over a TCP socket:

- all 15 migrations applied cleanly (`20260910000000_init` … `20260923000000_accounting_document_reversal`);
- the real `accounting.ledger_entries` index set was confirmed: `pk_ledger_entries` (id),
  `uq_ledger_entries_voucher_line_id` (voucher_line_id), `idx_ledger_entries_org_voucher`
  (organization_id, voucher_id), `idx_ledger_entries_org_account`
  (organization_id, account_id), `idx_ledger_entries_org_period`
  (organization_id, accounting_period_id) — **no date-leading index exists**;
- a 150,000-row probe table (100,000 rows for tenant A + 50,000 for tenant B) was created
  with `CREATE TABLE … (LIKE accounting.ledger_entries INCLUDING ALL)` so its indexes are
  identical to the real ones, then analysed and measured.

**This is rehearsal evidence, not live-PostgreSQL CI evidence**: WASM build, single
session, warm cache, and absolute times are not comparable to a native server. The plan
*shapes* and the index usage are the part worth reading. (The live movement suite itself
has since executed green against real `postgres:16` in CI — §13.3; this rehearsal is
kept because it is the only *query-plan* signal obtained for this slice.)

| Query (org = tenant A, the service's default order) | Plan | Time |
|---|---|---|
| Page 1, no filter (LIMIT 100) | Seq Scan (org filter, 99,999 rows) + top-N heapsort | 65 ms |
| Deep page (LIMIT 100 OFFSET 49,900) | Seq Scan + **external merge sort to disk** (18,272 kB temp) | 214 ms |
| Account filter (LIMIT 100) | **Index Scan** `idx_…_org_account` (50 rows) + quicksort | 0.22 ms |
| Period filter (LIMIT 100) | **Bitmap Index Scan** `idx_…_org_period` (8,334 rows) + top-N heapsort | 11.4 ms |
| Voucher filter (LIMIT 100) | **Index Scan** `idx_…_org_voucher` (4 rows) + quicksort | 0.10 ms |
| Voucher/period/account `count()` over the org predicate | Seq Scan / Bitmap Index Scan | 55 ms (tenant-wide count) |
| Date window (one month) | Seq Scan (no date index) + top-N heapsort | 32 ms |

Read-out: the equality filters this slice exposes are served by existing indexes; the
unfiltered tenant-wide page and the tenant-wide `count()` do a tenant-wide scan+sort
whose cost grows linearly with the tenant's ledger. No migration was added on that basis
(§12 item 4).

---

## 15. Known limitations (shipped, deliberate)

1. No account code/title, area/year/period codes or titles: consumers resolve them
   through the owning read APIs (OQ-25-gated enrichment).
2. No currency (OQ-03), no dimensions (OQ-41), no branch filter/field, no search across
   narration.
3. No running balance, opening/closing, period turnover, bucketing or aggregation — the
   source is movement rows only (§19.3 semantics stay with the balance projection and the
   future consumer).
4. Reversal/correction linkage is not projected (document-level concern; the original
   entries are never suppressed).
5. `count()` on every page costs a tenant-wide index/scan; deep paging sorts the tenant's
   matching set (measured in §14). No index was added.
6. `voucherNumber` matching is exact-match only; it is a string column (numeric-only
   serials), and no prefix/range/numeric-coercion semantics are invented.
7. The endpoint is a reporting *source*, not a user-facing report: no layout, totals,
   export, print or grouping.
8. Live-PostgreSQL evidence comes from CI (run `36048743757`, §13.3), not from this
   sandbox; the local signals are the WASM rehearsal of §14 and the in-memory HTTP suite.

---

## 16. Explicitly deferred capabilities (do not read this slice as them)

Journal/General/Subsidiary/Detail legal-book layouts and statutory ordering; Trial
Balance (detailed/summary, 4/6/8-column), Income Statement, Balance Sheet; book
configuration and daily/monthly/Jalali/Gregorian bucketing; independent-document
membership and aggregation with drill-through; opening/carry-forward and period/year
transition semantics (OQ-23); corrections policy (OQ-27); multi-currency (OQ-03);
dimensions (OQ-41); area access (OQ-40); the Reporting module, registry, definitions,
`Report.<id>.View` permissions, execution pipeline and limits; XLSX/CSV export; Print/PDF;
Iranian Electronic Books and every statutory/legal profile (OQ-43); report history/
artifacts, jobs, caching and read-only DB roles; frontend surfaces.

---

## 17. Files changed

| File | Change |
|---|---|
| `backend/src/modules/accounting/domain/ledger-movement.ts` + `.spec.ts` | NEW — movement DTO + pure projection (7 tests) |
| `backend/src/modules/accounting/application/ledger-movements.service.ts` + `.spec.ts` | NEW — read service (permission, scope, filters, order, paging) (12 tests) |
| `backend/src/modules/accounting/api/accounting-ledger-movements.controller.ts` | NEW — GET-only versioned controller |
| `backend/src/modules/accounting/api/dto/ledger-movement.dto.ts` | NEW — validated query + documented response DTOs |
| `backend/src/modules/accounting/domain/accounting-permissions.ts` | `Accounting.LedgerMovement.View` registered (+ definition) |
| `backend/src/modules/accounting/data/ledger-entries.repository.ts` | `listMovements` read + `LedgerMovementFilter`; no write path |
| `backend/src/modules/accounting/data/accounting-rows.ts` | movement predicates; delegate `skip`/`take`/`count` |
| `backend/src/modules/accounting/accounting.module.ts` | provider + controller registration |
| `backend/src/modules/accounting/application/posting.service.spec.ts` | reference-surface lock extended (proves reads only) |
| `backend/test/support/accounting-document-repositories.ts` | in-memory `listMovements` + movement filter/sort helpers |
| `backend/test/accounting-ledger-movements.e2e-spec.ts` | NEW — 28 HTTP tests |
| `backend/test/ledger-movements-live.e2e-spec.ts` | NEW — 13 live PostgreSQL tests (CI) |
| `docs/modules.md` | implemented API + permission count (35) recorded |
| `docs/accounting/task-index.md`, `STATE.md` | evidence-backed status entries |
| **Schema / migrations** | **NONE** — no schema change, no migration, no index. |

---

## 18. Review request

Please review this slice against: architecture (AR-07/AR-11/AR-21/AR-22/AR-24/AR-29), the
§19 Accounting/Reporting boundary, tenant isolation, the new permission (§7/§12),
Decimal exactness, query safety and scope discipline (no report, no aggregation, no
schema change). The concrete decisions that need an owner:

1. the interim posture covering OQ-25/OQ-43 for this bounded slice (§1.3) — the item that
   decides whether this work may stand at all;
2. the endpoint + permission deviation from the recommendation (§12 items 1–2), including
   whether `Accounting.LedgerMovement | View` is added to contract §22;
3. the index question for datasets far beyond 100k tenant rows (§12 item 4).

---

## Appendix A — scope as instructed (paraphrase, not a repository authority document)

The Task 17A instruction is the session's authorizing text, not a repository decision
record. Paraphrased, it required:

- **In scope:** a read-only application/service boundary plus a narrow Accounting-owned
  endpoint for immutable posted ledger movements, with filters (organization mandatory /
  server-bound, financial area, fiscal period, account, business-date range, voucher
  reference, posted status, pagination, deterministic ordering); only fields authoritative
  in the current schema; exact Decimal preservation; tenant-safe organization scoping;
  existing permission conventions; OpenAPI documentation; focused tests; task docs under
  `docs/tasks/task-17/`; a PR to `main` titled `feat(accounting): add ledger movement read source`.
- **Explicitly not in scope:** generic reporting engine, Report Builder, Excel/CSV export,
  Print/PDF, Iranian Electronic Books, financial statements, Trial Balance / Income
  Statement / Balance Sheet, aggregation/book configuration, frontend, AR/AP/Treasury/
  Sales/Purchase, universal report/document tables, EAV/JSONB, arbitrary user SQL, new
  workflow/script engines, speculative indexes/migrations, a second accounting truth,
  Redis or extra infrastructure.
- **Test expectations named in the instruction:** cross-organization isolation,
  non-posted exclusion, decimal exactness, page determinism, invalid parameters rejected,
  and the absence of a mutation path — among the enumerated cases.

Mapping to this report: §4–§5 (filters/fields), §6 (isolation), §7 (permission), §8
(posted-only), §9 (pagination/ordering), §10 (Decimal), §11 (API/OpenAPI), §13 (tests
executed), §15–§16 (limitations/deferred). The three places where this slice does **not**
follow either the instruction's framing or the recommendation's non-goals literally are
recorded rather than smoothed over:

1. the instruction's filter list names a **posted status filter**; the ledger has no
   status column and non-posted vouchers have no rows, so the source is posted-only by
   construction and the filter is deliberately absent (§4, §8);
2. the instruction lists **"posted status" and "currency if authoritative"**; currency is
   NOT authoritative today (OQ-03), so no currency field exists (§4, §5);
3. the recommendation's **"no executable endpoint / no permissions as dormant
   scaffolding"** is deviated from because the instruction required the endpoint and its
   enforced permission; the deviation and its owner decision are recorded in §1.3 and §12.
