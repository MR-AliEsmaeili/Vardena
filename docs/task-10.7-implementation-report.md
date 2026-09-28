# Task 10.7 — Accounting Ledger Entries & Atomic Finalization → Ledger Materialization: Implementation Report

Date: 2026-09-16 · Branch: `arena/01a0aab2-vardena` · Base: `d8231ec` (merge of PR #21, Task 10.6 accepted)

---

## 1. Status

**PASSED**, with the same two environment-bound limitations Tasks 10.4/10.5
recorded: no PostgreSQL exists in this sandbox (no `psql`, no Docker daemon),
so the live-database suites remain **SKIPPED** locally and wired for CI (§8);
and the Prisma CLI gates stay **BLOCKED** by sandbox egress
(`binaries.prisma.sh` is unreachable — TLS handshake fails), so
`prisma validate` / `prisma format` / `prisma generate` / `migrate dev` could
not run here. Unlike Task 10.5, this task **does** change the schema (§6), so
the mitigation is recorded explicitly: the schema edits follow the file's own
established patterns field-for-field (relation shapes, `@map`/`@@map`/`@@schema`
usage, `@unique(map:)` naming, `Decimal(18,2)`, RESTRICT FKs), and the
hand-written migration mirrors the Task 10.4 migration's statement shapes
(constraint/index naming, `ON DELETE RESTRICT ON UPDATE CASCADE`); **CI must
run `prisma validate` and apply the migration to a real database** before
merge. Nothing about the design depends on unverifiable behaviour — every
statement uses plain, long-stable PostgreSQL/Prisma features.

What exists after this task: the **minimal persistent foundation** the brief
asks for — `accounting.ledger_entries`, an insert-only `LedgerEntriesRepository`,
and **atomic Voucher Finalization → Ledger Materialization**: `finalizeChecked`
now writes the state change, exactly one immutable entry per stored line, and
the idempotency row in ONE transaction, or nothing at all. `final` = posted
(AC-D-20): no separate state, no second ledger, no Posting entity, no endpoint,
no permission, no event (§10).

## 2. Root contract

Nothing structural is invented here; every element is derived from the accepted
documents:

| Root | What it fixes for this task |
| --- | --- |
| contract **§15.5 (AC-D-23)** | Finalization IS the act that makes a voucher part of the books. The transaction boundary is therefore finalization's own: state + entries + evidence commit together or not at all. |
| Task 10.6 atomic model (`posting.ts` header) | The accepted boundary this task implements: readiness → fixed lock order → re-validate inside tx → state/evidenced `final` → N entries → idempotency row LAST → commit → `Finalized` event. No separated model, no second durable transaction. |
| Task 10.6 correction (§4, `PostingResult`) | `accounting_posting_operations` is idempotency/evidence infrastructure, NOT a Posting entity and NOT the ledger identity. The entry identity is the row's own ULID; the operation kind stays `document_finalize`. |
| contract **§12.5 / §19.2** | One voucher → N entries; one voucher line → exactly ONE entry (1:1 via `voucher_line_id` + `line_no` + account). |
| contract **§13 / AC-I-07/08** | Exact `Σ debit = Σ credit`, non-negative `numeric(18,2)`, exactly one side non-zero per entry — re-asserted at materialization, amounts as decimal strings, never floats (AR-12). |
| contract **§18 / AC-I-22** | The number snapshot (`voucher_number`) is immutable evidence carried on every entry. |
| contract **§16.4 / AC-I-12, ADR-0022 §3/§4** | Idempotency reuse: same key + same hash replays (re-reading current rows), same key + different hash 409s, nothing applied. The operation row stays the LAST statement. |
| contract **§15.2/§15.3, AC-I-05/06** | Structural immutability: no update path, no delete path, no unscoped read. Corrections are future counter-documents with NEW entries (AC-D-22). |
| contract **§16.1/§16.3, AC-D-24/25** | Origin + logical source identity snapshots (`manual` carries none, `system` carries all). |
| contract **AC-D-17 / AC-I-14** | Branch (header-level scope, Class C5) + the STORED area/year/period resolution on every entry — reports never recompute. |
| contract **§12.3, §15.5 (Class C3)** | BOTH business date (`document_date`) and system timestamp (`posting_timestamp` = `finalizedAt`) on every entry. |
| contract **§19.3 (AC-D-31/AC-I-19)** | Entries are truth; balances are a future rebuildable projection — no balance state is maintained here. |
| contract **AC-D-20** | No `posted` state exists nor is added; `AccountingDocument.Finalized` stays the posting evidence, no new event. |
| **ADR-0026** (Accepted) | Accounting owns its ledger; the materialization is in-module (`data/`), behind the existing `finalizeChecked` boundary (AR-07/AR-02). |
| Task 10.4 implementation | The lock order (area → year → period → accounts `FOR SHARE` → document), the single-decision-table posture (`checkVoucherLines`, `checkOriginEvidence`), the insert-LAST rule and the fake-parity pattern this task extends. |

**No STOP condition was reached**: every persisted element is defined by the
contract above; the OQ-gated elements (OQ-39…OQ-43) are *excluded* with their
seams preserved, not resolved (§7).

## 3. Design

```
temporary voucher (numbered, §18) + stored lines (≥2, §13)
        │  finalizeChecked — ONE transaction, fixed lock order (unchanged)
        ▼
re-validate inside tx: stored scope still resolves + OPEN (§7.2),
stored lines still a legal balanced composition (§13, from stored rows),
accounts still postable + active (§14), number present, phase temporary
        │  (all pre-existing Task 10.4 guards — untouched)
        ▼
write state = final + finalized_at/by (+ system evidence mirror)
        │
        ▼  (NEW, Task 10.7 — between the state update and the op row)
toPostingInput(final aggregate)      — final-only, numbered, evidenced
toLedgerEntries(input, generateId)   — 1 line → 1 entry, entry invariants
                                       + balance re-asserted (the 10.6 contract,
                                       never a second implementation)
insertLedgerEntries(tx, creates)     — plain createMany (skipDuplicates
                                       FORBIDDEN), count asserted
        │
        ▼
insertOperationRow(tx, ledger)       — still LAST (§16.4 evidence rule)
        │  commit (all or nothing)
        ▼
AccountingDocument.Finalized + audit facts (unchanged, §23)
```

Key decisions, each with its contract reason:

1. **The atomic model, not a separated one** (§15.5 AC-D-23 + the 10.6
   boundary): finalization and materialization share one transaction, so no
   second idempotency kind, no `ledger-post-*` key pattern and no Posting
   record are invented. A future separated architecture would decide its own
   boundary (OQ-39 dependent) — this task pre-commits to nothing.
2. **No Posting entity, no Posting table** (10.6 correction): the persistence
   surface is exactly one table (`ledger_entries`) plus the reused evidence
   row. Entry identity = own ULID, never `accounting_posting_operations.id`,
   never a line id, never a business field (§22 no-id-conflation, pinned by
   tests).
3. **Reuse, not reimplementation**: the materialization calls `toPostingInput`
   (whose preconditions — final-only, numbered, evidenced — fail loudly on an
   impossible state, the repository's existing posture) and `toLedgerEntries`
   (whose per-entry `checkLedgerEntry` + balance assertions are the SECOND
   in-transaction revalidation, evaluated under the document lock). No new
   error class, no new problem vocabulary, no new unit spec: the 10.6 suites
   already cover the contract.
4. **No new lock, no new lock order** (AR-11): fresh INSERTs under the already
   held document lock cannot deadlock — no path waits on a ledger row. The
   document lock serializes concurrent finalizations of one voucher; the
   UNIQUE backstop is the cross-transaction half (a hand-written row colliding
   with a finalization aborts it loudly). Recorded in
   `data/accounting-locks.ts`, the documentation the raw SQL depends on.
5. **Insert-only repository**: `LedgerEntriesRepository` exposes one scoped
   read (`findByVoucher`, org-first, `line_no` order) and the in-tx
   `insertLedgerEntries` helper (the `insertOperationRow` precedent). No
   update, no delete, no unscoped read — structurally (AC-I-05/06). An empty
   set and a short write both throw; `skipDuplicates` is forbidden by comment
   because it would hide exactly the collision the backstop exists to surface.
6. **ULIDs generated in the data layer** (the inventory/RBAC precedent):
   entry ids belong to rows this transaction owns and are unobservable before
   commit. The audit clock/actor are the finalization's own (`created_at` =
   `finalizedAt`, `created_by` = finalizer) — no second clock, no second actor.
7. **Fake parity + an atomicity fix**: the e2e fakes call the same
   `toPostingInput`/`toLedgerEntries`, enforce the same `P2002` backstops
   (including the new 1:1), and now snapshot/restore around multi-step writes —
   which also closes the pre-existing patch-then-insert gap where a thrown
   ledger key would have leaked a `final` row in the fake.
8. **No API, no permission, no event** (AR-21/AR-29, §22): the scope-audit
   e2e test still passes unchanged; `Finalized` remains the posting evidence.

## 4. Persistence model

`accounting.ledger_entries` (migration `20260916000000_accounting_ledger`):

- **Identity**: `id` (PK, ULID) + the 1:1 traceability key `voucher_line_id`
  (FK RESTRICT → lines, **UNIQUE** `uq_ledger_entries_voucher_line_id`).
- **Sourcing snapshot** (AC-D-35/§23 — traceable without re-reading mutable
  state): `organization_id`, `financial_area_id`, `fiscal_year_id`,
  `accounting_period_id` (all FK RESTRICT), `voucher_id` (FK RESTRICT) +
  `voucher_number` (immutable serial snapshot), `line_no` (dense legal-book
  order), `account_id` (FK RESTRICT), `document_date` (DATE), `posting_timestamp`
  (`finalizedAt`), `branch_id` (nullable FK RESTRICT), `origin`, the four
  logical source columns (never cross-module FKs, AR-07/08), `correlation_id`,
  `finalized_by`, `description` (line narration snapshot, nullable).
- **Money**: `debit_amount` / `credit_amount` `numeric(18,2)` (AR-12), carried
  as decimal strings through every layer.
- **Reads**: `idx_ledger_entries_org_voucher`, `idx_ledger_entries_org_account`,
  `idx_ledger_entries_org_period` — all org-scoped (ADR-0021 §3, AC-I-01).
- **Deliberately absent** (AR-29): no CHECK constraints, no triggers (Prisma
  cannot represent them — the drift hazard every migration header records; the
  rules live in `domain/ledger-entry.ts` + `domain/posting.ts` and run inside
  the tx), no dimension columns (OQ-41: no `detail_*_id`, no EAV, no JSONB —
  reads map `dimensionAssignments: []`), no currency/rate (OQ-03), no balance
  columns (§19.3: projections rebuild OVER these rows).

The migration is **purely additive**: one new table + virtual back-relations
(no existing table altered). Prisma back-relations added on `FinancialArea`,
`FiscalYear`, `AccountingPeriod`, `Account`, `AccountingDocument`,
`AccountingDocumentLine` (1:1 virtual side), `Organization` and `Branch`.

## 5. Files changed

**Created (4)**

| File | Why |
| --- | --- |
| `backend/prisma/migrations/20260916000000_accounting_ledger/migration.sql` | The `ledger_entries` table: PK, 8 RESTRICT FKs, the 1:1 UNIQUE backstop, 3 org-scoped read indexes. Header records the full design rationale (see §6). |
| `backend/src/modules/accounting/data/ledger-entries.repository.ts` | Insert-only evidence access: scoped `findByVoucher` + in-tx `insertLedgerEntries` (count-asserted, empty-set refused). Strict row→domain mapping (origin narrowing, Decimal→canonical string, `dimensionAssignments: []`). |
| `backend/test/ledger-entries-live.e2e-spec.ts` | 6 live-database tests: materialization snapshot, atomicity, 1:1 backstop, FKs, index names, race (§8). |
| `docs/task-10.7-implementation-report.md` | This report. |

**Modified (10)**

| File | What changed |
| --- | --- |
| `backend/prisma/schema/accounting.prisma` | `LedgerEntry` model + back-relations on area/year/period/account/document/line (1:1 virtual side on the line); header NOT-here comment updated (documents/operations shipped 10.4, ledger 10.7). |
| `backend/prisma/schema/organization.prisma` | Virtual `ledgerEntries` back-relations on `Organization` + `Branch` (no migration impact). |
| `backend/src/modules/accounting/data/accounting-rows.ts` | `LedgerEntryRow`/`Where`/`Create`/`Delegate` (findMany + createMany only — no update/delete surface exists) + `ledgerEntry: Pick<…, 'createMany'>` on `AccountingTxClient`. |
| `backend/src/modules/accounting/data/accounting-documents.repository.ts` | `finalizeChecked` materializes via `toPostingInput` → `toLedgerEntries(…, generateId)` → `insertLedgerEntries` between the state update and the still-LAST op row; `toLedgerEntryCreate` flattens the audit clock/actor from the finalization. Doc comment updated. No guard touched. |
| `backend/src/modules/accounting/data/accounting-locks.ts` | Task 10.7 note: no new lock/order, why INSERTs-under-held-lock cannot deadlock, backstop as the cross-tx half. |
| `backend/src/modules/accounting/accounting.module.ts` | Header note + `LedgerEntriesRepository` in `providers` (not `exports` — in-module evidence reads). |
| `backend/test/support/accounting-document-repositories.ts` | `ledgerEntries` table + 1:1 backstop, fake materialization through the same contract, `InMemoryLedgerEntriesRepository.findByVoucher`, `withRollback` atomicity for `createChecked`/`finalizeChecked` (closes the pre-existing patch-then-insert gap). |
| `backend/test/accounting-documents.e2e-spec.ts` | Provider override + 1 new journey (materialization snapshot, replay/second-key/single-set, org isolation); readiness read-only snapshot extended with `ledgerEntries`. No existing assertion weakened. |
| `backend/test/accounting-documents-live.e2e-spec.ts` | `ledgerEntry` client shape, cleanup order (ledger FIRST — RESTRICT), +2 entry-count assertions on the existing lifecycle/race tests. |
| `docs/modules.md` | Accounting entry: 10.4 facts restored (it still claimed documents were contract-only — the staleness Task 10.5 §12.1 flagged), 10.6/10.7 status, 29 permissions, document API routes, shipped events, catalog row (AG-07). |

No ADR, no `docs/open-questions.md` change (byte-identical), no controller/DTO,
no other module, no frontend, no new dependency.

## 6. Database

**One migration, additive only**: `20260916000000_accounting_ledger` —
`CREATE TABLE accounting.ledger_entries` (26 columns incl. AR-12 audit),
8 `ON DELETE RESTRICT ON UPDATE CASCADE` foreign keys (organization,
financial area, fiscal year, accounting period, voucher, voucher line,
account, branch — cross-schema direction strictly Accounting → Organization),
`uq_ledger_entries_voucher_line_id` (UNIQUE), and
`idx_ledger_entries_org_{voucher,account,period}`. No `ALTER TABLE` of any
existing table; the Prisma back-relations are virtual-only.

Consistency with the schema files was verified by hand against the Task 10.4
migration's statement shapes (constraint/index naming, FK actions, column
types/widths/defaults) because `prisma validate`/`migrate dev` cannot run in
this sandbox (§1, §8). **CI must validate the schema and apply the migration
before merge.**

## 7. Open questions

| OQ | Status after this task |
| --- | --- |
| OQ-39 (durable cross-module delivery) | **unchanged** — no outbox/queue, no durable delivery, no system-posting caller; the atomic model reuses the existing `document_finalize` evidence, and any future separated boundary stays OQ-39 dependent (10.6 wording kept). |
| OQ-40 (financial-area applicability) | **unchanged** — no applicability table; the entry carries `financialAreaId` as the book scope and nothing more. |
| OQ-41 (dimensions) | **unchanged** — no dimension tables/columns/EAV/JSONB; `dimensionAssignments: []` on every read, the typed child table arrives with the dimension task. |
| OQ-42 (posting mode / approval authority) | **unchanged** — no approval state, no mode configuration; `Finalize` ≠ `Approve`, the lifecycle is untouched. |
| OQ-43 (Iranian statutory/e-ledger) | **unchanged** — no statutory rule hardcoded; business date + posting timestamp + number evidence + branch scope keep every Class C3/C5 requirement expressible. |

`docs/open-questions.md` is byte-identical to the base commit.

## 8. Tests

New: **1 e2e journey** and **6 live-database tests** (+2 strengthened
assertions in the sibling live suite); **no new unit spec** — the entry
invariants, `toPostingInput`/`toLedgerEntries`/`toPostingResult` and the
no-id-conflation rule are already covered by the Task 10.6 suites
(`ledger-entry.spec` 23 + `posting.spec` 27 = the entire 816→866 unit delta
since the 10.5 report), and a duplicate suite would violate the
one-decision-table rule.

| Gate | Command | Result |
| --- | --- | --- |
| Format | `npm run format:check` | **PASSED** (exit 0) |
| Lint | `npm run lint` (`oxlint .`) | **PASSED** (0 warnings / 0 errors, 426 files) |
| Typecheck | `npm run typecheck` | **PASSED** (exit 0) |
| Build | `npm run build` | **PASSED** (exit 0) |
| Unit tests | `npm test` | **PASSED** — 70 files / 866 tests (was 68/816 at 10.5; +50 is Task 10.6's specs, +0 this task by design) |
| E2E tests | `npm run test:e2e` | **PASSED** — 189 passed / 37 skipped over 22 files (was 188/31 over 21; +1 journey, +6 live skips) |
| Live PostgreSQL suites | `VARDENA_TEST_DATABASE_URL` | **SKIPPED** — no PostgreSQL in this sandbox; 6 new + 7 sibling tests wired for CI, not counted as passing |
| Prisma CLI gates | `npx prisma validate/format/generate`, `migrate dev` | **BLOCKED** — sandbox egress denies `binaries.prisma.sh` (unchanged since 10.4); schema + migration hand-verified, CI must run these |

Case coverage (task §22 + §15.5): pre-final voucher has no entries;
finalization writes exactly N entries (N = stored lines) with the full
snapshot — scope, voucher + serial, line 1:1, account, canonical exact
amounts (`0.1/0.2/0.3` live, `1250.00→1250` e2e), business date,
`postingTimestamp = finalizedAt`, branch, origin + well-formed system source,
correlation, finalizer, empty dimensions; entry ids are fresh ULIDs distinct
from line ids and the op-ledger id; `numeric(18,2)` scale preserved on the
wire (`0.10/0.20/0.30`); same-key replay and fresh-key second finalization
both leave exactly one set; lost key race rolls back state + entries + key
(voucher stays temporary, zero entries); colliding hand-written entry aborts
with `P2002` and leaves no partial set; RESTRICT blocks deleting a posted
voucher/line/account while dangling inserts are rejected; the 4 index names
exist with the 1:1 UNIQUE; concurrent same-key finalizations yield one state
change, one entry set, one key row; cross-organization reads answer empty;
readiness evaluation still mutates nothing (ledger snapshot included).

## 9. Architecture audit

- **Bounded-context ownership intact**: everything lives in
  `modules/accounting` (+ its tests); `LedgerEntriesRepository` is provided
  but NOT exported, and cross-module references stay logical, never FKs
  (AR-07/AR-08, ADR-0026). The only cross-schema FKs point Accounting →
  Organization (the `Branch`/`Organization` ledger links).
- **Layering anatomy kept** (AR-02/04/05): `finalizeChecked` imports only
  framework-free domain (`posting.ts`, `ledger-entry.ts`, `money.ts`) plus the
  kernel ULID helper — the same import shape the calendar/account repositories
  already use; no DTO, no HTTP, no Prisma model type crosses into `domain/`.
- **No duplicate validation logic**: balance/composition stay `checkVoucherLines`
  (called on the STORED rows), origin evidence stays `checkOriginEvidence`,
  entry shape + balance stay `toLedgerEntries`' assertions. The only new logic
  is the insert plumbing and the strict row→domain mapping.
- **No new lock, no trigger, no CHECK, no exclusion** (AR-11): the
  concurrency story is the documented lock order plus UNIQUE backstops, all
  Prisma-visible — nothing a later generated migration could silently drop.
- **Money discipline** (AR-12): `numeric(18,2)` storage, decimal strings in
  domain/DTOs/tests, canonicalization at the mapping boundary, exactness pinned
  at both the mapped and the wire level.
- **Fake parity is structural, not aspirational**: the fakes execute the same
  contract functions, throw the same `P2002`s, and now roll back like the real
  transaction — the e2e journey asserts through the same `findByVoucher` shape
  the live suite uses.
- **Surface discipline**: no endpoint, no permission, no event added — the
  pre-existing scope-audit e2e test (correction/reversal/posting/reporting
  404s) passes unchanged, and `modules.md` now states the shipped-vs-planned
  line accurately.

## 10. Scope audit — what was deliberately NOT implemented

No posting/rules engine, no separate `posted` state, no Posting entity/table,
no second idempotency ledger or key scheme, no outbox/queue/Kafka/Redis/async
or durable delivery, no balances/trial-balance/reports/projections, no
corrections/reversals/approvals/reopen, no dimensions implementation (seam
only), no area-applicability table, no currency/exchange-rate, no OQ-39…OQ-43
resolution, no endpoint, no permission code, no event, no frontend, no
microservice split, no unrelated refactor.

## 11. Commit

One focused implementation commit on `arena/01a0aab2-vardena`:

- hash: `6946ea6e3892f1408212f7b6e215fbf9164f675a`
- message: `feat(accounting): materialize immutable ledger entries in finalization (Task 10.7)`

— the base history (`d8231ec`, PR #21) is untouched; only the additive
working-tree changes above it, plus the review-pass deltas of §13
(one narrowed function, one e2e pin, this report). A second, docs-only commit
records this exact hash in the report (a hash cannot be embedded in the commit
it identifies).

## 12. Pre-existing issues found, not fixed (out of scope, AG-03/AG-17)

1. **`.vardena/project-context.md` staleness** — already flagged by Tasks
   10.4/10.5; still describes the repo as Task 9-era in places. A doc rewrite,
   not a Task 10.7 change. Carried forward.
2. **Fiscal-year date edits have no document-reference guard yet** (Task 10.2's
   documented §6.5 reading) — carried forward from Task 10.5 §12.2; the guard
   belongs to the calendar/year-transition task.
3. **Live fixtures use `coding_structure_versions.status = 'published'`**,
   which is not in the domain vocabulary (`draft|active|superseded`). The value
   predates this task (Task 10.4 live suite) and no document guard reads it,
   so the new live suite mirrors it rather than diverging — but a future pass
   should align both fixtures with the domain list.
4. **Prisma engines are unfetchable in this sandbox** (recorded since 10.4):
   `prisma validate/format/generate` and `migrate dev` cannot run here. This
   task's schema + migration are hand-verified (§1, §6); CI remains the
   enforcing gate.

Resolved by this task: the `docs/modules.md` staleness Task 10.5 §12.1 flagged
(documents/ledger now recorded as shipped, §5) and the fake's patch-then-insert
non-atomicity (§3.7).

## 13. Review-pass addendum (acceptance corrections)

Focused review/fix pass only — §10 (scope audit) still holds verbatim. Each
item states whether a code change was required; where none was, that is stated
explicitly instead of inventing one.

### 13.1 Duplicated `branchId` (review item 1) — NO CODE CHANGE

Inspected the actual working-tree source, not the patch: `LedgerEntryRow`
declares `branchId: string | null;` **exactly once**
(`data/accounting-rows.ts:660`). The second file occurrence (`:692`) belongs
to the separate `LedgerEntryCreate` interface. No duplicate existed — and a
true duplicate could not have survived unnoticed, since TypeScript rejects
duplicate members and `typecheck` passes. No change made.

### 13.2 Cross-row integrity (review item 2) — NO CODE CHANGE, documented here

The application guarantees the seven equalities by single-source construction
inside the locked finalization transaction (`finalizeChecked`):

| Required equality | Mechanism (verified in source) |
| --- | --- |
| `ledger.organizationId == voucher.organizationId` | One source row: the locked + updated header → `toDomain` → `toPostingInput` (copies scope from `document`, `posting.ts:574-578`) → `toLedgerEntries` (copies input scope onto **every** entry, `posting.ts:627-631`). Equal by construction. |
| `ledger.financialAreaId == voucher.financialAreaId` | Same single-source copy. |
| `ledger.fiscalYearId == voucher.fiscalYearId` | Same single-source copy. |
| `ledger.accountingPeriodId == voucher.accountingPeriodId` | Same single-source copy. |
| `ledger.voucherId == source voucher` | `voucherId = document.id` where the document is `toDomain` of the updated locked row; the locked row is `input.id` in `input.organizationId` (`lockDocumentInTx` org check). |
| `ledger.voucherLineId` belongs to `ledger.voucherId` | Lines come from `readLinesInTx(tx, input.id)` — `WHERE document_id = input.id` (`:937`) — and `voucherLineId = line.id`. Stability: the document `FOR UPDATE` lock serializes against `updateChecked`/`deleteChecked` (the only line writers besides create-on-a-new-id; all four take `lockDocumentInTx`), and the `sameIds` stale check covers the pre-lock read window. |
| `ledger.accountId == source line accountId` | `accountId = line.accountId` from the same stored rows, whose accounts were locked `FOR SHARE` and revalidated (in-organization, postable, active) in the same transaction. |

The database intentionally does **not** enforce cross-row co-ownership: the 8
single-column RESTRICT FKs prove each referenced row **exists**, not that
(period ∈ year), (line ∈ voucher) or (account ∈ org-of-voucher). No composite
FK, trigger, CHECK or new mechanism is introduced, because:

1. **Single-writer mapping, not a race**: `finalizeChecked` is the sole ledger
   writer; co-ownership is a single-source copy inside one locked transaction,
   with nothing for a constraint to arbitrate.
2. **Accepted precedent**: `accounting_document_lines` (Task 10.4) denormalizes
   scope with independent FKs and no composite proof (period ∈ year) — the
   identical shape, accepted.
3. **A composite FK would need speculative schema**: `(voucher_id,
   voucher_line_id) → lines(document_id, id)` requires a redundant composite
   unique on `(document_id, id)` where `id` is already the PK (AR-29).
4. **Architecture rule**: concurrency guards live in locked `data/`
   transactions, never in Prisma-invisible DB mechanisms.

This section is the explicit application-invariant documentation the review
requires.

### 13.3 Audit columns (review item 3) — NO CODE CHANGE, documented here

`AR-12 — Standard entity columns` requires `created_at`, `updated_at`,
`created_by`, `updated_by` on **every** entity table, so all four stay on
`accounting.ledger_entries`. Their presence is structural convention, not
mutable state:

- **No application path can mutate a ledger row**: `LedgerEntryDelegate` and
  the `AccountingTxClient` surface expose only `findMany`/`createMany`
  (verified: zero `update`/`delete`/`upsert` call sites under `src/`; the only
  `deleteMany` hits are live-test `afterAll` cleanup hooks through the raw
  test client, not application paths). The in-memory fake only `insert`s into
  its ledger table (`patch`/`delete` touch documents/lines only).
- `updated_at` is written **once**, at insert, always equal to `created_at`
  (`= finalizedAt`); `updated_by` is not a member of `LedgerEntryCreate`, so it
  is always NULL. Both are therefore write-once evidence of the finalization
  act, consistent with AR-13 (journal entries are immutable).

### 13.4 Decimal conversion (review item 4) — NARROWED (ledger copy only)

Changed `toAmountString` in `data/ledger-entries.repository.ts` to the
narrowest safe mapping: `string` → itself (fakes store canonical strings);
`Decimal`-like (object with a function `toString`) → `toString()` — Prisma
returns `Decimal` for `numeric(18,2)` in production with exact decimal
rendering; **anything else throws**, especially JS `number`. The old `number`
fallback was unreachable (no producer emits numbers) and dangerous in
principle (`String(0.1 + 0.2)` is float loss), so per the review it is removed
rather than documented-around. A malformed string still fails loudly downstream
in `canonicalizeAmount`. The Task 10.4 sibling copy in
`accounting-documents.repository.ts` is accepted code and is intentionally
**untouched** in this correction pass (no-behavior-change discipline);
unifying the two copies is a future refactor, explicitly not taken here.

### 13.5 Transaction architecture (review item 5) — NO CODE CHANGE

Verified unchanged in source: service `replayOrReject` (pre-transaction) →
lock area → lock year → lock period → lock accounts ascending (`FOR SHARE`) →
lock document (`FOR UPDATE`) → stale/scope/composition revalidation on stored
rows → state update → N entries → operation row LAST → commit. No outbox,
queue, worker, Redis, async posting, second ledger, Posting table, `posted`
state, new key scheme, or OQ-39 resolution was introduced.

### 13.6 Atomicity coverage (review item 6) — ONE E2E PIN ADDED

| Case | Coverage (all still passing, none weakened) |
| --- | --- |
| 1. Entry-insert failure after state update → full rollback | Live `refuses a second entry…`: `P2002` inside `createMany` ⇒ voucher stays `temporary`, zero new rows. |
| 2. Partial insertion → full rollback | Same test (`count == 1`, the hand row only): entries go in via ONE `createMany` statement (statement-atomic), and Prisma `$transaction` rolls back the state update with it; the fake's `withRollback` mirrors this for its loop write. |
| 3. Evidence failure → full rollback | Live `rolls the whole finalization back…` (lost key ⇒ temporary + zero entries + one key row). |
| 4. Same-key same-hash replay → no duplicates | E2E ledger journey: replayed finalization ⇒ still exactly 2 entries. |
| 5. Same-key different-hash → conflict, no mutation | **Pinned in this pass**: second voucher finalized with the first voucher's key ⇒ `409 Conflict`, voucher stays `temporary`, zero entries for it, first voucher still exactly 2. Structural backstop: `replayOrReject` throws before any transaction opens (shared branch already e2e-pinned via composition). |
| 6. Fresh second finalization → no second set | E2E: fresh key on a final voucher ⇒ `422`, still exactly 2 entries. |
| 7. `voucher_line_id` collision → full rollback | Live test of case 1 (the same mechanism). |
| 8. Same-key concurrency → one of each | Live `finalizes once under concurrent attempts` + sibling race entry-count (CI; skipped locally, §13.8). |

The case-5 pin adds assertions to the existing ledger journey test (no new
`it` block, no existing assertion touched).

### 13.7 Schema audit (review item 7) — NO CODE CHANGE

Verified against the migration SQL: all 19 required snapshot groups are
present as 27 columns (`id`, org, area, year, period, voucher,
voucher_number, voucher_line, line_no, account, debit, credit, description,
document_date, posting_timestamp, branch, origin, 4 source columns,
correlation_id, finalized_by, plus the 4 AR-12 audit columns). The forbidden
terms (`detail_*`, EAV, JSONB, balance, currency, exchange, rules) occur only
in the migration header comment, each in a sentence explicitly stating its
absence. No dimension columns, EAV, arbitrary JSONB, balance projections,
currency/rate implementation, or posting rules.

### 13.8 Gates (review item 8)

Re-ran after the review deltas: `format:check` ✅ · `lint` (0/0, 426 files) ✅
· `typecheck` ✅ · `build` ✅ · unit **70 files / 866 tests** ✅ · e2e
**189 passed / 37 skipped** over 22 files ✅ (count unchanged — the case-5 pin
adds assertions, not tests). Live PostgreSQL: still unavailable in this
sandbox (port 5432 closed) — the 13 live tests stay skipped and CI-wired, not
counted as passing. Prisma CLI: still blocked (TLS failure to
`binaries.prisma.sh`, curl exit 35) — the CI requirement stands: validate the
schema and apply the migration before merge.

### 13.9 Scope discipline (review item 9)

No refactor of unrelated code, no domain-contract change, no OQ change, no
frontend, API, permissions, reports, balances, corrections, dimensions, rules,
or other-module changes. Total review-pass diff: one narrowed function +
comment, ~25 e2e assertion lines, and this addendum.

OQ-39…OQ-43 remain **unchanged** (§7 still holds; `docs/open-questions.md`
byte-identical).

Exact commit: `6946ea6e3892f1408212f7b6e215fbf9164f675a`
(`feat(accounting): materialize immutable ledger entries in finalization (Task 10.7)`,
see §11).
