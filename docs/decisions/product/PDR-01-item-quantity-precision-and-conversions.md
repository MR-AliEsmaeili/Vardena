# PDR-01: Quantity precision and unit-conversion semantics (OQ-29 — Option A)

- **Type:** PDR (Product Decision Record) · decision id **OD-C47-01**
- **Status:** **Decided** — Owner decision recorded 2026-10-02
- **Decided by:** Repository Owner (Ali Esmaeili), explicit decision text recorded in the work order for this governance task
- **Owner of the remaining questions:** Product + Inventory expert + accountant
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-29 remains OPEN** (partially resolved; see §5)
- **Recording baseline:** `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107)
- **Related records:** [C-47 preflight investigation](../../tasks/c-47-item-master-preflight-investigation.md) §5 (options A–D) · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §6 (options A–D with impact) · ADR-0022 (Accepted) · [this task's reconciliation report](../../tasks/c-47-owner-decision-and-dependency-reconciliation.md)

> This record transcribes an Owner decision. It authorizes **no** implementation,
> changes **no** production code or schema, promotes **no** ADR, and does not
> accept any merged work (STATE.md §6: MERGED/green CI ≠ ACCEPTED).

## 1. Question decided

OQ-29 (verbatim registry text): *"Units and conversions: precision per unit,
rounding rules for fractional conversions, whether conversion factors may change
over time (and with what effect on history), and which conversions are global vs
item-specific."*

The Owner selected **Option A** of the option set recorded in the C-47 preflight
§5 and the C-47 hardening report §6.

## 2. Decision (OD-C47-01) — Option A

1. **Fixed quantity precision: four fractional decimal places.** Precision is a
   single fixed scale, not a per-unit attribute.
2. **A conversion result that cannot be represented exactly at the supported
   precision is rejected.** Rejection is the required behavior, not a fallback.
3. **No rounding and no silent truncation** is permitted anywhere on the
   conversion/quantity path.
4. **Conversion-factor changes must use effective-dated versions.** A factor is
   never edited in place.
5. **Historical conversion versions, and the data required to interpret prior
   transactions, must be preserved.**

## 3. What this decision does NOT decide

Per the Owner's explicit instruction, no independent subquestion of OQ-29 that
this decision does not answer is closed. Still **OPEN** under OQ-29:

| Sub-question | Status after OD-C47-01 |
|---|---|
| Per-unit precision concept (a `units.precision` column / integer-only units) | **OPEN** — Option A fixes one global scale; it does not state whether a future per-unit *presentation or entry* constraint is wanted |
| Which conversions are global vs item-specific, and whether an item-specific pair may override a global pair | **OPEN** — current code lets item-specific win; the decision text does not confirm that precedence |
| Whether a reverse pair may be derived by division instead of being declared explicitly | **OPEN** — division requires a rounding rule, which this decision forbids; the product consequence (always declare both directions?) is unanswered |
| Where in the pipeline the exactness gate applies for *future* consumers (document line, movement, balance, report, valuation) | **OPEN** beyond the movement-posting boundary that exists today |
| Interaction with valuation/cost precision | **OPEN** — owned by OQ-24/OQ-11, not by this decision |
| Whether a factor version may be back-dated, superseded or corrected, and by whom | **OPEN** — effective dating is decided; its governance/permission model is not |

## 4. Implementation evidence on `main` (fact, not acceptance)

The decided rule and the currently implemented behavior **coincide**; the
decision converts interim fail-closed behavior into approved policy. No
production change is authorized by this record.

| Decided element | Current implementation evidence |
|---|---|
| Four fractional decimals, fixed | `backend/src/modules/inventory/domain/quantities.ts` (`QUANTITY_FRACTION_DIGITS = 4`, `numeric(18,4)` gate); `backend/prisma/schema/inventory.prisma` (`quantity`, `baseQuantity` `@db.Decimal(18, 4)`) |
| Reject non-representable exact results | `quantities.ts` `fitsQuantity` (fail-closed); `backend/src/modules/inventory/application/inventory-posting-support.ts` (`resolveEnteredToBase`) |
| No rounding / no truncation | `quantities.ts` header rule ("Rounding policy (OQ-29): there is none"); exact BigInt mantissa arithmetic |
| Effective-dated factor versions | `backend/src/modules/inventory/domain/unit-conversion.ts`; `application/unit-conversions.service.ts`; `data/unit-conversions.repository.ts` (planning inside the locked transaction); no `Edit` permission exists (`domain/inventory-permissions.ts`) |
| Historical interpretability preserved | `InventoryMovement` snapshots entered unit, base unit and `conversionFactor` (`backend/prisma/schema/inventory.prisma`); `resolveVersionAt` resolves the version in force at the business date |
| Regression proof | `backend/src/modules/inventory/domain/quantities.spec.ts`; `application/inventory-posting-support.spec.ts`; `application/unit-conversions.service.spec.ts`; live-PG cases 3–7 in `backend/test/item-master-live.e2e-spec.ts` |

**Delta analysis:** no schema, API or behavioral delta is identified as required
by OD-C47-01. The practical effect is that the existing behavior may now be
*documented as policy* instead of "interim, unapproved". Any future change that
introduces rounding, truncation or a per-unit scale would contradict this
decision and requires a new decision record.

## 5. Why OQ-29 stays OPEN

The registry row is annotated **PARTIALLY RESOLVED — remains OPEN**. The
sub-questions in §3 are independent and unanswered; closing the row would
silently decide them, which AG-09/AR-31 forbid.

## 6. Follow-up questions for the Owner / domain expert

1. Is a per-unit *entry* constraint (e.g. integer-only `pcs`) wanted later, or is
   the single fixed scale final for all units?
2. Must both directions of a conversion pair always be declared explicitly, given
   that derivation by division is impossible without rounding?
3. Is item-specific precedence over a global pair confirmed as policy?
4. Which authority may create a back-dated conversion version, and does a
   back-dated version require a reason/audit beyond the current event?
