# Domain Decision Register

Status: Proposed (design for review) · Updated: 2026-09-11

One row per consequential domain decision. Each entry states the problem, the options
considered, pros/cons, the recommendation, the reason, the consequences, and whether
domain-expert validation is required. Detailed analysis lives in the linked documents.

Legend for **Expert?**: `—` no · `accounting` · `tax` · `inventory` · `legal` ·
`implementation` (ERP implementation expertise).

---

## D-01 — Organization scope model

- **Problem:** Should v1 carry a company/branch/department dimension, or stay flat?
- **Options:** (O-1) flat single organization; (O-2) organization + branch dimension;
  (O-3) multi-company in one database; (O-4) tenant-per-organization.
- **Pros/cons:** O-1 is simplest but cannot report per branch and is retrofit-hostile;
  O-2 covers real single-company businesses at the cost of one column per fact table;
  O-3/O-4 add large complexity for needs not yet confirmed.
- **Recommendation:** **O-2** — one organization per deployment, `branch_id` as a
  first-class scope on documents/ledgers/warehouses, departments as organizational
  master data.
- **Reason:** matches OQ-01's assumption and on-premise reality, keeps reporting simple,
  and avoids a future migration that would rewrite history.
- **Consequences:** every document/movement/journal/balance table carries `branch_id`;
  branch ≠ legal entity must be documented for users; multi-company stays deferred.
- **Docs:** [blueprint](./domain-blueprint.md) §11, [master data](./master-data-strategy.md) §2,
  ADR-0020 (proposed), OQ-22.
- **Expert?** accounting/implementation (branch semantics).

## D-02 — Ownership of party master data (customers/suppliers)

- **Problem:** Sales owns customers, Purchasing owns suppliers in `docs/modules.md`;
  a business partner is often both.
- **Options:** (a) keep separate customer/supplier masters per module; (b) one party
  record owned by a shared/organization module with capability flags; (c) a shared
  `kernel` table (forbidden by AR-06).
- **Pros/cons:** (a) allows per-module fields but duplicates identity, breaks
  receivable/payable per counterparty, and re-creates the partner twice; (b) one identity,
  one credit/terms profile, capabilities for roles; (c) violates kernel purity.
- **Recommendation:** **(b)** — the Organization module owns the party master
  (contacts, addresses, bank accounts); Sales/Purchasing own commercial relationships
  (price lists, credit enforcement, statements).
- **Reason:** "one owner per fact" (AR-08); counterparty reporting must be possible.
- **Consequences:** changes the module catalog entry — needs ADR-0020 acceptance;
  Sales/Purchasing keep their specialized tables referencing `party_id`.
- **Docs:** [master data](./master-data-strategy.md) §5, ADR-0020 (proposed).
- **Expert?** —, implementation (migration impacts).

## D-03 — Accounting owns meaning; operations own facts

- **Problem:** Where do accounting rules live?
- **Options:** mapping inside each operational module; mapping inside Accounting;
  a shared "posting" module.
- **Pros/cons:** per-module mapping duplicates and drifts; Accounting-owned mapping
  centralizes expert-reviewed rules (existing AR-16); a new module adds nothing.
- **Recommendation:** reaffirm **AR-16/ADR-0005** — operational modules publish events;
  Accounting owns accounts, periods, journals and event→journal mappings.
- **Reason:** single place for accounting rules; modules stay free of financial policy.
- **Consequences:** Accounting may be **disabled per organization** (D-19) so
  undecided accounting does not block operational ERP use.
- **Docs:** [accounting analysis](./accounting-domain-analysis.md) §1/§5.
- **Expert?** accounting.

## D-04 — Inventory source of truth

- **Problem:** balance-authoritative, movement-authoritative, or both?
- **Options:** A balance only; B movements only; C movements + materialized balance.
- **Pros/cons:** A is fast but leaves no history and cannot value/explain stock;
  B is auditable but slow for reads; C needs consistency discipline but gives both.
- **Recommendation:** **C** — immutable movement ledger is authoritative; balances are
  materialized in the same transaction and rebuildable.
- **Reason:** audit/legal requirement (AR-13) plus operational read performance; enables
  reconciliation and any valuation method.
- **Consequences:** balance rows must be updated under a lock; a reconciliation job and
  rebuild tool are required from day one.
- **Docs:** [inventory](./inventory-domain-analysis.md) §1, ADR-0017 (proposed).
- **Expert?** inventory/accounting (valuation interactions).

## D-05 — Movements are signed, typed and immutable

- **Problem:** How to represent stock changes so reports and valuation work?
- **Options:** signed quantity + closed `movement_type`; separate in/out tables;
  document-only representation (derive movements from documents).
- **Pros/cons:** separate tables double every query; document-only representation
  cannot express adjustments/opening/counter-movements.
- **Recommendation:** one movement table, **signed base-unit quantity**, closed type
  enum, logical document link, audit columns, counter-movements for corrections.
- **Reason:** simple aggregation, meaningful grouping, complete history.
- **Consequences:** every writer must normalize to the base unit (conversion at the
  edge); adjustment reasons become a required field.
- **Docs:** [inventory](./inventory-domain-analysis.md) §2.
- **Expert?** inventory.

## D-06 — Valuation method is configuration consuming the ledger

- **Problem:** Which costing method, and how does it shape the schema?
- **Options:** bake one method into the movement table; infer a method per movement;
  represent valuation as a strategy consuming the ledger (recommended).
- **Pros/cons:** baking a method in makes a later change a migration of history;
  inferring per movement makes reports ambiguous; a consuming strategy keeps the
  quantity model stable and lets the method be chosen per organization.
- **Recommendation:** **the ledger + balance carry quantity and the cost actually
  assigned**; the *method* (moving average / FIFO / standard) is organization
  configuration evaluated by an Accounting-owned engine reading movements;
  method-specific state (average state, cost layers) is derived and rebuildable.
- **Reason:** valuation policy is an accounting decision (OQ-24) and must not be
  hard-coded; quantity correctness must be independent of valuation correctness.
- **Consequences:** valuation is re-computable for audit/repair; changing method
  affects the future, not posted history; valuation reports stay marked "requires
  accounting configuration" until OQ-24 is answered.
- **Docs:** [inventory](./inventory-domain-analysis.md) §5, OQ-24, ADR-0017
  (proposed), D-19.
- **Expert?** accounting/inventory.

## D-07 — Reservations are separate; negative stock is a fail-closed policy

- **Problem:** How is committed-but-not-moved stock represented, and may stock go
  negative?
- **Options:** reservations as movements; reservations as balance counters; negative
  stock always allowed / always rejected / policy per warehouse with item override.
- **Pros/cons:** movement-based reservations pollute the ledger and valuation;
  counter-based reservations keep the ledger a record of facts; allowing negatives
  makes valuation undefined, while rejecting them outright can block receiving flows.
- **Recommendation:** **reservations are their own dimensions on the balance row**
  (availability = quantity − reserved); **negative stock is policy** per warehouse with
  item override, **defaulting to reject** until the business confirms (OQ-24).
- **Reason:** availability is an operational promise, not a movement; fail-closed
  avoids inventing a costing rule.
- **Consequences:** the reservation lifecycle (who may release, expiry, partial
  fulfilment) must be specified before reservations are enforced (OQ-26); the policy
  switch is configuration (D-20/D-21).
- **Docs:** [inventory](./inventory-domain-analysis.md) §4, OQ-24, OQ-26, ADR-0017.
- **Expert?** inventory/accounting.

## D-08 — Document foundation: typed tables + shared mechanics

- **Problem:** independent models, one universal table, or a shared foundation?
- **Options:** A/B/C/D compared in [document architecture](./document-architecture.md) §2.
- **Pros/cons:** A duplicates mechanics; C destroys integrity/reporting; D couples
  schemas via a shared table.
- **Recommendation:** **B** — typed, module-owned tables following a common document
  contract, with shared *mechanics* (numbering, transition history, relation table).
- **Reason:** type safety and reportability with uniform behaviour.
- **Consequences:** each new document type adopts the contract (a checklist, not a
  framework); shared mechanics are the only cross-module structure.
- **Docs:** [documents](./document-architecture.md) §2–§4, ADR-0019 (proposed).
- **Expert?** —.

## D-09 — Document relations: closed kinds, line-level quantities, logical links

- **Problem:** How flexible may document relationships be?
- **Options:** hard-code the one true process; a generic graph of arbitrary links;
  closed relation kinds with quantity-aware links (recommended).
- **Pros/cons:** hard-coding rules out valid businesses; an arbitrary graph is
  unreviewable and unenforceable.
- **Recommendation:** **closed kind list** (`reference`, `derive`, `fulfill`, `settle`,
  `reverse`, `transfer_of`) with line-level quantity rows; cross-module links are
  **logical ids**, not FKs (AR-07/08).
- **Reason:** partial fulfilment must be reportable in SQL; module boundaries must
  survive; kinds must remain governable.
- **Consequences:** cross-module referential integrity is enforced by the creating
  service, not by the database; a relation registry/report is needed for operations.
- **Docs:** [documents](./document-architecture.md) §5, ADR-0019 (proposed).
- **Expert?** —, implementation.

## D-10 — Cancellation vs reversal semantics

- **Problem:** How are mistakes corrected?
- **Options:** edit with permission; delete; cancel before posting + reverse after posting.
- **Pros/cons:** editing/destroying history breaks audit and legal defensibility;
  cancel/reverse preserves the trail at the cost of a counter-document workflow.
- **Recommendation:** **cancel unposted, reverse posted** (§6 of the document doc);
  never edit a posted document.
- **Reason:** AR-13 immutability; the ledger accumulates facts and counter-facts.
- **Consequences:** UI must present reversal as a first-class action; reversal policies
  (window, approval, cross-period) need expert input.
- **Docs:** [documents](./document-architecture.md) §6, OQ-27.
- **Expert?** accounting/legal.

## D-11 — Numbering is configuration, allocated in-transaction

- **Problem:** where do business document numbers come from?
- **Options:** database identity/sequence per table; free user entry; configurable
  series with locked allocation (recommended).
- **Pros/cons:** sequences can't express per-branch/year formats; free entry creates
  duplicates and legal gaps; configurable series needs a counter row + lock.
- **Recommendation:** `numbering_series` configuration; allocation inside the write
  transaction (`SELECT … FOR UPDATE` on the counter, or a sequence per series); numbers
  are never reused.
- **Reason:** matches AR-12/`database-strategy.md` §4 and keeps legal formats
  configurable without code.
- **Consequences:** numbering is a hot row under load (mitigated by short transactions);
  gap policy remains an expert decision.
- **Docs:** [documents](./document-architecture.md) §7, OQ-12.
- **Expert?** accounting/legal.

## D-12 — Chart of accounts: hybrid template + organization detail

- **Problem:** how flexible may the chart of accounts be?
- **Options:** fixed system chart; standard template + customization; fully
  organization-defined; hybrid with code-defined control roles.
- **Pros/cons:** in [accounting analysis](./accounting-domain-analysis.md) §2.
- **Recommendation:** **hybrid** — control roles in code, mapped once per
  organization; detail accounts/hierarchy/coding owned by the organization.
- **Reason:** automated posting must not depend on customer-specific codes, yet
  businesses must keep their own chart.
- **Consequences:** posting mapping is a per-organization configuration artefact that
  must be tested; statutory report layouts map to ranges/roles.
- **Docs:** [accounting analysis](./accounting-domain-analysis.md) §2, OQ-25.
- **Expert?** accounting.

## D-13 — Pricing: explicit price lists, no pricing engine (v1)

- **Problem:** How are prices determined?
- **Options:** free entry only; configured price lists; rule/formula engine;
  scripted pricing.
- **Pros/cons:** free entry is simple but unauditable; price lists cover SMB needs;
  engines are unbounded scope.
- **Recommendation:** **price lists as configuration data with effective dates**;
  discounts explicit on lines; a promotion/pricing engine is a later, designed feature.
- **Reason:** covers real use without opening an unbounded rule surface.
- **Consequences:** promotions must be entered as list versions or line discounts in v1.
- **Docs:** [master data](./master-data-strategy.md) §6, OQ-34.
- **Expert?** —, implementation.

## D-14 — Customer credit control is deferred

- **Problem:** Does Vardena block sales when a customer exceeds a credit limit?
- **Options:** no credit control in v1; warn only; hard block with override permission.
- **Pros/cons:** hard blocking without policy clarity creates operational deadlocks;
  ignoring credit entirely is unacceptable for many businesses.
- **Recommendation:** **defer**; store credit limit/terms on the party profile and
  provide a *warning* surface, but no enforcement until policy is defined.
- **Reason:** enforcement semantics (scope, override authority, aging) are business
  decisions that must be specified, not guessed.
- **Consequences:** credit policy becomes a registered open question before Sales ships.
- **Docs:** [master data](./master-data-strategy.md) §5, OQ-35.
- **Expert?** accounting/implementation.

## D-15 — Workflow structure is code; enablement is versioned configuration

- **Problem:** How configurable is a business's document flow?
- **Options:** hard-coded flow; generic engine; code-defined edges with configuration
  over enablement/approval/automation (recommended).
- **Pros/cons:** in [workflow](./workflow-architecture.md) §1/§8.
- **Recommendation:** statuses/transitions/permissions in code; **versioned workflow
  definitions** select enabled edges, approval conditions and automation bindings.
- **Reason:** supports the three sample businesses without an engine and keeps reports,
  permissions and validation type-safe.
- **Consequences:** new states require code + ADR; configuration needs publish workflow
  and permissions.
- **Docs:** [workflow](./workflow-architecture.md), ADR-0018 (proposed), OQ-26.
- **Expert?** implementation (approval practice), accounting (approval thresholds).

## D-16 — Workflow versioning pinned per document

- **Problem:** What happens to documents when the workflow changes?
- **Options:** reinterpret all documents with the newest rules; pin the version per
  document; migrate everything.
- **Pros/cons:** reinterpretation corrupts history; pinning is safe and auditable;
  mass migration is an explicit operation.
- **Recommendation:** **pin `workflow_version_id` on each document (and each
  transition row)**; changing configuration affects future/open documents, and any
  migration of open documents is an audited explicit action.
- **Reason:** historical integrity (§ blueprint 14).
- **Consequences:** version metadata must be visible in document history UIs; version
  table never deleted.
- **Docs:** [workflow](./workflow-architecture.md) §3, ADR-0018 (proposed).
- **Expert?** legal/accounting (audit expectations).

## D-17 — Automations from a registered catalogue, idempotent

- **Problem:** How do "when X happens, do Y" rules work?
- **Options:** user scripts; declarative triggers + registered actions (recommended);
  hard-coded side effects per document type.
- **Pros/cons:** scripts are a security/maintenance sink; hard-coding rules out
  Business B/C; a catalogue is bounded and testable.
- **Recommendation:** **actions in code with typed parameters**; configuration binds
  trigger → action; execution idempotent with a stable key; external effects via outbox
  (AR-14).
- **Reason:** predictable, testable, auditable automation without a scripting surface.
- **Consequences:** new automations need code; the catalogue must be documented per
  module (which actions it exposes).
- **Docs:** [workflow](./workflow-architecture.md) §2.5, ADR-0018 (proposed).
- **Expert?** —.

## D-18 — Approvals: single-level in v1, recorded as evidence

- **Problem:** How deep does the approval model go at launch?
- **Options:** no approvals; boolean approved flag; single-level recorded approvals;
  multi-level/parallel chains.
- **Pros/cons:** a boolean loses who/when/under-what-rule; multi-level needs
  delegation/escalation design and UI.
- **Recommendation:** **single-level, condition-bounded, recorded approvals** in v1
  (actor, time, permission, comment, workflow version, document); multi-level,
  delegation and escalation are extension points.
- **Reason:** covers real segregation-of-duties needs; keeps the first iteration small
  and auditable.
- **Consequences:** businesses needing two-level approval must wait for the extension
  (explicitly registered as OQ-26).
- **Docs:** [workflow](./workflow-architecture.md) §2.4/§4.
- **Expert?** accounting/implementation (segregation of duties).

## D-19 — Accounting can be disabled per organization

- **Problem:** operational modules (inventory, sales) may be needed before accounting
  rules are decided.
- **Options:** block all ERP work until accounting is signed off; ship accounting
  partially/guessed; operational modules ship with accounting features switched off.
- **Pros/cons:** blocking delays value delivery; guessing risks wrong books; a switch
  keeps the books clean while operations start.
- **Recommendation:** **feature switch per organization** — documents and stock work
  fully; posting/mapping is disabled until the accountant's mapping is loaded.
- **Reason:** honest treatment of the expert boundary; no invented accounting rules.
- **Consequences:** inventory valuation reports are marked "requires accounting
  configuration" until enabled; enabling is a permission-gated, audited action.
- **Docs:** [accounting analysis](./accounting-domain-analysis.md) §5/§8.
- **Expert?** accounting.

## D-20 — Configuration owned by the Organization module, read via its service

- **Problem:** Where does cross-module configuration live?
- **Options:** kernel (forbidden: business data); each module silently owns its own;
  a dedicated Organization module (recommended).
- **Pros/cons:** kernel would violate AR-06; distributed ownership makes effective
  dating/scoping inconsistent; one module gives one pattern.
- **Recommendation:** a new **`organization` module** owns settings, numbering, taxes,
  workflow definitions, custom-field definitions and the organization structure;
  other modules read through its public service (AR-07).
- **Reason:** one place for "how this business works", one permission namespace, one
  audit trail, consistent versioning.
- **Consequences:** module catalog + schema list update; ADR-0020 required before code.
- **Docs:** [configurability](./configurability-architecture.md) §3, ADR-0020 (proposed).
- **Expert?** —.

## D-21 — Effective dating + version pinning as the history mechanism

- **Problem:** How do configuration changes avoid corrupting history?
- **Options:** no versioning (in-place edits); full temporal tables everywhere;
  effective-dated rows + pinned versions where interpretation matters.
- **Pros/cons:** in-place edits corrupt history; temporal tables everywhere are heavy;
  targeted versioning is proportionate.
- **Recommendation:** **effective-dated configuration rows + explicit version
  references from documents/journals/movements**; in-place edits of *used* rows are
  forbidden.
- **Reason:** auditable, point-in-time reproducible, low overhead.
- **Consequences:** every consumer table must carry the version/ snapshot columns from
  the start (adding them later means backfilling history).
- **Docs:** [configurability](./configurability-architecture.md) §4.
- **Expert?** accounting/legal (audit evidence).

## D-22 — Custom fields limited and governed

- **Problem:** How are customer-specific extra fields supported?
- **Options:** EAV tables; JSONB everywhere; registry-governed JSONB on a whitelist
  (recommended); no custom fields at all.
- **Pros/cons:** EAV/JSONB-everywhere destroys integrity/reporting; none at all pushes
  customers to hack the schema.
- **Recommendation:** **registry-governed `custom_fields` JSONB on a whitelisted set of
  entities**, validated server-side, with a promotion path to real columns.
- **Reason:** real need (descriptive metadata) without weakening the relational core.
- **Consequences:** enabling custom fields requires the registry in the first
  `organization` migration; financial documents are excluded until reviewed.
- **Docs:** [configurability](./configurability-architecture.md) §5, OQ-28.
- **Expert?** legal (if a "custom" field is legally required → promote).

## D-23 — No universal rules engine

- **Problem:** Should Vardena offer a general business-rule/workflow engine?
- **Options:** generic engine; hard-coded rules; **bounded rule categories implemented
  in code with narrow configuration** (recommended).
- **Pros/cons:** an engine looks flexible but is unreviewable, untestable, hard to
  secure and impossible to report on; hard-coding every rule blocks legitimate
  variation.
- **Recommendation:** the **six rule categories** of
  [configurability](./configurability-architecture.md) §6, each with a designed
  configuration surface.
- **Reason:** flexibility with guarantees (type safety, reporting, audit).
- **Consequences:** every new configurable rule needs a small design; the product
  backlog carries those designs.
- **Docs:** [configurability](./configurability-architecture.md) §6,
  [blueprint](./domain-blueprint.md) §17.
- **Expert?** —.

## D-24 — Inter-branch and inter-company treatment is decided explicitly

- **Problem:** Do warehouse/branch transfers create accounting events?
- **Options:** never (same books); internal clearing accounts; full internal invoicing.
- **Pros/cons:** internal invoicing in one legal entity is usually unnecessary and adds
  tax/document noise; ignoring it entirely may be wrong for some setups (segregated
  reporting, internal profit centres).
- **Recommendation:** **branch scope by default with no accounting entry for internal
  transfers**; the transfer document is inventory-only. Full internal settlement and
  multi-company accounting are deferred to a designed feature (OQ-31).
- **Reason:** avoids inventing an accounting policy; keeps branch reporting possible.
- **Consequences:** if a business needs internal settlement, it is a follow-up ADR.
- **Docs:** [inventory](./inventory-domain-analysis.md) §3, OQ-31.
- **Expert?** accounting.

## D-25 — Item model: one Item + kind + capability flags

- **Problem:** How to model goods, services, consumables and assets without exploding
  into per-type tables or EAV.
- **Options:** one table with free-text type; one table + closed kind + capability
  flags; table per kind; EAV attributes; JSONB attributes.
- **Pros/cons:** listed in [master data](./master-data-strategy.md) §3.1.
- **Recommendation:** **one Item table + closed kind (defaults) + explicit capability
  flags (truth)**; no variants/BOM in v1.
- **Reason:** one identity for documents/reports/permissions, per-item exceptions
  possible, no type-based branching in code.
- **Consequences:** validation rules keyed on capabilities; adding a kind or capability
  is a code change and, under OQ-33 Option D (Owner decision, 2026-10-02), also
  requires a concrete need and accepted project governance. The existing eight
  kinds/current per-item capability model is not confirmed without change;
  variants/BOM are a later, designed extension.
- **Docs:** [master data](./master-data-strategy.md) §3,
  [OQ-33 product record](../../decisions/product/OQ-33-item-taxonomy-and-capabilities.md).
- **Expert?** inventory (capability semantics for regulated goods).

## D-26 — Units: base-unit storage with explicit, effective-dated conversions

- **Problem:** Where is a quantity's unit resolved, and what happens to fractional
  units?
- **Options:** store the entered unit only; store the base unit only; store both
  (recommended); per-document rounding rules.
- **Pros/cons:** entered-only blocks aggregation; base-only loses printable values;
  storing both costs one extra column per line and gives correct reports *and*
  documents.
- **Recommendation:** **store both** — entered quantity/unit for documents, converted
  base quantity for ledgers; conversions are data (global + item-specific); precision
  and factors are effective-dated configuration.
- **Reason:** every stock report must aggregate one unit; printed documents must show
  what the user typed.
- **Consequences:** OQ-29 Option A (Owner decision, 2026-10-02) fixes four
  fractional decimal places, rejects non-exact results, forbids rounding or
  silent truncation, and requires effective-dated factors with preserved
  historical interpretation. Separate presentation/entry, complete
  backdating/correction, and downstream policy questions remain open; conversion
  changes never reinterpret recorded quantities (D-21).
- **Docs:** [master data](./master-data-strategy.md) §3.4,
  [OQ-29 product record](../../decisions/product/OQ-29-quantity-precision-and-conversion.md).
- **Expert?** inventory/accounting.

---

## Summary table

| # | Decision | Recommendation | Expert? |
|---|---|---|---|
| D-01 | Organization scope | O-2 organization + branch dimension | accounting/implementation |
| D-02 | Party master ownership | Organization module owns parties | implementation |
| D-03 | Accounting meaning vs operational facts | AR-16 reaffirmed | accounting |
| D-04 | Inventory source of truth | Ledger + materialized balance | inventory/accounting |
| D-05 | Movement representation | Signed, typed, immutable | inventory |
| D-06 | Valuation method | Ledger-consuming strategy; no schema lock-in | accounting/inventory |
| D-07 | Reservations & negative stock | Separate reservations; reject negatives by default | inventory/accounting |
| D-08 | Document foundation | Typed tables + shared mechanics | — |
| D-09 | Document relations | Closed kinds, line-level links, logical refs | implementation |
| D-10 | Cancellation/reversal | Cancel unposted; reverse posted | accounting/legal |
| D-11 | Numbering | Configured series, in-transaction allocation | accounting/legal |
| D-12 | Chart of accounts | Hybrid control roles + org detail | accounting |
| D-13 | Pricing | Price lists as configuration; no engine | implementation |
| D-14 | Credit control | Deferred; warn only | accounting/implementation |
| D-15 | Workflow flexibility | Code structure + versioned configuration | implementation |
| D-16 | Workflow versioning | Pinned per document | legal/accounting |
| D-17 | Automations | Registered catalogue, idempotent | — |
| D-18 | Approvals | Single-level recorded approvals in v1 | accounting/implementation |
| D-19 | Accounting activation | Feature switch per organization | accounting |
| D-20 | Configuration ownership | New Organization module | — |
| D-21 | History mechanism | Effective dating + version pinning | accounting/legal |
| D-22 | Custom fields | Governed JSONB whitelist + promotion path | legal |
| D-23 | Rules engine | None; six bounded categories | — |
| D-24 | Inter-branch/internal settlement | Inventory-only transfers; settlement deferred | accounting |
| D-25 | Item model | One Item + kind + capabilities | inventory |
| D-26 | Units/conversions | Store both; base-unit ledgers | inventory/accounting |
