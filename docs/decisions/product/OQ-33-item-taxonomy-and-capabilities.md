# OQ-33: Item taxonomy and capabilities

- **Type:** OQ decision record (Inventory domain policy; central-registry OQ below OQ-44, recorded here per the 2026-10-02 Owner decision session)
- **Status:** **Open** — the _extension mechanism_ is **Decided (Option D)**; the taxonomy/capability _confirmation_ remains **Open**. **Option A is NOT approved.**
- **Owner:** Ali Esmaeili (Repository Owner)
- **Decided (mechanism):** 2026-10-02
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — OQ-33 (row stays **Open**)
- **Related:** [OQ-29 record](./OQ-29-quantity-precision-and-conversion.md) · [OQ-36 record](./OQ-36-item-deletion-and-code-reuse.md) · [PDR-01 item barcode policy](./PDR-01-item-barcode-policy.md) · [OQ-65 item barcode lifecycle](./OQ-65-item-barcode-lifecycle.md) · [C-47 preflight investigation](../../tasks/c-47-item-master-preflight-investigation.md) §6 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §7

## Decision (Option D — extension mechanism only)

The Owner decided **Option D** for the change mechanism:

> **New item kinds or capability flags may be introduced only when a concrete
> need has been identified and accepted through the project's
> decision/governance process.**

In repository terms, that governance process is: register the need as an Open
Question or decision request (AG-09 — never invent business rules) → obtain the
explicit Owner decision → promote the work item through the Future Task
Candidate Register's promotion rule (`docs/roadmap/future-task-candidates.md`)
and, for Accounting, the task-index §7 gate
(`docs/accounting/task-index.md` §7 — or its Owner-approved domain equivalent).
A kind or capability may **not** be added by implementation inference, source
comment, seed, or migration without that acceptance.

## What is explicitly NOT decided

- **Option A ("confirm the current model") is NOT approved and must not be
  recorded as approved.** The Owner has **not** confirmed that the existing
  eight item kinds (`goods`, `service`, `consumable`, `asset`, `raw_material`,
  `semi_finished`, `finished_good`, `other`) and the current per-item
  configurable capability model (`is_stockable`, `is_purchasable`,
  `is_sellable`, `is_valued`, `requires_lot`, `requires_serial`,
  `requires_expiry` — stored per item, kind-supplied defaults at creation) are
  accepted without change. **That confirmation remains OPEN**, so OQ-33 is not
  resolved and must not be moved to Resolved.
- Per-kind default matrices (including the recorded source-comment assumptions
  for raw/semi-finished/finished/other and the asset/serial tension) remain
  unconfirmed as business-approved content.
- Whether capabilities should ever be constrained per kind (Option B's
  kind→allowed-flags matrix) remains open — Option D decides only _how new
  kinds/flags may be introduced_, not the final shape of the current set.
- Item classification (one-to-zero/one group) is unchanged and unconfirmed as
  final.

## Related decided policy (separate decision chain)

The **item barcode policy** was decided separately on 2026-10-02
([PDR-01](./PDR-01-item-barcode-policy.md)); its unresolved lifecycle detail is
registered as [OQ-65](./OQ-65-item-barcode-lifecycle.md). Neither PDR-01 nor
OQ-65 confirms the kind taxonomy.

## Implementation evidence (context; unchanged by this decision)

- `backend/src/modules/inventory/domain/item-kind.ts` — the closed eight-value
  kind list with creation defaults; several defaults are recorded assumptions
  in source comments (not business approval).
- `backend/src/modules/inventory/domain/item-capabilities.ts` — per-item stored
  capability flags with store-time invariants (valued ⇒ stockable;
  lot/serial/expiry ⇒ stockable).
- `backend/src/modules/inventory/application/items.service.ts` — kind immutable
  after creation; defaults resolved only at create; capability flags editable
  per item subject to invariants.
- `backend/prisma/schema/inventory.prisma` — `inventory.items` (typed columns,
  seven capability columns, `allow_negative_stock`, optional `barcode`).

No production code, schema, migration, or test change was made by the
decision-recording task.

## Consequences

- The existing taxonomy and capability model may be **retained as-is** in code
  (they are implemented, hardened and regression-covered by C-47's hardening
  slice, PR #107), but they are **not approved content**: C-47 completion and
  any claim that "the item model is accepted" remain blocked on the open
  confirmation.
- Adding any tenth kind, renaming a kind, or adding a capability flag now
  requires the Option D governance path — a concrete identified need accepted
  by the Owner — before any code/migration work.
- Future consumers (Sales C-18, Purchasing post-MVP, item import, production
  flows) must not assume a fixed taxonomy in their contracts without their own
  confirmation step.

## Follow-up question (open)

1. **Owner + Inventory expert:** confirm, correct or extend the eight-kind list
   and the per-item capability model (preflight §9 Q1/Q2; readiness report §7
   Options A–D remain the decision space). Until answered, OQ-33 stays Open and
   C-47 stays blocked on this confirmation.
