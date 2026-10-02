# PDR-01: Barcode policy

- **Type:** PDR (product decision record)
- **Status:** **Decided — Owner decision confirmed**
- **Owner decision recorded:** 2026-10-02
- **Owner:** Ali Esmaeili
- **Related OQs:** [`OQ-33 — Item taxonomy and capabilities`](./OQ-33-item-taxonomy-and-capabilities.md) ·
  [`OQ-36 — Item deletion and code reuse`](./OQ-36-item-deletion-and-code-reuse.md) ·
  [`docs/open-questions.md`](../../open-questions.md)
- **Implementation evidence:**
  `backend/src/modules/inventory/domain/item.ts`,
  `backend/src/modules/inventory/application/items.service.ts`,
  `backend/prisma/schema/inventory.prisma`,
  `backend/src/modules/inventory/api/dto/item.dto.ts`, and
  `docs/tasks/c-47-item-master-preflight-investigation.md`

## Owner decision — Option A

The Owner confirmed **Barcode policy — Option A**:

- A barcode is **optional**.
- Barcode uniqueness is enforced **within an organization**.
- Two **active** items in the same organization must not have the same barcode.
- Different organizations may use the same barcode.
- Multiple barcode formats are supported. Do not impose strict symbology
  validation unless separately approved.
- Do not introduce multi-barcode-per-item support under this decision.
- This documentation task changes **no production code or schema**.

The policy is an organization-scoped active-item uniqueness rule. It is not a
permission to retrofit a database constraint, normalization rule, symbology
parser, alias table, or barcode endpoint without a separately authorized
implementation task and the required migration/API/test evidence.

## Explicitly open lifecycle detail

The policy does **not** answer whether a barcode assigned to a deactivated item
may be reused by another item in the same organization. That lifecycle detail
remains **OPEN**. It must not be inferred from the active-item uniqueness rule.

The same barcode-reuse question is linked to OQ-36's unresolved item-code and
lifecycle semantics. Until it is separately answered, no record may claim that
deactivation releases or reserves a barcode.

## Follow-up

- OQ-33 remains open for taxonomy and capability confirmation; this PDR does not
  approve Option A for OQ-33.
- C-47's production state remains the merged, regression-hardened item master
  from PR #107, **not Owner-accepted**. Barcode implementation is deliberately
  outside this documentation task.
- A future implementation brief must define normalization/comparison behavior,
  active/inactive conflict handling, and the database/application enforcement
  boundary without closing the open deactivated-item reuse question by
  assumption.
