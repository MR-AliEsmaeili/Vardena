# Task 16 — Implementation Gate Investigation

**Inspection baseline:** `739e40126f462e6e04dd2b8a6474e4e5d90314e1` (`main` baseline checked out by this Arena work branch) on 2026-09-24.

**Method:** static repository investigation only. This report treats a candidate as a
repository-owned business document type or a nearby endpoint-bearing record that could
otherwise be mistaken for one. A candidate is supported only if repository evidence
identifies all five required authorities: identity, organization ownership, allocatable
state, allocatable monetary amount, and currency. A generic logical reference, a stock
quantity, a ledger debit/credit value, or a numbering allocation is not promoted to a
financial endpoint by this investigation.

## 1. Executive Result

**GATE BLOCKED — NO SUPPORTED DOCUMENT TYPE FOUND**

The current repository has one registered business document type,
`accounting_voucher`, but its contract does not define a settlement amount and the
repository provides no currency identity authority for it. The Inventory module has
immutable stock movements and reservations, not monetary documents; the Documents
Foundation has logical links, including `settle`, but no financial amount or currency
semantics. No AR/AP, Sales, Purchase, Treasury, invoice, payment, receivable, or
payable document implementation is present in the current module or Prisma-schema
inventory.

This confirms, rather than changes, the finalized Task 16 gate:
`docs/tasks/task-16/prompt.md:34-42` requires a repository-owned document-type
allow-list and owner-supplied amount/currency authorities, and explicitly says that the
Accounting voucher contract does not define a settlement amount. There is therefore no
current allow-list entry to recommend and no basis to authorize production work.

## 2. Candidate Inventory

`backend/src/modules/documents/application/document-type-registry.ts:9-21` establishes
that registered types are the code-owned source of truth. The only concrete
`DocumentTypeDefinition` declared by a module is
`ACCOUNTING_VOUCHER_TYPE_DEFINITION` in
`backend/src/modules/accounting/domain/accounting-document.ts:60-83`, registered at
startup by
`backend/src/modules/accounting/application/accounting-document-type-registration.ts:14-29`.
The Inventory, Organization, Workflow, and Documents modules declare no additional
business-document type definition.

The two negative candidates after the voucher are included because their names or
fields could be mistaken for a Task 16 endpoint: InventoryMovement is a real immutable
business event with a quantity/reversal contract, and DocumentRelation carries the
Foundation's `settle` relation kind. Neither is a supported document type.

| Module | Document Type | Source | Target | Organization Authority | State Authority | Amount Authority | Currency Authority | Classification |
| ------ | ------------- | ------ | ------ | ---------------------- | --------------- | ---------------- | ------------------ | -------------- |
| Accounting | `accounting_voucher` — `ACCOUNTING_VOUCHER_DOCUMENT_TYPE` / `AccountingDocument` in `backend/src/modules/accounting/domain/accounting-document.ts:60-83` and `backend/prisma/schema/accounting.prisma:552-647` | **No.** The only registered type is identifiable, but `docs/tasks/task-16/prompt.md:36-41` says its contract has no settlement amount; it is not a Task 16 Source. | **No.** Same authoritative gate and missing settlement amount: `docs/tasks/task-16/prompt.md:36-41`. | `AccountingDocument.organizationId` and FK: `backend/prisma/schema/accounting.prisma:553-554,627-630`; public lookup: `AccountingDocumentsService.getDocument` and `mustFindInOrganization`, `backend/src/modules/accounting/application/accounting-documents.service.ts:189-197,729-739`. | Existing phases are `draft`, `temporary`, `final`: `backend/src/modules/accounting/domain/accounting-document.ts:102-114`; typed reversal is `reverseDocument`, `backend/src/modules/accounting/application/accounting-documents.service.ts:588-628`. No `isAllocatable`/settlement-eligibility contract exists. | **No settlement amount authority.** `AccountingDocumentLine.debitAmount` / `creditAmount` are double-entry line sides, `backend/prisma/schema/accounting.prisma:645-692`; totals are derived from them, `backend/src/modules/accounting/domain/accounting-document.ts:405-456`. | **NO CURRENCY AUTHORITY FOUND.** Currency/rate columns are explicitly deferred: `backend/prisma/schema/accounting.prisma:548-551`; `docs/accounting/domain-contract.md:1087-1091,1637-1651`. | **NOT SUPPORTED.** The finalized Task 16 record expressly excludes voucher debit/credit totals as a settlement amount: `docs/tasks/task-16/decision-reconciliation.md:167-168`. |
| Inventory | `inventory_movement` — operational event, not a registered Document Foundation type: `backend/src/modules/inventory/domain/inventory-movement.ts:4-42`; `backend/src/modules/inventory/domain/movement-type.ts:9-19` | **No.** It is a stock movement rather than a financial document; no module registers an Inventory `DocumentTypeDefinition` (the registry evidence above; movement vocabulary at `backend/src/modules/inventory/domain/movement-type.ts:27-72`). | **No.** Same entity has only stock movement semantics, not a monetary receiving endpoint: `backend/prisma/schema/inventory.prisma:267-332`. | `InventoryMovement.organizationId` and FK: `backend/prisma/schema/inventory.prisma:268-269,315-322`; public organization-scoped lookup: `InventoryMovementsService.getMovement`, `backend/src/modules/inventory/application/inventory-movements.service.ts:152-163`. | There is no document lifecycle/state. Closed movement types are stock direction values: `backend/src/modules/inventory/domain/movement-type.ts:27-57`; reversal is a counter-movement: `backend/src/modules/inventory/application/inventory-movements.service.ts:337-438`. | **No monetary amount authority.** `quantity` and signed `baseQuantity` are unit quantities, not money: `backend/prisma/schema/inventory.prisma:277-289`; `backend/src/modules/inventory/domain/inventory-movement.ts:25-32`. | **NO CURRENCY AUTHORITY FOUND.** The complete model field range is `backend/prisma/schema/inventory.prisma:267-332`; it contains units and quantities, no currency identity. | **NOT SUPPORTED.** The concurrent balance mechanism protects stock availability, not financial allocation: `backend/prisma/schema/inventory.prisma:334-340`; `backend/src/modules/inventory/data/inventory-movements.repository.ts:33-52`. |
| Documents | `DocumentRelation` with relation kind `settle` — a Foundation link record, not a business document: `backend/prisma/schema/documents.prisma:155-181`; `backend/src/modules/documents/domain/document-relation.ts:22-53` | **No.** It stores a logical `source` reference only; it does not resolve or own the referenced document's financial authority: `backend/src/modules/documents/application/document-relations.service.ts:59-68,152-190`. | **No.** It stores a logical `target` reference only; the same record is not a financial target document: `backend/src/modules/documents/domain/document-relation.ts:48-53,152-165`. | `DocumentRelation.organizationId` / FK: `backend/prisma/schema/documents.prisma:156-175`; scoped relation lookup: `DocumentRelationsService.requireRelationInOrganization`, `backend/src/modules/documents/application/document-relations.service.ts:217-231`. | No lifecycle or eligibility field exists. The generic relation can be deleted: `backend/src/modules/documents/application/document-relations.service.ts:122-150`; it is not immutable allocation history. | **No financial amount authority.** Only `fulfill` may carry a base-unit `quantity`; `settle` must carry no quantity: `backend/src/modules/documents/domain/document-relation.ts:37-45,122-145`. | **NO CURRENCY AUTHORITY FOUND.** The relation model is fully declared at `backend/prisma/schema/documents.prisma:155-181` and contains no currency field. | **NOT SUPPORTED.** `settle` is a generic whole-document relation, not an allocation fact or remaining-amount projection: `backend/src/modules/documents/domain/document-relation.ts:22-45`; `docs/tasks/task-16/brief.md:90-96`. |

### Negative repository-wide findings

- `backend/prisma/schema/base.prisma:12-15` lists all current schemas:
  `identity`, `users`, `rbac`, `organization`, `inventory`, `documents`,
  `workflow`, and `accounting`. There is no AR/AP, Sales, Purchasing, Treasury,
  payment, or currency schema. The backend module directory mirrors that result.
- A structural scan of `backend/prisma/schema/*.prisma` found no currency field. The
  only `currency` references in the current Accounting schema describe deferred work;
  see `backend/prisma/schema/accounting.prisma:548-551,779-783,868-871`.
- The migration search finds `allocation` only in the Documents numbering ledger, not
  a monetary allocation table; see
  `backend/prisma/migrations/20260912000000_documents_foundation/migration.sql:99-141`.
  It is serial-number allocation, not Task 16 allocation.
- Searches for `receivable`, `payable`, `outstanding`, and `allocatableAmount` in
  application/schema/migration sources find no financial endpoint contract. A
  `Party` is organization-scoped counterparty master data, not an open financial item:
  `backend/src/modules/organization/domain/party.ts:1-28,50-67` and
  `backend/prisma/schema/organization.prisma:220-244`.

## 3. Detailed Evidence

### 3.1 Accounting — `accounting_voucher`

#### Document Identity

- Header identity is `AccountingDocument.id`; its registered type is the fixed
  `documentType = accounting_voucher` in
  `backend/prisma/schema/accounting.prisma:552-572`.
- The owning type declaration names module `accounting`, code
  `accounting_voucher`, and the Accounting module as owner in
  `backend/src/modules/accounting/domain/accounting-document.ts:60-83`.
- Optional line identity exists: `AccountingDocumentLine.id` with
  `documentId`, unique `(documentId, lineNo)`, in
  `backend/prisma/schema/accounting.prisma:653-692`. A line is an accounting
  posting line, not an independently declared settlement/open-item endpoint.

#### Organization Authority

`AccountingDocument.organizationId` is a required header field with an Organization
FK (`backend/prisma/schema/accounting.prisma:552-554,627-630`), and each line carries
its own organization snapshot (`backend/prisma/schema/accounting.prisma:653-680`).
The public application owner is `AccountingDocumentsService`:
`getDocument(organizationId, id)` calls `mustFindInOrganization`, which checks the
deployment scope and requires `document.organizationId === organizationId` or returns
not found (`backend/src/modules/accounting/application/accounting-documents.service.ts:189-197,725-739`).

This is valid evidence for organization-scoped document lookup. It does not supply an
allocatable amount or currency.

#### State Authority

The Accounting lifecycle is concrete: `draft` phase, then `temporary` and `final`
states (`backend/src/modules/accounting/domain/accounting-document.ts:102-114`; also
`docs/accounting/domain-contract.md:1131-1159`). Final documents are structurally
protected from edits; draft/temporary records are deletable
(`docs/accounting/domain-contract.md:1151-1168`).

Reversal is also concrete. `reverseDocument` permits only a final, not-already-reversed
voucher and creates a new counter-document (`backend/src/modules/accounting/application/accounting-documents.service.ts:588-628`); the model records
`reversesDocumentId` and `reversedByDocumentId` as typed self-links
(`backend/prisma/schema/accounting.prisma:596-626`). Accounting has no `void` state
(`docs/accounting/domain-contract.md:1138-1140`).

None of those sources declares which phase is eligible for Task 16 allocation or
provides an `isAllocatable` decision. The report therefore does not infer that `final`,
`temporary`, or any other phase is eligible.

#### Amount Authority

The only monetary fields are the double-entry sides on each accounting line:
`debitAmount` and `creditAmount`, governed by the balance invariant
Σ debit = Σ credit (`backend/prisma/schema/accounting.prisma:645-692`;
`docs/accounting/domain-contract.md:1030-1053`). The DTO/domain helper derives
`totalDebit` and `totalCredit` by summing those lines
(`backend/src/modules/accounting/domain/accounting-document.ts:405-456`), and the
contract identifies document totals as derived from lines, not client-supplied
(`docs/accounting/domain-contract.md:1080-1085`).

Those values establish a balanced journal voucher. They do **not** identify a settled
obligation, an amount receivable/payable from a counterparty, a directional amount,
or a current amount remaining after allocations. Selecting either total, a debit line,
a credit line, a ledger entry, or an account balance as a settlement amount would add
semantics not present in the owner contract.

**NOT A SUPPORTED TASK 16 ALLOCATION ENDPOINT.** The finalized Task 16 handoff says
exactly that the Accounting voucher contract does not define a settlement amount
(`docs/tasks/task-16/prompt.md:36-41`), and its reconciliation prohibits treating
voucher debit/credit lines as one (`docs/tasks/task-16/decision-reconciliation.md:167-168`).

#### Currency Authority

**NO CURRENCY AUTHORITY FOUND**

There is no currency identity field on `AccountingDocument`,
`AccountingDocumentLine`, `LedgerEntry`, or `AccountBalanceProjection`; the schema
explicitly records currency/exchange rate as deferred/not columns
(`backend/prisma/schema/accounting.prisma:548-551,779-783,868-871`). The Accounting
contract's single-base-currency statement is an assumption, not a stored identity or
compatibility service (`docs/accounting/domain-contract.md:1087-1091`), and the
per-line currency/rate seam remains deferred (`docs/accounting/domain-contract.md:1637-1651`).

It would be unsafe to treat numeric scale, organization identity, or the base-currency
assumption as a Task 16 currency authority.

#### Existing Relations

The typed self-links above represent voucher reversal/correction history only. They do
not represent a financial allocation. `sourceModule`, `sourceEntityType`,
`sourceEntityId`, and `sourceOperation` are system-origin traceability fields on an
Accounting document (`backend/prisma/schema/accounting.prisma:576-594`), not a
settlement relation or amount source.

The Documents Foundation separately offers generic logical relations. Its `settle`
kind has no quantity and its `fulfill` kind is the only quantity-aware kind
(`backend/src/modules/documents/domain/document-relation.ts:22-45,122-145`). The
Task 16 brief expressly says the generic `settle` relation is not an allocation record
and `fulfill` must not be repurposed for financial allocation
(`docs/tasks/task-16/brief.md:90-96`). No Accounting code maps a voucher relation to
a settlement amount, currency, or remaining amount.

### 3.2 Inventory — `inventory_movement`

#### Document Identity

`InventoryMovement.id` is a concrete immutable operational-event identity
(`backend/src/modules/inventory/domain/inventory-movement.ts:4-42`;
`backend/prisma/schema/inventory.prisma:267-332`). It is not a Document Foundation
business document type. The inventory movement type vocabulary deliberately avoids
future document-flavoured types until a module owns their semantics
(`backend/src/modules/inventory/domain/movement-type.ts:9-19`).

There is no optional financial line identity. `referenceType`/`referenceId` are opaque
references, not typed financial document endpoints
(`backend/prisma/schema/inventory.prisma:300-303`).

#### Organization Authority

The movement stores `organizationId` and has an Organization FK
(`backend/prisma/schema/inventory.prisma:268-269,315-322`). The public lookup
`InventoryMovementsService.getMovement(organizationId, id)` checks the organization
scope and compares the stored owner before returning the event
(`backend/src/modules/inventory/application/inventory-movements.service.ts:152-163`).

This is valid inventory scope evidence, but it is only for stock movement lookup.

#### State Authority

A movement has a `movementType`, not a business-document lifecycle. The fixed values
express incoming/outgoing stock directions (`backend/src/modules/inventory/domain/movement-type.ts:27-57`), with no `state`, `void`, `cancelled`, or allocation-eligibility
field in the model (`backend/prisma/schema/inventory.prisma:267-332`).

It is immutable and corrected by a mirror reversal: the service creates an opposite
movement with `reversalOfMovementId` (`backend/src/modules/inventory/application/inventory-movements.service.ts:337-438`), and the schema permits at most one full
reversal per original (`backend/prisma/schema/inventory.prisma:294-324`). That is a
stock-ledger correction contract, not a financial endpoint lifecycle.

#### Amount Authority

The model's numerical values are entered `quantity`, signed `baseQuantity`, unit IDs,
and a conversion factor (`backend/prisma/schema/inventory.prisma:277-289`;
`backend/src/modules/inventory/domain/inventory-movement.ts:25-32`). They are exact
stock quantities in a unit of measure. No price, cost, financial amount, settlement
amount, invoice total, receivable, or payable is stored on the movement.

`InventoryBalance.onHand`, `reservedQuantity`, and derived `available` are likewise
stock values scoped to `(organization, warehouse, item)`, maintained from movements
under a lock (`backend/prisma/schema/inventory.prisma:334-367`). They cannot become a
Task 16 money/availability authority merely because they are named “available.”

#### Currency Authority

**NO CURRENCY AUTHORITY FOUND**

The complete movement model field list is
`backend/prisma/schema/inventory.prisma:267-332`; its quantities are associated with
units, and it has no currency identity. The schema-wide currency finding in section 2
also applies to Inventory.

#### Existing Relations

Inventory uses `transferId` to bind stock-transfer legs and
`reversalOfMovementId` for a stock counter-movement
(`backend/prisma/schema/inventory.prisma:294-324`). Its optional
`referenceType`/`referenceId` is deliberately opaque (`backend/prisma/schema/inventory.prisma:300-303`). These are traceability/stock relation mechanisms;
they do not establish a payment, fulfillment of a monetary obligation, settlement
amount, or currency compatibility.

### 3.3 Documents Foundation — `DocumentRelation` / `settle`

#### Document Identity

A `DocumentRelation` has its own record ID and stores ordered logical endpoint shape:
`(module, documentType, documentId[, lineId])`
(`backend/prisma/schema/documents.prisma:155-181`;
`backend/src/modules/documents/domain/document-relation.ts:48-53,152-165`). It is not
the underlying business document. The Foundation intentionally has no universal
documents table (`backend/prisma/schema/documents.prisma:1-17`).

#### Organization Authority

The relation record itself has `organizationId` with an Organization FK
(`backend/prisma/schema/documents.prisma:155-175`).
`DocumentRelationsService.requireRelationInOrganization` protects reads of that row
(`backend/src/modules/documents/application/document-relations.service.ts:217-231`).

The Foundation does not resolve cross-module endpoint existence/ownership: its service
documentation assigns that responsibility to the creating owning module
(`backend/src/modules/documents/application/document-relations.service.ts:59-68`),
and the repository confirms that links are logical, not foreign keys
(`backend/src/modules/documents/data/document-relations.repository.ts:14-23`). Thus a
relation row's organization does not prove either endpoint's Task 16 organization
ownership.

#### State Authority

The relation model has no lifecycle state, cancellation state, reversal state, or
allocation eligibility. It is mutable in the relevant sense: the generic public
service permits relation deletion (`backend/src/modules/documents/application/document-relations.service.ts:122-150`). A deletable generic link cannot supply Task 16's
immutable financial history.

#### Amount Authority

`RELATION_KINDS` includes `settle`, but only `fulfill` is quantity-aware
(`backend/src/modules/documents/domain/document-relation.ts:22-45`).
`planRelation` requires quantity for `fulfill` and forbids it for every other kind,
including `settle` (`backend/src/modules/documents/domain/document-relation.ts:122-145`).
The stored field is therefore at most a base-unit fulfillment quantity, not a monetary
allocation amount, and there is no allocated/remaining amount calculation.

#### Currency Authority

**NO CURRENCY AUTHORITY FOUND**

The full `DocumentRelation` model declaration contains endpoint fields, kind, optional
quantity, and audit columns, but no currency field
(`backend/prisma/schema/documents.prisma:155-181`). Neither the relation domain type
nor service supplies a currency resolver.

#### Existing Relations

This candidate is the relation mechanism itself. ADR-0019 defines the closed kind list
and says cross-module links are logical; it only identifies line-level quantities as
support for partial fulfillment, not financial allocation
(`docs/adr/0019-document-foundation-and-relations.md:18-38`). The earlier document
architecture explicitly describes `settle` as a future payment-settles-invoice example
(`docs/architecture/domain/document-architecture.md:115-128`), not an implemented
payment/invoice contract. The Task 16 brief is more specific and binding for this
investigation: do not reuse `settle` or `fulfill` as Task 16 allocation storage
(`docs/tasks/task-16/brief.md:90-96`).

### 3.4 Records deliberately rejected as Task 16 authorities

The following records were inspected because their names or values could look
financial. They are not additional document candidates and must not fill the missing
endpoint contract:

- **Accounting ledger entries:** `LedgerEntry.debitAmount` / `creditAmount` are
  immutable accounting-posting facts copied from voucher lines
  (`backend/prisma/schema/accounting.prisma:784-856`). They have no currency field
  and do not define a document settlement amount.
- **Account balance projections:** `AccountBalanceProjection` aggregates turnover by
  organization, area, year, period, and account; it is explicitly a rebuildable
  projection, not a document balance/open-item record
  (`backend/prisma/schema/accounting.prisma:859-900`). Its debit/credit fields cannot
  be used as Task 16 availability.
- **Accounting posting operations:** `AccountingPostingOperation` is an
  organization-scoped idempotency ledger for posting operations, not a business
  document or allocation history (`backend/prisma/schema/accounting.prisma:695-767`).
- **Documents numbering allocations:** `NumberingAllocation` allocates a serial from a
  `NumberingSeries`; its `allocationKey` makes numbering idempotent, not financial
  allocation (`backend/prisma/schema/documents.prisma:108-153`).
- **Inventory reservations and balances:** their quantity/availability contract is
  explicitly stock-specific (`backend/prisma/schema/inventory.prisma:334-410`). It has
  no monetary amount or currency authority.
- **Organization parties:** a customer/supplier capability is master data only. The
  Party contract expressly leaves payment terms and credit limits absent
  (`backend/src/modules/organization/domain/party.ts:20-26,47-67`); it is not a
  receivable/payable document.
- **Workflow instances:** Workflow is a generic state/history mechanism. No Prisma
  `workflow` model has a decimal amount or currency field; it cannot establish an
  endpoint's money/currency authority.

## 4. Task 16 Suitability

| Candidate | Can it be Source? | Can it be Target? | Can both roles be supported? | Is the amount authoritative? | Is currency authoritative? | Can availability / remaining amount be determined safely? | Can concurrent allocation be protected without violating module boundaries? |
| --------- | ----------------- | ----------------- | ---------------------------- | ---------------------------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `accounting_voucher` | No — no settlement amount contract: `docs/tasks/task-16/prompt.md:36-41`. | No — same absence applies to a receiving endpoint: `docs/tasks/task-16/prompt.md:36-41`. | No — no role-specific settlement authority exists: `docs/tasks/task-16/decision-reconciliation.md:167-168`. | No — debit/credit line sides and derived totals are journal balancing values: `docs/accounting/domain-contract.md:1030-1053,1080-1085`. | No — **NO CURRENCY AUTHORITY FOUND**: `backend/prisma/schema/accounting.prisma:548-551`; `docs/accounting/domain-contract.md:1637-1651`. | No — no `allocatableAmount`, allocation history, or current remaining amount exists for a voucher; ledger/projection figures are different authorities: `backend/prisma/schema/accounting.prisma:784-900`. | No safe Task 16 design follows from the current contract. `lockAccountingDocumentRow` can lock a voucher row (`backend/src/modules/accounting/data/accounting-locks.ts:626-660`), but a lock cannot manufacture amount/currency semantics. |
| `inventory_movement` | No — movement direction/quantity is a stock fact, not a financial source: `backend/src/modules/inventory/domain/inventory-movement.ts:18-42`. | No — no monetary receiving obligation exists: `backend/prisma/schema/inventory.prisma:267-332`. | No — it is not a registered business document type and has no Task 16 lifecycle: `backend/src/modules/inventory/domain/movement-type.ts:9-19`. | No — `quantity` / `baseQuantity` are UoM quantities: `backend/prisma/schema/inventory.prisma:277-289`. | No — **NO CURRENCY AUTHORITY FOUND**: `backend/prisma/schema/inventory.prisma:267-332`. | No — stock `available` means on-hand minus reserved stock, not financial remaining amount: `backend/prisma/schema/inventory.prisma:334-340`. | No. Inventory's row locks serialize stock postings: `backend/src/modules/inventory/data/inventory-movements.repository.ts:33-52`; repurposing them would neither protect a money amount nor respect an approved cross-module endpoint contract. |
| `DocumentRelation` / `settle` | No — it carries a logical source reference, not the owner-resolved source document: `backend/src/modules/documents/application/document-relations.service.ts:59-68`. | No — it carries a logical target reference, not the target's money authority: `backend/src/modules/documents/domain/document-relation.ts:48-53`. | No — a generic relation cannot be an endpoint allow-list: `docs/tasks/task-16/brief.md:90-96`. | No — `settle` has no quantity and no money field: `backend/src/modules/documents/domain/document-relation.ts:37-45,122-145`. | No — **NO CURRENCY AUTHORITY FOUND**: `backend/prisma/schema/documents.prisma:155-181`. | No — no allocated/remaining projection or endpoint amount is stored: `backend/prisma/schema/documents.prisma:155-181`. | No. The relation service does not dereference/lock owner rows and supports deletion: `backend/src/modules/documents/application/document-relations.service.ts:59-68,122-150`. |

No entry passes all required authorities. The negative findings above are not an
invitation to derive missing financial semantics from another aggregate.

## 5. Gate Decision

### Gate Not Resolved

```text
Supported document types:
(none)
```

The exact missing Owner decisions are:

1. **Endpoint allow-list decision:** record a repository-owned *financial business
   document* only when its own current contract supplies all Task 16 endpoint
   authorities. No such document exists in this checkout. This report does not invent
   an AR/AP, Sales, Purchase, Treasury, invoice, payment, or other type to fill the
   list.
2. **Allocatable amount owner decision for each future allow-list entry:** name the
   typed document field or owner calculation that is the positive monetary
   `allocatableAmount`, its authoritative public read path, and its transaction/lock
   authority. `AccountingDocumentLine.debitAmount`, `creditAmount`, `LedgerEntry`,
   `AccountBalanceProjection`, and inventory quantities are explicitly not substitutes.
3. **Currency owner decision for each future allow-list entry:** name a stored currency
   identity and compatible-currency authority. The current repository has no such
   authority; organization scope, `numeric(18,2)`, and the base-currency assumption do
   not resolve this decision.
4. **Endpoint eligibility decision for each future allow-list entry:** name the
   document's allocatable states, reversal/cancellation/void treatment where present,
   and the owner service that can re-check them under its approved transaction and
   lock boundary. Existing Accounting and Inventory reversal mechanisms are not an
   allocation-eligibility declaration.
5. **Boundary/locking decision only after items 1–4 exist:** identify how the owning
   public service exposes a locked, same-organization endpoint/amount snapshot without
   cross-module table access. There is no current amount authority for which this can
   safely be designed.

These are missing implementation inputs, not decisions made by this investigation.
Task 16 remains fail-closed until the Owner records an actual allow-list with those
owners.

## 6. Architecture Impact

The investigation itself adds one documentation report only. It requires no new
module, no new cross-module communication, no new currency ownership, no lifecycle
change, no infrastructure, and no ADR.

**No ADR required for the investigation result itself.**

A later proposal would need an ADR before or with implementation if it changes an
ADR-gated boundary, as required by `.vardena/architecture-rules.md:124-128` and
`docs/adr/README.md:10-29`. In particular:

- a new AR/AP, Sales, Purchase, Treasury, or other module is a new module boundary;
- a new cross-module endpoint-resolution or lock/transaction protocol is a new
  cross-module communication pattern;
- a new currency owner, cross-module currency protocol, or currency persistence model
  changes a currently deferred boundary (`docs/accounting/domain-contract.md:1637-1651`);
- a new allocation/void/cancellation lifecycle changes a business lifecycle; and
- a new broker, Redis, outbox, or separate service changes infrastructure/deployment
  topology.

No such change is proposed or implied here. A bounded table/use case inside an
existing module would not alone require an ADR, but that observation does not cure the
missing endpoint contract.

## 7. Explicit Non-Decisions

This investigation deliberately does **not** decide, design, or authorize:

- a new AR/AP module or receivables/payables subledger;
- Sales or Purchase implementation, including invoices, orders, or credit notes;
- Treasury implementation, including cash, bank, payment, or reconciliation flows;
- FX, exchange rates, conversion, revaluation, or gain/loss treatment;
- a generic settlement engine, universal allocation framework, or open-item engine;
- a universal document model, shared financial-document table, or cross-module FK;
- JSONB/EAV storage for financial endpoint facts;
- a microservice, Redis, new broker, or new outbox/event infrastructure;
- a frontend, UI, client package, or frontend API work;
- a Task 16 Allocation model, migration, repository, service, controller, DTO,
  permission, endpoint, test, or production behavior; or
- production implementation authorization.

It also does not reinterpret Accounting voucher debit/credit totals, ledger entries,
balance projections, stock quantities, or DocumentRelation rows as settlement facts.

## 8. Validation

### Files changed

- `docs/tasks/task-16/implementation-gate-investigation.md` — this documentation-only
  investigation report.

### Repository inspection commands executed

- `find backend/src/modules -maxdepth 3 -type f -name '*.ts' | sort` plus targeted
  reads of Accounting, Documents, Inventory, Organization, and Workflow application,
  domain, data, API/DTO, and test files.
- `grep -rniE` searches across `backend/src/modules/**`,
  `backend/prisma/schema/**`, and `backend/prisma/migrations/**` for document types,
  invoice/receivable/payable/settlement/allocation, amount/currency, balance/
  outstanding/remaining, reversal/cancellation/void, and relation semantics.
- targeted reads of `docs/tasks/task-16/**`, `docs/accounting/**`,
  `docs/adr/**`, `docs/open-questions.md`, and document/accounting architecture
  contracts.
- structural Prisma checks: model inventory, current schemas from
  `backend/prisma/schema/base.prisma`, currency-field scan, and migration-table/
  vocabulary scan.
- repository-reference validation: a local Python static check verified every cited
  `backend/`, `docs/`, and `.vardena/` file path and cited line range in this report.
- documentation diff validation after staging the report: `git diff --cached --check`,
  `git diff --cached --name-only`, and `git status --short`.

### Results

- The repository-reference validator passed 76 distinct cited file/range references.
- Static evidence supports zero complete Task 16 endpoint candidates.
- The only registered document type is `accounting_voucher`; it lacks both a settlement
  amount authority and currency authority.
- Inventory values are stock quantities, and generic DocumentRelation records have no
  financial amount/currency semantics.
- No Task 16 implementation tests were run or claimed. No production code, Prisma
  schema, migration, controller, service, repository, DTO, permission registry,
  endpoint, frontend, architecture, or test file was changed.

## 9. Final Status

GATE BLOCKED — OWNER CONFIRMATION REQUIRED
