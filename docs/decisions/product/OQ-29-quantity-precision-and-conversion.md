# OQ-29: Quantity precision and conversion

- **Type:** OQ (inventory/accounting policy)
- **Status:** **Open — Option A recorded; independent subquestions remain open**
- **Owner decision recorded:** 2026-10-02
- **Owner:** Ali Esmaeili, with inventory-expert and accountant input
- **Related records:** [`docs/open-questions.md`](../../open-questions.md) ·
  [`docs/tasks/c-47-item-master-readiness-hardening-report.md`](../../tasks/c-47-item-master-readiness-hardening-report.md) ·
  [`docs/architecture/domain/master-data-strategy.md`](../../architecture/domain/master-data-strategy.md)
- **Implementation evidence:**
  `backend/src/modules/inventory/domain/quantities.ts`,
  `backend/src/modules/inventory/domain/quantities.spec.ts`,
  `backend/src/modules/inventory/domain/unit-conversion.ts`,
  `backend/src/modules/inventory/domain/unit-conversion.spec.ts`,
  `backend/src/modules/inventory/application/unit-conversions.service.ts`,
  `backend/src/modules/inventory/data/unit-conversions.repository.ts`, and
  `backend/prisma/schema/inventory.prisma`

## Context

The item-master preflight and C-47 hardening report documented the current
quantity/conversion behavior: quantity storage and fit checks use four fractional
decimal places; conversion factors are decimal values; exact conversion results
that do not fit the supported quantity precision are rejected rather than
rounded; and conversion versions are effective-dated. The C-47 report is
historical implementation evidence, not an Owner decision by itself.

## Owner decision — Option A

The Owner approved **Option A** for the quantity/conversion policy:

1. Quantity precision is fixed at **four fractional decimal places**.
2. A conversion result that cannot be represented exactly at that supported
   precision is **rejected**.
3. There is **no rounding and no silent truncation**.
4. A conversion-factor change must be represented by a new
   **effective-dated version**; it is not an in-place historical rewrite.
5. Historical conversion versions, and the data needed to interpret prior
   transactions using them, must be preserved.

This records the quantity/conversion decision only. It does not authorize a
production change, migration, schema change, API change, or new operational
warehouse document in this documentation task.

## What this decision does not close

OQ-29 remains **OPEN** for any independent subquestion not answered above,
including, as applicable:

- whether the four-place quantity precision also governs any separate unit-level
  display/entry precision contract;
- which conversion pairs are global versus item-specific as a product policy,
  and the complete precedence/maintenance policy between those scopes;
- the full effective-date/version lifecycle, including all backdating and
  correction rules beyond preserving historical interpretability; and
- any downstream valuation, opening-balance, receipt/issue, reporting, or
  accounting treatment that requires a separate policy decision.

No unresolved subquestion may be treated as closed merely because the current
implementation has a corresponding behavior.

## Follow-up and dependency effect

- C-47 may retain the current exact-fit/fail-closed arithmetic as the recorded
  Option A behavior, but its governance/Owner-acceptance status is unchanged.
- C-48/C-49 and the quantity/rial portions of C-51/C-52 must inherit the
  four-place exact-fit rule. Their separate opening, valuation, posting-mode,
  and durable-integration gates remain governed by OQ-11, OQ-24, OQ-39 and
  OQ-42.
- No rounding implementation, per-unit precision field, conversion migration,
  or operational warehouse flow is authorized by this record.
