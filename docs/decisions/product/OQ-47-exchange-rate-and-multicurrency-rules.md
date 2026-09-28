# OQ-47: Exchange-rate and multi-currency accounting rules

- **Type:** OQ (accounting/product — accountant + owner)
- **Status:** Open
- **Owner:** Ali Esmaeili (with accountant as domain validator)
- **Created:** 2026-09-22
- **Priority:** High for post-MVP accounting correctness · Zero MVP urgency (single-currency MVP)
- **Related docs:** PB-BASELINE §21 (Currency), PD-25, PD-26; OQ-03 (currencies/precision, existing); OQ-48 (revaluation/FX P/L, sibling); `docs/accounting/domain-contract.md` §13.6/§24.1 (currency seam); MVP proposal category D; roadmap Stage 7+

## Context

Confirmed requirements (PD-25, DECIDED):

- configurable base currency per organization;
- multiple currencies definable;
- currency per transaction/document;
- foreign amount and base amount per line/document;
- historical exchange rate snapshotted at composition;
- rial/base currency as the accounting basis (the balancing invariant is defined
  in the base currency — contract §13.6).

The schema seams for all of the above already exist (reserved currency/rate
fields on documents and lines; Task 10.1 explicitly kept multi-currency
additive).

Unresolved — the _rules_ that turn those seams into working accounting:

1. **Rate source and governance**: who sets rates (manual entry? import from a
   source? central-bank reference?), at what granularity (per day? per
   transaction?), with what approval and audit? Can a rate be corrected after
   documents used it?
2. **Currency account separation**: do foreign-currency balances live in
   dedicated accounts/sub-ledgers (typical Iranian practice uses separate
   rial-equivalent accounts per currency partner), or is currency a pure
   analytical dimension on the same accounts?
3. **Foreign-currency inventory valuation**: are purchase costs converted at
   receipt-time rate and then treated as rial costs (recommended default), or
   must inventory layers retain currency identity?

## Why this matters

- These rules decide whether the dormant seams can be activated without schema
  or contract changes (the whole point of reserving them).
- Wrong rate governance poisons every downstream figure (AR, AP, COGS, reports).
- Inventory valuation in currency touches OQ-24 (costing method) — they must be
  decided together.

## Exact decision required

1. Rate source(s), effective-dating, approval and correction rules (OQ-47).
2. Currency-account model: dedicated accounts per currency vs analytical
   dimension (OQ-47).
3. Whether inventory valuation must retain currency identity (OQ-47), or
   converts once at receipt (then OQ-48 governs revaluation).
4. Precision/rounding rules per currency (with OQ-03).

## Options

| Option                                                                                                   | Advantages                                                           | Disadvantages                                                           |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **A. Currency as analytical dimension on single chart** (rial books only; per-line rate snapshot exists) | Minimal schema; matches "rial as basis"; simplest reports            | Currency P/L tracking harder; currency exposure visibility limited      |
| **B. Dedicated currency accounts** (separate control accounts per currency)                              | Standard Iranian practice familiarity; cleaner FX exposure reporting | More chart configuration; posting-rule mapping complexity               |
| **C. Full dual-currency ledgers** (parallel foreign-currency books)                                      | Strongest FX accounting                                              | Contract/schema extension; heavy; likely unnecessary for target segment |

## Risks

- Activating seams without rules → inconsistent conversions, unreproducible
  reports.
- Inventory-in-currency interacts with OQ-24 costing method — deciding one
  without the other creates rework.

## Dependencies

- OQ-03 (precision per currency), OQ-24 (costing method), OQ-30 (tax on
  foreign-currency documents).
- OQ-48 (revaluation/FX gain-loss consumes whatever account model is chosen).
- Accountant validation mandatory before implementation (OQ-43 posture).

## Recommended option

**A first, B as a configuration outcome where a customer needs it**: keep
currency analytical (rate snapshot per line, rial books), dedicate accounts only
if an accountant requires separation — since the chart is organization-owned,
B can often be satisfied _without_ new architecture. **Recommendation only.**

## Questions requiring product owner confirmation

1. Who is the authoritative rate source for your target customers, and does it
   need to be _the system's_ job or the accountant's manual entry?
2. Do target customers expect dedicated currency accounts (option B) or is
   analytical currency enough (A)?
3. Must inventory retain currency identity, or convert once at receipt?

## Decision deadline or dependency

Must be resolved before any multi-currency activation task (post-MVP, Stage 7+).
Not on the MVP critical path.

## Related documents

PB-BASELINE §21; OQ-03, OQ-24, OQ-30, OQ-43, OQ-48; accounting domain contract
§13.6/§24.1; roadmap Stage 7.
