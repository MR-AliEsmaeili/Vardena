# Task 17 — Future Implementation Prompt

## Status and authorization

**Task definition: FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS**

**Documentation task: READY FOR REVIEW only**

This file is a future implementation handoff, **not** authorization to implement now.
The governing contract is [`brief.md`](./brief.md). Do not treat this prompt, a green
CI run, a merge, or a roadmap proposal as resolution of an Open Question or as product
approval.

## Mandatory preflight — re-read current `main`

Before changing any production file, schema, migration, test, or implementation
record, re-read current `main` and inspect at least:

- `STATE.md`;
- `docs/accounting/task-index.md` and `docs/accounting/domain-contract.md`;
- `docs/reporting-strategy.md` and [ADR-0009](../../adr/0009-reporting-views-raw-sql.md);
- [ADR-0026](../../adr/0026-accounting-bounded-context.md),
  [ADR-0031](../../adr/0031-balance-projection.md), and
  [ADR-0032](../../adr/0032-accounting-period-close-enforcement.md);
- Task 12 and Task 14 implementation/evidence records;
- `docs/modules.md`, `docs/open-questions.md`, the applicable product decision
  records, and the current Accounting implementation;
- this task's [`brief.md`](./brief.md).

Verify the actual status of all dependencies instead of copying a historical status
from this prompt. In particular:

- Task 12 is recorded as **ACCEPTED WITH FOLLOW-UP**, and its P1 real-PostgreSQL
  concurrency verification remains a separate follow-up. Do not absorb, close, or
  claim that follow-up through Task 17.
- Task 13 must not be represented as accepted unless current repository evidence says
  so.
- Task 14 must not be represented as accepted while its record says **READY FOR
  REVIEW — NOT ACCEPTED**. Respect its current review state and period-boundary
  semantics.
- ADR-0031 and ADR-0032 must not be silently promoted from their recorded status.

## Stop conditions — do not implement if any applies

**STOP and request the missing owner/reviewer decision before implementation** when:

1. OQ-25 is still open and no explicit, approved interim posture identifies the
   allowed report layouts/surfaces;
2. OQ-43 is still open and no accountant/tax/legal-approved interim posture covers the
   exact requested reporting scope;
3. the requested scope needs a deferred policy that is still open, including
   financial-area access/multi-area semantics (OQ-40), currency/FX (OQ-03),
   opening/carry-forward or calendar policy (OQ-11/OQ-23), localization/print layout
   (OQ-02), dimensions, or any statutory statement requirement;
4. the work would require creating a generic Reporting module/pipeline, Report Builder,
   semantic-entity registry, or dashboard engine that has not been separately approved;
5. a required dependency's current review/acceptance status conflicts with the
   implementation assumption; or
6. the owner has not authorized the exact report set after the above gates are cleared.

When stopped, make **no production changes**. Record the evidence, the blocking gate,
and the narrow decision needed; do not invent a temporary business rule or change an
Open Question's status.

## Authorized implementation direction after every gate is cleared

Implement only the explicitly approved Accounting Reporting scope. Follow
[`docs/reporting-strategy.md`](../../reporting-strategy.md) and ADR-0009 exactly:

1. Keep report definitions code-defined, typed, versioned, and reviewable.
2. Provide only Accounting-owned report sources/read models/views needed for the
   approved Account Ledger, Trial Balance, or balance-oriented surface. Use
   module-owned views for complex Accounting queries; do not force uncontrolled ORM
   joins.
3. If the shared Reporting pipeline does not yet exist, do **not** create a generic
   Reporting platform as incidental work. Implement only the authorized Accounting
   contribution, or stop and request the separately scoped Reporting task needed to
   execute it.
4. Read only immutable Accounting ledger facts, accepted balance-projection semantics,
   stored fiscal year/period and financial-area scope, account hierarchy, and immutable
   document metadata where traceability needs it. Do not query Sales, Inventory, or
   other operational tables to recompute Accounting.
5. Treat the immutable ledger as Accounting reporting truth and balance projections as
   derived/rebuildable inputs. Reconcile report semantics to ledger/projection facts;
   never introduce a second truth or a report-maintained accounting snapshot.
6. Keep every report path read-only. Do not mutate ledger entries, documents, accounts,
   periods, projections, or rebuild state through a reporting API.
7. Use exact Decimal/numeric semantics for debit, credit, turnover, opening, and
   closing values. Do not use JavaScript floating point or invent rounding.
8. Enforce organization and approved financial-area scope in the backend. Foreign
   organization, account, fiscal-year, period, or area identifiers must not bypass the
   scope boundary.
9. Give every approved report a backend-enforced permission. Derive the exact
   permission code from the accepted registry/module convention at implementation time;
   do not invent an unapproved wildcard or role bypass.
10. Allow only definition-whitelisted filters, sort keys, and (where separately
    authorized) grouping. Bind all values as SQL parameters; user input must never
    control a SQL identifier, SQL fragment, table, column, join, or expression.
11. Apply the Reporting strategy's pagination, page-size caps, row caps, timeouts,
    read-only execution posture, and async-heavy-report behavior. Reuse the future
    shared JSON/Excel/Print pipeline rather than duplicating export or print logic.

## Report-surface boundary

- **Account Ledger / ledger-oriented inquiry:** only approved ledger semantics and
  approved layout fields; do not assume a statutory journal/general/subsidiary/detail
  format.
- **Trial Balance / balance-oriented inquiry:** respect Task 12's turnover-only,
  intra-fiscal-year derived-opening/closing behavior. Do not silently synthesize
  cross-year opening balances, zero rows, branch/currency/dimension keys, account
  classifications, or a 4/6/8-column statutory layout.
- **P&L, balance sheet, or other financial statements:** do not implement unless the
  owner has separately cleared the exact account classification, layout, business
  meaning, and OQ-25/OQ-43 posture. This task definition does not supply them.

## Explicit prohibitions

Do not add or implement:

- Report Builder functionality, OQ-49 resolution, user-defined report definitions,
  user SQL, arbitrary SQL, a generic query builder, expressions, pivots, or semantic
  Report Builder entities;
- Sales reports, Inventory reports, cross-module reports, dashboards, dashboard
  engines, taxpayer/statutory automation, or statutory/e-ledger exports;
- multi-currency/FX/revaluation behavior without an explicit current authorization;
- posting changes, ledger mutation, balance-projection redesign, a new accounting
  source of truth, or a non-rebuildable reporting snapshot;
- EAV, giant JSONB report definitions, microservices, a second database, Redis without
  an approved need, a new message broker, or a speculative reporting database; or
- unrelated refactors, schema changes, migrations, frontend work, or status changes to
  Open Questions/ADRs/tasks outside the approved implementation scope.

## Required test and evidence plan

For every approved report source/surface, add and run the applicable evidence:

- fixture-based module-view/read-model tests proving ledger and balance-projection
  reconciliation;
- exact Decimal/debit-credit and fiscal year/period boundary tests;
- permission-denial and organization/foreign-identifier isolation tests;
- filter/sort whitelist, parameterization/injection-resistance, pagination, page-size,
  row-cap, and timeout/async-threshold tests for any authorized pipeline path;
- regression coverage showing no mutation occurs through report execution; and
- performance/query-plan evidence appropriate to the documented report dataset and
  source view.

Run the repository's applicable quality gates, at minimum the current backend
formatting, lint, typecheck, unit-test, build, Prisma validation, and relevant
integration/live-PostgreSQL gates where the implementation scope requires them. Record
commands, environment constraints, and actual results; do not relabel inherited Task
12/13/14 evidence as newly executed Task 17 evidence.

## Completion and review handoff

After a gate-authorized implementation:

1. update only the documentation required by the approved change, including
   `docs/modules.md` when actual module behavior changes;
2. write an implementation report identifying the approved scope, gate evidence,
   source-of-truth/reconciliation behavior, permissions, tests actually run, known
   limitations, and every intentionally deferred item;
3. update the Accounting task index and `STATE.md` only with evidence-backed status
   facts, without changing OQ or ADR status unless an authorized decision record does
   so; and
4. open a review request.

**Request review; do not self-accept.** The only official review outcomes are
`ACCEPTED` and `CHANGES REQUIRED`. `READY FOR REVIEW`, CI success, and an agent report
are not acceptance or production readiness.
