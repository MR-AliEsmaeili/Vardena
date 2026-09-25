# Task 18 — Accounting Reporting Read Foundation — Implementation Report

**Status: READY FOR REVIEW — NOT ACCEPTED (2026-09-25).**

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
| Account Statement | Existing `AccountStatementsService`/controller extended with explicit hierarchy, account-code/name and inclusive Document Date filters. Explicit `dateFrom` opens at the date boundary; period-only reads retain the accepted same-year lower-sequence opening. |
| General Ledger | `domain/general-ledger.ts`, DTO, service and controller. Rows retain Accounting document type, document/voucher identity and number, own immutable ledger-entry identity, voucher-line identity, account identity/labels, exact debit/credit/net, description, source snapshots and existing source-line reference. |
| Trial Balance | `domain/trial-balance.ts`, DTO, service and controller. POSTING leaves are rolled to themselves and each AGGREGATION ancestor in the shared SQL CTE; AGGREGATION totals use descendant POSTING activity only. |
| Scope support | `application/accounting-report-support.ts` resolves the organization deployment pin/usability, one financial area, one fiscal year, optional same-year period, explicit same-year date bounds, account identity/hierarchy existence, page bounds and allow-listed primary sorting. |
| Authorization | Independent `Accounting.GeneralLedger.View` and `Accounting.TrialBalance.View` definitions/registration, in addition to the accepted `Accounting.AccountStatement.View`; route guards and service checks are both present. |
| Wiring | `accounting.module.ts` registers the shared query repository, three report services and two new controllers. |
| Tests | Focused General Ledger, Trial Balance, Trial Balance exact-money, Account Statement date/hierarchy additions, and existing Task 17B regression coverage. |

## 3. Contract and calculation semantics

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

An omitted date range uses fiscal-year/period stored scope. A supplied
`dateFrom` and/or `dateTo` is inclusive and must remain within the requested
fiscal year. Account Statement and Trial Balance opening calculations use the
explicit lower date boundary when supplied; period-only openings use lower
period sequence rows of the same fiscal year. No prior-year rows are consulted.

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
  depend on it and rejects client sort.

The shared page size retains the existing maximum of 500, and report pages are
rejected when they address beyond the hard 50,000-row window. Raw report reads
run in one `REPEATABLE READ` transaction with a five-second Prisma interactive
transaction timeout. No write delegate, mutation route, lock-for-update or
report persistence exists.

## 4. General Ledger field authority

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

## 5. Validation evidence

Executed in this checkout:

- `npm ci --ignore-scripts` — completed;
- focused report/regression tests — passed;
- full backend unit suite: **97 test files, 1,101 tests passed**;
- `npm run typecheck` — passed;
- `npm run build` — passed;
- `npm run format:check` and the changed Accounting-file Prettier check — passed;
- `npm run lint` — zero errors and six pre-existing warnings in unrelated files;
- Swagger/OpenAPI boot probe with `SWAGGER_ENABLED=true` — HTTP 200 for
  `/api/docs-json`; all three required paths were present as `GET` operations
  with General Ledger and Trial Balance schemas present;
- `git diff --check` — passed after the final source/documentation edits.

Prisma validation was attempted with a valid-shaped local `DATABASE_URL`, but
Prisma 7 could not download its schema engine because the sandbox network
disconnected from `binaries.prisma.sh`; no schema or migration was changed. A
real PostgreSQL execution of the new raw report queries was not available in
this sandbox (Docker/PostgreSQL tools are absent), so the live SQL path remains
a review/CI verification item.

## 6. Limitations and deferred review items

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

**Governance status: READY FOR REVIEW — NOT ACCEPTED.**
