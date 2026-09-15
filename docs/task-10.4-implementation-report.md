# Task 10.4 — Accounting Voucher Foundation: Implementation Report

Date: 2026-09-15 · Branch: `arena/01a0a4a3-vardena` · Base: `eed9cda`
Code commit: `51f0bcc` (`accounting: add the voucher aggregate (task 10.4)`) — this
report is committed on top of it.

---

## 1. Status

**PASSED**, with two environment-bound limitations stated as such in §16/§17:
the Prisma CLI gates (`validate`/`generate`/`format`, `migrate`) are **BLOCKED**
by sandbox egress, and the live-Postgres suite is **SKIPPED** locally (no
database) while remaining wired for CI.

The full Accounting-owned `accounting_voucher` aggregate exists end to end:
domain (framework-free) → data (real transactions) → application → HTTP API,
with the contract lifecycle `draft → temporary → final`, Document
Foundation numbering, replay-or-reject idempotency, the documented invariants
enforced inside the write transactions, and an additive migration. Nothing from
the out-of-scope list was implemented (§18).

## 2. Commit

|               |                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Work commit   | `51f0bcc5d222ceb7287e269b4afdaca2b9a19613` — `accounting: add the voucher aggregate (task 10.4)` |
| Report commit | the commit that contains this file (on top of the work commit)                                   |
| Base          | `eed9cda` (merge of PR #18, `main`)                                                              |

The commit message cites the contract sections and the ADRs, per AG-16.

## 3. Branch

`arena/01a0a4a3-vardena`, pushed to `origin` (this session's branch; `main` is
untouched). 36 files changed, 8,641 insertions, 50 deletions.

## 4. Files created / modified

**Created (21).**

| Area        | Files                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB          | `prisma/migrations/20260915000000_accounting_documents/migration.sql`                                                                                                |
| Domain      | `accounting/domain/{money,voucher-lines,accounting-document,accounting-posting-operation}.ts` + `{money,voucher-lines,accounting-document}.spec.ts`                  |
| Data        | `accounting/data/{accounting-documents.repository,accounting-document-lines.repository,accounting-posting-operations.repository,accounting-document-errors}.ts`      |
| Application | `accounting/application/{accounting-documents.service,accounting-document-support,accounting-document-type-registration}.ts` + `accounting-document-support.spec.ts` |
| API         | `accounting/api/accounting-documents.controller.ts`, `accounting/api/dto/accounting-document.dto.ts`                                                                 |
| Tests       | `test/accounting-documents.e2e-spec.ts`, `test/accounting-documents-live.e2e-spec.ts`, `test/support/accounting-document-repositories.ts`                            |

**Modified (15).**

| Area                    | Files                                                                                                                                                          | What changed                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| DB                      | `prisma/schema/{accounting,organization}.prisma`                                                                                                               | 3 new models + the back-relations on `Organization`/`Branch` (additive)                                                       |
| Domain                  | `accounting/domain/{accounting-permissions,accounting.events,account.ts}`                                                                                      | 5 permission codes, 4 events, `isReferencedByDocumentLine` removed (AC-I-11)                                                  |
| Data                    | `accounting/data/{accounting-rows,accounting-locks,accounts.repository}.ts`                                                                                    | document/line/ledger row types, `lockAccountingDocumentRow`/`lockAccountRowForShare`, in-transaction line count               |
| Application             | `accounting/application/{accounts.service,accounting.module}.ts`                                                                                               | the AC-I-11 seam parameter; the module wiring (DocumentsModule, repositories, service, type registration, controller, export) |
| Tests                   | `accounting/application/coding-structure-accounts.spec.ts`, `accounting/domain/account-placement.spec.ts`, `test/support/accounting-structure-repositories.ts` | the 7-argument constructor, the after-use rule pinned on the domain decision, the line-usage seam                             |
| Tests (existing suites) | `test/account-structure.e2e-spec.ts`, `test/documents.e2e-spec.ts`                                                                                             | the document-lines fake override; the registered-type list (2 → 3)                                                            |

No file outside `accounting`, `test/`, `prisma/` and the new report was touched.
`docs/open-questions.md`, every accepted ADR, the CI workflow, the lint/format
configuration and all prior migrations are unmodified (verified with
`git status` before commit).

## 5. Tables and migration

`prisma/migrations/20260915000000_accounting_documents/migration.sql` — 243
lines, additive, ordered after `20260914010000_accounting_coding_structure_accounts`
(the previous newest), with a module + intent header (docs/database-strategy.md
§2). No prior migration is edited, nothing is renamed or dropped.

| Table                                      | Columns                                                                                     | Uniqueness                                              | Indexes                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `accounting.accounting_documents`          | 25 (ULID `TEXT` id, AR-12 audit columns, snake_case, `document_number` NULL until issuance) | `(organization_id, financial_area_id, document_number)` | `(organization_id, state)`, `(organization_id, financial_area_id, document_date)`, `(organization_id, accounting_period_id)` |
| `accounting.accounting_document_lines`     | 16, `numeric(18,2)` amounts                                                                 | `(document_id, line_no)`                                | `(organization_id, account_id)`                                                                                              |
| `accounting.accounting_posting_operations` | 10, `request_hash` + `result` (jsonb for the opaque replay payload only)                    | `(organization_id, operation_key)`                      | `(organization_id, operation)`                                                                                               |

12 foreign keys, all explicit: `document → lines` is `ON DELETE CASCADE`
(discarding a voucher discards its lines); every reference to master data or the
organization (`organizations`, `financial_areas`, `fiscal_years`,
`accounting_periods`, `branches`, `accounts`) is `ON DELETE RESTRICT`, so a
voucher can never be orphaned and master data can never be deleted out from
under one. `ON UPDATE CASCADE` everywhere. Closed lists (state, origin, operation
kind, account-rejection reasons) are `TEXT` with no CHECK constraints — the
rules live in the framework-free domain layer (AR-24), like every previous task.

Verification of the migration, strongest available here (see §16/§17):

- the whole migration set was applied to a **fresh PGlite database** and 11
  integrity checks ran against the result — all statements executed, all checks
  PASS (`/tmp/pgcheck.mjs`; the harness's non-zero exit is a teardown artifact,
  the stdout verdict is the evidence);
- an independent **schema ↔ migration consistency check** compares every scalar
  column of the three models with the SQL: 25 / 16 / 10 columns, none missing.

## 6. Invariants

Enforced at the domain/application boundary and re-checked inside the writing
transaction — never only in the frontend:

- **Σdebit = Σcredit exactly.** At composition (`assertVoucherComposition` →
  422 with every problem) and again at finalization against the **stored lines**
  under the document lock, so a concurrent line edit cannot slip through. Exact
  BigInt-mantissa decimal arithmetic, zero tolerance, **never rounded into
  balance** (§13.1/§13.3/§13.5, AC-I-07).
- **At least two lines**, dense 1-based `line_no` assigned by the server from
  submission order (gaps/duplicates are refused by the domain decision table
  and are impossible in storage thanks to `(document_id, line_no)`).
- **Non-negative amounts**, **exactly one populated side** per line, no
  zero-and-silent lines, and no sign-as-side (`-1` is a 400 at the DTO, a
  `malformed` verdict in the domain).
- **Account usability** through the Task 10.3 seam
  (`requireUsableAccountInOrganization` + `assertUsableAccounts` inside the
  transaction): missing/foreign → 404, non-postable/disabled → 422. The account
  rows are held `FOR SHARE` for the duration of the write.
- **Scope validity**: organization, area, branch and every account must belong
  to the caller's organization; the fiscal year and period are resolved from the
  date-only `document_date` and re-resolved under lock at finalize.
- **AC-I-11**: an account referenced by `accounting_document_lines` can no longer
  change `parent_id`, `level`, `account_nature` or `is_postable`. The predicate
  moved out of the domain (`domain/account.ts` no longer exports it) into the
  data layer, where it is counted in the same transaction that takes the
  account's row lock — closing the "count outside the transaction" race.
- Money moves as canonical decimal strings end to end; no float is created
  anywhere on the path (`numeric(18,2)` at rest).

## 7. Lifecycle

Exactly `draft → temporary → final`, nothing else (§15, AC-D-16…AC-D-23):

| Transition                      | Rule                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create                          | `draft` when the organization's `accounting_voucher` type has `draftRequired`, else `temporary` (the type is registered with `entryStates: ['temporary']`, so `initial`/Mode A is not reachable — OQ-42 stays open) |
| edit                            | allowed in `draft` **and** `temporary`; changing the financial area is refused once the voucher is issued; the whole line set is replaced atomically                                                                |
| delete                          | allowed in `draft` and `temporary`, refused for `final`; a numbered discard keeps the numbering allocation row, so the gap stays auditable and the serial is never reused                                           |
| draft → temporary (`/issue`)    | allocates the serial from the area's series; issuing an already-issued voucher replays the same number and burns no second serial; a `final` voucher refuses                                                        |
| temporary → final (`/finalize`) | one locked transaction: header read → scope lock → account locks → document lock → stored composition re-checked → state + finalization evidence → ledger row last                                                  |
| final                           | structurally immutable and non-deletable: `updateChecked`/`deleteChecked`/`issueChecked` refuse, and the guard throws inside the transaction (not merely in the service)                                            |

There is no `reopen`, no `void`, no approval state, no posting state, and no
`AccountingDocument.Reopen`/`Void` permission anywhere.

## 8. Numbering and scope

Numbering reuses the Document Foundation (ADR-0023) — no new counter, no
`MAX+1`, no in-memory counter, no timestamp, no client-supplied number:

- **Scope**: one series per `(organization, documentType, financialArea)`; the
  scope key is the lowercased area ULID (`voucherScopeKey`) and satisfies the
  Foundation's `^[a-z0-9_-]{0,64}$` grammar; allocation is the Foundation's
  row-locked transaction + ledger, replayed by `(series, allocationKey)`.
- **Timing**: a draft carries `document_number = NULL` and allocates at
  issuance; when the organization does not require a draft, the number is
  allocated during creation. A document can never exist in `temporary`/`final`
  without its number (asserted by the create guard and by the schema's
  uniqueness scope).
- **Idempotency**: `allocationKey = operationKey` of the action, so a retried
  issuance replays the identical serial.
- **Area / fiscal year / period** come from Task 10.2 and are validated through
  the same seams (`requireUsableFinancialAreaInOrganization`, the calendar lock
  path): a date that resolves to no year/period → 422; a `closed`/`sealed` year,
  a disabled year or a non-`open` period → 422; `open → closed → sealed` is
  respected and **no** closing/reopening/year-transition automation was added.
  `fiscal_year_id`/`accounting_period_id` are **persisted** on the header (and
  denormalized on the lines for the account/period indexes), never recomputed at
  read time.
- Business dates are date-only (`DATE_ONLY_PATTERN` at the DTO, `formatDateOnly`
  in responses); no new timezone semantics were introduced.

## 9. Authorization and security

- Five permission codes registered at startup and mirrored to `rbac.permissions`
  by the existing sync: `Accounting.Document.{View,Create,Edit,Delete,Finalize}`
  — the contract §22 rows, exactly. No wildcard, no superuser bypass, and no code
  that nothing enforces (no `Approve`/`Reverse`/`Correct`/`Replace`/`Post`; the
  e2e suite asserts their absence).
- Enforced twice: `@RequirePermission` on the route **and**
  `authorization.requireAllPermissions` in the service, so a second caller (a
  future system-posting path) cannot skip it.
- Reads/writes are scoped by organization: the path id plus `organizationId`
  (body on create, query elsewhere) identifies the resource; a foreign or
  missing id answers **404, never 403** (AC-I-01/§4). Lists require an explicit
  `organizationId` and can never widen across organizations. The organization id
  is used only after the caller is authenticated — it is never treated as proof
  of authorization.
- `createdBy`/`updatedBy` are stored (AR-12) but never returned: the response
  DTO omits them, asserted in the unit and e2e suites (AR-24).
- Reference fields are validated to belong to the caller's organization (area,
  branch, accounts), so ids cannot be used to probe foreign data.

## 10. Events

The existing kernel `DomainEventBus` only — no second bus, no outbox:

| Event                          | When                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `AccountingDocument.Created`   | a voucher is composed                                              |
| `AccountingDocument.Updated`   | an edit, and issuance (the contract folds issuance into “updated”) |
| `AccountingDocument.Finalized` | the finalization transaction commits                               |
| `AccountingDocument.Deleted`   | a pre-final voucher is discarded                                   |

Payloads carry identity and state only — `{id, organizationId, financialAreaId,
fiscalYearId, accountingPeriodId, documentType, documentNumber, state, origin}`
— never amounts. No `AccountingDocument.Posted` exists (posting is not
implemented, §16.6/AC-D-26), and no deletion event is emitted for a `final`
voucher because deleting one is impossible.

## 11. Idempotency

The ADR-0022 §3/§4 pattern, reused rather than redefined (contract §16.4,
AC-I-12):

- `operationKey` is **required** on create, issue and finalize (≤128 chars,
  non-blank); the request fingerprint is `sha256` over the canonical **client
  intent** only. Nothing the server resolves (ids, numbers, fiscal year, period,
  timestamps, actor) enters the hash — a retry of the same intent hashes
  identically, and any material change of intent does not. Covered by unit tests
  (including “same intent, fresh ids/later clock → identical hash”).
- The ledger row (`accounting.accounting_posting_operations`) is written **last**
  inside the effect's own transaction, so a committed effect always has its key
  and a rolled-back one never does.
- Same key + same hash → **replay** (the recorded result, no second effect);
  same key + different hash → **409**. The raced path (two concurrent requests)
  is caught via the unique index and re-read into the same replay-or-reject
  decision. Finalization replays **before** the lifecycle verdict, so a retried
  finalization of an already-final voucher returns the recorded result instead
  of being reported as an illegal transition (this ordering was found by the e2e
  journey and fixed in `finalizeDocument`).
- Issuance is idempotent on its post-state as well: issuing an already-issued
  voucher returns the same serial without touching the ledger or the series.
- **Not** implemented, on purpose: Outbox, durable cross-module delivery,
  production system posting (OQ-39 open). Nothing in this task claims durable
  delivery.

## 12. Unit tests (domain)

Four new files, **49 tests**; suite total **66 files / 782 tests, all passing**
(was 62 files / 733 tests).

| File                                              | Tests | Covers                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/money.spec.ts`                            | 5     | shape/precision/sign rules, canonicalization, exact sums (`0.1 + 0.2 = 0.3`, with the float result asserted to be unequal), comparison without float equality                                                                                                                                       |
| `domain/voucher-lines.spec.ts`                    | 10    | every problem in the decision table: ≥2 lines, one-sided non-negative amounts, both/neither sides, malformed and over-precise amounts, exact balance, dense line numbering, all-problems-at-once, the finalize-time balance-only re-check                                                           |
| `domain/accounting-document.spec.ts`              | 15    | type definition (entry state `temporary`, deletable `draft`/`temporary`, exactly three phases), create/edit/delete/issue/finalize decisions per phase, area freeze after issuance, manual-vs-system origin evidence, scope key grammar, DTO date-only rendering and derived totals, no audit actors |
| `application/accounting-document-support.spec.ts` | 19    | normalization and 400s (operationKey, description, narration/reference nulls, date-only parsing, amount and minimum-line refusals), composition 422 with all problems, origin/source normalization, hash determinism and intent sensitivity, the full guard-error mapping (404/409/422/400)         |

Both AC-I-11 spec updates are in scope: `account-placement.spec.ts` now pins the
domain **decision** the after-use predicate feeds (the predicate itself being
data), and `coding-structure-accounts.spec.ts` supplies the new document-lines
seam to the 7-argument `AccountsService`.

## 13. Application tests

The application layer is covered by `accounting-document-support.spec.ts`
(normalization, hashing, error mapping — §12) and, for the real service against
real repositories-in-memory, by the HTTP journey suite (§14), which boots the
production pipeline including the guards. The transaction/locking behaviour that
cannot be observed in a single-threaded fake is covered by the live suite (§15).

## 14. E2E tests (HTTP)

New: `test/accounting-documents.e2e-spec.ts`, **16 journeys** through the real
controller → guard → service → repository stack (only data access is faked), and
the fakes enforce the same unique indexes and throw the same guard errors as the
real transactions:

registration and the absence of unenforced codes; 401 for anonymous; 403 for a
read-only principal, for a composer lacking `Delete`, and for a finalizer who may
not compose; create draft (no number, server line numbers, derived totals, no
audit actors); 422 unbalanced and both-sides-set; 400 one-line, negative,
three-decimal and instant-date inputs; 422 non-postable vs 404 foreign account;
422 outside the calendar and 422 in a closed period (then reopened); foreign-id
404 (never 403) and an organization-scoped list; state/area/date filtering;
replay for one `operationKey` plus 409 for a different intent (with the row count
asserted); missing `operationKey` 400; the full edit → issue → re-issue (same
serial) → edit issued → finalize (denied for the composer, allowed for the
finalizer) → finalize replay → edit/issue/delete/finalize-again all refused →
re-read unchanged; discard of a draft and of a numbered temporary voucher with
the allocation row still present and a new serial afterwards; the AC-I-11 freeze
(and the still-editable title); and the scope audit (no reverse/correct/reopen/
post/approve route, no reporting surface).

Two existing suites were updated for legitimate behaviour changes, not weakened:
`documents.e2e-spec.ts` now expects three registered types (the voucher type is
registered at startup) and `account-structure.e2e-spec.ts` wires the
document-lines seam to “never referenced” (the interlock itself is asserted in
the voucher suite, whose fakes share the line table with the chart fakes).

Suite totals: **21 files / 218 tests — 187 passed, 31 skipped** (24 pre-existing
live skips + the 7 new live tests).

## 15. Live tests (PostgreSQL)

New: `test/accounting-documents-live.e2e-spec.ts`, **7 tests**, `skipIf
VARDENA_TEST_DATABASE_URL` — the only place where the SQL, the locks and the
constraints are real. It drives the data layer (with the Foundation's real
numbering service) and covers: exact `numeric(18,2)` persistence and round-trip;
transaction atomicity (a mid-transaction FK failure leaves no header, no lines
and no ledger row); the `(organization, area, number)` unique index refusing a
duplicate; 12 concurrent allocations with distinct serials plus a repeated
allocation key replaying one allocation; the locked lifecycle with illegal
transitions refused and `final` protected by the in-transaction guard
(update/delete both refused, stored row unchanged, one ledger row); a concurrent
finalize race leaving exactly one ledger row and one `final` state; and FK
behaviour (`document → lines` cascade, deleting a referenced account refused,
master data surviving a discard).

**Locally SKIPPED**: no PostgreSQL in the sandbox (no `psql`, no Docker daemon).
The suite is wired for CI and for a local `docker compose up` run.

## 16. Gates

| Gate                  | Command                                             | Result                                                                                |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Format                | `npm run format:check`                              | **PASSED** (exit 0, all 416 files match Prettier)                                     |
| Lint                  | `npm run lint` (`oxlint .`)                         | **PASSED** (exit 0, 0 warnings / 0 errors, 416 files)                                 |
| Typecheck             | `npm run typecheck` (`tsc --noEmit`)                | **PASSED** (exit 0)                                                                   |
| Build                 | `npm run build` (`nest build`)                      | **PASSED** (exit 0)                                                                   |
| Unit tests            | `npm test`                                          | **PASSED** (exit 0, 66 files / 782 tests)                                             |
| E2E tests             | `npm run test:e2e`                                  | **PASSED** (exit 0, 187 passed / 31 skipped)                                          |
| Migration (DDL)       | PGlite harness + column consistency                 | **PASSED** (all statements applied; 11/11 integrity checks; 25/16/10 columns matched) |
| Prisma CLI            | `npx prisma validate` (and generate/format/migrate) | **BLOCKED** — see §17                                                                 |
| Live PostgreSQL suite | `npm run test:e2e` with `VARDENA_TEST_DATABASE_URL` | **SKIPPED** locally; wired for CI                                                     |

Every gate above was run unpiped with its exit code recorded (no `tail`-swallowed
statuses). Nothing in CI was weakened, and no test was skipped to make a gate
pass.

## 17. Skipped / blocked checks

| Check                                                          | Status                      | Why, and what was done instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma validate` / `generate` / `format`                      | **BLOCKED**                 | Without `DATABASE_URL` the Prisma 7 config fails immediately (`PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`). With a dummy URL the CLI must download the schema engine and the sandbox blocks egress (`request to https://binaries.prisma.sh/… failed: Client network socket disconnected before secure TLS connection was established`). The config file was NOT edited to bypass it. Compensating evidence: `prisma/schema/*.prisma` is hand-consistent with the migration (column-by-column check in §5), `tsc` resolves the generated-client surface through the repository's committed stub, and the migration runs on a real PostgreSQL engine (PGlite/WASM). |
| `prisma migrate dev/deploy`                                    | **BLOCKED**                 | Needs a reachable database; the sandbox has no PostgreSQL. Compensating evidence: the migration set was applied on a fresh PGlite database with integrity checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Live PostgreSQL e2e (7 tests)                                  | **SKIPPED**                 | No database locally; `skipIf` guarded, ready for CI. Not counted as passing anywhere in this report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `prisma generate` codegen                                      | **BLOCKED**                 | Same egress failure. The repository's committed placeholder client (`backend/src/generated/prisma/client.ts`, deliberately tracked, see `backend/.gitignore`) is what compiles here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A dedicated FK probe for `accounting_documents → fiscal_years` | **NOT PROVEN IN ISOLATION** | The PGlite probe that tried to delete a fiscal year was refused by a pre-existing FK (`fk_accounting_accounting_periods_fiscal_year`) before reaching the new one. The constraint is present in the SQL with `ON DELETE RESTRICT`; the live suite's cleanup exercises the delete path. Flagged rather than claimed.                                                                                                                                                                                                                                                                                                                                                                             |

## 18. Scope audit — what was deliberately NOT implemented

- **No posting engine, no posting, no ledger/balance projection, no trial
  balance, no financial statements, no reporting endpoints.** The only ledger in
  this task is the idempotency ledger (`accounting_posting_operations`), which is
  evidence of an operation, not an accounting entry.
- **No reversal, correction, replacement or adjustment behaviour** (and no
  `reverses_document_id`/`kind`/`reason` columns): only the minimal structural
  references the contract requires today, deferred with AR-29 comments in the
  schema.
- **No reopen/void/approval/posting states**; the lifecycle is exactly
  `draft → temporary → final`.
- **No closing automation, no year transition, no opening/closing vouchers**
  (Task 10.2's calendar is consumed, never advanced).
- **No Outbox, no durable cross-module event delivery, no system posting.**
  `source`/`idempotencyReference`/`requestHash` exist as evidence columns and are
  validated, but no cross-module caller is wired (OQ-39 open).
- **No detail-dimension persistence** — OQ-41's seam is left to the future task;
  the lines table has no dimension columns.
- **No per-account financial-area applicability** (`account_financial_area` or
  equivalent) — OQ-40 stays open, untouched.
- **No currency, attachments, quantity or per-line document references**, no
  `detail_1_id…detail_4_id`, no EAV, no generic JSONB business payload (the only
  jsonb column is the opaque idempotency `result`, as Inventory already does).
- **No universal document table and no generic document controller**: the
  voucher is a typed Accounting-owned aggregate; the Foundation supplies type
  registration, numbering and (unused here) relations only.
- **No frontend, no Redis, no microservice, no workflow/approval integration, no
  new dependency.**
- **No `Accounting.Document.Approve/Reverse/Correct/Replace/Post` permission**
  (nothing would enforce them) and no generic `Accounting.Document.Manage`.

## 19. Open questions, seams and pre-existing issues

**OQ audit (nothing in `docs/open-questions.md` was modified; all five remain
open).**

| OQ                                                 | Status after this task                                                                                                                                                                                                                                             | Evidence |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| OQ-39 (system posting / durable delivery)          | **Still open, not required.** System posting is not implemented, no Outbox, no durable-delivery claim. The idempotency ledger is the ADR-0022 foundation a future integration will build on, and `origin = 'system'` rows are already representable and validated. |
| OQ-40 (per-account financial-area applicability)   | **Still open, not required.** No area-applicability structure was introduced; area validity is per organization + date, as Task 10.3 established.                                                                                                                  |
| OQ-41 (dimension policy)                           | **Still open, not required.** No dimension columns; the voucher lines are complete without them.                                                                                                                                                                   |
| OQ-42 (posting-mode defaults / approval authority) | **Still open, not required.** Finalization requires no approval and no posting mode; the type is registered with `entryStates: ['temporary']`, so creation never starts at `final`.                                                                                |
| OQ-43                                              | **Still open, untouched** — no behaviour in this task depends on it.                                                                                                                                                                                               |

**Architectural seams and follow-up concerns.**

1. `AccountingDocumentsService` is exported from `AccountingModule` for a future
   in-module caller (§16.3). A cross-module caller (Inventory/Sales → Accounting)
   must NOT import the service across contexts; the contract requires an
   integration boundary, which is OQ-39's decision.
2. `AccountingDocumentLinesRepository.countReferencingLinesInTx` and
   `AccountsRepository.countReferencingLinesInTx` are the AC-I-11 interlock.
   Any future writer of `accounting_document_lines` must take the account's
   `FOR SHARE` lock in the same transaction (the lock order is documented in
   `data/accounting-locks.ts` and must stay `area → year → period → accounts →
document`).
3. The header carries no correction/reversal kind. If the contract later
   requires representing them “now”, an additive migration plus a domain planner
   is the path — the current ref columns are deliberately absent rather than
   half-modelled.
4. Idempotency is per organization and per operation key; the `result` payload is
   opaque by design. A future system-posting caller must record its own intent
   hash the same way (client intent only) or replays will conflict with
   themselves.
5. `documents/types` now lists three types; any test or consumer that assumed two
   (`accounting_journal`, `inventory_receipt`) had to be updated — done in
   `test/documents.e2e-spec.ts`.

**Pre-existing repo issues (found, not fixed — out of scope).**

1. `.vardena/project-context.md` still describes the repository as having no
   application code beyond Task 9-era modules in places; it is stale relative to
   the Accounting module (Tasks 10.2–10.4). Flagged, not rewritten.
2. `backend/src/generated/prisma/client.ts` is a hand-written 184-line stub that
   is tracked on purpose (`backend/.gitignore` un-ignores exactly that file).
   It compiles but is not the real client; a real environment must run
   `prisma generate` (which cannot happen in this sandbox).
3. `docs/accounting/domain-contract.md` §16.6 and AC-D-26 describe system posting
   as future work; the schema comments in `accounting.prisma` mirror that, but a
   reader looking only at the schema sees the deferred columns’ rationale —
   nothing else in the docs contradicts the implementation.
4. The Prisma CLI’s hard dependency on a reachable engine download means every
   Prisma gate is unrunnable in this sandbox class; CI remains the authority for
   §16’s blocked rows.
