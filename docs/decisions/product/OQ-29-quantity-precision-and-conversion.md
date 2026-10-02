# OQ-29: Units and conversions — quantity precision and conversion semantics

- **Type:** OQ decision record (Inventory domain policy; central-registry OQ below OQ-44, recorded here per the 2026-10-02 Owner decision session)
- **Status:** **Decided (Option A) — partial**: precision, fractional-conversion handling, factor-change mechanism and history preservation are decided; the independent global-vs-item-specific subquestion remains **Open**
- **Owner:** Ali Esmaeili (Repository Owner) — decision prepared by the C-47 preflight §5 and readiness report §6 briefs
- **Decided:** 2026-10-02
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — OQ-29 (row stays **Open** for the remaining subquestion)
- **Related:** [OQ-33 record](./OQ-33-item-taxonomy-and-capabilities.md) · [OQ-36 record](./OQ-36-item-deletion-and-code-reuse.md) · [PDR-01 item barcode policy](./PDR-01-item-barcode-policy.md) · ADR-0022 (Accepted) · [C-47 preflight investigation](../../tasks/c-47-item-master-preflight-investigation.md) §5 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §6

## Decision (Option A)

The Owner decided **Option A** — the option that matches the fail-closed behavior
already shipped and regression-pinned by the C-47 hardening slice:

1. **Fixed quantity precision: four fractional decimal places.** The quantity
   scale is a single fixed repository-wide precision — `numeric(18,4)`. The
   OQ's "precision per unit" sub-question is answered by this fixed-scale
   model: there is **no per-unit precision** contract, column, or seed.
2. **Exact-fit or reject.** A conversion result that cannot be represented
   exactly at the supported precision (four fractional decimal places) is
   **rejected**. No rounding and no silent truncation is applied anywhere on
   the conversion path.
3. **Conversion-factor changes use effective-dated versions.** A factor may
   change only through a new effective-dated version of the conversion pair
   (the existing half-open `valid_from`/`valid_to` versioning); there is no
   in-place edit of an existing version.
4. **History is preserved.** Historical conversion versions are retained, and
   the data needed to interpret prior transactions (entered quantity and unit,
   resolved base quantity, and the conversion factor snapshot carried on each
   movement) is preserved, so backdated business dates resolve the factor that
   was in force at that instant.

**Explicit boundary:** this decision does **not** close any independent
subquestion of OQ-29 that it does not answer (see below).

## What this decision decides — and what it does not

| OQ-29 subquestion                                                       | Status after 2026-10-02                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precision per unit                                                      | **DECIDED** — fixed four fractional decimal places; no per-unit precision                                                                                                                                                                                                                                                                                                       |
| Rounding rules for fractional conversions                               | **DECIDED** — reject non-representable results; no rounding, no truncation                                                                                                                                                                                                                                                                                                      |
| Whether conversion factors may change over time (and effect on history) | **DECIDED** — effective-dated versions only; historical versions and transaction-interpretation data preserved                                                                                                                                                                                                                                                                  |
| Which conversions are global vs item-specific (precedence/scope)        | **OPEN** — not answered by this decision. Whether an item-specific pair may override a global pair for the same unit pair (current implementation behavior), what the permitted scope of each kind is, and whether reverse pairs are ever derived (the current implementation never divides/invents a reverse pair) remain undecided. These must not be inferred from Option A. |

## Implementation evidence (current `main` conforms to the decided rule)

The decision approves existing behavior; **no production code or schema change
was required or made** by the decision-recording task:

- `backend/src/modules/inventory/domain/quantities.ts` — exact `BigInt`
  mantissa arithmetic on decimal strings; `fitsQuantity` is the fail-closed
  gate that rejects any product needing more than four fractional places. The
  source comment records that "inventing a rounding rule is exactly what OQ-29
  forbids".
- `backend/prisma/schema/inventory.prisma` — quantities `numeric(18,4)`,
  conversion factors `numeric(18,6)` (`inventory.items`,
  `inventory.unit_conversions`, `inventory.item_unit_conversions`,
  `inventory.inventory_movements`).
- `backend/src/modules/inventory/domain/unit-conversion.ts`,
  `application/unit-conversions.service.ts`,
  `data/unit-conversions.repository.ts` — half-open effective windows,
  open-ended version supersession, historical `resolveVersionAt`, no in-place
  edit endpoint; pair-scoped advisory-lock supersession fix from the C-47
  hardening (PR #107).
- `backend/src/modules/inventory/application/inventory-posting-support.ts` —
  entered/base quantity and factor snapshot resolution used by every posting.
- Tests pinning the decided behavior: `domain/quantities.spec.ts`,
  `domain/unit-conversion.spec.ts`,
  `application/unit-conversions.service.spec.ts`,
  `application/inventory-posting-support.spec.ts`, and the live-PostgreSQL
  suite `backend/test/item-master-live.e2e-spec.ts` (backdated factor snapshot;
  > 4-dp fail-closed rejection; conversion races) — executed green in CI by
  > PR #107 (runs `36991377976`, `36992098706`).

## Consequences

- The previously **interim** fail-closed behavior is now the **decided** rule:
  any future change to precision or fractional handling requires a new explicit
  Owner decision, not an implementation choice.
- Downstream quantity-bearing candidates — **C-48 opening quantity, C-49
  opening rial, C-51 warehouse receipt, C-52 warehouse issue** — must inherit
  exact-fit-or-reject line math; the readiness report's "downstream blocked"
  column for Option A is discharged on the precision axis only (their own
  opening/valuation/integration blockers are unaffected).
- No migration is required (storage scale is already `numeric(18,4)` /
  `numeric(18,6)`).
- C-47's quantity/conversion acceptance criterion (preflight §7 item 4) is now
  decidable against an approved rule rather than an interim behavior.

## Follow-up questions (open)

1. Global vs item-specific conversion precedence and permitted scope (including
   approval or change of the current item-specific-over-global precedence) —
   remains under OQ-29.
2. Reverse-pair derivation semantics — remains under OQ-29 (the current
   no-derived-reverse behavior is implementation posture, not a decided rule).
