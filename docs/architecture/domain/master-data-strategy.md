# Master Data Strategy — scope, ownership, item model, lifecycle

Status: Proposed (design for review) · Updated: 2026-09-11
Companion: [blueprint](./domain-blueprint.md) · [glossary](./domain-glossary.md) ·
ADRs [0020](../../adr/0020-organizational-scope-and-master-data.md) (proposed),
[0017](../../adr/0017-inventory-ledger-as-source-of-truth.md) (proposed) ·
OQ-22, OQ-24, OQ-29, OQ-31, OQ-32

Master data is the part of the model that changes slowly and is referenced by
everything else. Getting its shape wrong is expensive (migrations touch history);
this document fixes **scope, ownership, identity and lifecycle** before any master
table exists.

---

## 1. Master-data inventory and classification

Classification legend: **C** = core (stable spine), **G** = configurable,
**X** = extensible, **E** = needs domain-expert validation.

| Master entity | Class | Owner (module) | Scope | Notes |
|---|---|---|---|---|
| Organization (settings root) | C + G | Organization (proposed) | singleton | Fiscal calendar, defaults, feature switches |
| Branch | C + G | Organization | organization | Reporting/scope dimension; not a legal entity (OQ-22) |
| Department | G | Organization | organization | Responsibility reporting; accounting-dimension use is expert-gated |
| Employee | G | Organization | branch/department | Minimal reference data; HR/payroll scope is OQ-32 |
| Cost center | C + E | Accounting | organization | Accounting dimension (OQ-25) |
| Project | G + E | Accounting | organization | Analytical dimension (OQ-25) |
| Account (chart of accounts) | C + G + E | Accounting | organization | See `accounting-domain-analysis.md` §2 |
| Currency | C + G | Organization (kernel-ish reference) | organization | Precision/base currency OQ-03 |
| Unit of measure (UoM) | C | Inventory (master data) | organization | Decimal precision per unit (OQ-29) |
| Unit conversion | C + G | Inventory | organization and/or item | Global + item-specific pairs (OQ-29) |
| Item group (category tree) | G | Inventory | organization | Defaults + reporting classification |
| Item | C + G | Inventory | organization | Kind + capability flags (this doc §3) |
| Warehouse | C + G | Inventory | branch | Belongs to exactly one branch |
| Warehouse location | G | Inventory | warehouse | Enabled per warehouse (§4) |
| Lot / batch | C (when `requires_lot`) | Inventory | item + warehouse | Traceability; expert for regulated industries |
| Serial number | C (when `requires_serial`) | Inventory | item | Traceability |
| Partner (customer/supplier) | C + G | Sales (customer) / Purchasing (supplier) — one party table, see §5 | organization | Contact/address children |
| Contact / Address | C | same as partner | partner | Never owns balances |
| Price list (sales/purchase) | G | Sales / Purchasing | organization (+ branch option) | v1: explicit lines, no price engine (§6) |
| Tax (rate/group) | G + E | Organization (config) | organization | Used by Sales/Purchasing; expert OQ-30 |
| Numbering series | G + E | Organization (config) | organization/branch/type | Legal rules OQ-12 |
| Document template / letterhead | G | Print | organization/branch | Print module owns templates (ADR-0012) |
| Workflow definition (versioned) | G | Organization (config) | document type | ADR-0018 |
| Custom-field definition | G | Customization | entity type | Registry, `configurability-architecture.md` §5 |

**Ownership principle.** Each entity is owned by exactly one module (AR-08) and
lives in that module's schema (AR-09); other modules read it through the owner's
public application service or a module-owned view (AR-07). Where the table currently
has no natural owner (currencies, taxes, numbering, workflow definitions), the
proposed `organization` module owns it (ADR-0020) — deliberately *not* `kernel/`,
which must stay technical (AR-06).

---

## 2. Organizational scope model

### 2.1 Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| **O-1: Flat, single organization** (no branch concept) | Organization only; no branch/department columns | Simplest schema, least code | Cannot report per branch, cannot scope numbering/warehouses; retrofitting later touches every document and ledger table |
| **O-2: Organization + branch dimension** (recommended) | One organization; branch is a typed column on documents, warehouses, journals, balances; departments for responsibility reporting | Covers real single-company businesses (main + branches), keeps reports simple, retrofit-safe | Requires discipline: every document/ledger table carries `branch_id`; branch semantics must be agreed (OQ-22) |
| **O-3: Multi-company (2+ legal entities in one DB)** | `company_id` everywhere, inter-company documents, consolidation | One deployment can serve a group | Large complexity: inter-company accounting, permissions, numbering, fiscal calendars per company. Needs its own ADR and a full-domain review |
| **O-4: Tenant-per-organization** (`organization_id` everywhere) | SaaS-style isolation | Cloud multi-tenant path | v1 is on-premise single-org (OQ-01); adds cost for a path nobody uses yet |

### 2.2 Recommendation

**O-2.** One organization per deployment (OQ-01 assumption), with **branch as a
first-class scope** and **department** as organizational master data.

Reasons:

1. It matches the documented assumption (OQ-01) and the deployment reality
   (on-premise installation per business).
2. It is *retrofit-hostile to ignore*: adding `branch_id` to a ledger after
   production data exists means rewriting history. Adding it now costs one column per
   relevant table.
3. It keeps reports simple: "sales by branch" is a `GROUP BY branch_id`, not a join
   through a hierarchy table.
4. Branches are **not** separate books; consolidation is unnecessary, but branch
   P&L/stock reports are possible because every fact carries the column.

**Consequences to design for immediately (even if the module ships later):**

- Every document, movement, journal line and balance row carries `branch_id`
  (nullable only where a branch is genuinely undefined, e.g. organization-wide
  configuration).
- Warehouses belong to a branch (a warehouse never spans branches).
- Numbering series may be scoped per branch (OQ-12 decides format/scope).
- Permissions can be **scoped** later (a user restricted to branches) — the column
  makes it possible; scope enforcement itself is an extension point (not v1).
- Departments are organizational, not automatically an accounting dimension; the
  cost-centre dimension is separate and expert-gated (OQ-25).

**Explicitly deferred:** O-3 multi-company and O-4 tenancy. Both are ADR-level
changes (AR-29) and must not be pre-added as nullable columns "just in case"
(that is exactly the kind of speculative flexibility this blueprint rejects).

---

## 3. Item / product domain

### 3.1 Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| I-1: One Item table, kind as free string | Simple | Reports/validation must parse strings; typos become behaviour | Inconsistent data, untestable |
| I-2: One Item + **closed kind** + **explicit capability flags** (recommended) | Kind is a code-managed list; capabilities are booleans on each item; code branches on capabilities only | One table, indexable, reportable; per-item exceptions possible; new capabilities are additive | Slight duplication (kind defaults + stored flags) — resolved by resolving defaults at create time and never at read time |
| I-3: Table per kind (Goods, Service, Asset…) | Type-pure tables | Clean per-type fields | Every shared feature (pricing, documents, reports, permissions) needs N implementations; cross-type reports = UNIONs; violates "one owner per fact" (AR-08) |
| I-4: EAV attributes (`ItemAttributeValue`) | Fully dynamic fields | No migrations for new attributes | No type safety/constraints, painful queries, reporting pivots; rejected system-wide (§ blueprint 17) |
| I-5: Item + JSONB free attributes | Flexible | Cheap for descriptive extras | Anything business-critical in JSONB is invisible to constraints/reports; only allowed for *custom fields* under governance (`configurability-architecture.md` §5) |

### 3.2 Recommended model

**`inventory.items`** (one table) with:

- Identity: `id` (ULID), `code` (human key, unique among non-deleted), `name`,
  `description`, `item_group_id`, `base_unit_id`, `is_active`, plus AR-12 columns.
- `item_kind` — closed, code-managed: `goods`, `service`, `consumable`, `asset`,
  `raw_material`, `semi_finished`, `finished_good`, `other`. *(OQ-33 confirms the list
  and the naming with the project owner.)*
  **Decision pointer (2026-10-02, OD-C47-02 / Option D — `docs/decisions/product/PDR-02-item-taxonomy-and-capabilities.md`):**
  a new kind or capability flag may be introduced **only** through an identified and
  accepted concrete need in the project's decision process. The Owner has **not**
  confirmed the list above, so it is frozen, not approved — OQ-33 stays OPEN.
- **Capability flags** (stored, authoritative):
  `is_stockable`, `is_purchasable`, `is_sellable`, `is_valued`,
  `requires_lot`, `requires_serial`, `requires_expiry`.
  Kind supplies defaults at creation; the flags are then what the code and the
  database constraints use.
- Standard attributes that are *not* capabilities: `barcode` (optional —
  **decided 2026-10-02 by OD-C47-03 / Option A, `docs/decisions/product/PDR-03-item-barcode-policy.md`:**
  optional, unique **within an organization** such that two *active* items must not
  share a barcode, reusable across organizations, multiple formats with no strict
  symbology validation, and no multi-barcode-per-item support. The constraint is
  **not implemented**: `inventory.items` has no barcode index today, and the index
  shape is blocked by **OQ-65** — reuse of a deactivated item's barcode and the
  comparison semantics are unresolved),
  `default_supplier_id`, `default_tax_id`, `min_stock`/`reorder_point` (planning
  placeholders — no planning logic in v1).
- **No** variant/BOM/kit columns in v1; those are later modules (§3.5).

**Validation rules derived from capabilities (examples):**

- A document line referencing an item with `is_stockable = false` must not carry a
  warehouse/location and must not produce stock movements (enforced in the owning
  module's validation, not by a DB trigger).
- `requires_lot` ⇒ quantity-bearing movements must carry `lot_id`; the same for
  serial (one serial per unit).
- `is_valued = false` ⇒ the item never contributes to inventory valuation reports.
- `is_stockable = false` ⇒ the item cannot appear in stock-balance reports.

### 3.3 Services vs goods — behaviour differences (no type tables)

| Behaviour | Goods (stockable) | Service | Consumable | Asset |
|---|---|---|---|---|
| Buy/sell document lines | Yes | Yes | Buy (internal) | Buy |
| Warehouse dimension on lines | Required | **Forbidden** | Required | Forbidden (asset register instead) |
| Stock movements | Yes | No | Yes | No |
| Inventory valuation | Yes (if `is_valued`) | No | Yes (if valued) | Depreciated later (out of scope) |
| Lot/serial/expiry | Configurable | No | Configurable | Serial typical |
| COGS on sale | Yes | No (cost of service, if tracked) | No | No |

This table is the contract that makes a single Item model coherent: the differences
are **capability-driven**, not table-driven.

### 3.4 Units and conversions

- Each item has exactly one **base unit**; all quantities in movements, balances and
  ledger reports are stored in that base unit (AR-12 quantity precision
  `numeric(18,4)`).
- **Global conversions** (`unit_conversions`): `from_unit`, `to_unit`, factor and
  rounding rule — valid for any item (e.g. `KG ↔ G`).
- **Item-specific conversions** (`item_unit_conversions`): e.g. `1 BOX(of THIS item)
  = 12 PCS`. These are the common case in practice.
- Document lines record the **entered unit** *and* the quantity converted to the base
  unit, so the business-facing value is preserved for printing while the ledger stays
  in one unit.
- **Expert-gated:** rounding of fractional conversions, whether conversion factors
  may change over time (and what that means for history — recommendation: effective
  dated, like other configuration), and per-unit decimal precision (OQ-29).

### 3.5 Extension points (deliberately not designed now)

Variants/matrix items, kits/BOM, substitutes, catch-weight, item revision control,
asset registers, service contracts, price formulas. Each is a *new module or a
capability extension* with its own ADR; none of them may require redefining
`Item`'s identity.

---

## 4. Warehouses and locations

- **Warehouse** belongs to exactly one branch; carries `code`, `name`, `is_active`,
  and optional default location behaviour. Physical negative inventory is rejected
  for the MVP (OD-VAL-17 / PDR-05); no allow policy is approved by OQ-24.
- **Locations (bins)** are configuration: a warehouse either operates with locations
  or without. The stock balance key is `(item, warehouse, location, lot, serial)`
  where location/lot/serial are only filled when enabled/required.
- **Transfer** between warehouses = two movements (out/in) sharing a transfer
  document and a transfer identifier. Under PO-06, a transfer between warehouses
  of the same Legal Entity creates no GL Voucher; different-entity, tax,
  financial-area and other transfer cases remain undecided (PDR-09 / OQ-31).
- **Negative stock:** physical negative inventory is rejected for the MVP
  (OD-VAL-17 / PDR-05), evaluated at movement creation inside the balance-update
  transaction. A future allowance requires a separate Owner decision; it is not an
  unresolved OQ-24 choice.

---

## 5. Partners (customers, suppliers, contacts, addresses)

**Recommendation: one party record with capability flags**, owned by a single module,
with `is_customer` / `is_supplier` flags (a business is frequently both).

- If Sales owns customers and Purchasing owns suppliers, a dual-role partner exists
  twice — violating "one owner per fact" (AR-08) and making receivable/payable
  reporting per counterparty impossible. The blueprint therefore recommends the
  **Organization module owns the party master data** (contacts, addresses, bank
  accounts, credit terms), while **Sales and Purchasing own the commercial
  relationship** (price lists, credit limit enforcement, statements). This is part of
  ADR-0020 and needs owner confirmation *(it changes the current `docs/modules.md`
  ownership note for customers/suppliers — flagged as a structural change)*.
- **Contacts** are children of a party; **addresses** are typed (billing/shipping/
  registered) with `country`/`province`/`city`/`postal_code`/`line` fields.
- **Credit limit / payment terms** live on the party's customer-profile side; whether
  v1 enforces credit limits is an open question (D-14).
- **Duplicate control:** a business key (`national_id`/economic code for legal
  persons, or code) with a partial unique index; merge tooling is an extension point.

---

## 6. Pricing and tax as master data (brief)

- **Price lists (v1 recommendation):** explicit `price_list` + `price_list_items`
  (item, unit, price, `valid_from/valid_to`, optional branch/customer-group scope).
  A price *engine* (formulas, cascading discounts) is deliberately not designed —
  unbounded scope (D-13).
- **Tax (v1 recommendation):** `tax_groups` + `tax_rates` (rate, `valid_from/to`,
  account mapping reference), referenced from document lines which copy the applied
  rate. Whether tax is inclusive/exclusive, rounded per line or per document, and
  which exemptions exist is **expert-gated** (OQ-30).

---

## 7. Master-data lifecycle (binding rules)

Applies to every entity in §1. The invariant from the blueprint §12 holds: *a
historical document must remain fully interpretable without the current state of any
master record.*

1. **Identity:** ULID `id` (never reused) + a human **code** unique among
   non-deleted rows (partial unique index `WHERE deleted_at IS NULL`).
2. **Create:** defaults (from group/category/kind) are resolved at creation and
   stored on the row; later changes to the group do **not** silently change items.
3. **Edit:** permitted, audited (`updated_at/by`, domain event; before/after for
   sensitive fields). Business-key changes are allowed but audited and rate-limited
   by permission (`*.Edit`).
4. **Disable:** `is_active = false` — a reversible state that blocks new usage
   (document creation, movement) but keeps history readable and reportable.
5. **Archive:** for records that must not be selectable again: disable + `archived_at`
   (if needed) and exclusion from pickers; historical reports still resolve the code
   and name.
6. **Delete:** allowed **only** while no reference exists anywhere (checked by the
   owning module across known referencing modules via their public services, or by
   FK constraints where clean). Where any history exists: soft delete
   (`deleted_at`/`deleted_by`, AR-13). For **accounting dimensions** (accounts, cost
   centres, projects): **never delete** — disable/archive only *(expert)*.
   **Decision pointer (2026-10-02, OD-C47-04 / OQ-36 Option C —
   `docs/decisions/product/PDR-04-item-deletion-and-code-reuse.md`):** for **items**,
   physical deletion is permitted **only** when the item has never been referenced by
   any operational, ledger or historical record; a referenced item must never be
   physically deleted; history and organization-scoped identity constraints are
   preserved. The decision does **not** introduce a `deleted_at` column, does not
   decide soft-vs-hard delete beyond that case, and does not extend to other
   entities. Nothing is implemented: there is no DELETE route and no `*.Delete`
   permission.
7. **Effective dating:** entities whose change alters interpretation
   (tax rates, conversions, price lists, mappings, workflow versions) are
   **versioned rows** with `valid_from`/`valid_to`; updates create a new version.
8. **Referential integrity:** documents keep both the FK (to the master row) and the
   **snapshot values** they used (unit, unit price, tax rate, conversion factor,
   account mapping version). Reports use the snapshot for historical truth and the FK
   for grouping/joins.
9. **Reuse of a code** after soft delete: allowed only if the owning module documents
   it and history remains unambiguous (partial unique index makes this technically
   possible; whether it is *business-desirable* is per entity — default: **no reuse**).
   **This default is a design default, never an Owner decision (2026-10-02).** OD-C47-04
   explicitly leaves code reuse after physical deletion of a never-referenced item
   **OPEN**; OQ-36 must not be read as resolved on this point.
10. **Audit:** lifecycle changes emit domain events (`Item.Updated`, `Item.Disabled`,
    …) consumed by Audit/Notifications; no parallel audit table (§ AR-23).

---

## 8. Reporting implications

- Every master entity carries the columns its reports filter by (branch, group,
  kind, capability flags, active state) — no report may need "the current attribute
  value" to interpret a historical fact.
- Item/party/warehouse **codes and names are denormalized into reporting views**
  (module-owned `vw_*`), so reports do not join five tables to render one row.
- Stock and ledger reports group by *ids* (stable), while display resolves the
  current name; historical snapshots are used where the printed document matters.
- Capability flags are indexed (at least `is_stockable`, `is_active`) because every
  stock report filters on them.

## 9. Open questions introduced here

OQ-22 (organization/branch scope & multi-company), OQ-24 (remaining Inventory/Accounting costing policy; negative physical stock reject is decided by OD-VAL-17),
OQ-29 (unit conversion semantics & rounding), OQ-31 (inter-branch/internal
settlement), OQ-32 (employee/HR scope). See [`../open-questions.md`](../../open-questions.md).
