# OQ-56: Two-book accounting architecture

- **Type:** OQ (product/accounting architecture decision)
- **Status:** Open
- **Owner:** Ali Esmaeili (with accountant + tax expert input)
- **Created:** 2026-09-22
- **Priority:** Medium · Post-MVP · Requires separate analysis before any design
- **Related docs:** PB-BASELINE §20 (two-book as "separately analyzed"), PD-24; OQ-22 (books/entities in one DB), OQ-31 (consolidation deferred), OQ-40 (financial areas — a _possible_ mechanism), OQ-43 (statutory books); accounting contract §5.1/§24.2 (area ≠ company); roadmap post-MVP

## Context

The owner's clarifications mention two-book accounting (دفاتر قانونی/موازی —
parallel statutory vs management books) as a possible need. The baseline
records it as "a separately analyzed capability or extension" — undecided, not
in MVP.

The repo already contains a mechanism _shaped_ like parallel books: the
**financial area** (حوزه مالی, `accounting.financial_areas`) — an
Accounting-owned bookkeeping scope with its own numbering scope, area
applicability on accounts/detail items, and n≥1 areas per organization
(AC-D-02…AC-D-05). This makes two-book accounting _plausible_ as
"two financial areas with different account structures" — but the contract
deliberately stops short: areas share one organization-scoped chart, no
consolidation, no `company_id`, and OQ-40 explicitly leaves "is an area ever a
separate legal book?" open.

## Why this matters

- If two-book accounting is ever needed, the wrong mechanism choice (areas vs
  separate organizations vs dual ledger columns) is expensive to reverse.
- Statutory books have hard requirements (OQ-43: legal books, retention,
  Persian, no deletion) that management books don't — mixing them casually
  creates compliance risk.
- Iranian practice: many companies keep statutory books that differ from
  management books (adjusted/unadjusted), often maintained manually —
  customers may expect system support.

## Exact decision required

1. Is two-book accounting in the product plan at all (vs "accountants do it
   manually")?
2. If yes: which mechanism — financial areas (OQ-40 extension), separate
   organizations per book (OQ-22/OQ-31 territory), or a dual-book model with
   statutory/management tagging on documents?
3. How do statutory requirements (OQ-43) apply per book?
4. Is cross-book reconciliation/consolidation in scope (the deferred
   تجمیع و تلفیق topic)?

## Options

| Option                                                                                          | Advantages                                                                                           | Disadvantages                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A. Not in product; accountants maintain statutory books manually**                            | Zero cost; matches current manual practice                                                           | No differentiator; error-prone; competitors may offer it                                   |
| **B. Financial areas as parallel books** (extend OQ-40: per-area charts, area-pinned documents) | Reuses the decided mechanism; one DB; familiar to Iranian accountants (حوزه مالی is a known concept) | Contract change (AC-D-04 shared-chart assumption); consolidation/elimination still missing |
| **C. Separate organization/book entities with consolidation**                                   | Cleanest legal separation                                                                            | OQ-31/OQ-56 deferred complexity; effectively multi-company ADR territory                   |

## Risks

- B needs a _contract change_ to the accounting bounded context (AC-D-04) —
  an ADR-level change, not configuration.
- Statutory requirements differ per book type; OQ-43 must be answered per book.

## Dependencies

- OQ-40 (financial area multiplicity/charts — the gating question), OQ-43
  (statutory books), OQ-31 (consolidation/multi-company ADR), OQ-22.
- Accountant + tax expert validation of what "two books" legally requires.

## Recommended option

**Defer with a documented analysis task**: neither A nor B nor C is chosen now;
when a named customer demand or legal requirement appears, run the analysis
(starting from OQ-40's answer) before any design. **Recommendation only.**

## Questions requiring product owner confirmation

1. Do target customers genuinely need system-supported two-book accounting, or
   is manual practice acceptable?
2. If needed: statutory+management in one system — is that the actual request,
   or is it really multi-company (a different problem)?
3. Is consolidation across books/companies ever in scope (تجمیع و تلفیق)?

## Decision deadline or dependency

Post-MVP; re-open on named demand or legal change. Requires OQ-40 resolution
first.

## Related documents

PB-BASELINE §20; OQ-40, OQ-43, OQ-31, OQ-22; accounting contract §5, §24.2;
roadmap post-MVP.
