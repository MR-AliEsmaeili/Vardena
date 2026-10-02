# Vardena — Domain Glossary

Status: Proposed (design for review) · Updated: 2026-09-11

One definition per term, used consistently in code, docs, API and UI labels. When a
term is ambiguous in the ERP world, the **Vardena meaning** is stated explicitly and
the ambiguity is noted. Persian/Farsi aliases are listed where they are likely to
appear in UI text or user conversations (UI translation is OQ-02; display language is
not decided here).

## How to use this glossary

- Definitions here are **normative for naming** in docs, APIs and code identifiers.
- A term marked *(expert)* needs an accountant/tax/legal/inventory specialist to
  confirm the definition before implementation.
- A term marked *(OQ-xx)* has an unresolved business rule attached — see
  [`../open-questions.md`](../../open-questions.md).

## Organizational terms

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Organization** | The single legal/business entity a Vardena deployment serves (OQ-01 assumption: one organization per deployment). It owns the fiscal calendar, the chart of accounts, the configuration and all data. *(OQ-22)* | tenant/multi-company: a *second* organization in one database is **not** designed yet (OQ-22) |
| **Branch** (شعبه) | A place of business of the organization (main office, sales branch, factory) used as an **organizational scope** for documents, warehouses and reporting. A branch is not a separate set of books. *(OQ-22)* | Company/legal entity; Department |
| **Department** (دپارتمان/واحد) | An internal functional unit of the organization (Sales, Warehouse, Finance, HR) used for responsibility reporting. *(expert: whether departments are also accounting dimensions)* | Branch; Cost center |
| **Business unit** | A configurable grouping of departments/branches for reporting, when a business needs a level between organization and branch. **Not implemented in v1** unless a real requirement appears (*extensible*) | Branch |
| **Fiscal year** (سال مالی) | The accounting year of the organization. Its start date is a configuration value, not a Gregorian assumption. *(expert, OQ-23)* | Calendar year |
| **Fiscal period** (دوره مالی) | A subdivision of the fiscal year (usually a month) that can be open or closed. Documents post into a period; closed periods reject posting. *(expert, OQ-23)* | Fiscal year |
| **Organization scope** | The dimension(s) a record belongs to: `organization` (always), optionally `branch`, and optionally `department`. Stored as explicit columns (not JSON) on the tables that report by it. *(OQ-22)* | Tenancy |

## Master-data terms

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Master data / reference data** | Long-lived records other records point at (items, units, warehouses, partners, accounts, cost centers). Editable but must never break historical documents — see lifecycle rules in `master-data-strategy.md`. | Transactional data |
| **Item** (کالا/خدمت) | Anything the business buys, sells, stores or uses, described by one shared record plus a **kind** and explicit **capabilities**. Goods, services, consumables and assets are all *Items*; they differ by capability, not by table. | Product (a marketing term), SKU (a packaging/order unit, out of scope in v1) |
| **Item kind** | The current code-managed classification is `goods` (stocked physical), `service`, `consumable`, `asset`, `raw_material`, `semi_finished`, `finished_good`, `other`. Kind selects capability defaults; capabilities are stored per item. OQ-33 Option D allows a new kind only for a concrete need accepted through governance; completeness of the current list remains OPEN. | Free-text category; Item group |
| **Item capability** | An explicit boolean on the item that turns behaviour on/off: `is_stockable`, `is_purchasable`, `is_sellable`, `is_valued`, `requires_lot`, `requires_serial`, `requires_expiry`. Every behaviour the code branches on is a capability, never a string comparison. OQ-33 remains OPEN on whether the current per-item model is accepted without change. | Item kind (kind = defaults; capability = truth) |
| **Item group / category** | A hierarchical classification for reporting and defaults. Groups may supply *defaults at creation time*; they never override an existing item at runtime. | Item kind |
| **Unit (UoM)** (واحد اندازهگیری) | A unit of measure with a code, e.g. `PCS`, `KG`, `M`, `BOX`; quantities use fixed `numeric(18,4)` precision under OQ-29 Option A. Any separate display/entry precision remains open. | Packaging |
| **Unit conversion** | A rule that expresses a quantity in one unit as a quantity in another (e.g. `1 BOX = 12 PCS`). Vardena distinguishes **global** conversions (true for the unit pair) from **item-specific** conversions (only for that item). Quantities are stored in the item's **base unit**; OQ-29 Option A rejects a result that does not fit exactly, without rounding or silent truncation, and requires effective-dated factor versions with historical interpretation preserved. | Re-packing, kit/BOM |
| **Warehouse** (انبار) | A physical or logical stock location owned by a branch. Stock is always held *by warehouse* (and optionally by location). | Branch; Store (retail front) |
| **Warehouse location / bin** (قفسه/محل) | An optional finer location inside a warehouse. **Configuration-enabled per warehouse**; never required by the schema unless a business turns it on. | Warehouse |
| **Lot / batch** (سری/بچ) | A traceable production/purchase batch of an item with an identity and possibly an expiry date. Requires the item's `requires_lot` capability. | Serial number |
| **Serial number** (شماره سری ساخت) | A unique identity for a single physical unit. Requires `requires_serial`. | Lot |
| **Partner** | A business counterparty: **Customer** or **Supplier** (a row can be both; the capabilities are flags on one party record). Contacts, addresses and bank details hang off the partner. | Employee |
| **Customer** (مشتری) | A partner the organization sells to. Owns credit limit/terms settings *(OQ: credit control is not yet specified)*. | Contact person |
| **Supplier** (تأمینکننده) | A partner the organization buys from. | Vendor (same thing) |
| **Contact** | A natural person reachable through a partner (name, phone, email, role). A contact never owns balances or documents. | Partner |
| **Address** | A structured postal address belonging to a partner or branch, with a type (billing/shipping/registered). | Contact |
| **Employee** | A person employed by the organization, referenced by HR-ish attributes only (name, code, branch, department, active flag). Full HR/payroll is **out of scope** unless scoped separately *(OQ-32)*. | User (a login account) |
| **Cost center** (مرکز هزینه) | An accounting dimension for classifying costs. Whether Vardena treats it as a first-class dimension or as a project-like tag is expert-gated *(OQ-25)*. | Department (organizational, not accounting-approved) |
| **Project** (پروژه) | An accounting/analytical dimension for attributing revenue and cost to a job or contract. Scope and behaviour are expert-gated *(OQ-25)*. | Cost center |
| **Currency** (ارز) | A monetary unit with a code and precision. v1 assumes a single base currency; multi-currency behaviour is OQ-03. | Exchange rate |
| **Tax** (مالیات) | A configured rate/rule applied to a document line (e.g. VAT). Vardena models tax as **configuration data + explicit document fields**; the legal rules and rates are expert-gated *(OQ-30)*. | Taxpayer-system integration status (OQ-05) |

## Document terms

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Business document** | A transactional record with a lifecycle: header + lines, a number, a date, a status, and (usually) a financial or stock effect. Examples: quotation, sales order, invoice, inventory receipt/issue/transfer/adjustment. | Master data; system record |
| **Document type** | A code-defined kind of business document (e.g. `Sales.Invoice`, `Inventory.Receipt`) owned by exactly one module. The type determines the table, the permission namespace, the number series and the allowed workflow. | Document *instance* |
| **Document line** | A row of a document holding the economic content (item/service, quantity, unit, unit price, discount, tax, and the warehouse/location/cost-center/project dimensions). | Header |
| **Status** | The lifecycle state of a document (`draft`, `approved`, `posted`, `cancelled`, …). Status values are **code-defined per document type** — configuration selects behaviour *within* the allowed set, it cannot invent states (see `workflow-architecture.md`). | Stage/step |
| **Transition** | A change of status, performed by an actor, optionally requiring approval and/or emitting events. Transitions are audited. | Update |
| **Posting** | The act that makes a document's economic effects permanent and (usually) irreversible: stock movements and/or journal entries are created. Posted documents are corrected by reversal/counter-documents, not by editing. | Approval |
| **Approval** | An authorization decision that a transition may happen (e.g. manager approves an order above a threshold). | Permission (role capability) |
| **Cancellation** | Ending a document's life before it produced ledger effects, preserving it for audit. | Deletion; Reversal |
| **Reversal** | A counter-document that neutralizes a posted document (negative journal, opposite stock movement) while both remain in history. | Editing a posted document |
| **Source document / target document** | The two ends of a *document relation*: e.g. an invoice is the target of a quotation and the source of an inventory issue. | Parent/child (a purely structural concept; Vardena links documents, it does not nest them) |
| **Document relation** | A typed, quantity-aware link between two documents (`reference`, `derive`, `fulfill`, `reverse`, …), with line-level quantities where partial fulfillment is possible. See `document-architecture.md`. | Foreign key to a "parent" |
| **Document number** | The human-facing business number (e.g. invoice no.). Format, scope (org/branch/warehouse), gap policy and whether it is auto-assigned are **business rules — OQ-12; do not invent**. | Primary key (`id`, ULID) |

## Inventory terms

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Stock movement** | An immutable, signed record that quantity of an item moved into or out of a warehouse/location on a date, with a movement type and (when known) a unit cost. The **source of truth** for stock (ADR-0017). | Document line |
| **Movement type** | A closed, code-defined classification of *why* stock moved (`purchase_receipt`, `sales_issue`, `transfer_out`, `transfer_in`, `adjustment_gain`, `adjustment_loss`, `opening`, `return_in`, `return_out`, …). Reports group by it; it is not user-extensible. | Document type |
| **Stock balance** | The quantity on hand for (item, warehouse, location, lot/serial) at a point in time. Vardena keeps a **materialized balance row** updated in the same transaction as the movement, rebuildable from the ledger. | Ledger |
| **Opening balance** | Stock (and its value) present when a warehouse/accounting area starts being used in Vardena. Recorded as explicit movements (`opening`) dated before the first live transaction. *(OQ-23 relates to accounting opening balances.)* | Adjustment |
| **Inventory valuation** | Assigning a monetary value to stock (and to cost of goods sold). **Method is an accounting decision (moving weighted average, FIFO, standard cost) — OQ-24, expert-gated.** The inventory data model must not force one. *(expert)* | Pricing |
| **Negative stock** | Stock balance below zero. Whether it is allowed is a **policy** configuration, per item and/or per warehouse *(OQ-24)*; the default when the policy is undecided is **reject** (fail closed). | Backorder |
| **Reservation** | A soft claim on stock (e.g. an approved sales order) that does not move stock or change the balance report; it is tracked separately as `reserved_quantity`. Whether reservations exist in v1 is a workflow decision *(OQ-26 depends on it)*. | Movement |

## Accounting terms (all expert-gated)

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Account** | A node in the chart of accounts; journal lines reference accounts. Structure (code scheme, hierarchy, levels) is expert-gated *(OQ-25)*. | Cost center |
| **Chart of accounts (CoA)** | The organization's account tree. Options and recommendation in `accounting-domain-analysis.md` §2. *(expert)* | Ledger |
| **Journal entry (voucher)** (سند حسابداری) | An immutable double-entry record with ≥2 lines whose debits equal credits. | Document (it is a document type too, but with the strictest rules) |
| **Posting rule / mapping** | The Accounting-owned mapping from a business event (e.g. `InventoryReceipt.Created`) to a journal template (accounts, debit/credit sides, amount sources). Mapping rules belong to Accounting only (AR-16, ADR-0005). *(expert)* | Automation rule |
| **Accounting period close** | Making a fiscal period read-only for posting. Reopening, if allowed at all, is an expert/legal decision *(OQ-23)*. *(expert)* | Document posting |
| **Trial balance / ledger / balance sheet / P&L** | Standard financial reports derived from journal lines. The **report formats** (column layout, Iranian statutory formats) are expert-gated. *(expert)* | Operational reports |
| **Cost of goods sold (COGS)** | The accounting expense recognized when stock leaves the business, derived from the valuation method. *(expert, OQ-24)* | Purchase price |

## Configurability terms

| Term | Vardena meaning | Not to be confused with |
|---|---|---|
| **Configuration** | Organization-level data that changes *behaviour* without code changes: settings, workflow definitions, numbering rules, tax rates, templates, custom-field definitions. Configuration is versioned/effective-dated where it affects documents (see `configurability-architecture.md`). | Preference (per-user UI data, Customization module) |
| **Extension point** | A documented place where code (a module, an adapter, a provider) plugs in without modifying existing code: domain events, `reports/`, `imports/`, `documents/`, adapter ports, permission registrations. | Configuration |
| **Custom field** | An organization-defined extra attribute stored in a whitelisted JSONB column, governed by a code-defined definition registry. Only for descriptive data — never for amounts, quantities, dimensions or anything reported on (see `configurability-architecture.md` §5). | Core column |
| **Workflow definition** | A versioned, organization-owned configuration that maps a document type's allowed transitions to required permissions, approvals and automation. It cannot invent states or transitions outside the code-defined set. | Workflow engine |
| **Effective date** | The date from which a configuration version applies. Documents capture the version that was active for them, so history is never reinterpreted. | Document date |
| **System context** | Execution with no HTTP request/principal (bootstrap, worker, jobs) where authorization is the caller's responsibility (ADR-0016). | Anonymous request |
