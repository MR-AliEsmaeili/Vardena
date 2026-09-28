# Task 18 — Accounting Reporting Read Foundation — Implementation & Acceptance Report

**Status: ACCEPTED (2026-09-25).** Merged into `main` via PR #46
(`e774a1c37c921ba83e4e9c23729fde6205cedb76`; reviewed implementation head
`5971bedf551a023d3a7936767345f0d70fac477a`; review-fix commits
`418234666375e1fb6776dd8b1186b1be5cafe735` and
`0d9cf760330ea37b4fded0ddb675731db72c1d25`). The Repository Owner/Reviewer
reviewed PR #46 before merge and accepted the bounded implementation under the
approved Owner Decisions D1–D20; the final review-fix addressed the D5
source-of-truth/reconciliation point. Acceptance record:
[`task-18-acceptance-record.md`](./task-18-acceptance-record.md).

This is the focused implementation report for Task 18 on
`arena/01a0d841-vardena`. It records the implementation and the evidence
actually available in this checkout. It does not promote an ADR, close
OQ-25/OQ-43, complete Task 17, or make a legal/statutory-reporting claim.

## 1. Scope and governing decisions

Task 18 implements the bounded Accounting-owned read foundation authorized by
the Task 18 prompt and its Owner Decisions D1–D20:

- `GET /api/v1/accounting/account-statements`
- `GET /api/v1/accounting/general-ledger`
- `GET /api/v1/accounting/trial-balance`

The three endpoints are read-only and consume one shared
`AccountingReadQueryRepository` over the immutable `accounting.ledger_entries`
and Accounting-owned chart/calendar/document rows. There is no generic
Reporting module, Report Builder, universal report table, EAV/JSONB reporting
schema, cross-context calculation source, export/print path, or second ledger
engine. No Prisma schema, migration, index, view, or persisted report artifact
was added.

The implementation deliberately does not resolve OQ-25/OQ-43 or introduce
classification, temporary/permanent, statutory, financial-statement,
treasury, management-dimension, settlement/allocation, AR/AP, sales,
purchasing, multi-currency, or cross-year behavior.

## 2. Delivered surface

| Area | Implementation |
|---|---|
| Shared read/query boundary | `backend/src/modules/accounting/data/accounting-read-query.repository.ts`; preserves Task 17B scope/statement reads and adds bounded raw General Ledger and Trial Balance reads. `AccountStatementsRepository` remains a compatibility adapter so Task 17B imports and read-only prototype tests remain stable. |
| Account Statement | Existing `AccountStatementsService`/controller consumes the shared read/query boundary and retains the accepted Task 17B period-only semantics; Task 18 adds only bounded hierarchy and account-code/name narrowing filters, without changing the fixed order or opening basis. |
| General Ledger | `domain/general-ledger.ts`, DTO, service and controller. Rows retain Accounting document type, document/voucher identity and number, own immutable ledger-entry identity, voucher-line identity, account identity/labels, exact debit/credit/net, description, source snapshots and existing source-line reference. |
| Trial Balance | `domain/trial-balance.ts`, DTO, service and controller. POSTING leaves are rolled to themselves and each AGGREGATION ancestor in the shared SQL CTE; AGGREGATION totals use descendant POSTING activity only. |
| Scope support | `application/accounting-report-support.ts` resolves the organization deployment pin/usability, one financial area, one fiscal year, optional same-year period, explicit same-year date bounds, account identity/hierarchy existence, page bounds and allow-listed primary sorting. |
| Authorization | Independent `Accounting.GeneralLedger.View` and `Accounting.TrialBalance.View` definitions/registration, in addition to the accepted `Accounting.AccountStatement.View`; route guards and service checks are both present. |
| Wiring | `accounting.module.ts` registers the shared query repository, three report services and two new controllers. |
| Tests | Focused General Ledger, Trial Balance, exact-money Ledger-to-output reconciliation, shared raw-query read-only/mapping checks, Account Statement hierarchy addition, and existing Task 17B regression coverage. |

## 3. D5 resolution: Ledger authority and Task 12 projection role

Repository evidence supports the ledger-native interpretation of D5; no
production-code change is required.

- `docs/adr/0031-balance-projection.md` explicitly says that
  `accounting.ledger_entries` is the **sole source of truth**. It defines
  `accounting.account_balance_projections` as a materialized, rebuildable,
  reporting-only projection.
- `backend/src/modules/accounting/domain/balance-projection.ts` stores only
  period debit/credit turnover. `opening`, `periodNet` and `closing` are
  derived by `deriveBalances`/`vw_account_balance_derived`; they are not a
  second stored monetary truth.
- `AccountBalanceProjectionsRepository.rebuildScoped` re-derives the slice
  from ledger aggregates, and `readReconciliationMismatchesInTx` compares the
  projection with a ledger aggregate through `vw_balance_reconciliation`.
  `AccountingBalancesService` describes the projection as rebuildable and not
  authoritative. This is a performance/read model with an explicit repair and
  reconciliation path, not an authority boundary.
- Consequently, using the Task 12 projection as the Task 18 runtime source
  would add stale-data risk and a second calculation dependency without
  improving authority. It could also accidentally inherit projection absence
  semantics (zero-turnover rows are not persisted) and projection view
  boundaries. Task 18 instead reads the immutable ledger facts directly,
  applies the same exact Decimal equations, and remains independently
  reconcilable against the ledger source.

The focused `backend/src/modules/accounting/domain/trial-balance.spec.ts`
test now names this contract explicitly: exact authoritative ledger opening and
turnover aggregates produce `opening`, `periodNet` and `closing`, and
`opening + periodNet = closing`. The existing live
`backend/test/account-statements-live.e2e-spec.ts` also reconciles the
ledger-native Account Statement opening against `vw_account_balance_derived`
when the PostgreSQL-gated suite runs. No new projection, persistence or
financial calculation engine was introduced.

**D5 resolution:** Ledger = authoritative financial source. Task 12 projection
= derived/rebuildable read optimization, not an independent financial source of
truth. Task 18 remains Ledger-native and reconciliable by exact debit/credit
facts; no second monetary truth exists.

## 4. Contract and calculation semantics

### Scope, status and isolation

Every report requires `organizationId`, `financialAreaId` and `fiscalYearId`.
The organization is checked first through the existing deployment-pin and
`requireUsableOrganization` conventions. Area and year are resolved inside the
organization and must agree. A supplied period must belong to that fiscal year.
Foreign/unknown scope rows return the existing not-found posture; existing but
contradictory area/year/period/date combinations return the existing business
rule posture. All predicates carry organization, area and fiscal-year scope.

OPEN, CLOSED and SEALED years/periods are readable: report SQL does not add a
status exclusion and contains no lifecycle mutation. A period-only report uses
the stored `accounting_period_id`; it does not recompute a period from a date.

Account Statement retains its accepted period-only contract: stored fiscal
year/period identity and lower same-year period sequence determine opening;
its fixed movement order remains unchanged. General Ledger and Trial Balance
accept an optional inclusive `dateFrom` and/or `dateTo`, each constrained to
the requested fiscal year. Trial Balance uses the explicit lower date for
opening; period-only Trial Balance openings use lower same-year period sequence
rows. No report path consults prior-year rows.

### Decimal exactness and hierarchy

Amounts are read and mapped through the existing Accounting decimal-string
helpers. Net/opening/turnover/closing derivations use the existing exact money
value functions; no JavaScript floating-point arithmetic or JSON numeric money
field is introduced.

Trial Balance hierarchy is a single recursive roll-up from valid POSTING
accounts to each ancestor. An account's own AGGREGATION activity is not another
input, and a posting row is not also counted through a second direct aggregate.
This preserves POSTING XOR AGGREGATION and prevents parent/child double
counting. Zero-activity accounts are not fabricated into a non-empty report.

### Sorting, paging and execution bounds

The inherited query syntax is accepted only for one allow-listed primary field
per report. The values are passed as bound CASE inputs, never as interpolated
SQL identifiers. Server-defined tie-breakers make the result deterministic:

- General Ledger default: `documentDate`, `postingTimestamp`, `documentId`,
  `ledgerLineId`, then immutable row identity; allowed primary fields also
  include account code/name/id.
- Trial Balance default: `accountCode`, `accountId`; allowed primary fields
  include account name/id and the derived opening, debit, credit, period-net and
  closing measures.
- Account Statement keeps its fixed legal-book order because running balances
  depend on it, retains the accepted period-only scope and rejects client sort.

The shared page size retains the existing maximum of 500, and report pages are
rejected when they address beyond the hard 50,000-row window. Raw report reads
run in one `REPEATABLE READ` transaction with a five-second Prisma interactive
transaction timeout. No write delegate, mutation route, lock-for-update or
report persistence exists.

## 5. General Ledger field authority

The authoritative `backend/prisma/schema/accounting.prisma` was inspected
before finalizing the joins:

- `AccountingDocument.documentType` maps to `accounting_documents.document_type`;
- `AccountingDocumentLine.sourceLineReference` maps to
  `accounting_document_lines.source_line_reference`;
- `LedgerEntry` supplies the stored document date, posting timestamp,
  voucher/document identity and number, voucher-line identity, own immutable
  ledger-entry id, account id, description, debit, credit, origin and source
  snapshots.

No unavailable document type or generic reference was fabricated. The public
`reference` field is explicitly the existing voucher-line source reference and
is nullable. The report exposes IDs needed for future source drill-down but
performs no mutation or cross-context lookup.

## 6. Validation evidence

Executed in this checkout:

- `npm ci --ignore-scripts` — completed;
- focused report/regression tests — passed;
- full backend unit suite: **97 test files, 1,100 tests passed**;
- `npm run typecheck` — passed;
- `npm run build` — passed;
- `npm run format:check` and the changed Accounting-file Prettier check — passed;
- `npm run lint` — zero errors and six pre-existing warnings in unrelated files;
- Swagger/OpenAPI boot probe with `SWAGGER_ENABLED=true` — HTTP 200 for
  `/api/docs-json`; all three required paths were present as `GET` operations
  with General Ledger and Trial Balance schemas present;
- `git diff --check` — passed after the final source/documentation edits;
- required GitHub Actions CI run **36133360887** (`CI` → `backend`) —
  **completed successfully**. GitHub metadata verifies `event=pull_request`,
  `headSha=5971bedf551a023d3a7936767345f0d70fac477a`, and a completed
  successful `backend` job. PR **#46** was open with the same head SHA when
  this run was verified, so the run belongs to the PR's implementation head
  (`5971bed`) before this surgical Review-Fix. Its recorded successful steps
  include Prisma validate/generate, lint, typecheck, format check, unit tests,
  build, migration deployment, migration rehearsal and the complete E2E suite
  including live-DB suites. The earlier PR run
  `36132173749` correctly caught an accidental Task 17B contract regression:
  `dateFrom` had become accepted by Account Statements; follow-up commit
  `9b784f0` removed that filter while retaining date bounds on the new General
  Ledger and Trial Balance surfaces.

Prisma validation was attempted with a valid-shaped local `DATABASE_URL`, but
Prisma 7 could not download its schema engine because the sandbox network
disconnected from `binaries.prisma.sh`; no schema or migration was changed. A
dedicated Task 18 raw-report fixture was not available in the local sandbox
(Docker/PostgreSQL tools are absent); the shared repository's static fake-client
checks passed, and PostgreSQL execution of the new report SQL was subsequently
covered by the required CI/live-DB battery on the reviewed implementation head
`5971bed` — run `36133360887`, `backend` `completed success`, E2E step incl. the
live-DB suites on `postgres:16` (§6 CI evidence, §9).

## 7. Review-Fix manifest

- **Production code changed for this Review-Fix:** No. The only implementation
  change is the focused test assertion in
  `backend/src/modules/accounting/domain/trial-balance.spec.ts`; it exercises
  the existing Ledger-native mapping and exact-money derivation.
- **Documentation changed:** this report, plus the minimal Task 18 status
  synchronization in `STATE.md` and `docs/accounting/task-index.md`.
- **Reviewed implementation commit:** `5971bedf551a023d3a7936767345f0d70fac477a`.
- **Focused Review-Fix commits:**
  `418234666375e1fb6776dd8b1186b1be5cafe735` — the test-only Ledger → Trial
  Balance reconciliation assertion (the D5 review-fix point) — and
  `0d9cf760330ea37b4fded0ddb675731db72c1d25` — the review-fix
  documentation/status handoff. No history was rewritten.
- **No new financial truth:** no projection, schema, migration, API,
  calculation engine, dependency or persistence was added.

## 8. Limitations and deferred review items

1. The report query repository uses reviewed, static SQL/CTE branches and
   bound values. The raw SQL should be executed in the repository's PostgreSQL
   CI/live suite before acceptance; this local checkout could validate TypeScript
   and the mapping/service contract but not connect to PostgreSQL.
2. The repository's Swagger bootstrap emits existing duplicate generated
   `PaginatedResponseClass` warnings; the required Task 18 paths and schemas
   nevertheless generated successfully. This is not changed by Task 18.
3. The default deployment-pin posture remains the existing Vardena posture; no
   per-user financial-area authorization model was invented.
4. Task 18 does not implement exports, Legal Books, statutory layouts, report
   builder behavior, classification, or any other bounded context.

These limitations are retained as recorded; the acceptance (§9) does not close
them.

## 9. Acceptance record (2026-09-25)

Task 18 — Accounting Reporting Read Foundation is **ACCEPTED (2026-09-25)**.

- **PR #46** (`feat(accounting): add reporting read foundation`) was reviewed by
  the Repository Owner/Reviewer **before merge** and is **MERGED** into `main`
  in merge commit `e774a1c37c921ba83e4e9c23729fde6205cedb76`; implementation =
  MERGED, Task governance status = ACCEPTED (two distinct facts).
- **Reviewed implementation head:** `5971bedf551a023d3a7936767345f0d70fac477a`.
- **Review-fix commits:** `418234666375e1fb6776dd8b1186b1be5cafe735` (test-only
  D5 Ledger → Trial Balance reconciliation assertion) and
  `0d9cf760330ea37b4fded0ddb675731db72c1d25` (documentation/status handoff).
- The implementation was built against the approved **Owner Decisions D1–D20**;
  their meaning is preserved unchanged.
- **D5** is accepted Ledger-native: `accounting.ledger_entries` is the
  authoritative financial source; the Task 12 projection remains a materialized,
  turnover-only, derived and rebuildable read optimization; Task 18 does not
  introduce a second monetary source of truth and does not depend on the
  projection at runtime for financial truth.
- **Validation evidence recorded:** focused D5 reconciliation **2 passed**;
  accounting unit suite **43 files / 538 tests passed**; full backend unit suite
  **97 files / 1,100 tests passed**; typecheck, build, format and
  `git diff --check` passed; lint **0 errors / 6 pre-existing unrelated
  warnings** (not Task 18 failures); required CI run **36133360887** on PR #46
  (head `5971bed`) `backend` **completed success** including Prisma validation,
  lint, typecheck, format, unit tests, build, migration rehearsal and live
  PostgreSQL E2E. CI predates the review-fix commits, which were
  documentation/test-only with no production change.
- **Scope, OQ and cross-task boundaries are unchanged by the acceptance:**
  OQ-25 and OQ-43 remain OPEN; Task 17 overall remains BLOCKED and is not
  complete; Task 17A/17B acceptances stand; Task 17C remains READY FOR REVIEW —
  NOT ACCEPTED; no ADR status is promoted and no new ADR was created; exports,
  Legal Books, Report Builder, UI Account Overview, settlement/allocation, AR/AP,
  treasury, sales/purchase, cross-year carry and configurable reporting
  dimensions remain unimplemented and unclosed — see the acceptance record §1
  and §7.

**Governance status: ACCEPTED (2026-09-25).**
