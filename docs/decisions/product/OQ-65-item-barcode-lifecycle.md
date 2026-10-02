# OQ-65: Item barcode lifecycle — reuse and uniqueness comparison semantics

- **Type:** OQ (product/Inventory master-data policy)
- **Status:** Open
- **Owner:** Ali Esmaeili (Product) + Inventory domain expert
- **Created:** 2026-10-02 — registered when [PDR-01](./PDR-01-item-barcode-policy.md) was recorded, so the unresolved lifecycle detail stays explicit instead of being inferred from the uniqueness rule
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — OQ-65 (Open)
- **Related:** [PDR-01 item barcode policy](./PDR-01-item-barcode-policy.md) (decided) · [OQ-36 record](./OQ-36-item-deletion-and-code-reuse.md) (item deletion eligibility decided; code reuse open) · [OQ-33 record](./OQ-33-item-taxonomy-and-capabilities.md)

## Context

PDR-01 (2026-10-02) decided the barcode policy: optional; unique **among
active items within one organization**; no cross-organization restriction; no
strict symbology validation; no multi-barcode support. The decided wording
binds only _active_ items. It deliberately does not say what happens to a
barcode when its holding item leaves the active set, or how the uniqueness
check compares strings. The C-47 preflight (§4 barcode row, §9 Q5) explicitly
flagged reuse-after-disable as unresolved; the canonical decision wording does
not resolve it, so it is registered here rather than inferred (AG-09/AG-17).

## Exact decision required

1. **Reuse after deactivation:** may a barcode assigned to a **deactivated**
   item be assigned to another item in the same organization?
2. **Re-enable conflict:** if reuse is allowed and another active item has
   taken the barcode, what happens when the deactivated item is re-enabled —
   is re-enable blocked, is the barcode cleared, or is the conflict resolved
   another way?
3. **Reuse after physical deletion:** with OQ-36's decided Option C
   (never-referenced items may be physically deleted), does the deleted item's
   barcode become unconditionally reusable, and does any barcode history
   obligation exist? (A never-referenced item has no operational/ledger
   history, but the rule is still not written.)
4. **Comparison/normalization semantics:** is the uniqueness comparison
   case-sensitive (`ABC123` vs `abc123`), and what whitespace/normalization
   applies? (Parallels the case-sensitivity subquestion of OQ-36 for business
   codes.)

## Options (decision space — none selected)

| Option                                                          | Meaning                                                                                                        | Consequences                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A — Barcode reserved once used                                  | A barcode, once assigned to any item (active or not), is never reusable while that item row exists             | Simplest audit story; wastes barcodes on abandoned items; effectively extends uniqueness beyond active items                         |
| B — Reusable when the holding item is deactivated               | Active-only uniqueness; a deactivated item's barcode is free for reassignment; re-enable must handle conflicts | Matches the active-scoped wording most directly; needs the re-enable conflict rule (Q2)                                              |
| C — Reusable only after physical deletion (OQ-36 Option C path) | Deactivation reserves the barcode; only a physically deleted never-referenced item releases it                 | Strongest retention; interacts with OQ-36 code-reuse policy; still needs the re-enable rule for the deactivated-but-not-deleted case |

## Impact

Item create/update/enable validation; the shape of the barcode uniqueness
guarantee (plain vs partial unique index, NULL handling); item import mapping;
scan-lookup contracts; C-47 barcode enforcement design.

## Assumption until resolved

**No reuse-after-deactivation behavior may be implemented or inferred.** The
current database has no barcode uniqueness constraint at all; PDR-01's
enforcement is a future bounded implementation task that must wait for (or
explicitly scope around) this question. Comparison semantics default to the
current implementation posture (normalized optional string, stored as given)
without deciding case sensitivity.

## Dependencies

- [PDR-01](./PDR-01-item-barcode-policy.md) (decided policy this question
  completes); OQ-36 (deletion/code-reuse chain — physical deletion of
  never-referenced items is decided, code/barcode reuse is not); OQ-33
  (taxonomy context).
