# C-54 — Quantity Kardex implementation

**Status:** implemented; review/CI pending
**Date:** 2026-10-04

## Decision reconciliation

The Owner decisions in the C-54 implementation order supersede the open gates in the earlier investigation:

- Opening is a **ledger-derived calculated balance**, never a movement or the materialized current balance.
- The total order is `movementDate ASC → createdAt ASC → id ASC`.
- The API must provide a reusable ledger snapshot across pages.
- A caller may select a display unit; authoritative arithmetic remains in base quantity.

The earlier investigation remains useful historical evidence, but its “investigation only” status and its four decision gates no longer describe this authorized implementation.

## API

`GET /api/v1/inventory/kardex` requires `organizationId`, `itemId`, and `warehouseId`. It accepts inclusive `dateFrom`/`dateTo`, standard `page`/`pageSize`, optional `displayUnitId`, and optional `snapshot`.

Page 1 returns a `snapshot`. Every request for page 2 or later must send that exact value. The response contains `items`, `total`, `page`, `pageSize`, `scope`, `opening`, `closing`, `openingBasis`, and `snapshot`. Quantities are four-place decimal strings.

The endpoint uses the existing `Inventory.Movement.View` permission. Authentication is enforced by the controller guards; the service repeats permission enforcement and calls `OrganizationsService.assertOrganizationInScope` before data access. Item and warehouse lookups are organization-qualified.

## Quantity semantics

For `dateFrom`, opening is:

```text
SUM(inventory_movements.base_quantity)
WHERE movement_date < dateFrom
```

Without `dateFrom`, opening is zero and every recorded movement up to `dateTo` (if any) is in range. Both bounds are inclusive for report rows. Closing is opening plus all in-range signed base quantities, independent of pagination. A SQL window over the complete filtered sequence computes running base quantity before `OFFSET/LIMIT`, so it never resets at a page boundary.

All eight persisted movement types participate through signed `base_quantity`; no sign is inferred from labels. Transfer and reversal links are projected. Reservations are in a different table and are never queried. The current balance projection is never queried.

## Deterministic order

The repository uses exactly this order in the window and page query:

```text
movement_date ASC, created_at ASC, id ASC
```

## Consistency contract

The first read starts a PostgreSQL `REPEATABLE READ` transaction and captures `txid_current_snapshot()`. Every component of that response is read in that transaction. The token is returned to the caller. Later pages filter movement row transaction IDs with `txid_visible_in_snapshot(xmin, snapshot)`, recreating visibility of that original ledger snapshot. Consequently, a movement committed after page 1 is excluded from later pages, including a backdated movement. No migration, lock, long-lived transaction, or server-side cache is required.

The token is opaque API state and is validated syntactically. It is report consistency state, not an authorization credential; organization/item/warehouse scope and permission checks run on every page.

## Display unit

The ledger query, opening, running sums, and closing all use stored base quantities. If `displayUnitId` is omitted, output uses the item base unit. Otherwise, Inventory resolves explicitly declared display-unit → base-unit conversion versions using the existing item-specific-then-global effective-dated lookup. Opening uses the version at `dateFrom`; each row and its running quantity use the version at that movement's business date; closing uses `dateTo`, or the final matching movement date when `dateTo` is absent. Thus history is never re-presented with a current factor. Presentation divides authoritative base quantity by the selected historical factor using integer decimal arithmetic. Every opening, row quantity, running quantity, and closing quantity must be exactly representable at four decimals; otherwise the whole request fails with the existing 422 business-rule response. There is no rounding, truncation, binary floating-point arithmetic, reverse-pair derivation, or recalculation of stored historical base quantities.

## Scope

This is an Inventory-owned, quantity-only read model. It adds no valuation, costing, FIFO, weighted average, Accounting/Sales/Purchasing integration, Reporting module, frontend, export, print, opening document, fiscal close, schema change, migration, or new permission.

## Test execution matrix

| Gate                                         | Classification              | Result                       |
| -------------------------------------------- | --------------------------- | ---------------------------- |
| Kardex quantity + application targeted tests | FAST-LOCAL                  | PASS (6 tests)               |
| Typecheck                                    | FAST-LOCAL                  | PASS                         |
| Full unit, lint, format, build               | FAST-LOCAL                  | pending final verification   |
| HTTP E2E                                     | CI-HEAVY                    | CI only                      |
| PostgreSQL snapshot/concurrency              | CI-LIVE-DB / CI-CONCURRENCY | CI only                      |
| Migration                                    | CI-MIGRATION                | not applicable; no migration |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.

## Known limitation

PostgreSQL transaction snapshot identifiers are database-local and subject to PostgreSQL transaction-ID lifecycle; a client should finish pagination as one report session and must not persist a token as a permanent bookmark. Display conversion configuration is resolved per request at the documented report upper-bound instant; ledger snapshot consistency is independent because all authoritative arithmetic remains in immutable base quantities.
