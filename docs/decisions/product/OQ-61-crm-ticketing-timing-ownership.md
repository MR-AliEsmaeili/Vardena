# OQ-61: CRM/ticketing timing and ownership

- **Type:** OQ (commercial/product decision)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** Low · Commercial operations, not product development
- **Related docs:** PB-BASELINE §29, PD-37; OQ-59 (product strategy), OQ-50 (API surface), OQ-57 (ecosystem); roadmap Stage 8

## Context

The current direction (PB-BASELINE §29, DIRECTIONAL): CRM and ticketing for
Vardena's own commercial operations start as **separate products or external
tools**, integrating with Vardena over time. Scope: customers, leads, licenses,
contracts, renewals, support, communications (CRM); ticketing as a
commercial/support capability.

Undecided:

1. **Timing**: when does the commercial operation actually need this — at pilot
   (Stage 6, a handful of customers), at public release (Stage 8), or later?
2. **Buy vs build vs spreadsheet-phase**: is there an interim tool (CRM SaaS,
   even a spreadsheet) before a real system?
3. **Ownership**: who operates it (owner? a hired support person?), and which
   system is source of truth for customers/licenses while Vardena's own
   licensing foundation (ADR-0030) is minimal?

## Why this matters

- License/contract/renewal tracking has *no home* today — ADR-0030 records
  license state in-product, but the commercial registry (who bought what, when
  does it renew) lives nowhere. This is an operational gap that bites at the
  first renewal.
- A premature build (custom CRM) is exactly the "feature accumulation without
  real users" the non-goals reject; a permanent spreadsheet eventually breaks.

## Exact decision required

1. The interim tool and its owner (what runs the commercial operation in the
   next 12 months?).
2. The trigger to invest in a real CRM/ticketing (customer count? support
   load? renewal complexity?).
3. Integration direction and source-of-truth split (CRM owns prospects;
   Vardena owns licenses/usage — or the reverse?).

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Structured interim tool** (lightweight CRM SaaS or even disciplined spreadsheet; owner-maintained) | Near-zero cost; adequate for pilot volume | Manual discipline required; no integration |
| **B. Off-the-shelf CRM + ticketing at Stage 8** (buy when going public) | Proven tooling; fast; integrates later via API (OQ-50) | Cost; data migration from interim tool |
| **C. Build custom CRM/ticketing as Vardena-family products** | Full control; product-family bet (OQ-59 option B territory) | Classic distraction risk; delays ERP value |

## Risks

- Renewals/licenses tracked nowhere → missed renewals, unsupported customers.
- Option C consuming focus during the ERP's critical path.

## Dependencies

- OQ-59 (product family strategy — C is a strategy change), OQ-50 (API
  surface for integration), ADR-0030 (license foundation shape), OQ-45
  (expiry behavior needs a commercial registry to be meaningful).

## Recommended option

**A now (documented interim registry with owner as owner), B at Stage 8,
C only as an outcome of OQ-59's strategic review.** **Recommendation only.**

## Questions requiring product owner confirmation

1. What tool(s) track your customers/licenses/renewals *today*, and is that
   adequate through pilot phase?
2. What customer count or support load should trigger buying a real CRM?
3. Do you want ticketing separated from CRM or combined in one tool?

## Decision deadline or dependency

Stage 8 planning; interim answer needed by Stage 6 (pilot support becomes real
work).

## Related documents

PB-BASELINE §29; OQ-50, OQ-57, OQ-59; ADR-0030; roadmap Stage 8.
