# C-54 — Quantity Kardex API contract follow-up

## Repository baseline

`main` @ `6d8a4f943e533fc6bc684927335bbc0182f509d5`

## Problem

The post-C-50 reconciliation identified the missing explainability path from recorded movements to a running stock quantity. That original quantity Kardex was subsequently implemented and merged in PR #115 (`1e3d407fd3f08650e0e70353f96b277e80ef03fd`), but its public route is `GET /api/v1/inventory/kardex` and it reuses `Inventory.Movement.View`.

This follow-up adds the explicitly quantity-scoped route and dedicated read permission requested for C-54 without duplicating the ledger query or changing the existing route's behavior. The Inventory API currently requires an explicit `organizationId` query parameter; there is no `@OrganizationId()` decorator in the repository.

## Scope

Read-only quantity Kardex API:

- Endpoint: `GET /api/v1/inventory/kardex/quantity`
- Filter: `organizationId` (required under the existing Inventory contract), `warehouseId` (required), `itemId` (required), `dateFrom` (optional), `dateTo` (optional)
- Pagination: shared `PageQueryDto` defaults (`page=1`, `pageSize=100`, maximum page size 500), plus the Task 18 bounded-report 50,000-row page window
- Date semantics: inclusive canonical Gregorian BusinessDate bounds
- Ordering: existing C-54 chronological order `movement_date ASC, created_at ASC, id ASC`; no client sort
- Response: rows with signed quantity change and cumulative quantity, plus total/page/pageSize, base-unit id, opening/closing quantities and the snapshot token required for stable later pages
- Permission: `Inventory.Kardex.View`
- Existing `GET /api/v1/inventory/kardex` remains available under its existing permission and contract

## Out of scope

- Rial Kardex (future work)
- Valuation / cost fields
- Inventory → Accounting integration
- New ledger tables, schema changes or migrations
- Reporting module / generic report builder
- Changes to movement posting, balance math, or the existing Kardex endpoint
- Any business rule not recorded in the repository

## Gates

- **OQ-89 — projection reconciliation:** open and registered. This route remains ledger-derived and does not compare against `inventory_balances`; no drift response is invented. OQ-89 is not a blocker for returning the existing ledger-derived quantities.
- Pagination page-size and hard-window limits follow the shared API pagination pattern and Task 18 D13; the 50,000-row boundary is enforced for this route.
- Chronological order and snapshot semantics are carried forward from the existing C-54 implementation; no LIFO behavior is introduced.
- C-47 Item Master is merged (PR #107), but remains separately **NOT ACCEPTED**; its existing item validation service is reused.
- The original C-54 read surface is already merged (PR #115), but remains **NOT ACCEPTED**. This follow-up adds only the requested route/permission contract.

## Acceptance criteria

1. `GET /api/v1/inventory/kardex/quantity` filters by organization, warehouse, item and optional inclusive business-date bounds.
2. `Inventory.Kardex.View` is registered and enforced by both route guard and application service.
3. ODR-3 isolation is enforced permission-first, then by `assertOrganizationInScope`; item and warehouse are validated through Inventory-owned services.
4. Chronological running quantity is continuous across pages; page size is at most 500 and no page may address rows beyond the 50,000-row window; later pages reuse the returned snapshot.
5. Unit tests cover isolated orchestration, scope/resource not-found paths, permission denial, empty results and page bounds.
6. Live PostgreSQL E2E covers the HTTP route, chronological quantities, organization isolation, permission denial, validation and snapshot pagination. Run only in CI.
7. The committed frontend TypeScript client is regenerated from this backend's OpenAPI document and passes `scripts/check-generated-api-client.sh`; no frontend UI behavior is added.
8. Backend, frontend and generated-api-client CI jobs are green on the final commit.

**Status target:** READY FOR REVIEW — NOT ACCEPTED.
