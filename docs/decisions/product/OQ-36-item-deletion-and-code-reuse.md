# OQ-36: Item deletion and code reuse

- **Type:** OQ (product/domain lifecycle policy)
- **Status:** **Open — Option C recorded; code-reuse semantics remain open**
- **Owner decision recorded:** 2026-10-02
- **Owner:** Ali Esmaeili, with product and architecture input
- **Related records:** [`docs/open-questions.md`](../../open-questions.md) ·
  [`OQ-33 — Item taxonomy and capabilities`](./OQ-33-item-taxonomy-and-capabilities.md) ·
  [`PDR-01 — Barcode policy`](./PDR-01-barcode-policy.md) ·
  [`docs/tasks/c-47-item-master-readiness-hardening-report.md`](../../tasks/c-47-item-master-readiness-hardening-report.md) ·
  [`docs/architecture/domain/master-data-strategy.md`](../../architecture/domain/master-data-strategy.md)
- **Implementation evidence:**
  `backend/src/modules/inventory/application/items.service.ts`,
  `backend/src/modules/inventory/domain/inventory-permissions.ts`,
  `backend/src/modules/inventory/domain/item.ts`,
  `backend/prisma/schema/inventory.prisma`, and
  `docs/architecture/domain/master-data-strategy.md`

## Context

The current item master exposes enable/disable lifecycle operations and no
physical-delete endpoint or delete permission. The C-47 reports also identify
item code uniqueness and barcode lifecycle as separate policy surfaces. The
current runtime is evidence of implementation state; it is not a substitute for
the Owner decision.

## Owner decision — Option C

The Owner approved **Option C**:

1. Physical deletion is permitted only when the item has **never been referenced
   by any operational, ledger, or historical record**.
2. An item that has been referenced must **not** be physically deleted.
3. History and organization-scoped identity constraints must be preserved.

This decision defines eligibility and history preservation. It does not authorize
a DELETE endpoint, permission, migration, schema change, or production-code
change in this documentation task. The current implementation remains
`is_active` lifecycle with no physical-delete path until a separately authorized
implementation exists.

## Explicitly unresolved code-reuse questions

Option C does **not** resolve the complete item-code reuse policy. Keep all of
the following OPEN unless a later canonical decision explicitly answers them:

- whether the code of a physically deleted, never-referenced item may be reused;
- whether a code may be reused after deactivation; and
- the exact historical/uniqueness behavior for any future delete or reuse path.

Do not infer code reuse from the physical-deletion eligibility rule. The current
organization-scoped code constraint and no-delete runtime behavior remain
implementation evidence only.

Barcode reuse is also not inferred here. The confirmed barcode policy explicitly
leaves the lifecycle question—whether a barcode assigned to a deactivated item
can be reused by another item in the same organization—OPEN; see
[`PDR-01`](./PDR-01-barcode-policy.md).

## Follow-up and dependency effect

- C-47 remains not accepted even though PR #107 is merged and CI is green.
- Base Chart/content and account-code consumers must not infer a code-reuse
  policy from this record; the unresolved reuse semantics remain a prerequisite
  where those consumers need them.
- Any future physical-deletion implementation must prove the no-reference rule
  across operational, ledger, and historical records and preserve the
  organization-scoped identity/history contract.
