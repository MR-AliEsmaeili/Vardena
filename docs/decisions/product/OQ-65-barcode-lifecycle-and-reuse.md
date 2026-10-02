# OQ-65: Item barcode lifecycle, reuse and comparison semantics

- **Type:** OQ (product/inventory policy decision)
- **Status:** **Open**
- **Owner:** Ali Esmaeili (with Inventory domain expert)
- **Created:** 2026-10-02
- **Priority:** High · **Blocks** the bounded barcode-uniqueness implementation (candidate C-55); does **not** block any other Inventory candidate
- **Created by:** the barcode Owner decision [PDR-03](./PDR-03-item-barcode-policy.md) (OD-C47-03), which decided the uniqueness rule for **active** items and deliberately left the lifecycle detail unresolved
- **Related:** OQ-33 (item model), OQ-36 / [PDR-04](./PDR-04-item-deletion-and-code-reuse.md) (master-data lifecycle, code reuse), `docs/architecture/domain/master-data-strategy.md` §7, [C-47 preflight](../../tasks/c-47-item-master-preflight-investigation.md) §4

## Context

OD-C47-03 (PDR-03) decided: a barcode is optional; **two active items in the
same organization must not have the same barcode**; different organizations may
use the same barcode; multiple formats are supported without strict symbology
validation; no multi-barcode-per-item support.

Current `main` has **no** barcode constraint of any kind: `inventory.items.barcode`
is a nullable `varchar(64)` that is trimmed, length-checked and stored verbatim
(`backend/src/modules/inventory/application/items.service.ts`,
`backend/prisma/schema/inventory.prisma`). The only item unique key is
`(organization_id, code)`.

Enforcing the decided rule therefore requires a new constraint — and **every
candidate constraint shape silently answers questions the Owner has not
answered**.

## Exact decision required

1. **Reuse after deactivation (blocking).** May a barcode assigned to a
   **deactivated** item be reused by another item in the same organization?
   - If **yes**, the natural shape is a partial unique index
     `(organization_id, barcode) WHERE is_active AND barcode IS NOT NULL`,
     which also permits two *inactive* items to share a barcode (question 3).
   - If **no**, the natural shape is a plain unique index
     `(organization_id, barcode)` over all non-null values, which reserves the
     barcode of a deactivated item forever.
2. **Comparison semantics.** Is uniqueness compared case-sensitively on the
   trimmed raw string (consistent with item-code comparison today), or is a
   normalization required (case folding, leading-zero handling, Unicode/Persian
   digit folding)? List *search* is already case-insensitive substring matching,
   which is a different concern and must not be read as a uniqueness rule.
3. **Inactive-vs-inactive collisions.** May two inactive items hold the same
   barcode?
4. **Re-activation.** If item A is deactivated, its barcode is taken by item B,
   and A is re-activated — is the re-activation rejected, or is A's barcode
   cleared, or is the collision tolerated?
5. **Clearing and re-assignment.** Is clearing a barcode (setting it to null)
   unrestricted, and does a cleared barcode become immediately reusable?

## Why this matters

- The uniqueness rule cannot be implemented without answering question 1: the
  index shape *is* the answer. Implementing first would fabricate a business
  rule (AG-09/AR-31).
- A plain unique index creates a permanent barcode reservation that operators
  cannot clear without editing the deactivated item — a real operational
  consequence in warehouses that re-label stock.
- A partial index allows the same physical barcode to resolve to different
  historical items over time; any future scan-based lookup, Kardex filter or
  report must then be explicit about which item a historical scan referred to.

## Options

| Option | Semantics | Consequences |
|---|---|---|
| **A — No reuse ever** (plain unique index over non-null barcodes) | A barcode is permanently bound to the item it was first assigned to, active or not | Simplest invariant; historical scans stay unambiguous; operators cannot re-label a barcode without editing/clearing the old item (needs an `Edit` path and a policy for who may do it) |
| **B — Reuse allowed after deactivation** (partial unique index on active rows) | Only active items compete for a barcode | Matches the decided wording literally; allows re-labelling; a historical scan value may map to several items over time — any future scan lookup must disambiguate by date/state |
| **C — Reuse allowed only after an explicit release action** | Deactivation does not free the barcode; a separate audited "release barcode" operation does | Most controlled, most expensive: new operation, permission, audit surface (no Audit module exists) |

No option is recommended here; the question is recorded, not decided.

## Dependencies

- Depends on nothing else to be decidable. It **blocks** candidate C-55
  (organization-scoped barcode uniqueness enforcement).
- Interacts with OQ-36 / PDR-04 (if physical deletion of a never-referenced item
  is ever implemented, a deleted item's barcode disappears with the row; that is
  consistent with any of A/B/C but should be stated once both are decided).
- Interacts with OQ-33 only in that any future multi-barcode capability would
  re-open the uniqueness shape.

## Decision deadline or dependency

Before any barcode constraint, migration or scan-oriented API is implemented.
Nothing else in the Inventory MVP path waits on it.
