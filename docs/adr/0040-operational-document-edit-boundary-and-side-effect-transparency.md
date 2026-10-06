# ADR-0040: Operational document edit boundary, side-effect transparency and the negative-inventory invariant

Status: Proposed
Date: 2026-10-05

> Records the architecture contract for the Owner decision **OD-54-01…OD-54-11**
> (`docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`).
> The product policy is decided; this ADR stays **Proposed** until the Owner
> explicitly accepts it (acceptance gate per this directory's README — recording
> the product decision does not self-accept the ADR). Detailed contract text:
> `docs/architecture/domain/document-architecture.md` §6.1.

## Context

OQ-54 is decided: operational documents are editable until Accounting Post,
then only cancel/correct. Every module that implements an operational document
(Inventory Receipt/Issue, Sales, Purchasing) needs one shared contract for the
edit boundary, side-effect detection and the negative-stock invariant —
otherwise each state machine would re-invent them (AR-07/AR-08).

## Decision

1. **Lifecycle boundary.** The existing vocabulary is preserved — Document
   Foundation `draft`/`temporary`/`final` states (ADR-0023, contract §15) plus
   the Accounting posting boundary (ADR-0026): *Draft → Finalized/Operational →
   Accounting Posted → Immutable*. No duplicate or new lifecycle states.
2. **Edit contract (before Accounting Post):** Load → Validate → **Detect side
   effects** → Apply change → Apply/reconcile operational effect →
   Recalculate/reprice **only if explicitly selected** (OD-VAL-11/12) → Persist
   atomically. After Accounting Post: **reject direct edit**; corrections are
   reversal/counter-documents only (AR-13).
3. **Side-effect detection is explicit and testable.** A classification step
   returns one of: *safe* / *valid with material side effect* (requires
   explicit user choice) / *invalid* (blocked). It is a contract output, never
   an implicit by-product of persistence.
4. **Negative inventory is a hard invariant.** No commit if resulting physical
   stock becomes negative (extends ADR-0022 §5 / OD-VAL-17 to edits). The
   rejection names item, warehouse and the offending business date; no partial
   mutation.
5. **Valuation is not duplicated.** Valuation impact and repricing go through
   the existing Moving Weighted Average foundation (ADR-0039); this ADR adds no
   second valuation path.
6. **Alert/event requirement.** Material consequences (stale valuation,
   recalculation required, blocked edit, failed accounting integration, failed
   backup, license Grace/Read-Only) must be emittable as domain events for a
   future administrative alert surface. The alert center itself is **not**
   designed or implemented here.
7. **No physical deletion; cancelled documents stay visible; numbers are never
   reused** (ADR-0023 allocation boundary preserved).

> **Related product decisions (2026-10-06).** [PDR-07](../decisions/product/PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md)
> OD-PRC-11 makes **Accounting eligibility** — not Inventory operations — the
> gate for an unpriced document, and OD-PRC-12 keeps valuation state on a
> separate axis from the lifecycle states this ADR lists in §1. OD-PRC-10
> explicitly forbids using "unpriced" as a general block on later inventory
> operations. This ADR stays **Proposed**; those records do not promote it.

## Consequences

- Edit paths are heavier than create paths (reconciliation, bounded replay,
  stricter transaction boundaries) — accepted deliberately by OD-54.
- Each operational document module must ship the OQ-54 acceptance tests
  (lifecycle, negative-stock rejection with unchanged DB, warning/choice,
  stale-state alert, cancelled-visible, no number reuse, no silent effect).
- "Posted?" becomes an explicit cross-module fact via document states + events,
  not hidden coupling (AR-07).
- Nothing is implemented by this ADR; implementation remains separately gated
  (OQ-13/OQ-26 approval coupling, OQ-12 gap policy and OQ-27 correction windows
  stay open).
