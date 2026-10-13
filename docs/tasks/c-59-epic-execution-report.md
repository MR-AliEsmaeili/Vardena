# C-59 Inventory valuation and Accounting eligibility — execution report

Status: Partial implementation; known scope gaps remain
Date: 2026-10-06
Baseline: `main` @ `319e9dd2fc25003fa25298b080b05999aeb8f0fd` (PR #124)

## Baseline audit

The repository already contained more than the work order's greenfield wording implied:

- C-58 owns Receipt, Issue, and Transfer documents and composes the existing ledger; it does not update balances directly.
- C-59A owns Receipt's cost-optional contract.
- Issue already forbids manual cost and is valued by Moving Weighted Average in `InventoryMovementsRepository`.
- Transfer already posts an atomic source/destination pair and `valueTransfer` carries the source value to the destination.
- Movement reversal already mirrors the original movement value.
- One-key explicit recalculation already exists, but the PDR-07 periodic, date/warehouse/document-kind batch operation does not.
- Return document kinds and Reverse Pricing do not exist.
- The Accounting boundary existed but previously checked lifecycle only.

These findings agree with `c-59-readiness-and-scope-proposal.md`, PDR-07, PDR-08, ADR-0039, and ADR-0040. Actual GL/COGS creation remains blocked by OQ-24/OQ-39/OQ-42 and is not implemented here.

## Implemented in this branch

- Document valuation state is now derived from authoritative movement-level valuation facts for operational Receipt, Issue, and Transfer documents.
- `unvalued`, mixed/provisional, and all-`valued` fact sets map to `unpriced`, `partially_priced`, and `priced` respectively.
- Missing or cross-organization movement facts fail closed as `unpriced`.
- Added explicit `accountingEligible`, independent from permissions and lifecycle.
- Accounting Post now rejects non-operational, unpriced, partially priced, or valuation-stale documents with `inventory.document.accounting_ineligible`.
- Accounting Post retries after the boundary are idempotent and do not create a duplicate effect.
- `canAccountingPost` now reflects domain eligibility rather than lifecycle alone.
- Receipt Draft keeps C-59A's manual-cost preview; operational state comes from the ledger.
- Frontend generated contract exposes the backend-owned eligibility result; no UI domain-rule duplication was introduced.

## Actual regression matrix at this point

| Flow | Operational | Valued | Accounting Eligible | Accounting Post |
|---|---:|---|---:|---:|
| Receipt without cost | Yes | No until explicit recalculation can resolve it | No | No |
| Receipt with cost | Yes | Yes | Yes* | Boundary only* |
| Issue | Yes | Depends on movement valuation | Only if Priced | Boundary only* |
| Transfer | Yes | Source-derived, destination same value | Only if Priced | Boundary only* |
| Purchase Return | No dedicated document kind | Not implemented | No | No |
| Sales Return | No dedicated document kind | Not implemented | No | No |
| Reversal | Movement-level only | Original movement value | No document eligibility model | No |

`*` Permission, organization scope, lifecycle, and non-stale valuation must also pass. The current Accounting Post marks the Inventory boundary; it does not create a GL document.

## Deferred / blocking gaps

The requested Epic is not complete. The following decided requirements require schema and vertical-slice work and were not fabricated as shortcuts:

1. Purchase Return and Sales Return document kinds, original-basis links, MWA fallback, and cold-start refusal (PDR-08 OD-RET).
2. Periodic Pricing Operation scope/reporting/history beyond the existing one-key recalculation (PDR-07 OD-PDP).
3. Run-scoped Reverse Pricing, compensating history, latest-run and accounting blockers, and dedicated permission (PDR-08 OD-RVP).
4. Coupled two-key replay for backdated Transfer; the existing implementation correctly remains fail-closed.
5. A transaction-level lock around the Accounting eligibility check and lifecycle update. Current movement values are immutable except through explicit pricing, but a full Pricing/Reverse Pricing implementation must serialize this boundary.
6. Separate edit-time `backdateConfirmed` from `acknowledgeSideEffects`, already named by C-58/C-59A.
7. Actual inventory GL/COGS posting remains blocked by open owner/accounting decisions.

No ADR was added because PDR-07/PDR-08 already decide the implemented semantics and ADR-0039/0040 already describe the architecture.
