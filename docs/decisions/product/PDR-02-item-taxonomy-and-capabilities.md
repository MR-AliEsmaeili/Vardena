# PDR-02: Item taxonomy and capability governance (OQ-33 — Option D)

- **Type:** PDR (Product Decision Record) · decision id **OD-C47-02**
- **Status:** **Decided (governance rule only)** — Owner decision recorded 2026-10-02
- **Decided by:** Repository Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-33 remains OPEN**; the taxonomy/capability confirmation is explicitly **NOT** given
- **Recording baseline:** `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107)
- **Related records:** [C-47 preflight](../../tasks/c-47-item-master-preflight-investigation.md) §6 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §7 · [PDR-03 barcode policy](./PDR-03-item-barcode-policy.md) · [this task's reconciliation report](../../tasks/c-47-owner-decision-and-dependency-reconciliation.md)

> This record transcribes an Owner decision. It authorizes no implementation and
> accepts no merged work.

## 1. Question

OQ-33 (verbatim registry text): *"Item model: is the kind list (`goods`,
`service`, `consumable`, `asset`, `raw_material`, `semi_finished`,
`finished_good`, `other`) complete, and which capabilities (`is_stockable`,
`is_purchasable`, `is_sellable`, `is_valued`, `requires_lot`, `requires_serial`,
`requires_expiry`) may an organization turn on or off per item vs per kind?"*

## 2. Decision (OD-C47-02) — Option D, restricted to the governance rule

**Decided:** new item kinds or capability flags may be introduced **only** when a
concrete need has been identified and accepted through the project's
decision/governance process (an Owner decision recorded in the repository, with
the resulting candidate promoted through the normal task gate).

Consequences of the rule:

1. No kind and no capability flag may be added by implementation inference,
   by a source-code comment, by a roadmap row, or by analogy with another ERP.
2. A concrete, named requirement must exist first; the decision record must state
   the need, the affected documents/reports, and the migration/backfill treatment.
3. Until such a need is accepted, the item model is **frozen as-is** — frozen is
   not the same as *approved* (see §3).

## 3. Explicitly NOT decided

- **Option A is NOT approved and must not be recorded as approved.** The Owner
  has **not** confirmed that the existing eight item kinds (`goods`, `service`,
  `consumable`, `asset`, `raw_material`, `semi_finished`, `finished_good`,
  `other`) and the current per-item configurable capability model are accepted
  without change.
- That confirmation stays **OPEN** and is the main reason OQ-33 remains OPEN.
- Also still open under OQ-33: per-kind default correctness (including the
  recorded `asset`/`requires_serial` tension and the
  raw/semi-finished/finished/other defaults), whether any flag should be
  kind-mandatory or kind-forbidden rather than per-item overridable, whether the
  item→group relation stays one-to-zero/one, and whether lot/serial/expiry
  traceability semantics (beyond the master flags) are admitted at all.

## 4. Implementation evidence on `main` (fact, not acceptance)

| Element | Evidence |
|---|---|
| Closed eight-value kind list, code-defined | `backend/src/modules/inventory/domain/item-kind.ts` (`ITEM_KINDS`) |
| Kind supplies defaults at creation only; kind immutable afterwards | `backend/src/modules/inventory/application/items.service.ts`; `domain/item-capabilities.ts` |
| Seven capability flags stored per item and authoritative | `backend/prisma/schema/inventory.prisma` (`Item` model); `domain/item-capabilities.ts` |
| Capability invariants (valued/lot/serial/expiry ⇒ stockable) | `domain/item-capabilities.ts`; `domain/item-capabilities.spec.ts` |
| Kind stored as text (adding a kind is a code change, not `ALTER TYPE`) | `backend/prisma/schema/inventory.prisma` (`itemKind String @db.VarChar(24)`) |
| Regression coverage | `backend/src/modules/inventory/application/items.service.spec.ts`; `backend/test/master-data.e2e-spec.ts` |

Because the current model is frozen rather than approved, the code comments in
`item-kind.ts` that record default assumptions remain **assumptions**, not rules.

## 5. Why OQ-33 stays OPEN

The decision supplies a *governance gate for change*; it does not answer the
question the OQ asks (is the list complete, and which flags are per-kind vs
per-item). Marking OQ-33 resolved would fabricate the missing confirmation.

## 6. Follow-up questions for the Owner / Inventory expert

1. Are the eight kinds confirmed as the approved taxonomy, or is a delta needed?
2. Are the per-kind creation defaults confirmed, in particular `asset` +
   `requires_serial` and the raw/semi-finished/finished/other defaults?
3. Should any capability become kind-mandatory or kind-forbidden instead of
   per-item overridable (the "Option B matrix" in the hardening report §7)?
4. Are lot/serial/expiry traceability *behaviors* in MVP scope at all, or only
   their master-data flags?
