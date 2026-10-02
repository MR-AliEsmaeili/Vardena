# ADR-0022: Inventory Core — Movement Ledger, Idempotent Posting and Availability Policy

Status: Accepted (implemented by Task 9.5; idempotency hardening by Task 9.6, 2026-09-13)
Date: 2026-09-13

## Context

ADR-0017 decides that stock truth is an append-only movement ledger with
materialized balances, and `docs/architecture/domain/inventory-*.md` designs
the postings (D-04/D-07/D-24). What remained open was the implementation
binding: which tables carry the ledger, how a retry is distinguished from a
double posting, how transfers and reversals stay atomic, when stock may go
negative, and how master data is frozen without deleting history. Task 9.5
implements the ledger; Task 9.6 hardened its idempotency determinism and
organization scoping.

## Decision

1. **Ledger tables (schema `inventory`).** `inventory_movements` (append-only;
   signed effect via typed `movement_type`, never updated or deleted),
   `inventory_balances` (materialized per organization/warehouse/item/base
   unit, adjusted inside the posting transaction) and `inventory_reservations`
   (`active`/`released` soft claims on availability).
2. **Eight movement types, three write paths.** Direct postings accept only
   `inbound`, `outbound`, `adjustment_in`, `adjustment_out`. `transfer_*`
   legs exist only as the atomic pair a transfer writes (shared
   `transfer_id`, commit both or neither); `reversal_*` rows exist only as
   the exact mirror the reversal operation derives from the original
   (`reversal_of_movement_id`). Neither can be hand-posted.
3. **Idempotency ledger (`inventory_operations`).** One row per completed
   mutating operation, keyed by `(organization_id, operation_key)`, written
   in the SAME transaction as the ledger effect. `request_hash` is sha256
   over the canonical request: same key + same hash replays the stored
   result (re-reading current rows, never a stale snapshot); same key +
   different hash is rejected 409 and applies nothing. The five operation
   kinds are `movement_post`, `movement_reversal`, `transfer_post`,
   `reservation_create`, `reservation_release`. Releasing an already
   released reservation is 422; a replay of the release replays 200.
4. **Only client intent is hashed.** Generated ids and server clocks never
   enter the hash. An omitted business date is hashed as an explicit `null`
   (`canonicalClientDate(undefined) === null`); the stored effective date
   still defaults to the first attempt's `new Date()`. Hashing the server
   clock made every dateless retry — the exact case keys exist for — hash
   differently and fail with a false 409 (Task 9.6 finding).
5. **One negative-stock policy, applied to movements and reservations.**
   Per-warehouse `allow_negative_stock`, default reject (fail closed), with
   an optional per-item tri-state override (`true`/`false`/inherit). The
   effective policy guards both resulting on-hand and resulting
   availability (`on_hand − reserved`); there is no permission-gated third
   level (OQ-24, unapproved).
6. **Versioned unit conversion, resolved at the business date.** Postings
   resolve the conversion version covering the (possibly backdated) movement
   date; quantities are stored canonically in the item base unit.
7. **Freeze over delete in the implemented core.** Items/warehouses are
   disabled by the current runtime, and disabling is blocked while non-zero
   balances exist (`hasBlockingBalanceForItem/Warehouse`); postings against
   disabled references are rejected. This preserves the ledger's history while
   stopping new activity. The item-specific "never deleted" wording is
   superseded by the Owner's OQ-36 Option C decision (2026-10-02): physical
   deletion may be considered only for an item never referenced by any
   operational, ledger, or historical record; referenced items must not be
   physically deleted. No delete endpoint, permission, schema, migration, or
   implementation is authorized by that decision. Warehouse deletion remains
   outside that OQ-36 item decision and is not authorized here.
8. **Structural organization scoping (ADR-0021) plus an optional deployment
   pin (ADR-0025).** Every ledger row carries `organization_id`; by-id reads
   and actions take `organizationId` and answer 404 — never 403 — on
   mismatch. All reference resolution (warehouse, item, unit) is scoped to
   the posting's organization.

## Consequences

- Retries of timed-out/double-clicked postings are safe at every layer; the
  unique key plus same-transaction write make a committed effect without its
  key impossible.
- Real row locking and unique-key race behaviour are proven by the opt-in
  live-database suite (un-skipped in the GitHub Actions pipeline); in-memory e2e doubles
  pin replay/reject semantics.
- Backdated postings follow the conversion version in force then, so
  historical corrections stay reproducible.
- **Gap accepted:** no costing/valuation fields yet (OQ-24 valuation
  remains open); the ledger stores quantities, not money — Accounting
  (Task 10) consumes it.
- Cross-org ledger access is indistinguishable from "not found", which is
  less debuggable for operators; the decision is deliberate (no existence
  disclosure across tenants).

## Links

- Implements: ADR-0017; scope: ADR-0021; deployment pin: ADR-0025
- Design: `docs/architecture/domain/` (inventory domain analysis, D-04/D-07/D-24)
- Open questions/decision records: OQ-24 (negative stock/valuation), OQ-29
  (units — Option A recorded; independent questions remain open), OQ-36
  (item deletion/code reuse — Option C recorded; reuse remains open), and
  PDR-01 (barcode policy; deactivated-item reuse remains open)
- Tests: `test/inventory-core.e2e-spec.ts`, `inventory-posting-support.spec.ts`
