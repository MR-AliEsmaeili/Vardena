# OQ-33: Item taxonomy and capabilities

- **Type:** OQ (product/domain policy)
- **Status:** **Open — Option D recorded; current taxonomy/capability confirmation remains open**
- **Owner decision recorded:** 2026-10-02
- **Owner:** Ali Esmaeili, with product and inventory-expert input
- **Related records:** [`docs/open-questions.md`](../../open-questions.md) ·
  [`PDR-01 — Barcode policy`](./PDR-01-barcode-policy.md) ·
  [`docs/tasks/c-47-item-master-readiness-hardening-report.md`](../../tasks/c-47-item-master-readiness-hardening-report.md) ·
  [`docs/architecture/domain/master-data-strategy.md`](../../architecture/domain/master-data-strategy.md)
- **Implementation evidence:**
  `backend/src/modules/inventory/domain/item-kind.ts`,
  `backend/src/modules/inventory/domain/item-capabilities.ts`,
  `backend/src/modules/inventory/domain/item.ts`,
  `backend/src/modules/inventory/application/items.service.ts`,
  `backend/prisma/schema/inventory.prisma`, and
  `docs/tasks/c-47-item-master-readiness-hardening-report.md`

## Context

The question covers the eight currently code-defined item kinds
(`goods`, `service`, `consumable`, `asset`, `raw_material`, `semi_finished`,
`finished_good`, `other`) and the current stored capability flags
(`is_stockable`, `is_purchasable`, `is_sellable`, `is_valued`, `requires_lot`,
`requires_serial`, `requires_expiry`). It affects item validation, future
operational documents, stock/valuation behavior, and imports.

## Owner decision — Option D

The Owner approved **Option D as a governance rule for change**:

- A new item kind or capability flag may be introduced **only after a concrete
  need has been identified and accepted through the project's
  decision/governance process**.
- **Option A is not approved.** This record must not be read as confirmation
  that the existing eight kinds or the current per-item configurable capability
  model are accepted without change.
- Confirmation of the existing eight kinds, their defaults, capability
  constraints/overrides, and related item-model semantics therefore remains
  **OPEN**.

This is a guard on future taxonomy/capability expansion, not approval of a new
kind, flag, migration, schema, API, UI, or production implementation.

## Barcode policy boundary

The Owner separately confirmed **Barcode policy — Option A**; the full policy is
recorded in [`PDR-01 — Barcode policy`](./PDR-01-barcode-policy.md) and is
linked here because barcode is part of the item-master decision surface. The
barcode decision does not close OQ-33's taxonomy/capability confirmation.

In particular, the confirmed policy does not introduce multi-barcode-per-item
support and does not authorize a schema or production-code change in this
documentation task.

## Remaining questions

OQ-33 remains OPEN for confirmation of:

- whether the eight existing kinds are complete and whether their names/defaults
  are correct;
- whether capabilities are per-item overrideable, kind-constrained,
  kind-mandatory, or organization-configurable; and
- the complete downstream semantics of lot, serial, expiry, valuation, sales,
  production, and warehouse documents.

OQ-36 separately governs physical deletion and code-reuse semantics. No
item-master lifecycle conclusion should be inferred from this record.

## Follow-up and dependency effect

- C-47's merged hardening and CI evidence prove implementation state, not Owner
  acceptance. A bounded follow-up remains governance/decision-gated.
- A future kind or flag requires a named demand, an approved decision record,
  explicit impact analysis, and the normal code/schema/API/OpenAPI/test gates if
  implementation is later authorized.
- The existing runtime model remains evidence of what is implemented, not proof
  that Option A was approved.
