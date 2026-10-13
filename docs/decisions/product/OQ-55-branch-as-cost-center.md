# OQ-55: Branch as cost center

- **Type:** OQ (product/accounting decision)
- **Status:** Open
- **Owner:** Ali Esmaeili (with accountant input)
- **Created:** 2026-09-22
- **Priority:** Medium · Not MVP-blocking
- **Related docs:** PB-BASELINE §20, PD-23; OQ-22 (existing branch/organization scope), OQ-31 (inter-branch/inter-company), OQ-40 (financial areas), OQ-41 (detail dimensions — branch may bind as a dimension); accounting domain contract §5 (financial area ≠ branch); roadmap Stage 7

## Context

The repo has decided: branch (شعبه) is a scope dimension of the same legal
entity's books — warehouses belong to one branch, movements are branch-scoped,
reports can slice by branch (OQ-22 interim posture, retained by Task 6
organization-scoping ADR-0021). The accounting contract keeps financial area
(حوزه مالی) and branch as *separate* subsystems (contract §5.1/§24.2, OQ-40).

The owner's clarifications describe branches as **physical organizational
units** with branch-specific inventory, warehouse, cashbox, reporting and
access — but say nothing about the *accounting* treatment of branch activity:

1. Is branch a **cost center** (an accounting dimension attached to journal
   lines for expense allocation and branch P&L)?
2. Or is branch purely an operational/scope dimension with no ledger presence?
3. If a cost center: is it a **detail dimension** (تفصیلی — bound to branch
   master data via OQ-41's optional master-data binding), or a first-class
   ledger column?

## Why this matters

- Decides whether branch P&L / branch expense reporting is possible without
  rework (if branch must appear on journal lines, the posting path and
  dimension model must carry it).
- Interacts with OQ-41 (detail dimension count/binding) and OQ-24 (cost
  allocation is a *separate* deferred engine — a branch cost-center answer must
  not silently assume allocation).
- Iranian accounting practice commonly treats branches as cost centers —
  accountants will ask.

## Exact decision required

1. Must journal lines carry branch (yes/no)?
2. If yes: via detail dimension bound to branch master data (OQ-41 mechanism),
   or a dedicated ledger column?
3. Is branch-level expense *allocation* (تسهیم) in scope — noting allocation
   is separately deferred — or only branch-level *aggregation* of what is
   posted?

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Branch = operational scope only** (no ledger presence) | Simplest; consistent with OQ-22 interim; no posting changes | No branch P&L from the ledger; accountants may object |
| **B. Branch as detail dimension (bound to branch master data)** | Uses the decided dimension mechanism (OQ-41); optional per organization; branch P&L possible | Depends on OQ-41 resolution; dimension discipline required on postings |
| **C. Branch as first-class ledger column** | Strongest queries/consistency | Schema + contract extension; likely premature |

## Risks

- Choosing B before OQ-41 resolves the requiredness rules creates ambiguity on
  every posting line.
- Assuming allocation comes with cost-centering (it doesn't — allocation is
  deferred; aggregation only).

## Dependencies

- OQ-22 (branch scope semantics), OQ-41 (dimension mechanism), OQ-40
  (financial areas — must not be conflated with branches), OQ-31
  (inter-branch transfers), OQ-24 (allocation engine deferred).

## Recommended option

**B, per-organization optional**: branch may be bound as a detail dimension
where the accountant wants branch P&L; nothing is forced. This reuses the
decided mechanism and keeps A available as configuration. **Recommendation
only — owner + accountant decide.**

## Questions requiring product owner confirmation

1. Do target customers expect branch-level P&L from the ledger?
2. Do you accept branch-as-dimension (configurable) as the mechanism?
3. Is expense *allocation* to branches explicitly out of scope for the
   foreseeable future (it is currently deferred)?

## Decision deadline or dependency

Post-MVP (Stage 7 planning); must be resolved together with OQ-41 for any
accounting-dimension work.

## Related documents

PB-BASELINE §20; OQ-22, OQ-31, OQ-40, OQ-41, OQ-24; accounting contract §5,
§10/§11; roadmap Stage 7.
