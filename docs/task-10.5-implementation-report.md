# Task 10.5 — Accounting Posting Readiness & Contract Foundation: Implementation Report

Date: 2026-09-16 · Branch: `arena/01a0a8f3-vardena` · Base: `e9823dd` (merge of PR #19, Task 10.4 accepted)

---

## 1. Status

**PASSED**, with the same environment-bound limitation Task 10.4 recorded: no
PostgreSQL exists in this sandbox (no `psql`, no Docker daemon), so the
live-database suites remain **SKIPPED** locally and wired for CI (§8). The
Prisma CLI gates stay **BLOCKED** by sandbox egress — unchanged, and not
re-attempted because **this task intentionally changes no schema** (§6).

What exists after this task: a stable, read-only, internal
**Posting Readiness contract** between the Accounting voucher (Task 10.4) and
the future Posting Engine — a pure domain decision table
(`domain/posting-readiness.ts`) plus an application seam
(`PostingReadinessService`) that assembles the snapshot from persisted rows and
delegates every rule to the existing decision tables. No posting of any kind
was implemented (§10).

## 2. Root contract

The eligibility definition is **not invented here**; it is derived, section by
section, from the accepted documents:

| Root                                                     | What it fixes for this task                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/accounting/domain-contract.md` **§15.5 (AC-D-23)** | Finalization's own re-validation set — balance, ≥2 lines with both sides, postable+active+area-applicable accounts, resolved **open** year/period, scope, description, number, origin evidence — is the invariant set that "makes a voucher part of the books". Readiness re-evaluates the PERMANENT members of this set. |
| contract **§7.2 rule 7**                                 | "Final documents keep their resolved period forever. A later period close does not move or invalidate them" ⇒ period/year STATUS is not a readiness criterion (openness is finalization's own gate, AC-I-04).                                                                                                             |
| contract **§8.6 (AC-D-08)**                              | Account deactivation "blocks new posting lines and new child creation; existing lines, balances, reports and history keep referring to the account and remain fully readable" ⇒ account ACTIVITY is not a readiness criterion.                                                                                            |
| contract **§14 / AC-I-09**                               | Posting eligibility of accounts is a validated attribute (`is_postable`, leaf); a missing/foreign account is invisible (AC-I-16). Reused, not re-implemented.                                                                                                                                                             |
| contract **§13 / AC-I-07/08**                            | The exact `Σ debit = Σ credit` and line-shape rules — consumed through `checkVoucherLines`, never duplicated.                                                                                                                                                                                                             |
| contract **§16.1/§16.3**                                 | Origin evidence (`manual` carries none, `system` carries all four snake_case fields) — consumed through `checkOriginEvidence`.                                                                                                                                                                                            |
| contract **§6.2 rule 4 / AC-I-02 / AC-I-14**             | The stored scope resolution is authoritative and never recomputed; readiness verifies it still resolves.                                                                                                                                                                                                                  |
| contract **§18 / AC-I-22**                               | "A Final document always has one [number]" — the number is part of the final-state contract.                                                                                                                                                                                                                              |
| contract **§19.3 (AC-D-31/AC-I-19)**                     | The future consumer of Final lines (balance projections, rebuildable, never the source of truth) — the engine this seam serves.                                                                                                                                                                                           |
| **ADR-0026** (Accepted)                                  | Accounting owns posting; the engine is in-module, so the seam is internal. §7 inherits the organization posture verbatim.                                                                                                                                                                                                 |
| Task 10.4 implementation                                 | The aggregate, the guard vocabularies (`VoucherLineProblem`, `AccountingDocumentAccountProblem`, `AccountingDocumentScopeRejectedError`'s `area                                                                                                                                                                           | year | period`), the lock order and the idempotency ledger this task composes with. |

**No STOP condition was reached**: every eligibility dimension is defined by
the contract above; the OQ-gated dimensions (OQ-39…OQ-43) are _excluded_ and
recorded as seams rather than resolved (§7).

## 3. Design

```
AccountingDocumentsService (Task 10.4: compose → issue → finalize)
        │  a FINAL voucher exists — immutable, numbered, evidenced
        ▼
PostingReadinessService.evaluateReadiness(organizationId, documentId)   [application, read-only]
        │  assembles the snapshot by STORED ids, in the module's canonical
        │  read order (area → year → period → accounts ascending), no locks
        ▼
evaluatePostingReadiness(snapshot)                                      [domain, pure]
        │  re-uses checkVoucherLines + checkOriginEvidence + the guard vocabularies
        ▼
PostingReadiness { status: ready | not_ready, reasons[] }               [stable contract]
        ▼
future Posting Engine (§19.3 projections / ledger materialization — a later task)
```

Key decisions, each with its contract reason:

1. **Domain-level, pure, total** (`domain/posting-readiness.ts`, AR-05): the
   engine depends on framework-free shapes only — never repositories, Prisma
   models, DTOs or Nest classes.
2. **Narrow inputs make the non-criteria structural**: the scope input carries
   identity + dates only (no `status`), the account input carries
   `id/organizationId/isPostable` only (no `isActive`). The decision
   _cannot_ depend on the two dimensions §7.2 rule 7 and §8.6 exclude.
3. **Scope verification by stored ids + containment**: because years of one
   area and periods of one year never overlap (AC-I-03), reading the stored
   rows and checking ownership + date containment is exactly the resolution
   finalization validated — drift (the real seam: fiscal-year dates are
   editable while a year is open; Task 10.2's §6.5 reading has no
   document-reference guard yet) is _reported_, never re-resolved.
4. **No locks, documented consistency boundary**: every fact the verdict
   depends on is immutable (final voucher + lines, §15.2), frozen by reference
   (postability, AC-I-11) or excluded (statuses, activity) — so a `ready`
   verdict on a final voucher is **stable** and an unlocked read is not a
   check-then-act race. The future engine still owns its effect's consistency
   and re-validates inside its own transaction (ADR-0022 posture), reusing
   `data/accounting-locks.ts` and its fixed order unchanged — readiness takes
   no locks, so it can never join or reverse a lock cycle.
5. **Internal seam, no HTTP surface**: no endpoint, no permission code (AR-21
   binds endpoints; none exists). Like `requireUsable*`, the calling operation
   authorizes; the service applies the deployment pin (ADR-0025) and the
   404-never-403 organization posture (AC-I-01/16).
6. **Provided, not exported** from `AccountingModule`: the engine is
   Accounting-owned (ADR-0026 §1); a cross-module consumer would need the
   §16.3 posting contract and OQ-39's delivery decision first (AR-07).

## 4. Result model

- **`ready`** — the stored aggregate satisfies every PERMANENT book invariant:
  `final` phase, numbered, non-blank description, consistent origin evidence,
  a legal balanced composition, postable in-organization accounts, and a
  stored scope that still resolves from `document_date` within the
  organization/area. Empty `reasons`.
- **`not_ready`** — one or more reasons, ALL reported (the `checkVoucherLines`
  convention), in the fixed order state → source → composition → accounts
  (ascending by id) → scope (area, year, period). Never a raw database error;
  a missing/foreign document is the module's uniform 404 _before_ any verdict.
- **Reason codes** (machine-readable; consumers match `problem`, never text):

| Code (context)                                                                                                                                                                                       | Dimension                                                             | Reused vocabulary                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `document_not_final` (`phase`)                                                                                                                                                                       | state (§15.1/§15.5)                                                   | new, readiness-specific                                                                    |
| `document_not_numbered`                                                                                                                                                                              | state (§18, AC-I-22; final only — a draft legitimately has no serial) | new                                                                                        |
| `missing_description`                                                                                                                                                                                | state (§12.2)                                                         | new                                                                                        |
| `source_required_for_system` / `source_forbidden_for_manual` / `malformed_source`                                                                                                                    | origin evidence (§16.1/§16.3)                                         | `AccountingDocumentOriginProblem` verbatim                                                 |
| `too_few_lines`, `missing_debit_side`, `missing_credit_side`, `unbalanced_document`, `invalid_amount`, `zero_line`, `both_sides_set`, `invalid_line_no`, `duplicate_line_no`, `gaps_in_line_numbers` | composition (§13/§12.5)                                               | `VoucherLineProblem` verbatim                                                              |
| `account_not_found` / `account_not_postable` (`accountId`)                                                                                                                                           | accounts (§14, AC-I-09/16)                                            | narrowed `AccountingDocumentAccountProblem` (`account_disabled` deliberately absent, §8.6) |
| `scope_unresolvable` (`scope: area                                                                                                                                                                   | year                                                                  | period`)                                                                                   | calendar (§6.2 rule 4, AC-I-02/14) | the guard's `scope` vocabulary |

**Deliberate non-criteria** (documented in the domain file, pinned by tests):
period/year `status` and account/area activity — §7.2 rule 7 and §8.6 keep a
final voucher valid across later closes/seals/disables, and AC-I-19's
projection rebuild must include those lines. Dimensions (OQ-41), area
applicability (OQ-40), approval/mode (OQ-42), delivery (OQ-39) and statutory
behaviour (OQ-43) are recorded as seams, not evaluated.

## 5. Files changed

**Created (4)**

| File                                                                      | Why                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/modules/accounting/domain/posting-readiness.ts`              | The contract: result model, narrow status-free inputs, the pure `evaluatePostingReadiness` decision.                                                                                              |
| `backend/src/modules/accounting/domain/posting-readiness.spec.ts`         | 21 unit tests: every reason code, vocabulary reuse, fixed order, all-problems-at-once, purity.                                                                                                    |
| `backend/src/modules/accounting/application/posting-readiness.service.ts` | The seam: scoped 404 resolution, snapshot assembly by stored ids, delegation. Read-only by construction.                                                                                          |
| `backend/src/modules/accounting/application/posting-readiness.spec.ts`    | 13 tests against the real service + in-memory repositories: positive/negative journeys, the two non-criteria on real state transitions, corruption/drift re-checks, before/after store snapshots. |

**Modified (3)**

| File                                                  | What changed                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/modules/accounting/accounting.module.ts` | Header note + `PostingReadinessService` in `providers` (deliberately not `exports`), with the boundary rationale.                                                                                            |
| `backend/test/accounting-documents.e2e-spec.ts`       | The lifecycle journey records `state.finalizedId`; one new journey proves the seam resolves from the booted app (ready / not-ready / foreign-org 404 / read-only snapshots). No existing assertion weakened. |
| `docs/modules.md`                                     | One new bullet in the Accounting entry describing the Task 10.5 seam (AG-07).                                                                                                                                |

**Created (1) documentation**

| File                                      | Why          |
| ----------------------------------------- | ------------ |
| `docs/task-10.5-implementation-report.md` | This report. |

No file under `prisma/`, no ADR, no `docs/open-questions.md` change, no
frontend, no other module.

## 6. Database

**No migration.** No schema file, no SQL, no column, no table, no index was
touched (`git status` confirms `backend/prisma/` is untouched). Readiness is a
contract/readiness layer over data Tasks 10.2–10.4 already own; nothing about
the evaluation needed a schema change, so no STOP was required (task §16).

## 7. Open questions

| OQ                                        | Status after this task                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-39 (durable cross-module delivery)     | **unchanged** — no outbox, no durable delivery, no system-posting caller; the seam is in-module and delivery-agnostic by design.                   |
| OQ-40 (financial-area applicability)      | **unchanged** — no `account_financial_area` or equivalent; §14 rule 1's "area-applicable" is recorded as an unimplemented seam in the domain file. |
| OQ-41 (dimensions)                        | **unchanged** — no dimension tables/columns; AC-I-18's check is recorded as a seam that extends the decision table when the dimension task ships.  |
| OQ-42 (posting mode / approval authority) | **unchanged** — no approval state, no mode configuration; readiness evaluates the final state, not how it was reached.                             |
| OQ-43 (Iranian statutory/e-ledger)        | **unchanged** — no statutory behaviour implemented.                                                                                                |

`docs/open-questions.md` is byte-identical to the base commit.

## 8. Tests

New: **34 unit/application tests** (21 domain + 13 application) and **1 e2e
journey**; suite totals 68 files / 816 unit tests and 21 files / 219 e2e tests.

| Gate                   | Command                        | Result                                                                                                     |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Format                 | `npm run format:check`         | **PASSED** (exit 0)                                                                                        |
| Lint                   | `npm run lint` (`oxlint .`)    | **PASSED** (0 warnings / 0 errors, 420 files)                                                              |
| Typecheck              | `npm run typecheck`            | **PASSED** (exit 0)                                                                                        |
| Build                  | `npm run build`                | **PASSED** (exit 0)                                                                                        |
| Unit tests             | `npm test`                     | **PASSED** — 68 files / 816 tests (was 66/782)                                                             |
| E2E tests              | `npm run test:e2e`             | **PASSED** — 188 passed / 31 skipped (was 187/31; the skips are the pre-existing live-DB guards)           |
| Live PostgreSQL suites | `VARDENA_TEST_DATABASE_URL`    | **SKIPPED** — no PostgreSQL in this sandbox; wired for CI, not counted as passing                          |
| Prisma CLI gates       | `npx prisma validate/generate` | **NOT RUN** — no schema change to validate; the 10.4 report's BLOCKED status (sandbox egress) is unchanged |

Case coverage (task §18): finalized valid → READY; draft → NOT_READY
(`document_not_final`); temporary → NOT_READY; invalid composition → NOT_READY
(every §13 code); invalid/unusable account → NOT_READY
(`account_not_found`/`account_not_postable`); foreign organization → uniform
404, never a verdict; invalid calendar scope → NOT_READY
(`scope_unresolvable` area/year/period, incl. the year-date drift);
system-origin evidence → its three codes; plus the deliberate non-criteria
(closed period, sealed year, disabled account ⇒ still READY). Regression
protection: before/after deep snapshots of every read store prove no mutation,
no serial change and no idempotency row (the service has no numbering/ledger/
bus dependency at all — structural), asserted in both the application suite
and the e2e journey.

## 9. Architecture audit

- **Bounded-context ownership intact**: everything lives in
  `modules/accounting`; `PostingReadinessService` is provided but NOT exported,
  so no cross-module consumption path exists (AR-07, ADR-0026).
- **No Prisma/Nest in the domain**: `domain/posting-readiness.ts` imports only
  `domain/*` types and pure functions (verified by its import list); the
  service follows the module's `application/ → data/` anatomy (AR-02/04/05).
- **No cross-module table access**: reads go through the Accounting module's
  own repositories only; the Document Foundation is untouched (no registry,
  numbering or configuration interaction — readiness never allocates).
- **No duplicate validation logic**: the balance/line rules are
  `checkVoucherLines` (one decision table), origin evidence is
  `checkOriginEvidence`, date containment is `dateOnlyRangeWithin`, account
  vocabulary is the guard's (narrowed and documented). The only new _rules_ are
  the readiness-specific state/scope predicates that had no prior owner.
- **No Document Foundation redesign**: zero changes outside the accounting
  module and its tests; the module wiring comment documents the boundary.
- **No architecture tests existed to extend** (the repo has no dedicated
  boundary-test suite); the domain-purity and layering claims above are
  verifiable from the import lists and are pinned by the suites' construction
  (the domain spec imports no Nest/Prisma artifacts).

## 10. Scope audit — what was deliberately NOT implemented

No Posting Engine, no ledger/journal/balance-projection/trial-balance/
financial-statement write, no posted state, no posting rules, no outbox, no
system-posting integration (Inventory/Sales/Purchasing), no dimensions, no
financial-area applicability, no approval workflow, no reopen/correction
mechanisms, no HTTP endpoint, no permission code, no frontend, no Redis, no
new dependency, no unrelated refactor, **no schema migration**.

## 11. Commit

One focused commit on `arena/01a0a8f3-vardena`:
`feat(accounting): add posting readiness contract` — Task 10.4's commits are
untouched (history-only base `e9823dd`; only additive working-tree changes
above it).

## 12. Pre-existing issues found, not fixed (out of scope, AG-03/AG-17)

1. `docs/modules.md`'s Accounting status line still reads "documents/posting
   contract-only (Tasks 10.2, 10.3)" — stale since Task 10.4 (its report
   lists no `modules.md` change). Flagged here rather than silently rewritten;
   the Task 10.5 bullet added in this change is accurate regardless.
2. Fiscal-year date edits have no document-reference guard yet (Task 10.2's
   documented §6.5 reading) — the readiness scope check is the defensive
   detector for the drift this can create; the guard itself belongs to the
   calendar/year-transition task.
3. `.vardena/project-context.md` staleness — already flagged by Task 10.4;
   unchanged.
