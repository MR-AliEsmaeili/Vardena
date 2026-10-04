# C-54 — Quantity-only Inventory Kardex Investigation

**Status: investigation only — no Kardex implementation authorized**  
**Inspected `origin/main`:** `c22bb1975f0fb29ebd0eefe4b1b66198c9a99f1e`  
**Working branch:** `arena/01a10348-vardena`

## 1. Executive summary

Vardena has a usable quantity ledger foundation: immutable, signed `InventoryMovement` rows, atomic materialized balances, idempotent posting, transfer pairs, reversals, reservation counters, organization scoping, and effective-dated unit conversion. It does **not** yet have a Kardex query: the movement endpoint returns facts and the balance endpoint returns current projection rows, but neither returns an opening quantity, deterministic stock-card order with a running quantity, or a page-consistent running balance.

The smallest coherent slice is a **single organization + single item + single warehouse, quantity-only, base-unit Kardex** over the existing movement ledger. It can calculate an opening quantity as the signed sum of movements strictly before the inclusive period start, then calculate each row's running quantity from the complete ordered preceding set. It cannot represent a separate business opening event, because there is no accepted opening movement type or opening-document contract. It must not use the current materialized balance as historical opening.

The query belongs initially to Inventory's owned application/read path (and may later be exposed through the accepted Reporting pipeline), not to a new generic Reporting module. ADR-0009 requires module-owned views first and reserves cross-module raw SQL for Reporting; no Reporting module exists on this `main`. This is a recommendation for a later authorized implementation, not an accepted architecture change.

**Final readiness: READY FOR OWNER DECISION.** The quantity read can be bounded without resolving valuation, accounting, or OQ-49. Before implementation, the Owner must explicitly admit the recorded-movement opening limitation and choose/confirm the deterministic tie-break and snapshot contract. Those decisions do not block investigating or implementing a ledger-derived report; they block claiming a business opening balance or a fully stable concurrent paginated result without those semantics.

## 2. Governing sources and baseline

Read and compared the following sources:

- `STATE.md` — repository source-of-truth, evidence labels, lifecycle/authorization rules, and C-48…C-54 reconciliation.
- `.vardena/project-context.md`, `.vardena/architecture-rules.md`, `.vardena/agent-rules.md`, `docs/architecture.md`, `docs/testing/test-execution-policy.md`.
- `docs/roadmap/backend-mvp-dependency-matrix.md`, `docs/roadmap/backend-mvp-roadmap.md`, `docs/roadmap/future-task-candidates.md` (including candidate-promotion rules and C-47…C-54).
- `docs/open-questions.md` (full current rows for OQ-11, OQ-13, OQ-23, OQ-24, OQ-26, OQ-39, OQ-42, OQ-49, OQ-54, and OQ-66).
- `docs/reporting-strategy.md`, `docs/modules.md`, `docs/current-state-reconciliation.md`.
- Actual ADR paths: `docs/adr/0009-reporting-views-raw-sql.md` (Accepted), `docs/adr/0017-inventory-ledger-as-source-of-truth.md` (Proposed), and `docs/adr/0022-inventory-core-ledger.md` (Accepted and implemented).
- `docs/architecture/domain/inventory-domain-analysis.md`, `docs/architecture/domain/domain-decisions.md`, `docs/architecture/domain/domain-blueprint.md`.
- `docs/tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md`, `docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md`, `docs/tasks/c-47-item-master-readiness-hardening-report.md`, `docs/tasks/c-50-material-request-investigation.md`.

`git ls-files` confirms that a root/general `standard.md` is absent. The tracked `docs/frontend/standards.md` and UX standards are frontend-specific and were not substituted for repository governance.

The requested “latest `origin/main`” was fetched before inspection. Its exact SHA is the baseline above. The session branch is fixed by Arena workflow; it was not renamed or switched.

## 3. Current implementation evidence

| Capability | Current behavior | Evidence | Kardex consequence | Gap |
|---|---|---|---|---|
| Movement vocabulary/sign | Eight types: `inbound`, `outbound`, `transfer_in/out`, `adjustment_in/out`, `reversal_in/out`; signs are code-defined (`+` inbound-side, `-` outbound-side). | `backend/src/modules/inventory/domain/movement-type.ts:27-56` | Sum `baseQuantity`; do not infer signs from labels. | No report projection yet. |
| Direct write paths | Direct endpoint accepts only four types; transfer legs are written atomically by transfer service; reversal rows are derived by reversal operation and cannot be hand-posted. | `movement-type.ts:60-80`; `inventory-movements.controller.ts` POST and `inventory-transfers.controller.ts`; `InventoryMovementsRepository.postTransfer/postReversal` | Include all persisted ledger rows; classify source by type/link. | Source/document meaning is not richer than the generic movement record. |
| Ledger immutability | No update/delete path; correction is a full counter-movement. | `inventory-movement.ts:3-13`; `inventory-movements.repository.ts:50-51`; `inventory.prisma:284-342` | Safe historical input; reversal is a new dated row. | No accepted opening event. |
| Business vs technical time | `movementDate` is the business date; `createdAt` is technical creation time. Both are persisted. | `inventory-movement.ts:33,40`; `inventory.prisma:310,327` | Query period uses `movementDate`; `createdAt` can be a tie-break component but is not business chronology. | `id`/creation ordering policy for equal dates is not explicitly accepted for Kardex. |
| Quantity storage | Entered magnitude and unit plus signed `baseQuantity`, base-unit snapshot, and exact conversion factor are persisted; quantities are decimal strings. | `inventory-movement.ts:25-32`; `inventory.prisma:293-310`; `inventory-core.dto.ts` quantity comments | Initial report should expose base-unit signed values as decimal strings. | Alternate display-unit semantics need a separate contract. |
| Effective-dated conversions | Posting resolves conversion at the movement business date; versions are closed by later versions, not reinterpreted. | `inventory-movements.service.ts:202-215`; `unit-conversions.service.ts:86-100`; `inventory.prisma:68-119` | Historical base quantities remain interpretable; do not reconvert history using current factors. | Per-unit presentation and reverse-pair policy remain partly open in OQ-29. |
| Materialized balance | On-hand and reserved counters are maintained in posting/reservation transactions; `available = onHand - reserved`. | `inventory-balances.controller.ts` module comment; `inventory-balances.repository.ts:17-34`; `inventory.prisma:358-390` | Current balance is a consistency check/final comparison, not historical opening. | Balance API has no history or running rows. |
| Missing balance key | A key with no stored row reads as zero in availability; balance listing only lists rows. | `inventory-balances.controller.ts` module comment and `GET availability`; `inventory-balances.service.ts:96-101` | Empty movement history can return zero opening/running quantity. | Must distinguish zero facts from an unrecorded business opening. |
| Movement list | Paginated filters: organization, branch, warehouse, item, type, transfer, date range; default sort is movement date desc then created-at desc. | `inventory-core.dto.ts:37-76`; `inventory-movements.service.ts:121-150`; repository `list:130-147` | Existing API is reusable evidence, not a Kardex contract. | No opening, signed-row presentation, running quantity, or ledger-derived closing quantity. |
| Ordering/indexes | Existing indexes cover `(organization, warehouse, item, movementDate)` and related scopes. | `inventory.prisma:341-345` | The expected single-key date query has a supporting index. | No unique/order index proves a total chronological order. |
| Reservations | Reservations update reserved counters, not physical movement rows; C-50 invocation consumes reservation capacity and separately invokes a future physical flow. | `inventory.prisma:394-459`; `material-requests.service.ts:140-178,670-799`; OQ-66 row | Never render reservation create/release/invocation as receipt/issue or alter physical running quantity. | Reserved/available are separate balance information, not Kardex rows. |
| Reconciliation/rebuild | Reconciliation derives expected on-hand from movement SUM and expected reserved from reservations; rebuild is a maintenance operation under separate permission. | `inventory-balances.repository.ts:190-220`; `inventory-balances.controller.ts:105-177` | A report can reconcile its final ledger sum to expected on-hand. | No report snapshot spanning all pages. |
| Security | Services require Inventory view permission and `OrganizationsService.assertOrganizationInScope(organizationId)`; by-id mismatches are 404. | `inventory-movements.service.ts:121-126,153-161`; `inventory-balances.service.ts:122-134`; organization service | Client organization ID cannot bypass membership scope. | Proposed endpoint must reuse this exact pattern. |

## 4. Existing APIs and limitations

Current movement API: `GET /api/v1/inventory/movements` with standard `page/pageSize`, filters, and decimal-string response fields. Current balance API: `GET /api/v1/inventory/balances`, availability endpoints, and reconciliation/rebuild maintenance endpoints. Neither API is a stock-card API. In particular, the movement list's default descending presentation is unsuitable for directly accumulating a forward running quantity, and its two-field order is not a total order when both values tie.

The schema migrations are `backend/prisma/migrations/20260911010000_inventory_master_data/migration.sql` and `backend/prisma/migrations/20260911020000_inventory_core/migration.sql`; the latter creates the core ledger/balance/reservation structures represented by the current Prisma schema. The current schema, not the older analysis sketches, is authoritative for this report: it has no cost fields, no location/lot/serial dimensions, and no opening movement type.

## 5. Proposed minimal quantity-Kardex contract (proposal only)

### Scope and query

Proposed first slice: `organizationId`, required `itemId`, required `warehouseId`, optional inclusive `dateFrom` and `dateTo`, and repository-standard bounded `page/pageSize`. No branch/location/lot/serial filter is added: branch is present on movements but balances are keyed by item/warehouse/base unit, and the requested slice is a single item/warehouse ledger key. Validation should follow existing ULID/date/page bounds and return the existing validation/not-found/forbidden shapes.

The query must apply the organization to every movement, item, warehouse, and unit lookup and call `assertOrganizationInScope` before data access. The existing Inventory view permission is the least surprising initial permission; a new permission is not justified merely to name a report. If ADR-0009's future registry requires a report-specific permission, that is an explicit later architecture/permission decision, not an invented permission here.

### Opening quantity

For an inclusive period start `S`, the recorded-ledger opening is:

`openingBaseQuantity = SUM(baseQuantity WHERE movementDate < S)`

If no start is supplied, the opening is zero and all recorded movements in scope are included. A bounded report should make this distinction explicit in its response metadata (for example `openingBasis: recorded_movements_before_period`, or `zero_no_period_start`), rather than calling it a business opening balance.

This calculation represents only recorded movements. It cannot represent a separately defined opening balance, an unrecorded historical stock position, or an opening document not yet implemented. Do not add an `opening` type: `movement-type.ts:15-17` explicitly excludes it and points to OQ-23. OQ-23 asks how opening entries/year boundary are produced and approved; OQ-13/OQ-26 and OQ-54 constrain approval and lifecycle. OQ-24/OQ-11 matter if the opening also has valuation/accounting meaning. None authorizes silently treating current on-hand as historical opening.

### Rows and arithmetic

Each row should include, at minimum: movement ID, business `movementDate`, technical `createdAt`, movement type, signed `quantity` in base unit, base unit ID, transfer/reversal links, reference fields, and `runningBaseQuantity`. The conceptual calculation is:

`running = opening + cumulative signed baseQuantity in deterministic order`

Rows are strictly quantity-only. `transfer_out` decreases the source warehouse and `transfer_in` increases the destination; the shared `transferId` links the atomic pair. A reversal contributes its own signed mirror (`reversal_in` or `reversal_out`) on its reversal date and links `reversalOfMovementId`. Reservations do not appear as rows. Negative results are displayed as signed decimal quantities if the applicable existing negative-stock policy permits them; the report does not create a new negative-stock policy.

Opening, rows, and closing should be derived from the movement ledger. The final value should be comparable with the ledger-derived `expectedOnHand` used by reconciliation, not silently substituted with a potentially drifted materialized balance.

## 6. Deterministic ordering, pagination, consistency

The minimum proposed sort is `(movementDate ASC, createdAt ASC, id ASC)` for forward arithmetic. `movementDate` is the business chronology and `createdAt` is an immutable technical tie-break candidate; `id` is the final unique tie-break. The current implementation proves all three fields exist, but it does **not** prove that `createdAt` is a business-order guarantee or that this exact three-part order is an accepted domain decision. Therefore the Owner must confirm that this is an acceptable deterministic presentation order, or specify another existing immutable tie-break; a new sequence column is outside this investigation.

Pagination must be based on that same total order. Offset pagination is compatible only if the query snapshot/order remains stable; every page's running quantity must still be initialized from the complete pre-page ledger set, not from the previous page supplied by a client. A safer implementation could use a bounded query that computes opening plus cumulative values in one database statement/snapshot, or keyset pagination with an explicit snapshot/as-of boundary. The current `Promise.all` movement rows/count pattern is not a Kardex snapshot guarantee (`inventory-movements.repository.ts:136-147`).

At minimum, a later implementation must either document read-committed behavior (a report may observe a posting between opening and page reads) or use one coherent read transaction/snapshot. It must not combine a current balance with a historical movement page and call the result coherent. Existing posting transactions make individual movement and balance effects atomic, and movement rows are immutable, but they do not by themselves provide a multi-page report snapshot. Existing movement-date indexes are sufficient evidence for the expected filter; no new index, lock, isolation change, or migration is justified by this investigation.

## 7. Precision and units

OD-C47-01 records the accepted quantity rule: four fractional decimal places, reject a conversion result that is not exactly representable, never round/truncate, preserve effective-dated historical versions. Current implementation evidence includes `backend/src/modules/inventory/domain/quantities.ts` (`QUANTITY_FRACTION_DIGITS`, `fitsQuantity`), `numeric(18,4)` movement/balance quantities, `numeric(18,6)` factors, and movement snapshots of entered/base units and factor.

The initial response should therefore be base-unit-only and serialize decimals as strings. Recalculating historical rows through the current conversion table is forbidden; use the persisted signed `baseQuantity` and `baseUnitId`. Alternate-unit display is not safe as an initial requirement: it needs a presentation precision/exactness contract, item-vs-global precedence confirmation, and a rule for factors effective at the display date. It can be an optional future capability after OQ-29's remaining parts are answered. Report arithmetic must use decimal arithmetic, not JSON numbers or binary floating point.

## 8. Reservation and supported sources

| Source/flow | Quantity Kardex treatment | Limitation |
|---|---|---|
| Generic inbound/outbound | Include persisted signed rows. | They are generic, not proof of Purchasing/Sales lifecycle. |
| Adjustment in/out | Include signed rows; preserve reason/reference. | Adjustment policy is not a report policy. |
| Transfer legs | Include both legs in their respective warehouse query; use `transferId`. | Atomic posting is guaranteed, but rows can have equal dates; order contract still matters. |
| Reversals | Include derived counter-movement rows, not edits to originals. | Reversal is a later movement date and may change a historical period only if that later date is in the selected data. |
| Material Request reservation/release | Exclude from physical rows and running quantity. | OQ-66 is resolved and must not be reopened. |
| Material Request invocation | Do not treat invocation alone as movement; include only a separately persisted physical movement if a later authorized flow creates one. | C-50 does not authorize C-52 or invent an invocation-reversal flow. |
| Future Warehouse Receipt/Issue | Not claimable merely from generic types; future document posting can use ledger rows once authorized. | C-51/C-52 document lifecycle and approval decisions remain open. |
| Opening imports | Not representable unless they produce accepted ledger movements. | OQ-23 and OQ-54 remain policy gates; no opening type is invented. |
| Sales, Purchasing, Accounting | Excluded as source integrations. | OQ-15/OQ-16 and OQ-11/OQ-24/OQ-39/OQ-42 remain relevant to those future effects. |

Physical on-hand, reserved quantity, and available quantity are distinct. The initial Kardex row should contain physical signed movement and running physical quantity only. Reserved and available values may be returned as separate current-key summary data only if an explicitly bounded API needs it; they should not be placed in each Kardex row or folded into running physical quantity.

## 9. Architectural placement

**Option A — Inventory-owned query/application read model:** fits the current modular monolith and existing `InventoryMovementsService`/`InventoryBalancesService` paths, preserves Inventory ownership of `inventory` tables, reuses organization and permission checks, and can be a bounded code-defined read. It avoids creating a Reporting module solely for one Inventory-owned query.

**Option B — generic Reporting module:** ADR-0009 supports a future Reporting registry/pipeline, report definitions in code, caps/timeouts, and cross-module parameterized SQL. `docs/reporting-strategy.md` requires module-owned views first; cross-schema SQL belongs in Reporting. However, `backend/src` has no Reporting module, `docs/modules.md` marks it not implemented, and OQ-49 leaves generic builder depth open. Putting this single-schema query there now would introduce an unapproved module/dependency and could make Reporting own or directly depend on Inventory tables without an established source-view adoption.

**Recommendation:** implement the first bounded quantity Kardex in Inventory's application/read path, with a module-owned query/view if SQL is needed, and keep the output compatible with the future Reporting registry. Revisit a Reporting consumer when the C-14/Reporting foundation is authorized. This follows ADR-0009's ownership rule but does not accept ADR-0017 (which remains Proposed); the recommendation relies on accepted ADR-0022 and actual code.

## 10. Proposed API shape (not implemented)

Candidate: `GET /api/v1/inventory/kardex` under Inventory, requiring:

- required `organizationId`, `itemId`, `warehouseId`;
- optional inclusive `dateFrom`, `dateTo`;
- bounded `page`, `pageSize`, with one fixed total order;
- no alternate display unit in the first slice.

A proposed response is `{ items, total, page, pageSize, scope, opening, closing, openingBasis }`, where each item has `movementId`, `movementDate`, `createdAt`, `movementType`, `signedBaseQuantity`, `baseUnitId`, `runningBaseQuantity`, `transferId`, `reversalOfMovementId`, `referenceType`, and `referenceId`. Decimal values remain strings.

The response fields have these precise meanings:

- `opening` is the ledger-derived quantity immediately before the inclusive `dateFrom`, when `dateFrom` is supplied. If `dateFrom` is absent, the report starts from zero and includes all recorded movements up to the applicable `dateTo` (or all recorded movements when `dateTo` is also absent). It is not a business opening event or a value read backward from the current materialized balance.
- Each row's `runningBaseQuantity` is the cumulative quantity at that movement, calculated from the complete deterministic sequence of preceding movements in the filtered ledger range, not only from rows returned on the current page. Pagination must not reset the running quantity at a page boundary.
- `closing` is the calculated quantity after the final movement in the entire filtered date range, independent of the requested page. It must not mean the last row on the current page, and it is not the current materialized balance unless separately labelled.
- `total` counts every movement row matching the scope and date/type/reference filters, not only the rows on the current page.

`opening`, `closing`, `total`, and the page rows must all be read and calculated under the same selected consistency/snapshot contract. The report must state that contract and apply it uniformly; this investigation does not choose between a coherent database snapshot and a documented weaker read-committed contract. That remains an Owner decision gate described in Section 13.

Validation: reject malformed IDs/dates/page bounds and invalid ranges; return the existing organization/item/warehouse not-found behavior and standard error envelope. Authorization: authenticate, require the existing Inventory movement/balance view permission, then call organization scope enforcement; never trust an arbitrary organization ID. The proposal remains quantity-only and base-unit-only; it does not add a business opening event, valuation, accounting integration, or implementation authorization.

This is a proposal only: no controller, DTO, permission, OpenAPI declaration, frontend declaration, or generated file was added.

## 11. Valuation/accounting boundary

C-54 here is quantity-only. Explicitly excluded are Rial/value Kardex, cost layers/FIFO/moving average/standard costing, monetary opening balances, valuation, Accounting journal posting, durable Inventory-to-Accounting integration, Sales/Purchasing integration, generic user-configurable Report Builder, export/print, dashboards as a new report surface, and frontend implementation.

OQ-11 governs accounting opening import and inventory cost method; OQ-24 governs valuation and the still-unsettled business negative-stock policy; OQ-39 governs durable system-generated Accounting integration; OQ-42 governs posting mode. These block valued/accounting reports, not the bounded physical quantity calculation. OQ-49 blocks no bounded code-defined report; it only leaves generic builder depth open. OQ-13/OQ-26/OQ-54 constrain future document lifecycle/approval, not this read-only query. OQ-23 matters only when the report claims a separately governed opening event. OQ-66 is resolved and is not reopened.

## 12. Later implementation test strategy (proposal only)

| Test | Classification |
|---|---|
| Empty history, no-period-start zero, movement before/inside period | Unit + integration repository test |
| Exact signs for inbound/outbound/adjustments; transfer pair across warehouses; reversal linkage | Unit + integration |
| Equal business timestamps and final unique ordering; stable page boundaries and running values across pages | Integration with PostgreSQL |
| Precision strings, four-decimal exactness, historical factor snapshots, no reconversion/rounding | Unit + integration |
| Reservations create/release/invocation do not change physical rows; no invented invocation reversal | Application/integration |
| Organization membership, permission denial, cross-tenant 404/isolation | Application/e2e (hermetic where possible) |
| Concurrent posting while report reads; coherent snapshot or documented read-committed semantics | Live PostgreSQL integration; CI only |
| Final report quantity reconciles to ledger-derived on-hand and handles missing balance row | Integration |
| Negative running values under the existing permitted policy, and fail-closed behavior where posting rejects | Unit + integration |

No live PostgreSQL, migration rehearsal, or E2E suite was run for this investigation. Per `docs/testing/test-execution-policy.md`, expensive database/concurrency/E2E coverage belongs in authorized GitHub CI implementation work.

## 13. Unresolved Owner decisions and implementation dependencies

1. **Opening basis admission (blocks business-opening claims; not ledger-derived read):** Unknown whether C-54 may label `SUM` of recorded pre-period movements as the opening quantity, or must wait for a governed opening event. Existing OQ-23/OQ-13/OQ-26/OQ-54 do not answer it. Owner decision: explicitly admit the initial report as `recorded_movements_before_period`, with an explicit limitation, and defer business opening events. This does not block a clearly labelled ledger-derived report.
2. **Total ordering contract (blocks safe implementation claim, not investigation):** Unknown whether `(movementDate, createdAt, id)` is the accepted presentation chronology for equal business timestamps. The fields exist, but no accepted decision assigns technical creation time as business tie-break. Owner decision: approve this deterministic order or select another existing immutable field; do not add a sequence as part of C-54.
3. **Snapshot/pagination guarantee (blocks a strong cross-page consistency claim only):** Unknown whether the initial endpoint must guarantee one database snapshot across count/opening/pages or may document read-committed behavior. Existing APIs do not settle this. Owner decision: choose a bounded snapshot contract; implementation can otherwise use a single-query/keyset design or explicitly weaker semantics.
4. **Alternate-unit presentation (optional only):** OQ-29 leaves display precision and exactness scope open. Base-unit-only C-54 is not blocked; alternate-unit display is deferred.
5. **Reporting adoption (architecture sequencing, not quantity arithmetic):** ADR-0009 is accepted but the Reporting module/C-14 foundation is absent. Owner/architecture approval is needed before creating that module or moving this read into it. It does not block an Inventory-owned first slice.

## 14. Acceptance criteria for a later authorized implementation

- Only an authorized documentation/implementation task proceeds; C-54 is not promoted by this report.
- Query is single organization/item/warehouse, quantity-only, bounded and organization-authorized.
- All eight persisted movement types are handled according to their stored signed base quantity; transfer/reversal links are preserved; reservations are excluded.
- Opening basis and limitation are explicit; no opening type or current-balance-as-history shortcut exists.
- Total deterministic ordering is tested; every page derives running quantity from all preceding movements under the selected consistency contract.
- Decimal strings preserve four-place exactness; no rounding/truncation or current-factor reinterpretation occurs.
- Permission, membership, validation, not-found, and isolation behavior follow current Inventory conventions.
- Reconciliation test proves final calculated quantity against ledger-derived quantity; concurrency behavior is tested in CI where required.
- No valuation, Accounting, generic builder, frontend, new module, schema/migration, index, or permission is added without separate authorization.

## 15. Verification and final status

- `git diff --check`: **PASS** after creating this report.
- Changed-path audit: **PASS** — only `docs/tasks/c-54-quantity-kardex-investigation.md` is changed; no production code, Prisma schema/migration, API, permission, generated file, frontend file, or test changed.
- Markdown link validation: relative evidence links are repository paths cited in prose; lightweight link validation was not available as a named repository command and no heavy suite was run. The report uses no new Markdown link targets requiring generated artifacts.
- Backend/frontend lint, typecheck, build, tests, live PostgreSQL, migration rehearsal, and E2E: **not run**, intentionally; this is documentation-only and the task explicitly prohibits heavy local suites.

**READY FOR OWNER DECISION**

This status means the investigation is complete and identifies concrete decisions needed to scope implementation safely. It is not authorization to implement, accept, promote, or close C-54, any ADR, or any OQ.
