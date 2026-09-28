# OQ-59: One ERP + products vs product family / consolidation strategy

- **Type:** OQ (strategic/product decision)
- **Status:** Open — strategic; deliberate long-horizon
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** Low urgency · High consequence if never asked
- **Related docs:** PB-BASELINE §13 (platform/products), §20 (multi-company), §27 (ecosystem), §29 (CRM/ticketing), PD-22; OQ-01 (tenancy), OQ-22, OQ-31 (multi-company/consolidation deferred), OQ-61 (CRM/ticketing products); ADR-0001 §12 (extraction path); roadmap post-MVP

## Context

The owner's clarifications describe Vardena as **one ERP product built on a
platform core, with independent modules and potential future products**
(CRM/ticketing as separate products, marketplace possibility, enterprise
capabilities). But the _strategy_ for how products relate is unstated:

1. **One ERP + satellite products**: Vardena ERP is the center; CRM, ticketing,
   vertical packages etc. are separate products that integrate with it.
2. **Product family / platform company**: the platform core becomes the
   product; ERP, CRM, and others are siblings with equal weight.
3. **Consolidation-capable ERP**: holding/multi-company consolidation
   (تجمیع و تلفیق) becomes a flagship enterprise capability of the ERP itself
   (currently deferred — OQ-31).

These imply different investment patterns (where platform hardening happens),
different sales stories, and different multi-installation data architecture
(one customer, several Vardena installations — already directional in PB
§9/§20 — becomes a first-class need).

## Why this matters

- Post-MVP investment (Stage 7+) divides differently under each strategy.
- The multi-DB-per-customer + consolidation question (holding groups) has real
  architecture consequences (cross-installation reporting is _not_ possible in
  the current single-installation model) — knowing the strategy decides whether
  to keep reserving seams.
- Without the answer, "future products" remains a loose list rather than a
  roadmap.

## Exact decision required

1. Which strategic shape is intended (center-and-satellites / platform-family /
   ERP-with-consolidation)?
2. Is cross-installation consolidation (holding reporting) ever a product
   capability, or does it stay out (accountants consolidate manually)?
3. What is the relationship rule: does every future product integrate with
   Vardena ERP, or do some stand alone?

## Options

| Option                                                                                             | Advantages                                                    | Disadvantages                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A. Center-and-satellites** (Vardena ERP is _the_ product; others orbit and integrate)            | Focused investment; clear story; matches current architecture | Ceiling if ERP market saturates                                          |
| **B. Platform family** (platform core is the product; ERP is one app)                              | Broader ambition; reuse payoff                                | Platform-first trap (PB §32 non-goal #3); dilutes near-term focus        |
| **C. ERP with consolidation flagship** (invest in multi-installation consolidation for enterprise) | Enterprise revenue; differentiator vs competitors             | Heavy architecture (cross-DB reporting); OQ-31 territory; not SMB market |

## Risks

- Choosing B too early is precisely the "overly generic architecture" the
  owner's non-goals reject (PB §32).
- C requires multi-company/consolidation ADRs (OQ-31) that don't exist.

## Dependencies

- OQ-31 (multi-company/consolidation ADR), OQ-01 (tenancy), OQ-22, OQ-61
  (CRM/ticketing shape), OQ-57 (ecosystem).
- ADR-0001 §12 (extraction path preserves the option, doesn't choose it).

## Recommended option

**A for the planning horizon, with the extraction path kept intact** (it
already is): treat Vardena ERP as the center; let CRM/ticketing exist as
separate products that integrate; revisit B/C only with a strategic review the
owner initiates. **Recommendation only — owner decides.**

## Questions requiring product owner confirmation

1. Is Vardena ERP the center of your product strategy for the next 2–3 years?
2. Is holding-level consolidation a market you intend to serve, or explicitly
   not?
3. Do you accept recording "future products integrate _with_ Vardena" as the
   working rule until a strategic review changes it?

## Decision deadline or dependency

No deadline; natural checkpoint at post-MVP strategic planning (after Stage 8).

## Related documents

PB-BASELINE §13, §20, §27, §29, §32; OQ-01, OQ-22, OQ-31, OQ-57, OQ-61;
ADR-0001 §12; roadmap post-MVP.
