# Task 17 — Accounting Reporting Foundation

## Status

| Concern | Status |
| --- | --- |
| Task definition | **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** |
| Documentation task | **READY FOR REVIEW** — documentation only. |
| Implementation authorization | **NOT AUTHORIZED** until the [Implementation Gate](#7-implementation-gate) is met. |
| Production implementation / report availability | **NOT IMPLEMENTED**. |
| Acceptance / production readiness | **NOT CLAIMED**. |

This is a documentation-only task definition. It authorizes no production code,
Prisma/schema change, migration, controller, service, repository, permission,
endpoint, test, event, reporting infrastructure, frontend work, or report release.
`READY FOR REVIEW` above applies only to this documentation task. It is not a claim
that Task 17 implementation is ready, accepted, or production-ready.

## 1. Objective

Formally define the bounded Accounting contribution to future read-only reporting:
Accounting-owned reporting inputs and report surfaces for account-ledger-oriented
inquiry, trial balance, and balance-oriented account reporting, consumed through the
accepted Reporting architecture.

The definition records what the future Accounting implementation may provide **after
its gates are resolved**. It does not authorize a generic Report Builder, a generic
Reporting platform, statutory layouts, or report execution now.

## 2. Repository basis and current state

This task definition is grounded in the following repository records:

| Repository evidence | Task 17 consequence |
| --- | --- |
| [`docs/accounting/domain-contract.md` §19](../../accounting/domain-contract.md#19-reporting-boundary), especially `AC-D-30`, `AC-D-31`, and `AC-I-19` | Accounting reports read final accounting facts through Accounting-owned views; balances are rebuildable projections, never authority; statutory layouts remain gated. |
| [ADR-0009](../../adr/0009-reporting-views-raw-sql.md) and the accepted [`reporting-strategy.md`](../../reporting-strategy.md) | Preserve code-defined report definitions, module-owned views, parameterized SQL, backend authorization, whitelisted inputs, pagination/limits, read-only execution, and JSON/Excel/Print reuse. |
| [`docs/accounting/task-index.md`](../../accounting/task-index.md) §4 | Accounting reporting was recorded as a candidate blocked by **OQ-25** and **OQ-43** for layouts. This task formalizes that candidate without resolving either gate. |
| [ADR-0031](../../adr/0031-balance-projection.md) and Task 12 records | The existing turnover-only balance projection is derived from ledger entries, rebuildable, and limited to intra-fiscal-year derived opening/closing semantics. ADR-0031 remains **Proposed**. |
| [Task 14 implementation report](../../task-14-implementation-report.md) and [ADR-0032](../../adr/0032-accounting-period-close-enforcement.md) | Period-status enforcement exists in the current implementation record, but Task 14 is **READY FOR REVIEW — NOT ACCEPTED** and ADR-0032 remains **Proposed**. |
| [`docs/modules.md`](../../modules.md) and the current module tree | Accounting has ledger and balance-projection foundations; no `reporting` backend module is currently present. Existing balance endpoints are not a generic Reporting pipeline. |

No new ADR is created: this definition adopts the accepted Reporting architecture and
does not change an architectural boundary.

## 3. Source-of-truth and read-only rule

The following rules are mandatory for any later Task 17 implementation:

1. **Ledger is the Accounting truth for Task 17 reporting.** Immutable ledger entries
   are atomically materialized from final document lines; the domain contract describes
   final lines as the originating accounting fact. This task does not create a second
   truth or choose a different authority between those atomically related facts.
2. **Balance projections are derived and rebuildable.** They accelerate/report
   turnover semantics but never replace ledger authority. A reconciliation mismatch is
   a defect to surface and repair from ledger-derived facts, not a reason to edit the
   ledger through reporting.
3. **Reporting calculations must reconcile to ledger/projection semantics.** A
   report may not recompute Accounting from Sales, Inventory, or any operational
   module's data at read time.
4. **The reporting surface is read-only.** It must not mutate ledger entries,
   accounting documents, balance projections, periods, accounts, or any other
   Accounting state. A projection rebuild remains its existing explicit maintenance
   operation; it is not a report operation.
5. **Stored scope wins.** Organization, financial area, fiscal year, accounting
   period, account, voucher/line traceability, business date, and posting timestamp
   are read from the Accounting facts that already carry them. A report does not
   re-resolve a fiscal period from a date or reconstruct scope from another module.

## 4. Bounded future scope

### 4.1 Allowed Accounting reporting inputs

Future work may use only existing Accounting-owned facts and projections appropriate
to the approved report:

| Input | Permitted reporting role | Boundary that remains in force |
| --- | --- | --- |
| Immutable ledger entries | Account movement/ledger-oriented rows, exact debit/credit totals, voucher and line traceability. | Insert-only evidence; no report writes or mutates entries. |
| Accepted Task 12 balance projection and derived balance view semantics | Period turnover and derived intra-year opening/closing amounts; reconciliation against ledger aggregates. | Projection is rebuildable and turnover-only; no cross-year carry-forward, stored opening/closing, zero-row persistence, or speculative widening. |
| Fiscal year and accounting period | Stored fiscal/year/period filters and period sequence ordering. | Respect stored boundaries and current lifecycle semantics; do not invent adjustment/special-period policy. |
| Financial area and organization scope | Required organization and financial-area scoping for every result. | Financial area is not a second tenant or a company; per-user financial-area grants remain subject to OQ-40. |
| Account hierarchy / chart data | Account identity, code/title, parent/tree context where the existing chart projection authorizes it. | Do not invent account classifications, control-role mappings, temporary-account semantics, or statutory grouping. |
| Accounting-document metadata where traceability requires it | Voucher number, line number, description, origin, document date, posting timestamp, and other immutable ledger snapshots. | Metadata supports ledger traceability only; it is not permission to read operational source-module tables or recreate Accounting from them. |

### 4.2 Candidate report surfaces

The table distinguishes an available **semantic basis** from an approved report
layout. A semantic basis is not implementation authorization while the task gate is
blocked.

| Candidate surface | Semantics supported by current contracts/foundations | Layout or business meaning that remains blocked |
| --- | --- | --- |
| **Account Ledger / ledger-oriented reporting** | Immutable, organization-scoped ledger entries retain account, area, fiscal year, period, voucher, line, exact debit/credit, business date, and posting timestamp. An Accounting-owned read model can therefore be defined against ledger facts. | Journal/general/subsidiary/detail legal-book formats, statutory columns, captions, sequence/gap presentation policy, and any mandated layout remain subject to OQ-25 and OQ-43. |
| **Trial Balance** | Task 12 provides exact period debit/credit turnover and derived intra-year opening/closing semantics by organization, area, fiscal year, period, and account; ledger-vs-projection reconciliation exists. | A 4/6/8-column presentation is a layout, not a new model. Its approved meaning, account grouping/classification, captions, and statutory form remain blocked by OQ-25/OQ-43. Dense periods, cross-year opening carry, and comparative policy must not be inferred from the current projection. |
| **Balance-oriented account reporting** | Existing projection/derived-view semantics can support account-by-period turnover and balance inquiry that reconciles to ledger facts. | No branch, currency, detail-dimension, opening-balance, or account-classification expansion is authorized. Any report needing those semantics needs its owning decision and a separate approved scope. |
| **P&L, balance sheet, or other financial statements** | The domain contract identifies statements as future report candidates only. | **Not defined by Task 17.** No account classification, statement section, subtotal, caption, comparison policy, or Iranian statutory layout may be invented. These surfaces remain blocked by OQ-25 and OQ-43 and require explicit approved scope before implementation. |

### 4.3 What Accounting must provide to Reporting

Once the gate is open, Accounting's responsibility is limited to its own side of the
accepted architecture:

- define appropriately scoped, module-owned, versioned reporting views/read models
  over Accounting facts where a complex query requires them;
- document the source columns, exact Decimal semantics, allowable fixed filters and
  sort keys, scope predicates, and reconciliation expectation for each approved
  surface;
- add fixture-based view/read-model reconciliation tests to protect Accounting
  semantics; and
- make those sources consumable by the Reporting module's code-defined registry.

The Reporting module, when separately implemented and authorized, owns the shared
registry and execution pipeline. Task 17 must not create a generic Reporting module,
a report runner, a semantic-entity registry, or an alternative pipeline merely because
those facilities are absent today.

## 5. Accepted Reporting architecture boundary

Task 17 preserves, rather than redesigns, the accepted baseline in
[`docs/reporting-strategy.md`](../../reporting-strategy.md):

- report definitions are **code-defined**, versioned, typed, and testable;
- complex Accounting report sources are **Accounting-owned views** where
  appropriate; cross-module raw SQL, if ever needed, belongs only in the Reporting
  module and remains parameterized;
- values are bound parameters; user input can never select SQL identifiers, tables,
  columns, operators, or arbitrary SQL;
- filters and sort keys are allowlisted by a report definition;
- backend permission enforcement is mandatory for each report;
- pagination, page-size caps, row caps, timeouts, and asynchronous-heavy-report
  behavior follow the Reporting strategy;
- report execution is read-only, including the strategy's read-only connection
  posture; and
- one shared query pipeline is the future reuse point for JSON, Excel, and Print.

No exact future Task 17 report permission code is defined here. That identifier is
**REQUIRES OWNER CONFIRMATION** at implementation time and must follow the accepted
Reporting/module permission registry rather than be guessed in this brief.

## 6. Dependencies

### 6.1 Accounting foundations

| Dependency | Current repository status to preserve | Task 17 consequence |
| --- | --- | --- |
| Task 10.x Accounting foundation | Fiscal scope, chart, documents, posting contracts/orchestration, immutable ledger persistence, and their domain contract are present across Tasks 10.1–10.8. | Reuse stored Accounting facts and their existing organization/scope semantics; do not reconstruct a separate accounting model. |
| Task 11 — Accounting Configuration Foundation | **ACCEPTED 2026-09-22** in the Accounting task index. | Account/chart configuration is an existing foundation; Task 17 must not redefine its configuration semantics. |
| Task 12 — Balance Projection | **ACCEPTED WITH FOLLOW-UP 2026-09-23** in the Accounting task index; ADR-0031 is still **Proposed**. Its P1 real-PostgreSQL concurrency verification remains open. | Use the accepted projection only as a rebuildable derived input. The Task 12 P1 follow-up is separate and must not be absorbed into Task 17 scope or acceptance criteria. |
| Task 13 — Accounting Operational Freeze | **IN PROGRESS (self-review) — NOT Accepted** in the Accounting task index. | Preserve its recorded status; do not claim it is accepted or use Task 17 to close its follow-ups. |
| Task 14 — Accounting Period Close Foundation | **READY FOR REVIEW — NOT ACCEPTED**; ADR-0032 remains **Proposed**. | Reports must respect stored period/year boundaries and the current implementation state, but no Task 17 document may treat Task 14 as accepted. |

### 6.2 Architecture and product dependencies

| Dependency | Relevance to Task 17 | Gate posture |
| --- | --- | --- |
| ADR-0009 / Reporting Strategy | Accepted reporting architecture and pipeline boundary. | Existing architectural baseline; do not replace it. |
| ADR-0026 / Accounting domain contract §19 | Accounting ownership, reporting inputs, source-of-truth, view-first boundary. | Existing architectural baseline. |
| **OQ-25 — chart/report layout policy** | Required account/report layout, grouping/classification, control-role, and statutory-layout policy is not defined. | **Hard implementation gate. OPEN.** |
| **OQ-43 — Iranian statutory/legal reporting requirements** | Legal-book/statutory layouts, columns, language/currency and related legal requirements are not validated. | **Hard implementation gate. OPEN.** |
| OQ-40 — financial-area semantics/access grants | Core report results can carry stored area scope, but user-to-area authorization or area/multi-book policy cannot be invented. | Conditional gate if the requested scope needs area access grants, multi-area aggregation, or a policy beyond current organization scoping. |
| OQ-03 — currency and precision policy | Existing base-currency Decimal facts can be read exactly; currency reporting, conversion, revaluation, and multi-currency layouts are not authorized. | Conditional gate; no multi-currency report implementation under Task 17. |
| OQ-11 / OQ-23 — ledger/opening and fiscal-calendar policy | Current balance derivation is intra-year only and period/year facts are stored. Cross-year opening, special/adjustment-period, year-transition, or policy-dependent comparison semantics cannot be assumed. | Conditional gate for any requested scope that needs those semantics. |
| OQ-02 — localization | Report labels and print/display formatting are not an Accounting decision. | Conditional display/print gate; do not invent Persian/Jalali/statutory presentation. |
| OQ-49 — Report Builder MVP depth | The Report Builder decision is open and separate from code-defined reports. | Explicitly out of scope; neither resolved nor implemented by Task 17. |

No Open Question is resolved, reclassified, or given a fabricated interim answer by
this task definition.

## 7. Implementation Gate

**Task 17 is formally defined, but implementation remains blocked.** A future agent
must stop before production work unless all applicable conditions below are evidenced
on current `main` and recorded for the requested report scope:

1. **OQ-25** is resolved, or the owner has recorded an approved, bounded interim
   posture identifying which non-statutory layouts/surfaces are allowed and which
   remain excluded.
2. **OQ-43** is resolved, or an accountant/tax/legal owner has recorded an approved
   interim posture for the exact requested report scope. No statutory or Iranian legal
   layout may be inferred from historical notes or secondary-source discussion.
3. Task 14's review/acceptance state is re-read and respected. It must not be
   represented as accepted while its repository record says otherwise.
4. Any scope that needs financial-area grants, multi-currency, cross-year opening,
   adjustment-period, localization/printing, dimensions, or another deferred concept
   has its governing OQ/decision explicitly cleared. Otherwise that scope is excluded.
5. The future agent confirms that implementation is limited to Accounting's approved
   contribution and does not require an unapproved generic Reporting-module or
   Report-Builder implementation.

Task 12's independent P1 real-PostgreSQL concurrency verification remains a real
follow-up, but it is **not** an implementation deliverable or acceptance criterion of
Task 17. It must remain separately tracked exactly as Task 12 evidence requires.

## 8. Explicit non-goals

Task 17 does **not** authorize or implement:

- a Report Builder, semantic Report Builder entities, or resolution of OQ-49;
- user-defined SQL, arbitrary user SQL, a generic query builder, dynamic SQL
  identifiers, or user-controlled joins/expressions;
- Sales reporting, Inventory reporting, cross-module report ownership, or dashboards;
- taxpayer/statutory automation, statutory e-ledger export, or invented Iranian legal
  report layouts;
- multi-currency reporting, conversion, revaluation, or FX implementation unless an
  existing decision expressly authorizes it;
- accounting posting changes, ledger mutation, document mutation, or balance-projection
  redesign;
- a new Accounting source of truth, a non-rebuildable snapshot, or a reporting write
  model;
- cross-module table ownership violations or re-computation from operational module
  tables;
- EAV, a giant JSONB report-definition/data model, a universal rules/expression
  engine, or a universal document/report abstraction;
- microservices, a second database, unnecessary Redis/cache infrastructure, a new
  message broker, or a speculative reporting database; or
- frontend work, a dashboard engine, print/export implementation, or a generic
  Reporting platform when separately authorized work has not established it.

## 9. Future implementation acceptance criteria

The criteria below are for a later, gate-authorized implementation only. None has
been executed or passed by this documentation task.

### 9.1 Correctness

- An Account Ledger/ledger-oriented report reconciles each row and exact debit/credit
  total to immutable ledger entries in its requested scope.
- A Trial Balance or balance-oriented report reconciles to the accepted Task 12
  projection and ledger-reconciliation semantics, including the documented
  intra-fiscal-year opening/closing boundary.
- Debit and credit totals use exact Decimal/numeric semantics; no JavaScript floating
  point, epsilon, or silent rounding is introduced.
- Organization and financial-area scope is enforced; fiscal-year and accounting-period
  boundaries use stored scope facts.
- No result crosses organization boundaries, including through a foreign account,
  period, year, area, or report-source identifier.
- Any dense-period behavior, layout variant, account grouping, or statement semantics
  is present only where a cleared gate expressly authorizes it.

### 9.2 Security

- Each approved report's permission is enforced in the backend, with no frontend-only
  authorization claim.
- Unauthorized access is denied; foreign organization/account/period/area identifiers
  cannot bypass scope.
- Filters, sorts, grouping (if approved), and identifiers are parsed against a fixed
  definition whitelist; values are parameterized and arbitrary SQL is impossible.
- Reporting execution uses the accepted read-only posture and offers no mutation path.

### 9.3 Performance

- Pagination and page-size limits are enforced for report data.
- Row caps, query limits/timeouts, and any async-heavy-report escalation follow
  `docs/reporting-strategy.md` rather than creating Task 17-specific infrastructure.
- Heavy Accounting reports use the appropriate Accounting-owned projection/view or
  parameterized Reporting-layer query, not uncontrolled ORM joins that reconstruct
  Accounting facts.
- Query plans/index needs are measured against the documented dataset expectation and
  documented with the owning view/source if implementation is authorized.

### 9.4 Regression evidence

- Fixture-based report-source/view tests prove expected ledger/projection rows and
  reconciliation behavior.
- Permission-denial tests, organization-isolation tests, and foreign-id boundary tests
  exist for each approved report surface.
- Decimal/exactness and fiscal-boundary tests cover the actual report calculations.
- Pipeline-level tests cover allowed filters/sorts, pagination, limits, and injection
  resistance where the shared Reporting pipeline is part of the authorized scope.

### 9.5 Operational integrity

- Reporting APIs and report execution perform no Accounting mutation.
- No second accounting truth, non-rebuildable report snapshot, or operational-module
  accounting reconstruction is introduced.
- Report definitions remain code-defined and reviewable under the accepted Reporting
  architecture.
- The implementation report clearly separates executed evidence from inherited Task
  12/13/14 evidence and does not claim acceptance for another task.

## 10. Future implementation handoff

The future implementation instruction is [`prompt.md`](./prompt.md). It requires the
agent to re-read current `main`, verify the gates above, stop when they are unresolved,
work only within the approved Accounting reporting scope, run the applicable quality
checks, produce an implementation report, and request review rather than self-accept.

## 11. Documentation-task verification basis

This formalization was derived by static repository inspection of `STATE.md`, the
Accounting task index and domain contract, `docs/reporting-strategy.md`, the product
roadmap/execution report, OQ-49, ADR-0009 and current Accounting ADRs, `docs/modules.md`,
Task 12/14 evidence, and the current Accounting module/source/schema inventory.

Only documentation files are changed by this task definition. No production behavior,
Open Question status, ADR status, schema, migration, test, or implementation evidence
is changed or claimed.
