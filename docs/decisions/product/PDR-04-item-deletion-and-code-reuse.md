# PDR-04: Item deletion eligibility (OQ-36 — Option C); code reuse stays OPEN

- **Type:** PDR (Product Decision Record) · decision id **OD-C47-04**
- **Status:** **Decided in part** — Owner decision recorded 2026-10-02
- **Decided by:** Repository Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-36 remains OPEN** (code-reuse semantics unanswered)
- **Recording baseline:** `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107)
- **Related records:** [C-47 preflight](../../tasks/c-47-item-master-preflight-investigation.md) §4/§9.6 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §7/§9 · [`docs/architecture/domain/master-data-strategy.md`](../../architecture/domain/master-data-strategy.md) §7 · Task 21 §10 (Base Chart OQ-36 prerequisites) · [this task's reconciliation report](../../tasks/c-47-owner-decision-and-dependency-reconciliation.md)

> This record transcribes an Owner decision. It authorizes no implementation,
> creates no DELETE endpoint or permission, and changes no schema.

## 1. Question

OQ-36 (verbatim registry text): *"Master-data lifecycle: is deactivation
(`is_active`) sufficient forever, or must some master data be genuinely deletable
(e.g. an item created by mistake with no document lines yet)? If deletion is ever
allowed, what is the eligibility rule, is it soft (`deleted_at`) or hard, and are
codes of deleted rows reusable? Related: are business codes case-sensitive
(`ABC` vs `abc`) and may a code be reused after deactivation?"*

## 2. Decision (OD-C47-04) — Option C, eligibility only

1. **Physical deletion is permitted only when the item has never been referenced
   by any operational, ledger, or historical record.**
2. **An item that has been referenced must not be physically deleted** — under
   any circumstance, including after the referencing records are themselves
   superseded.
3. **History and organization-scoped identity constraints must be preserved.**
   Deletion must never make an existing record uninterpretable, and the
   organization-scoped uniqueness of the item code remains in force.

## 3. Explicitly NOT decided — code reuse stays OPEN

The Owner's instruction is explicit: the complete item-code reuse policy must
**not** be inferred from Option C. The canonical decision text does not resolve
it, and the registry's current statement ("Codes … are never reused") is recorded
as an *interim assumption*, not a rule. Therefore:

> **OPEN:** after a never-referenced item is physically deleted, may its code be
> reused by a new item in the same organization?

Also still OPEN under OQ-36 (not answered by OD-C47-04):

| Sub-question | Status |
|---|---|
| Code reuse after **physical deletion** of a never-referenced item | **OPEN — blocking for any delete implementation** |
| Code reuse after **deactivation** (no deletion) | **OPEN** — unchanged by this decision |
| Case sensitivity of business codes (`ABC` vs `abc`) | **OPEN** — current behavior is case-sensitive comparison via the plain unique index, recorded as implementation fact |
| Whether soft delete (`deleted_at`) is introduced at all, and whether unique indexes become partial (`WHERE deleted_at IS NULL`) | **OPEN** — Option C decides *physical* deletion eligibility; it does not introduce a soft-delete column or change index shape |
| The exact "never referenced" proof obligation (which modules/tables must be interrogated, how the check is made race-free) | **OPEN** — implementation design, gated on the above |
| Which permission authorizes deletion, and whether it is auditable/irreversible | **OPEN** — no `*.Delete` permission exists |
| Whether the same eligibility rule applies to item groups, units, warehouses and other master data | **OPEN** — this decision was taken in the item context |

## 4. Implementation evidence on `main` (fact, not acceptance)

| Element | Evidence |
|---|---|
| No deletion path exists at all: no DELETE route, no `*.Delete` permission | `backend/src/modules/inventory/api/items.controller.ts` (no `@Delete`); `backend/src/modules/inventory/domain/inventory-permissions.ts` (`ITEM_PERMISSIONS` = View/Create/Edit/Enable/Disable) |
| Lifecycle is `is_active` only; no `deleted_at` on items | `backend/prisma/schema/inventory.prisma` (`Item` model) |
| Organization-scoped identity is a plain unique index (case-sensitive comparison) | `backend/prisma/schema/inventory.prisma` (`@@unique([organizationId, code])`) |
| Referential protection already exists at database level | `Item` relations use `onDelete: Restrict`; `InventoryMovement`, `InventoryBalance`, `InventoryReservation` reference `item_id` |
| Reference-aware freeze guards exist for *edits/disable*, not deletion | `backend/src/modules/inventory/application/items.service.ts` (`movements.existsForItem`, `balances.hasBlockingBalanceForItem`) |
| Regression proof of the freeze guards | `items.service.spec.ts` ("freeze guards (guards firing)"); `backend/test/item-master-live.e2e-spec.ts` (live case 8) |
| Design-document tension to resolve later | `docs/architecture/domain/master-data-strategy.md` §7.6 (soft delete where history exists), §7.9 (default **no reuse**) — a *design default*, never an Owner decision |

**Delta:** implementing OD-C47-04 would require a new delete operation,
permission, eligibility proof across referencing modules, and a decision on the
index/reuse shape. None of it may start while §3's reuse question is open.

## 5. Why OQ-36 stays OPEN

Only the eligibility half of the question is answered. Reuse, soft-vs-hard
delete beyond the physical-deletion case, case sensitivity and the cross-entity
scope remain unanswered; Task 21 §10 additionally records OQ-36 prerequisites for
Base Chart content loading that this decision does not satisfy.

## 6. Follow-up questions for the Owner

1. May the code of a physically deleted, never-referenced item be reused?
2. Is deletion restricted to items, or does the same rule apply to item groups,
   units, warehouses and accounting master data (Task 21 §10 prerequisites)?
3. Which permission authorizes deletion, and must each deletion carry a reason
   recorded in an audit surface (no Audit module exists yet)?
4. Is the case-sensitive code comparison in force today confirmed as policy?
