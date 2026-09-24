# Task 16 — Settlement / Allocation Foundation Contract

## Status

| Concern | Status |
|---|---|
| Owner Direction | **ESTABLISHED** — the directions in the Task 16 contract-finalization request are binding and are not reopened here. |
| Accounting Foundations | **EXISTING** — organization scope, typed document identity, Decimal handling, RBAC, idempotency, transactions, immutable ledger/correction patterns and PostgreSQL test conventions were verified in the repository. |
| Task 16 Contract | **FORMALIZED** — this brief and [`decision-reconciliation.md`](./decision-reconciliation.md). |
| Contract finalization | **READY FOR REVIEW** — the documentation work is complete for review. |
| Implementation authorization | **BLOCKED — OWNER CONFIRMATION REQUIRED** — the supported document/amount-authority boundary is unresolved. |
| Production Implementation | **NOT AUTHORIZED**. |
| Acceptance / production readiness | **NOT CLAIMED**. |

This is a documentation-only domain contract. It authorizes no service, controller,
repository, Prisma model, migration, endpoint, permission registration, event or
frontend work. The implementation task must consume this contract and the
reconciliation matrix; it must not infer settled business rules from code comments
or reopen the listed Owner directions.

One concrete implementation input remains intentionally gated: the implementation
must identify which repository-owned document types are allocatable and which owning
contract supplies each document's allocatable amount and currency identity. The
current repository does not contain an approved AR/AP, Sales, Purchase or Treasury
document contract, and the Accounting voucher contract does not define a settlement
amount. This gate prevents Task 16 from becoming a generic settlement engine.

## 1. Scope

Task 16 is the **bounded Accounting Settlement / Allocation foundation only**.

It defines the narrow domain fact that one eligible Source document amount is
allocated to one eligible Target document amount, records that fact immutably, and
maintains the availability/integrity rules needed for later Accounting settlement
vertical slices.

The foundation is not a universal relationship framework. It may reuse existing
logical document endpoint identity and existing Accounting infrastructure, but it
must own only the allocation semantics required here. The implementation must have
an explicit, narrow allow-list of supported document types and use each owning
module's public contract for endpoint existence, state, amount and currency. It may
not accept arbitrary module/type/id triples merely because the Documents Foundation
can store a logical reference.

### 1.1 Architectural fit

Task 16 remains inside the existing Modular Monolith + Vertical Slice architecture:

- domain invariants stay framework-free;
- application services own authorization, orchestration and transaction boundaries;
- data repositories own Prisma/SQL and PostgreSQL locking;
- controllers, if later authorized, remain transport-only;
- cross-module reads use the owning module's public application service;
- cross-module side effects use the existing domain-event seam;
- no second tenant, idempotency, audit, event, workflow or document system is
  introduced.

The canonical architectural record location is `docs/adr/`. A new ADR is needed only
if implementation changes an ADR-gated boundary; adding a bounded table/use case
inside the existing Accounting module is not, by itself, a new architecture.

## 2. Core domain contract

### 2.1 Allocation

An **Allocation** is one accepted, directional financial application event:

> apply a positive amount from one eligible Source document to one eligible Target
document within one Organization, subject to both endpoints' current availability,
compatible currency and the transaction's idempotency/concurrency rules.

An allocation is a historical financial fact. It is not a mutable link, a workflow
transition, a journal entry, an FX conversion, a general-purpose rule execution or a
request log. The amount and endpoint identity in a completed allocation remain
interpretable without relying on mutable client state.

The allocation record must preserve, at minimum, the conceptual identity required by
this contract: Organization, Source endpoint, Target endpoint, positive amount,
currency identity where the supported document contract provides one, operation key
and request intent/evidence, timestamps/actor/correlation evidence, and correction or
reversal linkage where applicable. This is a conceptual contract, not a Prisma shape;
the implementation must use typed fields and existing repository conventions rather
than a catch-all JSONB/EAV payload.

### 2.2 Source and Target

- **Source** is an eligible document endpoint from the explicit Task 16 supported
  document-type allow-list. It is the origin of the directional allocation.
- **Target** is an eligible document endpoint from that allow-list. It is the
  destination to which the allocation is applied.
- Endpoints use the existing Document Foundation logical identity shape:
  `(module, documentType, documentId[, lineId])`. Logical identity is not proof of
  existence or organization ownership; the owning module must resolve it.
- Task 16 must not invent AR/AP, Sales/Purchase, Treasury or other operational
  document types to populate the allow-list.
- The current `documents.document_relations` `settle` kind is a generic whole-document
  relation and is not, by itself, an allocation record. The existing quantity-aware
  `fulfill` relation must not be repurposed to mean financial allocation.

### 2.3 Directionality: Source → Target

`Source → Target` is semantic, not presentational:

- the Source is the amount being consumed/applied;
- the Target is the amount receiving the application;
- swapping the endpoints is a different operation and a different idempotency
  intent;
- reads, audit facts, correction links and concurrency locks preserve the endpoint
  order;
- no query or uniqueness rule may collapse the pair into an undirected set.

### 2.4 Organization isolation

Source and Target must resolve to the **same Organization**. The implementation must:

1. validate the requested organization through the existing organization scope and
   deployment-scope mechanisms;
2. resolve both endpoints through their owning public application services, including
   organization ownership;
3. reject a missing, unsupported or cross-organization endpoint using the existing
   scope/error posture; and
4. perform the same-scope assertion again inside the allocation transaction where
   endpoint rows/amount authorities are locked.

A foreign logical endpoint, a client-supplied organization id, or a database FK to a
row in another module is not sufficient authorization. No cross-organization
allocation may be persisted, and no cross-organization existence may be disclosed.

### 2.5 Currency compatibility and FX boundary

Source and Target currency must be compatible. The supported document contracts must
provide the compatibility authority; Task 16 does not invent a stricter currency-code
predicate from the absence of current currency columns. Numeric scale or Organization
alone never proves compatibility.

Task 16 performs **no FX conversion**. It does not look up rates, apply rounding,
revalue balances, calculate FX gain/loss, or add a conversion engine. If the
supported document contract cannot provide currency identity, the allocation must
fail closed rather than assume compatibility. Adding currency ownership, currency
columns to existing Accounting documents, or a new cross-module currency protocol is
outside this documentation contract and requires the existing OQ/ADR process.

### 2.6 Document-state eligibility

An endpoint is allocatable only when its owning document contract says that its state
is eligible for allocation and the document has not been reversed or voided/cancelled
where that terminal state is supported.

The implementation must explicitly reject:

- a reversed document, including an original document whose reversal link is set;
- a document in a supported voided/cancelled terminal state; and
- any state that the supported document contract identifies as non-allocatable.

Task 16 does not establish a default draft, temporary or inactive exclusion without
repository evidence from the supported document contract. Those state-eligibility
rules remain part of the unresolved document-type/amount-authority gate.

The current Accounting contract deliberately has `draft | temporary | final` and no
`void` state. Task 16 must not introduce a `void` state. For current Accounting
vouchers, the existing final/reversal contract is authoritative: final facts are
immutable, and a reversal is a new counter-document rather than a mutation of the
original. A future owning document type may expose a void/cancel state; that type's
contract must identify it as non-allocatable.

Eligibility is checked at creation and re-checked under the allocation transaction's
locks. A pre-check outside the transaction is not sufficient.

## 3. Amount contract

### 3.1 Exact amount semantics

The allocation amount is a positive exact Decimal value. It must be parsed and
canonicalized using the repository's existing Decimal/money conventions; floating
point arithmetic, silent rounding and negative-zero representations are forbidden.

Reject before any effect is committed when the requested amount is:

- zero or negative;
- malformed or outside the supported precision/range;
- greater than the currently allocatable amount of any affected endpoint; or
- incompatible with the supported document amount/currency contract.

The implementation must use the repository's applicable precision contract. It must
not invent a new precision rule merely for Task 16.

### 3.2 `allocatableAmount`, `allocatedAmount`, `remainingAmount`

Task 16 conceptually maintains three values for every participating endpoint:

- **`allocatableAmount`** — the eligible amount made available by the owning,
  supported document contract. It is not a client-authoritative number and is not an
  Accounting ledger balance projection.
- **`allocatedAmount`** — the cumulative net amount consumed by accepted allocation
  effects for that endpoint. Historical allocations remain individually visible;
  this value is a projection/aggregate of those facts, not a replacement for them.
- **`remainingAmount`** — the amount still available to allocate after accepted
  effects. At the contract level:

  ```text
  remainingAmount = allocatableAmount - allocatedAmount
  ```

  The implementation must preserve exact Decimal arithmetic and must never commit a
  negative remaining amount.

A requested positive amount must not exceed the current `remainingAmount` of any
endpoint whose amount authority participates in the allocation. If either side cannot
satisfy the request, the whole operation is rejected and no allocation, projection,
idempotency evidence or audit fact is committed.

The source of `allocatableAmount` is an implementation dependency, not an invitation
to invent AR/AP semantics. The implementation must name the owner, read path,
state/amount snapshot and lock authority in its design/tests. It must not derive
settlement availability from Accounting ledger balances, account balance projections,
numbering allocations or unrelated document totals.

### 3.3 Partial and multi-stage allocation

- **Partial allocation is supported:** an accepted amount may be less than the
  endpoint's current remaining amount.
- **Multiple allocations are supported:** one Source and/or Target may participate in
  multiple allocation records over time, including several partial allocations.
- The implementation must not enforce one allocation per endpoint or overwrite a
  previous allocation.
- Allocation history is append-only. Current remaining availability is obtained from
  the allocation-owned facts and the owning document amount authority under the
  transaction's consistency rules.
- A later allocation may consume the remaining amount only after the current amount
  authority and prior allocation effects have been re-read under lock.

## 4. Immutability and correction

### 4.1 Append-only history

A completed Allocation is immutable:

- no direct update of its endpoint, amount, currency, operation key, state or
  historical evidence;
- no direct delete endpoint or repository method for a completed allocation;
- no reuse of a mutable generic `DocumentRelation` delete path as a financial
  correction mechanism; and
- no “edit in place” repair of an over-allocation or mistaken endpoint.

Database relationships and repository APIs must protect historical allocation rows in
line with the repository's Accounting immutability conventions. A failed or rejected
attempt creates no completed allocation row.

### 4.2 Compensating/reversal correction

If correction is supported by the implementation slice, it is an explicit,
permission-gated compensating/reversal operation:

- it creates a new correction/reversal record linked to the original allocation;
- it carries the reason and actor/correlation evidence required by the supported
  correction contract, reusing existing Accounting correction conventions;
- it leaves the original allocation unchanged and readable;
- its effect is included in the net availability calculation without rewriting the
  historical original; and
- it has its own idempotency intent and conflict/replay behavior.

The exact compensating effect and endpoint representation must follow the supported
correction/amount authority; this contract does not invent those details. The
original allocation remains immutable, and no generic correction engine, workflow or
rules language is introduced.

If reversal is not included in the first implementation vertical slice, normal
allocation creation must not imply that correction exists. The contract still
requires the explicit permission boundary before any reversal use case is enabled.

## 5. Idempotency

Task 16 uses the existing organization-scoped `operationKey` pattern.

The canonical intent payload for an allocation must include every business input
whose change would alter the result, including at least:

- organization identity;
- ordered Source and Target endpoint identities;
- canonical positive amount;
- compatible currency identity when supplied by the owner contract; and
- operation kind plus correction/reversal reference and reason when applicable.

Generated ids, server timestamps, resolved projections and other server-generated
values must not be hashed as client intent. The resulting canonical request hash is
compared under the existing operation ledger rules.

| Replay case | Required result |
|---|---|
| Same Organization + same `operationKey` + same canonical payload | Idempotent replay of the recorded/current result; no second allocation effect, no second consumption and no duplicate history row. |
| Same Organization + same `operationKey` + different payload | Conflict; nothing is mutated. |
| Same `operationKey` in a different Organization | Organization isolation applies; do not use another organization's operation row as a replay source. |
| No valid `operationKey` | Reject before the effect transaction. |

The implementation must reuse the existing operation/idempotency repository pattern,
not add a second allocation-key table with different semantics.

## 6. Atomicity

Creation of an Allocation and **all affected financial state** is one atomic
application/data transaction. The transaction includes, as applicable:

1. locked, same-organization endpoint and amount-authority resolution;
2. eligibility/state and currency compatibility re-checks;
3. current remaining-amount re-checks;
4. allocation history insertion;
5. any allocation-owned aggregate/projection maintenance;
6. idempotency evidence; and
7. audit facts required by the existing audit boundary.

All commit together or all roll back. A rejected amount, state, organization,
currency, uniqueness or idempotency condition must leave no partial allocation,
amount consumption, projection update, idempotency row or audit fact.

Use the existing Modular Monolith application-service transaction boundary and
Accounting data-layer pattern. Do not perform a financial write, event-derived
allocation or audit write in a separate best-effort transaction.

## 7. Concurrency safety

The implementation must prevent two concurrent requests from consuming the same
remaining amount.

Minimum design obligations:

- acquire locks on every affected amount authority and allocation aggregate before
  the final remaining-amount check;
- use one deterministic lock order for Source and Target when both are present;
- order multiple endpoint/aggregate locks deterministically (ascending stable id or
  the owning repository's established order);
- re-read current state, currency and remaining amount after locks are held;
- reject the loser when the first committed allocation has consumed the available
  amount; and
- keep the allocation insert, aggregate/projection update and idempotency row in the
  same transaction.

The design must fit the Accounting lock-order matrix and must not introduce a cycle
with existing `financial_area → fiscal_year → accounting_period → configuration →
accounts → balances → accounting_document` paths. If an allocation needs an
existing Accounting document lock, it must take it at the documented position and
extend the matrix before implementation. Cross-module table locks are forbidden;
lock through the owning module's approved transaction/public boundary.

### Required real PostgreSQL verification

The implementation task must eventually run a dedicated live PostgreSQL suite using
independent database connections, not only mocks, in-memory repositories or PGlite.
It must verify at least:

1. two concurrent allocations whose sum is within the available amount;
2. two concurrent allocations whose sum exceeds the available amount — exactly one
   or the permitted subset commits, and no endpoint is over-allocated;
3. concurrent partial allocations of the same Source and Target;
4. concurrent attempts with the same operation key and same payload;
5. same operation key with different payload;
6. a failed transaction leaves no allocation, aggregate, idempotency or audit trace;
7. reversed/voided/ineligible endpoint races are refused; and
8. lock timeout/deadlock behavior is surfaced rather than hidden.

This documentation task does not claim those tests have run.

## 8. Authorization and audit

### 8.1 Permissions

The future implementation must use the existing granular RBAC model and enforce
authorization in both the route guard and application service:

- an explicit Create permission for allocation creation;
- an explicit Read/View permission for allocation reads; and
- a distinct explicit reversal/compensation permission if that operation is enabled.

Permission names must follow the existing `Module.Entity.Action` convention and be
registered only by the owning module. Create/Read must not imply reversal. There is
no wildcard, superuser or frontend authorization bypass.

### 8.2 Audit/history

The allocation write must preserve actor, action, endpoint identity, amount, reason
(if applicable), operation key/hash reference, correlation and timestamps through the
repository's established audit boundary. History is append-only.

The current repository has strong row-level evidence and append-only workflow
history, while the documented Audit module/persistence is not present in the
inspected runtime module/schema and the kernel event bus is in-memory. Therefore:

- reuse existing audit ports/events and transaction conventions if the implementation
  has an approved owner available;
- do not invent a second audit table, event store or outbox;
- do not claim an in-memory event publish is durable audit evidence; and
- if persistent audit is required before allocation can ship, record that repository
  gap and follow the existing architecture/OQ/ADR process before implementation.

## 9. Reuse map and explicit non-goals

### 9.1 Repository mechanisms to reuse

| Need | Existing repository mechanism | Task 16 rule |
|---|---|---|
| Organization scope | `organizationId`, `OrganizationsService`, deployment-scope guard, service-level same-scope lookup | Reuse; do not create tenancy or membership infrastructure. |
| Document identity | Documents Foundation logical endpoint shape and typed module-owned documents | Reuse identity only; validate endpoint existence/state through the owning service. |
| Money | Accounting `Money`/Decimal conventions and PostgreSQL numeric handling | Reuse exact Decimal; do not use floats or invent precision. |
| RBAC | `AuthorizationService`, route permission metadata and module permission registry | Reuse double enforcement and granular codes. |
| Idempotency | Organization-scoped operation ledger, canonical request hash, replay-or-reject | Reuse semantics; same key/different payload is conflict. |
| Transactions | Application service + Prisma repository `$transaction` boundaries | Keep allocation, state and evidence atomic. |
| Locks | Accounting `FOR UPDATE`/`FOR SHARE` helpers and lock-order matrix | Extend deterministically; prove no cycle. |
| Immutable history | Accounting final/ledger/reversal conventions and append-only history pattern | No direct edit/delete; corrections append compensating facts. |
| Events/audit | Existing kernel event seam and documented Audit boundary | Reuse; no parallel infrastructure and no false durability claim. |

### 9.2 Explicit exclusions

Task 16 does **not** implement or introduce:

- FX conversion, exchange-rate tables, revaluation or FX gain/loss;
- AR/AP subledgers, receivables/payables aging, collection or settlement workflows;
- Treasury, cash, bank, payment or payment-reconciliation implementation;
- Sales or Purchase documents, pricing, invoicing or order workflows;
- frontend/UI/client packages;
- a generic universal settlement engine or future-module framework;
- a workflow engine, rules engine, expression language or approval engine;
- a universal document table/engine, EAV, giant JSONB structures or speculative
  currency/dimension abstractions;
- microservices, Redis, a new message broker, event bus or outbox infrastructure;
- unrelated accounting features, tax, statutory/e-ledger, reporting or year-close
  work; or
- edits to existing production behavior, schemas or migrations in this contract
  finalization task.

## 10. Implementation handoff and gates

Before production implementation is authorized, the implementation prompt must include:

1. the explicit supported document-type allow-list;
2. the owning public service/contract for each endpoint's organization, state,
   amount and currency identity;
3. the allocation-owned persistence/projection design, if one is required, with no
   generic abstraction;
4. the exact permission codes and denial tests;
5. the operation kind and canonical payload/hash definition;
6. the deterministic lock-order extension and deadlock argument;
7. the correction/reversal decision and explicit permission, if enabled;
8. the audit boundary and evidence persistence path;
9. unit/application tests for every invariant and denial path; and
10. real PostgreSQL concurrency tests with independent connections.

No item above authorizes implementation by itself. The production task must also
respect current repository status: this brief is formalized, not implemented or
accepted.

## 11. Validation basis for this documentation task

The reconciliation was based on static inspection of:

- `STATE.md`, `.vardena/agent-rules.md`, `.vardena/architecture-rules.md`;
- `docs/adr/` and `docs/adr/README.md`;
- `docs/accounting/domain-contract.md`, `lock-order-matrix.md` and `task-index.md`;
- current Task 16 records and Accounting/Document source, schema and migrations;
- existing RBAC, organization, idempotency, audit/history and PostgreSQL test
  patterns.

Only Markdown/static checks appropriate to this documentation-only change are
required here. The live PostgreSQL allocation suite belongs to the later authorized
implementation task and is not claimed by this document.
