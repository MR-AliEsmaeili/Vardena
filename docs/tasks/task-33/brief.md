# Task 33 — Inventory / Warehouse Master Completion — Brief

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Base SHA | `ee17f41c5022d7185087285361f17be9c9567627` (branch `arena/01a0f91f-vardena`, off `main`) |
| Work order title | "Task 33 — Inventory / Warehouse Master Completion" |
| Repository roadmap identity | Candidate **C-46** ("Warehouse coding / master completion"), `docs/roadmap/future-task-candidates.md` |
| Governing docs consulted | `.vardena/agent-rules.md`, `.vardena/architecture-rules.md`, `.vardena/project-context.md`, `STATE.md`, `docs/roadmap/backend-mvp-roadmap.md`, `docs/roadmap/backend-mvp-dependency-matrix.md`, `docs/roadmap/future-task-candidates.md` |

## 0. Mandatory disclosure — task-number collision

The work order that produced this brief asked for a `docs/tasks/task-33/`
folder and called this **"Task 33."** The repository's `STATE.md` already has
a **merged, unrelated** entry numbered Task 33:

> §13 — "Task 33 — Organization Provisioning & First-Login Readiness" (PR #96,
> `docs/task-33-organization-first-login-provisioning-report.md`).

These are two different pieces of work sharing one number by coincidence of
two independent numbering schemes (an external work-order sequence vs. the
repository's own task history). This brief does **not** renumber, supersede,
or reinterpret §13. Per the repository's own numbering rule ("a numbered
implementation task is created only when its investigation/decision gate is
ready, through the governing process" — `future-task-candidates.md`), the
authoritative repository identity for *this* work is roadmap candidate
**C-46**. Everywhere in this task's documents, "Task 33" means *this* work
order and is cross-referenced to C-46; it never means §13's Task 33. No file
belonging to §13's Task 33 was touched.

## 1. Reconnaissance summary

Target: the Inventory Warehouse master-data vertical slice — List, Get,
Create, Update, Enable, Disable — against `main` as it exists today.

Files inspected (unchanged, pre-existing):

- `backend/src/modules/inventory/domain/warehouse.ts` — domain entity /
  validation (code/name normalization and length limits).
- `backend/src/modules/inventory/domain/inventory-permissions.ts` —
  `WAREHOUSE_PERMISSIONS` = `Inventory.Warehouse.{View,Create,Edit,Enable,
  Disable}`, one permission code per operation (`lifecycle('Warehouse',
  'warehouse')`).
- `backend/src/modules/inventory/application/warehouses.service.ts` —
  `WarehousesService`: `listWarehouses`, `getWarehouse`, `createWarehouse`,
  `updateWarehouse`, `enableWarehouse`, `disableWarehouse`,
  `requireUsableWarehouseInOrganization`.
- `backend/src/modules/inventory/data/warehouses.repository.ts` —
  Prisma-backed repository: `findById`, `findByCode`,
  `findByCodeExcludingId`, `list`, `create`, `update`.
- `backend/src/modules/inventory/api/warehouses.controller.ts` —
  `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/enable`,
  `POST /:id/disable`, each behind `@RequirePermission` with the matching
  `WAREHOUSE_PERMISSIONS.*` code.
- `backend/prisma/schema/inventory.prisma` (`model Warehouse`, lines
  213–238) — `organizationId`, `branchId` (FK to `organization.Branch`,
  `onDelete: Restrict`), `code` (`VarChar(64)`), `name` (`VarChar(200)`),
  `allowNegativeStock`, `isActive`, audit columns,
  `@@unique([organizationId, code])`, indexes on
  `(organizationId, isActive)` and `branchId`.
- `backend/src/modules/organization/application/branches.service.ts` /
  `organizations.service.ts` — the only legal source of branch/organization
  validation (`requireUsableBranchInOrganization`,
  `assertOrganizationInScope`, `requireUsableOrganization`); confirmed
  Inventory calls these public services and performs **no** Prisma access
  into `organization.*` tables.
- `backend/src/modules/inventory/application/inventory-movements.service.ts`,
  `inventory-operations.repository.ts` and the warehouse repository's
  `existsForWarehouse` / `hasBlockingBalanceForWarehouse` methods — the two
  ADR-0022 lifecycle freeze guards already implemented in
  `warehouses.service.ts` (~line 262: branch-change-after-movements;
  ~line 347: disable-while-holding-balance).

### Gap matrix

| Capability | Existing implementation | Contract source | Gap found | Action |
|---|---|---|---|---|
| List/Get | Implemented, org-scoped, deterministic pagination + allow-listed sort | ADR-0022; REST/OpenAPI conventions | None in production code; **no dedicated unit spec existed** | Add unit tests only |
| Create | Implemented: validation → org scope → branch usability (via Organization's public service) → code pre-check → repository create → event | ADR-0022; architecture invariants (module-owned data) | None; **no unit spec, no live-DB uniqueness-race test** | Add unit tests + live-DB concurrency test |
| Update | Implemented, including branch-change freeze guard | ADR-0022 | None in production code; **freeze guard's blocking branch had zero test coverage anywhere** | Add unit test that drives the guard into its blocking branch; add live-DB equivalent |
| Enable/Disable | Implemented, idempotent, disable-while-stock freeze guard | ADR-0022 | None in production code; **disable guard's blocking branch had zero test coverage** | Add unit test + live-DB equivalent |
| Org-scoped code uniqueness | `@@unique([organizationId, code])`, service pre-check + DB-authoritative fallback mapped to `Conflict` | Task binding requirement (§ code uniqueness) | None in production code; **no test ever proved the DB index — not just the pre-check — is authoritative under a real race** | Add live-Postgres concurrent-write race test |
| Branch validity (cross-org rejection) | Verified via `BranchesService.requireUsableBranchInOrganization` only | Architecture invariant (Inventory owns Warehouse; Organization owns Branch; cross-module access only via public services) | None in production code; **HTTP-level IDOR path for warehouses untested** | Add E2E tests (hermetic + live) |
| Authorization (per-operation permission, org scope, IDOR) | `@RequirePermission` per action; `assertOrganizationInScope`; RBAC membership required | Security ordering requirement (Permission → Org scope → Business validation → Repository) | None in production code; **no test proved a genuine two-org member is still blocked from the other org's warehouse (true IDOR, not a scope stub)** | Add authorization-layer tests against the real `AuthorizationService` |
| Negative-stock policy hierarchy | `allowNegativeStock` on Warehouse, Item-level override elsewhere (untouched) | Task binding requirement | None — explicitly out of scope to touch Item policy | No action |
| Schema | `Warehouse` model already satisfies every contract field | Task binding requirement ("zero-migration preferred") | None | No migration |

**Conclusion: the Warehouse master-data implementation on `main` is already
correct and complete for its frozen domain boundary.** The only genuine gap
across the whole reconnaissance was **regression-test coverage** — unit,
authorization, hermetic-HTTP, and (new) live-PostgreSQL. No production code
required a change, and per the task's binding "no drive-by refactor" rule,
none was made.

## 2. Domain boundary — confirmed frozen, untouched

Warehouse remains exactly: organization + branch + code + name +
allowNegativeStock + active/inactive lifecycle. No bins, costing, valuation,
pricing, lots, serials, new movement/reservation model, cross-module posting
logic, or generic workflow was added, and none existed to remove.

## 3. Open Questions — preserved, not resolved

OQ-11, OQ-22, OQ-24, OQ-29, OQ-33, OQ-36, OQ-39, OQ-41, OQ-42, OQ-43, OQ-54
remain **OPEN**. In particular OQ-22 and OQ-33 (the two OQs this capability
is explicitly keyed to in the roadmap register) are not silently answered by
this work: this task only proves the *already-decided* contract (ADR-0022)
is correctly implemented and regression-tested; it does not make any new
decision those OQs are waiting on.

## 4. Non-goals (task §24 scope exclusions) — none implemented

Item Master, Warehouse Receipt/Issue, Material Request, valuation, costing,
Kardex, reports, any Inventory → Accounting/Sales/Purchasing/AR/AP/Treasury
integration, outbox, jobs, audit module, notifications, licensing changes,
auth/membership redesign. None of these were touched, and no dependency on
any of them was discovered during reconnaissance (so there was nothing to
stop and report).

## 5. Planned changes (test-only; see implementation-report.md for the executed result)

1. New unit spec: `backend/src/modules/inventory/application/
   warehouses.service.spec.ts`.
2. Extend `backend/src/modules/organization/application/
   master-data-authorization.spec.ts` with Warehouse-specific authorization
   and cross-organization IDOR cases.
3. Extend `backend/test/master-data.e2e-spec.ts` with duplicate-code,
   same-code-different-org, and cross-org GET/PATCH IDOR HTTP cases.
4. New live-PostgreSQL spec: `backend/test/warehouse-master-live.e2e-spec.ts`
   (opt-in via `VARDENA_TEST_DATABASE_URL`, run by CI only, per the task's
   local-testing policy).
5. Governance sync: update roadmap candidate C-46's row in
   `docs/roadmap/future-task-candidates.md` and the Full Inventory/Warehouse
   capability matrix in `docs/roadmap/backend-mvp-dependency-matrix.md`; add
   a STATE.md addendum (§16) that explicitly discloses the numbering
   collision described above.
6. These three documents (`brief.md`, `implementation-report.md`,
   `test-evidence.md`).

No migration, no frontend change, no new dependency.
