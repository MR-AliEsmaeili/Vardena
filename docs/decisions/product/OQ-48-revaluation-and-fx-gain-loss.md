# OQ-48: Revaluation and foreign-exchange gain/loss

- **Type:** OQ (accounting/product — accountant + owner)
- **Status:** Open
- **Owner:** Ali Esmaeili (with accountant as domain validator)
- **Created:** 2026-09-22
- **Priority:** Medium-High for post-MVP accounting completeness · Zero MVP urgency (single-currency MVP)
- **Related docs:** PB-BASELINE §21.2, PD-26; OQ-47 (rate rules, sibling), OQ-03, OQ-24; `docs/accounting/domain-contract.md` §13.6/§24.1; roadmap Stage 7+

## Context

Sibling of OQ-47 (rate sources, currency account model, currency inventory).
Even after OQ-47 decides *how foreign amounts enter the books*, the
*periodic accounting treatment* of currency movement is separately undecided:

1. **Revaluation**: must open foreign-currency balances (AR/AP/cash) be
   revalued at period end to a current rate, with the difference posted?
2. **Realized FX gain/loss**: when a foreign-currency receivable is settled at
   a different rate than booked, is the difference recognized automatically, on
   settlement documents, or manually?
3. **Unrealized gain/loss**: are unrealized differences recognized at period
   end (Iranian tax practice has specific positions), and are they tax-
   acceptable adjustments or informational only?
4. **Mechanism**: automatic period-end revaluation documents (permission-gated,
   reversible per correction model OQ-27) vs manual accountant journals.

## Why this matters

- Decides whether period-end accounting for FX customers is a product feature
  or an accountant's manual process.
- Tax acceptability of unrealized differences is a compliance question (OQ-43
  adjacency) — wrong treatment = statutory misstatement.
- The correction/immutability model (AR-13, OQ-27) must accommodate reversals
  of revaluation documents.

## Exact decision required

1. Is revaluation in scope at all for Vardena's target segment, and in which
   stage?
2. Realized vs unrealized treatment; tax position on unrealized differences.
3. Automatic (period-end job producing reviewable revaluation documents) vs
   manual (accountant does it by hand with no special feature)?
4. Which accounts/balances are subject to revaluation (depends on OQ-47
   account model)?

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. No revaluation feature; manual accountant journals** | Zero cost; accountants already do this; no tax-rule liability | No assistance; error-prone; competitive gap for FX-active customers |
| **B. Period-end revaluation document (auto-calculated, human-approved)** | Reuses voucher/review patterns (Mode B, OQ-42); auditable; reversible | Requires OQ-47 account model + rate governance first; real build cost |
| **C. Continuous revaluation on every document** | Always-current books | Heavy; unusual for segment; tax treatment unclear |

## Risks

- Shipping automatic revaluation with a wrong tax position (compliance risk
  R-04).
- Revaluation documents colliding with period close/reopen policy (OQ-23).

## Dependencies

- Hard dependency: OQ-47 (account model + rate governance) and OQ-03.
- OQ-23 (period close policy), OQ-27 (correction windows for reversals),
  OQ-43 (tax positions on unrealized differences).
- Accountant sign-off mandatory.

## Recommended option

**B, only for customers who transact in foreign currency, and only after
OQ-47 resolves; A is the default for everyone else until then.** Revaluation
produces reviewable revaluation documents (never silent posts). **Recommendation
only — owner + accountant decide.**

## Questions requiring product owner confirmation

1. Do your first-year customers have meaningful foreign-currency activity?
2. If yes, do their accountants expect system revaluation support in year one,
   or is manual practice acceptable?
3. Do you accept that unrealized gain/loss needs a tax-expert position before
   any automation?

## Decision deadline or dependency

Post-MVP (Stage 7+); re-open with Stage 7 planning. Not on MVP critical path.

## Related documents

PB-BASELINE §21.2; OQ-47, OQ-03, OQ-23, OQ-24, OQ-27, OQ-43; accounting domain
contract §13.6/§24.1; roadmap Stage 7.
