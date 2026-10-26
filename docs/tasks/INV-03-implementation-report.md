# INV-03 — Effective unit conversion resolve (checkpoint, 2026-10-26)

**Status:** Implemented as an inline read-only section on the existing unit-conversions page. This is a checkpoint in the single ACC-05-through-XC-01 draft PR, not a claim that the archive is complete.

## Contract and behavior

- The backend mounts `UnitConversionsController` at `/inventory/unit-conversions` (`backend/src/modules/inventory/api/unit-conversions.controller.ts`). The frontend Axios base path is only `/api/v1`, with no inventory rewrite. List, create and resolve now use the backend path. The resolve endpoint requires `Inventory.UnitConversion.View`, `organizationId`, `fromUnitId`, `toUnitId`, and BusinessDate `asOf`; `itemId` is optional. The read uses a server-derived contract alias and an org-scoped query key.
- The inline section uses a Jalali-first BusinessDate picker (canonical day on the wire). The user explicitly presses Check; incomplete/same-unit inputs never send a resolve request. State is URL-shareable under namespaced `resolve*` parameters, distinct from the list filters; the rest of the list URL is preserved.
- `{ conversion: null }` is an ordinary no-coverage result, **never** a 1:1 fallback. The selected backend response is shown directly: exact decimal factor string, version ID, item/global scope, and the half-open interval `[validFrom, validTo)`; null `validTo` means open-ended. No frontend interval search, interpolation or factor rounding.
- Unit/item pickers are permission-gated by their respective reference-read permissions and bounded; a view-only conversion user can still supply ULIDs manually. The create-form schema now rejects `scope=item` without an item ID before submit.

## Related XC-01 route correction, done early for working pickers

The same backend mount mismatch existed for `items`, `item-groups`, `units`, and `warehouses`, including the movement-form reference reads. In the **same single PR**, `frontend/src/api/inventory-master.api.ts` and `frontend/src/api/inventory.api.ts` now call `/inventory/<resource>`. This is an early, narrowly scoped XC-01 route-contract correction, not a claim that XC-01 or the full archive is finished. API-route regression tests assert the effective paths; no proxy rewrite is assumed. The archive INV-03 brief deferred these related paths to XC-01, but their correction is necessary for the resolve pickers to work in this single combined PR.

**Coverage caveat:** `GET /inventory/unit-conversions/:id` still has no independent version-detail UI. Keep the conversion group `PARTIAL` in the matrix pending that endpoint (even though INV-03 resolve itself is implemented).

## Verification

| Gate | Location | Result |
| --- | --- | --- |
| Targeted resolve UI, path contract, scope schema tests | FAST-LOCAL | Passed. Null/no-coverage, exact factor, open-ended window, no identity request, network error, path and scope are covered. |
| Frontend typecheck, lint, format, unit suite, build | FAST-LOCAL | Passed after inline-section refactor: 767 tests in 111 files and build (chunk-size warning only). |
| Date contract and documentation link guard | FAST-LOCAL | Passed: 1,337 relative links, 0 broken (after this report was added). |
| Browser E2E / CI pipeline | CI-HEAVY | Pending next GitHub commit. Earlier checkpoint run `40298057735` passed on `ef1df77` (before INV-03). No heavy browser or live DB suite was run locally. |
