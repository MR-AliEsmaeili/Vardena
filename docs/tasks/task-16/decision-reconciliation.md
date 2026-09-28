# Task 16 — Decision Reconciliation

## Status and purpose

- **Owner Direction:** Established by the Task 16 contract-finalization request.
- **Accounting Foundations:** Existing, verified by static inspection of the current repository.
- **Task 16 Contract:** Formalized in [`brief.md`](./brief.md).
- **Production Implementation:** **NOT YET AUTHORIZED**.
- **Production readiness / acceptance:** Not claimed.

This record reconciles the established Owner directions with repository evidence. It
is a documentation record, not an implementation approval and not a substitute for
runtime verification. The inspection baseline is the current checkout at `HEAD`
(`0b45e34`, the checked-out `main` baseline); no production source, Prisma schema or
migration is changed by this task.

The Owner directions below are treated as explicit inputs and are **not re-asked**.
A classification of `OWNER-DECIDED / NOT YET FORMALIZED` means that the direction
was supplied by the Owner but was not a settled repository contract before this
change; the brief now records it for the implementation handoff.

## Classification key

| Classification                       | Meaning in this record                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPOSITORY-CONFIRMED`               | The repository already has a directly applicable contract, mechanism, or invariant. This does not mean Task 16 is implemented.                                                      |
| `OWNER-DECIDED / NOT YET FORMALIZED` | The Owner direction is binding for Task 16 but was not previously recorded as a Task 16 contract.                                                                                   |
| `CONFLICT`                           | The current repository vocabulary or capability does not provide what the direction requires, or contains a directly incompatible boundary. The direction is not silently weakened. |
| `REQUIRES ADR`                       | An implementation would cross an ADR-gated architectural boundary. No new ADR is created by this documentation-only task.                                                           |
| `REQUIRES OWNER CONFIRMATION`        | A genuine essential input is absent from both the repository and the established Owner directions. This is not used for any direction explicitly settled above.                     |
| `OUT OF SCOPE`                       | Explicitly excluded from Task 16; it must not be added as incidental work.                                                                                                          |

## Repository evidence register

The following are repository facts used in the matrix. They are separated from the
Owner directions so that existing implementation is not overstated.

1. **Architecture and ADR location.** The repository is a Modular Monolith under
   `backend/src/modules/`; AR-01 and ADR-0001 reject microservices. ADR governance
   says that `docs/adr/` is canonical, numbering is sequential, and a routine table
   or endpoint inside an existing module does not itself require a new ADR:
   [`agent-rules.md`](../../../.vardena/agent-rules.md),
   [`architecture-rules.md`](../../../.vardena/architecture-rules.md),
   [`docs/adr/README.md`](../../adr/README.md).
2. **Accounting boundary.** The Accounting contract owns accounting documents,
   posting, ledger facts and corrections; it rejects a universal document engine,
   generic rules engine, EAV/JSONB ledger abstractions and microservices. It also
   defers multi-currency and cost-allocation engines:
   [`domain-contract.md` §1](../../accounting/domain-contract.md#1-objective-and-non-goals),
   [`domain-contract.md` §3](../../accounting/domain-contract.md#3-bounded-context),
   [`domain-contract.md` §24](../../accounting/domain-contract.md#24-deferred-boundaries-must-remain-possible).
3. **Organization isolation.** The Accounting contract requires `organization_id`
   on Accounting rows, organization-scoped reads and service checks; cross-scope
   references answer as not-found. The schema gives Accounting documents and posting
   operations organization FKs with `ON DELETE RESTRICT`:
   [`domain-contract.md` §4](../../accounting/domain-contract.md#4-organization-scope-and-the-security-posture-accounting-inherits),
   [`ADR-0021`](../../adr/0021-organization-scoped-master-data.md),
   `backend/prisma/schema/accounting.prisma`.
4. **Document identity and relations.** Documents are typed, module-owned tables;
   there is no universal `documents` table. The Documents Foundation represents
   cross-module endpoints as logical `(module, document type, document id[, line])`
   references. Its closed relation kinds include `settle`, but only `fulfill` is
   currently quantity-aware; the generic relation row has no allocation amount or
   cumulative remaining amount:
   [`ADR-0019`](../../adr/0019-document-foundation-and-relations.md),
   `backend/src/modules/documents/domain/document-relation.ts`,
   `backend/prisma/schema/documents.prisma`.
5. **Current Accounting document lifecycle.** Accounting storage uses
   `draft | temporary | final`; the domain contract explicitly has no `void` state.
   A finalized document is protected from direct edit/delete. Reversal is additive:
   a new final counter-document is created, the original remains final, and typed
   reversal links/reason/operation-key handling exist in the current Task 15 code
   and migration. This is a repository fact about Accounting documents, not an
   allocation implementation:
   `backend/src/modules/accounting/domain/accounting-document.ts`,
   `backend/src/modules/accounting/domain/document-reversal.ts`,
   `backend/src/modules/accounting/data/accounting-documents.repository.ts`,
   `backend/prisma/schema/accounting.prisma`,
   `backend/prisma/migrations/20260923000000_accounting_document_reversal/migration.sql`.
6. **Decimal handling and currency boundary.** Accounting money uses exact decimal
   strings/BigInt arithmetic and `numeric(18,2)` storage; zero/negative accounting
   line rules are domain-enforced. The current Accounting schema has no currency
   identity or FX columns. Currency and FX policy remain deferred under OQ-03; the
   contract describes a single base-currency assumption and an additive future seam:
   `backend/src/modules/accounting/domain/money.ts`,
   `backend/prisma/schema/accounting.prisma`,
   [`domain-contract.md` §13.6](../../accounting/domain-contract.md#136-currency),
   [`domain-contract.md` §24.1](../../accounting/domain-contract.md#241-multi-currency-deferred--oq-03),
   [`docs/open-questions.md`](../../open-questions.md).
7. **Existing idempotency.** `AccountingPostingOperation` is unique on
   `(organization_id, operation_key)`, stores a canonical request hash and result,
   is inserted last in the same effect transaction, and the service replays equal
   intent or returns conflict for a different intent. The same operation-key/hash
   posture is also used by document numbering and reversal:
   `backend/prisma/schema/accounting.prisma`,
   `backend/src/modules/accounting/data/accounting-posting-operations.repository.ts`,
   `backend/src/modules/accounting/application/posting.service.ts`,
   `backend/src/modules/accounting/application/accounting-document-support.ts`.
8. **Existing atomicity and locking.** Accounting writes use application-owned
   Prisma transactions and parameterized PostgreSQL row locks. The documented order
   is `financial_area → fiscal_year → accounting_period → configuration → accounts
→ balance projections → accounting document`; finalization re-validates under
   locks and writes document state, immutable ledger entries, projections and the
   operation row as one unit:
   [`lock-order-matrix.md`](../../accounting/lock-order-matrix.md),
   `backend/src/modules/accounting/data/accounting-locks.ts`,
   `backend/src/modules/accounting/data/accounting-documents.repository.ts`.
9. **Existing permissions.** Accounting uses granular `Accounting.*` permissions,
   including `Accounting.Document.View`, `.Create`, `.Finalize` and `.Reverse`, and
   performs route/application authorization rather than wildcard or admin bypass:
   `backend/src/modules/accounting/domain/accounting-permissions.ts`,
   `backend/src/modules/accounting/application/accounting-documents.service.ts`,
   `backend/src/modules/rbac/application/authorization.guard.ts`,
   `backend/src/modules/rbac/application/authorization.service.ts`,
   [`ADR-0016`](../../adr/0016-rbac-enforcement-and-evaluation.md).
10. **Existing audit/history posture.** The repository has append-only workflow
    transition history written in the same transaction as workflow state changes,
    and Accounting preserves actor/timestamp/correlation/finalization evidence on
    business rows. The documented Audit module is not present in the inspected
    `app.module.ts`/Prisma schema, and the current kernel event bus is in-memory;
    it describes a future persisted audit/event seam. Task 16 must not invent a
    parallel audit system:
    `backend/prisma/schema/workflow.prisma`,
    `backend/src/kernel/events/domain-event-bus.ts`,
    `backend/src/app.module.ts`,
    [`docs/modules.md` Audit section](../../modules.md#audit-v1-core),
    [`architecture.md` §5](../../architecture.md#5-cross-module-communication-ar-07).
11. **Real PostgreSQL testing.** Live suites are opt-in through
    `VARDENA_TEST_DATABASE_URL` and use PostgreSQL; existing repository records
    distinguish live PostgreSQL from in-memory/PGlite tests. Task 12 still records
    a real-PostgreSQL concurrency follow-up, while Accounting document/period
    suites demonstrate the repository's required live-test shape:
    `backend/vitest.config.e2e.ts`,
    `backend/test/accounting-documents-live.e2e-spec.ts`,
    `backend/test/accounting-period-lifecycle-live.e2e-spec.ts`,
    [`task-index.md` §8](../../accounting/task-index.md#8-current-follow-ups-findings-not-the-next-task).

## Decision matrix

### Core behavior

| ID          | Decision                                                                                                                                                             | Current repository evidence                                                                                                                                                                   | Classification                       | Consequence for Task 16                                                                                                                                                                                                                                                                                                                                                    | Required documentation action                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T16-01      | Source and Target documents must belong to the same Organization.                                                                                                    | Organization-scoped Accounting rows and service-level same-scope checks are established. Generic document relation endpoints are logical and do not prove endpoint ownership by themselves.   | `REPOSITORY-CONFIRMED`               | Resolve both endpoints through their owning service in the requested organization; reject a cross-organization pair and do not rely on a logical reference or FK alone.                                                                                                                                                                                                    | Formalized as a Task 16 invariant in [`brief.md`](./brief.md); implementation must record the owning-document validation path.                                                                                         |
| T16-02      | Reversed documents are not allocatable.                                                                                                                              | Reversal is represented by an additive counter-document and a reversal link; finalized Accounting documents remain immutable. Allocation eligibility does not yet exist.                      | `OWNER-DECIDED / NOT YET FORMALIZED` | Reject a reversed document as either endpoint before any amount is consumed. Do not mutate the original or use the reversal as an implicit allocation correction.                                                                                                                                                                                                          | Formalized in the brief's document-state and eligibility sections.                                                                                                                                                     |
| T16-03      | Voided documents are not allocatable where a supported document contract has a void state.                                                                           | Accounting's current contract explicitly has no `void` state and no `initial`/`deleted` business state. A future supported document type may have its own terminal void/cancel state.         | `CONFLICT`                           | Do not invent a `void` state in Accounting. Treat any repository-supported void/cancel terminal state as non-allocatable; for current Accounting vouchers, use the established reversal/final lifecycle instead.                                                                                                                                                           | Formalized with an explicit no-new-state rule in the brief; any new lifecycle state requires its owning contract/ADR, not a Task 16 shortcut.                                                                          |
| T16-04      | Allocation amount must be positive.                                                                                                                                  | The generic Documents `fulfill` quantity validator is positive, and Accounting rejects zero-value/negative line amounts, but no allocation amount exists.                                     | `OWNER-DECIDED / NOT YET FORMALIZED` | Validate exact Decimal input as strictly greater than zero before locking or writing.                                                                                                                                                                                                                                                                                      | Formalized in the brief; future tests must cover zero, negative and malformed/over-precision inputs.                                                                                                                   |
| T16-05      | Allocation amount must not exceed the currently allocatable amount.                                                                                                  | No allocation aggregate, allocatable counter or settlement balance exists in the current schema. Existing balance projections are Accounting ledger projections, not settlement availability. | `OWNER-DECIDED / NOT YET FORMALIZED` | Re-read the current eligibility and remaining amount under the allocation transaction's locks; reject without any partial write when insufficient.                                                                                                                                                                                                                         | Formalized as an atomic invariant and acceptance criterion; the implementation must not derive it from unrelated ledger balances.                                                                                      |
| T16-06      | Partial allocation is supported.                                                                                                                                     | The Document Foundation explicitly supports partial quantity-aware fulfilment, but its `settle` relation is not amount-aware and does not provide settlement remaining state.                 | `OWNER-DECIDED / NOT YET FORMALIZED` | One allocation may consume less than the currently allocatable amount; the unconsumed amount stays available.                                                                                                                                                                                                                                                              | Formalized in the brief; do not overload `DocumentRelation.quantity` or `fulfill` semantics without an approved contract.                                                                                              |
| T16-07      | Multiple allocations against the same Source or Target are supported.                                                                                                | The generic relation model is append-oriented, but it has no allocation-specific cumulative state or concurrency guard.                                                                       | `OWNER-DECIDED / NOT YET FORMALIZED` | Preserve each accepted allocation as a separate historical record and calculate the current remaining amount from the allocation-owned facts/contract.                                                                                                                                                                                                                     | Formalized in the brief; implementation must add no “one allocation per document” uniqueness rule.                                                                                                                     |
| T16-08      | Conceptually maintain `allocatableAmount`, `allocatedAmount` and `remainingAmount`.                                                                                  | Accounting has exact Decimal money and rebuildable projections, but no settlement amount model. The existing projection is not a source of settlement truth.                                  | `OWNER-DECIDED / NOT YET FORMALIZED` | The contract exposes these concepts without prescribing a new universal balance engine. `allocatableAmount` is the eligible amount made available by the supported document contract; `allocatedAmount` is the cumulative accepted amount for that endpoint; `remainingAmount` is the amount still available. Values must be exact Decimal and non-negative at acceptance. | Formalized in the brief; the implementation must document the source amount and whether a compensation increases availability rather than mutating history.                                                            |
| T16-09      | Source → Target is directional.                                                                                                                                      | Documents Foundation already models distinct source and target logical endpoints; ADR-0019 defines controlled source/target document relations.                                               | `REPOSITORY-CONFIRMED`               | Preserve endpoint order in identity, reads, idempotency payloads and audit; reversing the endpoints is a different intent.                                                                                                                                                                                                                                                 | Formalized in the brief and reconciliation matrix; do not model allocation as an undirected pair.                                                                                                                      |
| T16-10      | Source and Target currency must be compatible.                                                                                                                       | Currency/FX is explicitly deferred in Accounting, no current Accounting document currency column is present, and OQ-03 remains open.                                                          | `CONFLICT`                           | Enforce compatibility using the supported document contract's authority; fail closed when compatibility cannot be resolved. Do not infer a stricter currency-code predicate from numeric storage or organization alone.                                                                                                                                                    | Keep this as a visible implementation gate in the brief. An implementation that adds currency fields, cross-module currency ownership, or a new conversion boundary requires an ADR and must not silently close OQ-03. |
| T16-11      | FX conversion is outside Task 16.                                                                                                                                    | Accounting §24.1 defers currency conversion, exchange-rate tables and revaluation; current schema has no FX model.                                                                            | `REPOSITORY-CONFIRMED`               | Compare compatible currencies only; no rates, rounding, gain/loss, revaluation, or conversion columns/engine.                                                                                                                                                                                                                                                              | Formalized in the brief's exclusions and currency contract.                                                                                                                                                            |
| T16-12      | Allocation must be atomic.                                                                                                                                           | Accounting AC-D-23 already requires one locked transaction for financial effects and idempotency evidence; repository methods use Prisma `$transaction`.                                      | `REPOSITORY-CONFIRMED`               | The allocation record, all affected allocation state, idempotency evidence and audit facts commit together or roll back together.                                                                                                                                                                                                                                          | Formalized in the brief; implementation must reuse the existing application/data transaction pattern.                                                                                                                  |
| T16-13      | Idempotency is required using `operationKey`.                                                                                                                        | `AccountingPostingOperation` and Document Foundation numbering already use caller keys, organization scope and canonical intent hashes.                                                       | `REPOSITORY-CONFIRMED`               | Use the existing organization-scoped operation-key/hash pattern; do not create a second key namespace with different replay rules.                                                                                                                                                                                                                                         | Formalized in the brief; implementation must identify the allocation operation kind and canonical payload.                                                                                                             |
| T16-14      | Same `operationKey` plus same payload is an idempotent replay.                                                                                                       | PostingService re-reads the stored result for equal operation/hash and does not repeat the effect.                                                                                            | `REPOSITORY-CONFIRMED`               | Return the recorded/current allocation result without a second allocation record or second consumption of remaining amount.                                                                                                                                                                                                                                                | Formalized in the brief and required as a future unit and live behavior test.                                                                                                                                          |
| T16-15      | Reusing an `operationKey` with a different payload is a conflict.                                                                                                    | Existing Accounting replay-or-reject returns conflict for a different operation or request hash and applies nothing.                                                                          | `REPOSITORY-CONFIRMED`               | Return conflict and leave allocation, remaining state, history and audit unchanged.                                                                                                                                                                                                                                                                                        | Formalized in the brief; use the established conflict posture rather than inventing overwrite semantics.                                                                                                               |
| T16-16      | A recorded allocation must not be directly edited.                                                                                                                   | AR-13 and Accounting final/ledger contracts structurally protect posted facts; current reversal code is additive.                                                                             | `REPOSITORY-CONFIRMED`               | No update operation for a completed allocation; a correction is a new record.                                                                                                                                                                                                                                                                                              | Formalized in the brief and permission/non-mutation acceptance criteria.                                                                                                                                               |
| T16-17      | A recorded allocation must not be directly deleted.                                                                                                                  | Accounting final documents/ledger entries are non-deletable and use `RESTRICT`/unique backstops; generic DocumentRelation deletion is not an acceptable precedent for a financial allocation. | `OWNER-DECIDED / NOT YET FORMALIZED` | No delete endpoint/repository path for completed allocations; preserve the historical row.                                                                                                                                                                                                                                                                                 | Formalized in the brief; the generic relation delete path must not be reused for the financial allocation fact.                                                                                                        |
| T16-18      | Corrections use a compensating/reversal mechanism, not historical mutation.                                                                                          | Accounting contract AC-D-22 and current Task 15 reversal create a new counter-document, keep the original final and require a reason/permission.                                              | `REPOSITORY-CONFIRMED`               | Allocation correction is additive and linked to the original; it must not edit/delete the original allocation.                                                                                                                                                                                                                                                             | Formalized in the brief; the implementation must define the narrow allocation reversal link/operation without building a universal correction engine.                                                                  |
| T16-19      | Appropriate Create / Read permissions are required.                                                                                                                  | Granular RBAC, route plus application checks, and Accounting `Document.View/Create` are established. No Task 16 permission codes exist.                                                       | `REPOSITORY-CONFIRMED`               | Register only the allocation permissions actually enforced, following `Accounting.<Entity>.{View,Create}`; deny by default and test both layers.                                                                                                                                                                                                                           | Formalized in the brief; exact codes belong to the implementation's owning module registry, not a parallel RBAC system.                                                                                                |
| T16-20      | If reversal is supported, reversal requires an explicit permission boundary.                                                                                         | Current Accounting has `Accounting.Document.Reverse`; correction permissions are explicitly separate from ordinary document actions.                                                          | `REPOSITORY-CONFIRMED`               | A compensation/reversal use case must require a distinct permission from Create/Read and must not be reachable by ordinary allocation creation.                                                                                                                                                                                                                            | Formalized in the brief; implementation must register/enforce the narrow reversal permission.                                                                                                                          |
| T16-21      | Real PostgreSQL concurrency testing is required.                                                                                                                     | Live suites use opt-in PostgreSQL; repository governance distinguishes real PostgreSQL from in-memory/PGlite evidence and records a prior real-PG concurrency follow-up.                      | `REPOSITORY-CONFIRMED`               | The implementation task must add/execute independent-connection PostgreSQL tests for allocation races; unit, mock or PGlite tests alone do not close this requirement.                                                                                                                                                                                                     | Formalized in the brief's validation gate; this documentation task intentionally does not run the live suite.                                                                                                          |
| T16-22      | Concurrent requests must not over-allocate.                                                                                                                          | Existing Accounting uses locked-row validation, fixed lock order and unique backstops, but no allocation rows or remaining counter exist.                                                     | `OWNER-DECIDED / NOT YET FORMALIZED` | Lock all affected source/target amount authorities in a deterministic order, re-read remaining amounts under lock, and make the insufficient-remaining path rollback-only.                                                                                                                                                                                                 | Formalized in the brief and required in the future PostgreSQL race matrix.                                                                                                                                             |
| T16-23      | Task 16 is a bounded Accounting Settlement / Allocation foundation.                                                                                                  | ADR-0026 and the Accounting domain contract define a bounded Accounting context and reject universal engines. Task 16 was not previously in the authoritative task index.                     | `OWNER-DECIDED / NOT YET FORMALIZED` | Add only the allocation aggregate/use cases required for these invariants; no future-module framework, generic rule language or cross-module table access.                                                                                                                                                                                                                 | Formalized in the brief and task index; production implementation remains unauthorized.                                                                                                                                |
| T16-GATE-01 | The implementation must identify the supported document-type allow-list and each owning amount/currency authority before production implementation.                  | No current repository contract names an allocatable document type or settlement amount; current Accounting vouchers expose debit/credit lines, not a settlement amount.                       | `REQUIRES OWNER CONFIRMATION`        | Record the narrow allow-list and authority without reopening any established allocation rule; fail closed until it exists.                                                                                                                                                                                                                                                 | Remains an explicit gate in the brief and implementation handoff; no fake global OQ was created.                                                                                                                       |
| T16-GATE-02 | An implementation that changes module boundaries, currency ownership, communication, lifecycle or deployment topology requires an ADR before or with implementation. | ADR README/AR-29 define these architecture gates; `docs/adr/` is canonical.                                                                                                                   | `REQUIRES ADR`                       | Do not introduce a parallel architecture silently. A bounded in-module allocation vertical slice does not require a new ADR by itself.                                                                                                                                                                                                                                     | Formalized in the brief and this reconciliation; no ADR created by this documentation task.                                                                                                                            |

### Inferred-rule review: self-allocation

The repository contains a concrete **generic DocumentRelation** self-reference rule:
`planRelation` returns `self_reference` in
`backend/src/modules/documents/domain/document-relation.ts`, with unit coverage in
`backend/src/modules/documents/domain/document-relation.spec.ts` and HTTP coverage in
`backend/test/documents.e2e-spec.ts`. ADR-0019 supports that generic relation
semantics.

That evidence does **not** establish a Task 16 allocation invariant. The Task 16
brief explicitly distinguishes a financial allocation from the generic
`documents.document_relations` `settle`/`fulfill` mechanisms, and the repository has
no allocation/settlement aggregate, schema constraint, amount authority or allocation
test. The self-allocation sentence was therefore removed from the mandatory Task 16
contract rather than promoted to an Owner decision.

**Self-allocation classification:** removed as unsupported from the mandatory contract.
If a later implementation proposes to reject self-allocation specifically for the
financial allocation aggregate, it requires explicit Owner confirmation; the generic
DocumentRelation rule must not be silently reused as proof.

### Targeted review of other inferred rules

- **Supported document types, amount source and currency source:** remain an explicit
  `REQUIRES OWNER CONFIRMATION` implementation gate. No allow-list is invented.
- **Currency compatibility:** the established Owner decision remains intact, but the
  unsupported “same currency identity” predicate was removed. The supported document
  contract must supply the compatibility authority; FX remains out of scope.
- **Document states:** reversed and supported voided/cancelled documents remain
  non-allocatable per Owner direction. A default draft/temporary/inactive exclusion
  was removed because allocation eligibility for those states is not established by
  the current repository contract.
- **Correction semantics:** immutable history and compensating/reversal correction
  remain intact. Exact reversal amount/endpoint representation is left to the
  supported correction and amount authority rather than invented here.
- **Locks, permissions, atomicity, idempotency, audit evidence and PostgreSQL
  verification:** remain as repository-aligned implementation constraints and
  established Owner directions; no new business rule was added.

### Scope exclusions

| Exclusion                                        | Current repository evidence                                                                                      | Classification | Consequence / required action                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| FX conversion                                    | Accounting multi-currency and exchange-rate behavior is deferred under OQ-03.                                    | `OUT OF SCOPE` | No rate lookup, conversion, revaluation or FX gain/loss.                            |
| AR/AP implementation                             | The repository has no AR/AP module or approved Task 16 contract for it.                                          | `OUT OF SCOPE` | Do not implement receivables/payables subledgers, aging, statements or collections. |
| Treasury implementation                          | No Treasury module or approved Task 16 contract is present.                                                      | `OUT OF SCOPE` | Do not implement cash/bank/payment/treasury workflows.                              |
| Sales/Purchase implementation                    | These operational modules are not an approved Task 16 dependency.                                                | `OUT OF SCOPE` | Do not add invoices, orders, purchasing or sales document flows.                    |
| Frontend implementation                          | No frontend is present in the inspected repository; frontend is architecturally separate.                        | `OUT OF SCOPE` | No UI, client package or frontend API work.                                         |
| Generic universal settlement engine              | ADR-0026 and the Accounting contract reject universal abstractions.                                              | `OUT OF SCOPE` | Keep the model narrowly owned by the Accounting settlement/allocation slice.        |
| Workflow/rules engine                            | ADR-0018/0024 provide a bounded workflow foundation and reject a general rules engine.                           | `OUT OF SCOPE` | No allocation rules language, scripting, approval engine or new state machine.      |
| Universal document abstraction                   | ADR-0019 requires typed module-owned tables and rejects a universal `documents`/JSONB model.                     | `OUT OF SCOPE` | Reuse logical endpoint identity; do not create a universal document table.          |
| Unnecessary JSONB/EAV abstractions               | Existing Accounting explicitly rejects EAV/JSONB for typed accounting facts.                                     | `OUT OF SCOPE` | Use typed, narrow fields and existing Decimal handling only.                        |
| Microservices, Redis or event-bus infrastructure | AR-01/ADR-0001 require the Modular Monolith; existing event/outbox seams are not a reason to add infrastructure. | `OUT OF SCOPE` | Keep allocation inside the existing monolith and transaction boundary.              |

## Conflicts and remaining confirmation

### Genuine repository conflicts / capability gaps

1. **Void vocabulary:** current Accounting deliberately has no `void` state. The
   Owner's non-allocatable void direction is preserved as a rule for any supported
   document contract that actually exposes such a terminal state; Task 16 must not
   add one. If a future implementation changes lifecycle vocabulary, the owning
   contract and ADR gate apply.
2. **Currency availability:** the Owner requires compatibility, while the current
   Accounting schema defers currency and has no currency identity. The implementation
   must fail closed when it cannot resolve currency. Adding a currency model or a
   new cross-module ownership/communication pattern is an ADR/OQ-03 matter, not an
   implicit Task 16 invention.
3. **Allocation amount authority:** no current repository contract defines which
   document types expose an allocatable amount. The brief therefore defines the
   invariant and the required authority boundary, but does not invent AR/AP,
   Sales/Purchase, Treasury, or an accounting-voucher settlement meaning.

### `REQUIRES ADR`

No new ADR is required merely to add a bounded allocation vertical slice inside the
existing Accounting module. An ADR **is required before implementation** if the chosen
solution changes any ADR-gated boundary, including:

- introducing a new module or service/deployment topology;
- introducing a new cross-module communication or currency-ownership pattern;
- introducing a universal document/settlement/rules abstraction;
- introducing new event/outbox infrastructure rather than reusing the current seam;
- changing the existing lifecycle or security architecture.

The canonical location remains `docs/adr/`; no second ADR directory is created.

### `REQUIRES OWNER CONFIRMATION`

**One essential implementation input remains:** the first implementation task must
name the repository-owned document types that are allocatable and identify the
existing owner of each document's allocatable amount/currency. The current checkout
contains no approved AR/AP, Sales, Purchase or Treasury document contract and the
Accounting voucher contract does not define a settlement amount. This is not a
request to revisit any of the 23 established directions; it is the missing concrete
endpoint/amount authority needed to prevent Task 16 from becoming a generic
settlement engine. Until that allow-list and authority are recorded, production
implementation is not authorized.

## Required documentation outcome

- The Owner directions are now recorded in the Task 16 brief and this matrix.
- Repository-confirmed mechanisms are referenced rather than duplicated.
- The no-void-state boundary and currency capability gap are explicit.
- No ADR was copied, moved, renumbered or created.
- No production code, Prisma schema, migration, endpoint, permission registry or
  business logic was changed.
- The next implementation prompt may use the established rules without re-asking
  them, subject only to the concrete document/amount authority confirmation above.
