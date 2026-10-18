# C-54 — Quantity Kardex API contract follow-up: implementation report

- **Status:** READY FOR REVIEW — NOT ACCEPTED
- **Branch:** `arena/f25829e6-vardena` (the session's fixed branch)
- **Baseline:** `main` at `6d8a4f943e533fc6bc684927335bbc0182f509d5`
- **Date:** 2026-10-18

## Summary

The original quantity Kardex read path is already on `main` from PR #115 (`1e3d407fd3f08650e0e70353f96b277e80ef03fd`). This additive follow-up exposes it at `GET /api/v1/inventory/kardex/quantity`, gives that route a dedicated `Inventory.Kardex.View` permission, and keeps the existing `GET /api/v1/inventory/kardex` contract and `Inventory.Movement.View` authorization intact.

The new response is quantity-only and in the item's base unit: each ledger row includes the signed quantity change, cumulative quantity after that row, movement date/instant, movement type and available source identifiers. Opening, closing, opening basis, stable snapshot pagination, and page metadata are preserved from the Inventory-owned ledger path. The repository continues to read `inventory.inventory_movements`; no balance projection, cost/valuation amount, Accounting module, new table, or migration was added.

## Authorization and query behavior

- `Inventory.Kardex.View` is code-registered separately from the 22 master-data permissions and enforced by both the route guard and `InventoryKardexService.readQuantity`.
- The route requires `organizationId`, `warehouseId`, and `itemId`; `dateFrom` and `dateTo` are optional inclusive BusinessDate bounds. The explicit organization parameter follows the existing Inventory API contract; this repository has no `@OrganizationId()` decorator.
- The service checks the dedicated permission before ODR-3 organization scope, then validates the item and warehouse through Inventory-owned services. Out-of-scope resources remain not-found.
- Chronological order remains `movement_date ASC, created_at ASC, id ASC`. Client `sort` is documented as unsupported and rejected; existing `read()` does not receive the new cap/refactor options.
- Shared pagination is page 1 / 100 rows by default and maximum 500 rows per page. The new route enforces the Task 18 50,000-row report window; a request ending exactly at row 50,000 is allowed and a page beyond it is rejected.
- Later pages must reuse the PostgreSQL snapshot returned by page 1.

## Open question

**OQ-89 remains OPEN.** The API continues to calculate quantities from the immutable movement ledger and does not compare the result with `inventory_balances.on_hand`. Whether/when a current rebuildable projection should be reconciled with a historical or unbounded Kardex, and the behavior on drift, remains for an Owner/product/architecture decision. No ADR was created and no OQ was closed.

## Local verification

| Check                                              | Result                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend typecheck (`npm run typecheck`)            | PASS                                                                                                                                                                                                                             |
| Backend lint (`npm run lint`)                      | PASS — 0 errors; 3 existing warnings in unrelated licensing/accounting files                                                                                                                                                     |
| Backend format (`npm run format:check`)            | PASS                                                                                                                                                                                                                             |
| Backend unit suite (`npm test`)                    | PASS — 164 files, 2,208 tests                                                                                                                                                                                                    |
| Kardex service unit tests                          | PASS — 12 tests, included in the full suite                                                                                                                                                                                      |
| Backend build (`npm run build`)                    | PASS                                                                                                                                                                                                                             |
| Frontend typecheck                                 | PASS                                                                                                                                                                                                                             |
| Frontend lint                                      | PASS — 0 warnings/errors                                                                                                                                                                                                         |
| Frontend format (`npm run format:check`)           | PASS                                                                                                                                                                                                                             |
| Frontend unit suite (`npm test`)                   | PASS — 61 files, 426 tests                                                                                                                                                                                                       |
| Frontend build                                     | PASS — Vite reports existing dependency-comment and large-chunk warnings                                                                                                                                                         |
| OpenAPI dump and generated TypeScript client       | PASS — regenerated from this checkout; quantity route/DTOs and `referenceId` are included, while the legacy Kardex 403 description remains unchanged. `scripts/check-generated-api-client.sh` passes against the committed tree. |
| Live-DB E2E / migration rehearsal / docker-compose | NOT RUN locally — CI-only by instruction                                                                                                                                                                                         |

**Sandbox limitation:** `npm run prisma:generate` was attempted with the CI-style dummy `DATABASE_URL`, but the Prisma CLI could not reach its engine download host (`binaries.prisma.sh`; TLS connection unavailable under the sandbox's outbound-host policy). Consequently the local OpenAPI dump emitted a permission-mirror sync warning because the generated Prisma client was unavailable, although it completed and the OpenAPI-derived client was generated. The backend build/typecheck/unit suite passed; CI must perform Prisma generation, live PostgreSQL E2E and the generated-client check on the final PR head.

## Changed files

- `backend/src/modules/inventory/api/inventory-kardex.controller.ts` — additive `quantity` route and route-level OpenAPI responses.
- `backend/src/modules/inventory/api/dto/kardex-quantity-query.dto.ts` — query and quantity-only response DTOs.
- `backend/src/modules/inventory/application/inventory-kardex.service.ts` — dedicated permission path, shared authorization/read path, fixed ordering and row window.
- `backend/src/modules/inventory/application/inventory-kardex.service.spec.ts` — permission, projection isolation, scope/resource, quantity mapping, ordering and row-window coverage.
- `backend/src/modules/inventory/application/inventory-permission-registration.ts` — registers the new Inventory-owned permission.
- `backend/src/modules/inventory/application/inventory-permission-registration.spec.ts` — verifies application-layer permission registration.
- `backend/src/modules/inventory/domain/inventory-kardex-permissions.ts` — dedicated permission code/definition.
- `backend/src/modules/inventory/domain/inventory-kardex-permissions.spec.ts` — permission vocabulary test.
- `backend/src/modules/inventory/domain/kardex-movement.ts` — quantity-only result types.
- `backend/src/modules/inventory/domain/inventory-permissions.ts` — retains the master-data vocabulary without mixing in Kardex permission counts.
- `backend/test/inventory-kardex-live.e2e-spec.ts` — CI live-DB HTTP coverage for permission, ODR-3, validation and snapshot pagination.
- `frontend/src/api/generated/vardena-api.d.ts` — generated OpenAPI client contract for the additive route.
- `docs/modules.md`, `docs/open-questions.md`, `docs/tasks/c-54/brief.md`, and this report.

## Review and CI status

Local static/unit checks and the committed-file API-client check are recorded above. [PR #179](https://github.com/MR-AliEsmaeili/Vardena/pull/179) is open from the fixed session branch. Verify the live `backend`, `frontend`, and `generated-api-client` statuses on the current PR head; the CI-only live database suite must also pass before review can be completed. No acceptance is recorded by this report.
