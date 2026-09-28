# ADR-0017: Inventory Ledger as Source of Truth with Materialized Balances

Status: Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)
Date: 2026-09-11

## Context

`docs/modules.md` says stock balances are "derived/materialized from movements" but does
not decide which structure is authoritative, how consistency is guaranteed, or how
valuation interacts with the ledger. The domain analysis compared
balance-authoritative, movement-authoritative and hybrid designs
(`docs/architecture/domain/inventory-domain-analysis.md` §1). Because inventory
quantity and value feed accounting, statutory reports and audit expectations, the
choice must be explicit before the first inventory table exists.

## Decision

1. **The immutable stock-movement ledger is authoritative.** Movements are append-only,
   signed, in the item's base unit, typed by a closed `movement_type` enum, and linked
   logically to their originating document.
2. **Balances are materialized** (one row per `item × warehouse × location × lot ×
serial` key) and updated **inside the same transaction** as the movement, under a
   row lock (`SELECT … FOR UPDATE`). They are derived data and **rebuildable** from the
   ledger; a reconciliation report detects drift.
3. **Corrections are counter-movements**, never updates. Posted movements are never
   edited or deleted (AR-13).
4. **Reservations are not movements.** `reserved_quantity` is tracked separately from
   `quantity`; availability is `quantity − reserved_quantity`.
5. **Valuation is method-shaped, not schema-shaped.** Inbound movements record their
   cost where known; outbound movements record the cost assigned by the active method.
   The method (moving average / FIFO / standard) and its accounting effects are an
   accounting decision (OQ-24) and must not force a schema redesign. Method-specific
   state (moving-average state or cost layers) is a separate, rebuildable structure.
6. **Negative stock is a policy**, per warehouse with item-level override; when the
   policy is undecided the default is **reject** (fail closed).

## Consequences

- Stock-on-hand screens, availability checks and reports read the balance table
  (indexed), while the ledger explains every number and supports stock-card reports.
- Every movement writer must use the item's base unit and the same transactional
  balance update; this is a single Inventory-owned code path, not a per-module
  convention.
- Concurrency risk moves to one locked balance row per key; long transactions are
  forbidden (outbox/job patterns apply).
- A reconciliation query (ledger `SUM` vs balance) and a rebuild tool are required
  from the first release; drift is treated as a defect.
- Reporting stays SQL-friendly: no JSONB, no EAV, typed dimensions
  (`docs/architecture/domain/inventory-domain-analysis.md` §7).
- Until OQ-24 is answered, movement cost columns exist but valuation reports are
  marked "requires accounting configuration" (see ADR-0020/D-19).

## Links

- Analysis: `docs/architecture/domain/inventory-domain-analysis.md`
- Related: ADR-0005 (Inventory → Accounting via events), ADR-0008 (schemas),
  AR-13 (immutability), OQ-24 (valuation, negative stock), OQ-29 (units).
