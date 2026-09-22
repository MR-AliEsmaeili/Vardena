# OQ-58: Public release vs internal-only distribution

- **Type:** OQ (commercial/product decision)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** Medium · Commercial, not technical · Blocks sales motion details, not development
- **Related docs:** PB-BASELINE §9 (deployment), §11 (commercial model), §32 (non-goals); OQ-57 (ecosystem), OQ-50 (public API interplay); roadmap Stage 8

## Context

The owner's materials contain a tension the baseline must record rather than
resolve: Vardena is described as a **commercial product with a licensing model
(setup fee + licenses + subscriptions)** — implying a *public, marketed
product* — while at the same time the current phase behaves like an
**internal/selective release** (pilot customers from the owner's network,
controlled installs, product-maturity focus).

Both can be true sequentially, but the *boundary* — when the product becomes
publicly marketed, under what brand assets, website, trial/demo posture, and
sales process — is not decided. This is a genuine commercial contradiction
between "product for the market" and "product being stabilized through
pilots", and per the task rules it is recorded, not silently resolved.

## Why this matters

- Sales/marketing artifacts (website, pricing pages, demo policy) cannot be
  produced without the answer.
- The public-vs-internal posture affects OQ-45 (enforcement seriousness — a
  public product needs real enforcement), OQ-46 (data-ownership promises in
  public contracts), and OQ-60 (acceptance thresholds that qualify a release).
- Trial/demo availability (if any) interacts with the proprietary/no-source
  rules (§22).

## Exact decision required

1. Is there a defined moment/milestone when Vardena becomes publicly marketed
   (and what qualifies it — e.g. MVP acceptance OQ-60)?
2. Distribution posture until then: invitation-only pilots? silent availability?
3. Trial/demo policy: are time-limited demo installations ever offered (and how
   does that square with per-customer controlled installs)?
4. Brand/website/public communication timing.

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Internal-only until MVP acceptance gate passes** (pilots from owner's network; no public marketing) | Protects reputation during hardening; realistic expectations | Slower market contact; pipeline starts late |
| **B. Public announcement at MVP, pilots continue in parallel** | Marketing momentum at a defensible milestone | Support/marketing load during stabilization |
| **C. Public from the start (marketed pre-release)** | Early demand generation | Reputation risk on unfinished product; contradicts maturity focus |

## Risks

- Premature public posture with unproven installs (installation-simplicity
  criterion) and unmeasured recovery targets (OQ-52/OQ-53).
- A trial/demo offering, if improvised, becomes an uncontrolled distribution
  channel for proprietary software.

## Dependencies

- OQ-60 (the MVP acceptance gate is the natural trigger for B), OQ-45
  (enforcement posture must be serious before public), OQ-46 (contract-level
  data promises), OQ-57 (any public ecosystem posture).

## Recommended option

**A now, B at the MVP acceptance gate (OQ-60 ratification)**: stay
invitation-only through pilot hardening; go public when the MVP criteria are
met and enforced licensing (OQ-45) is real. **Recommendation only — owner
decides.**

## Questions requiring product owner confirmation

1. Do you accept "invitation-only until MVP acceptance passes"?
2. Will demos/trials exist, and in what form (on-site demo install? hosted
   demo for prospect viewing only?)
3. What is your intended public-launch moment (event? date-style milestone?
   customer-count trigger?)

## Decision deadline or dependency

Stage 8 (commercial operations) planning; the recommendation ties it to the
OQ-60 gate.

## Related documents

PB-BASELINE §9, §11, §22, §32; OQ-45, OQ-46, OQ-57, OQ-60; roadmap Stage 8.
