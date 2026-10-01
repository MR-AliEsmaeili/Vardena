TASK: Task 33 — Inventory / Warehouse Master Completion (repository identity: roadmap candidate C-46, "Warehouse coding / master completion", `docs/roadmap/future-task-candidates.md`). See `brief.md` §0 for the mandatory disclosure that this number collides with an unrelated, already-merged `STATE.md` §13 "Task 33".

STATUS: READY FOR REVIEW — NOT ACCEPTED

BASE SHA: ee17f41c5022d7185087285361f17be9c9567627 (branch arena/01a0f91f-vardena, off main)

IMPLEMENTED:
- Reconnaissance of the full Warehouse master-data vertical slice (domain,
  application, data, API, schema) confirmed the production implementation on
  `main` already satisfies every binding contract requirement in the task:
  permission → organization scope → business validation → repository
  ordering; organization-scoped code uniqueness (pre-check + DB-authoritative
  fallback); branch validity verified exclusively through Organization's
  public `BranchesService` (no cross-module Prisma access); both ADR-0022
  lifecycle freeze guards (branch-change-after-movements,
  disable-while-holding-balance); per-operation RBAC permissions; in-memory
  domain events fired only on successful commit; deterministic
  pagination/sort on list. See `brief.md` §1 for the full gap matrix.
- Added regression-test coverage closing every genuine gap found (all gaps
  were test-coverage gaps, not implementation gaps):
  - `backend/src/modules/inventory/application/warehouses.service.spec.ts`
    (new, 24 tests) — full `WarehousesService` unit coverage, including
    driving both freeze guards into their actual blocking branch via a
    controllable fake movements/balance seam (previously untested anywhere).
  - `backend/src/modules/organization/application/master-data-
    authorization.spec.ts` (extended, +3 tests, 25 total in file) — a new
    `WarehousesService authorization & cross-organization IDOR` block
    against the real `AuthorizationService`: anonymous 401; a distinct
    permission required per Warehouse operation; a genuine member of two
    organizations still cannot read/update/enable/disable the other
    organization's warehouse or attach a foreign branch (real IDOR, not a
    scope stub).
  - `backend/test/master-data.e2e-spec.ts` (extended, +4 tests, 41 total in
    file) — hermetic HTTP coverage: duplicate-code 409 in one organization;
    identical code allowed in a different organization; cross-organization
    GET/PATCH 404 (no-disclosure) with the real row confirmed unchanged;
    PATCH rejecting a move onto a foreign-organization branch.
  - `backend/test/warehouse-master-live.e2e-spec.ts` (new, 5 tests,
    `describe.skipIf(VARDENA_TEST_DATABASE_URL === undefined)`, same opt-in
    pattern as `workflow-live.e2e-spec.ts` /
    `licensing-persistence-live.e2e-spec.ts`) — real PostgreSQL verification:
    organization-scoped unique index is authoritative under 8 concurrent
    `createWarehouse` calls racing the identical `(organizationId, code)`
    (exactly 1 winner, 7 `Conflict`, confirmed by a direct row count);
    identical code reused across two organizations; organization isolation
    (`EntityNotFound` on get/update/disable/`requireUsableWarehouseIn
    Organization` across real committed rows); branch isolation on create
    and on update; both lifecycle freeze guards exercised against real
    `inventory_movements`/`inventory_balances` rows produced by
    `InventoryMovementsService.postMovement` — including proving the disable
    guard lifts once the real balance is driven back to zero while the
    branch-change guard stays permanently blocked afterward (it is keyed on
    "any movement ever existed," not current balance).
- Governance sync: updated candidate C-46's row in
  `docs/roadmap/future-task-candidates.md` and the Full Inventory/Warehouse
  capability matrix row in `docs/roadmap/backend-mvp-dependency-matrix.md`;
  added `STATE.md` §16 disclosing the numbering collision and summarizing
  the work; this file set
  (`docs/tasks/task-33/{brief,implementation-report,test-evidence}.md`).

NOT IMPLEMENTED (and why — all are correct non-goals, not missed work):
- No production code change of any kind (0 lines in
  `backend/src/**` outside the new spec file) — reconnaissance found no
  genuine implementation gap, and the task forbids drive-by refactors of
  working code.
- No new migration — the `Warehouse` Prisma model already has every
  required column/constraint/index; confirmed zero-migration is sufficient.
- No Item Master, Warehouse Receipt/Issue, Material Request, valuation,
  costing, Kardex, reports, or any Inventory→Accounting/Sales/Purchasing/
  AR/AP/Treasury integration — explicit task §24 scope exclusions; none were
  found to be a dependency of this work, so there was nothing to stop and
  report.
- No outbox/jobs/audit-module/notification/licensing/auth/membership change.
- No frontend change — confirmed no in-repo generated OpenAPI client depends
  on Warehouse; frontend untouched.
- OQ-11, OQ-22, OQ-24, OQ-29, OQ-33, OQ-36, OQ-39, OQ-41, OQ-42, OQ-43, OQ-54
  were not resolved, guessed at, or silently closed; all remain OPEN exactly
  as before this task.
- Branch note: per this session's fixed-branch constraint, work was
  committed and pushed directly on `arena/01a0f91f-vardena` rather than onto
  a separately named `feat/...` branch; a PR is opened from this branch into
  `main` to obtain real CI evidence (see CI EVIDENCE below).

FILES CHANGED:
- `backend/src/modules/inventory/application/warehouses.service.spec.ts` (new)
- `backend/src/modules/organization/application/master-data-authorization.spec.ts` (modified — appended one `describe` block, 3 tests)
- `backend/test/master-data.e2e-spec.ts` (modified — inserted 4 `it` blocks)
- `backend/test/warehouse-master-live.e2e-spec.ts` (new)
- `docs/roadmap/future-task-candidates.md` (modified — C-46 row)
- `docs/roadmap/backend-mvp-dependency-matrix.md` (modified — Warehouse coding/master row)
- `STATE.md` (modified — appended §16)
- `docs/tasks/task-33/brief.md` (new)
- `docs/tasks/task-33/implementation-report.md` (new, this file)
- `docs/tasks/task-33/test-evidence.md` (new)

No file under `backend/src/**` production code, no Prisma schema file, no
migration file, and no frontend file was changed.

MIGRATION: None. The `Warehouse` model (`backend/prisma/schema/
inventory.prisma`, lines 213–238) already carries `organizationId`,
`branchId` (FK → `organization.Branch`, `onDelete: Restrict`), `code`
(`VarChar(64)`), `name` (`VarChar(200)`), `allowNegativeStock`, `isActive`,
full audit columns, `@@unique([organizationId, code])`
(`uq_warehouses_organization_id_code`), and indexes on
`(organizationId, isActive)` and `branchId`. No `prisma/migrations/*` file
was added or modified; `npm run prisma:validate` was not re-run locally
(no schema touched) and will be exercised unchanged by CI's existing
`prisma:validate` / `prisma:generate` / `prisma:deploy` steps.

LOCAL FAST VERIFICATION (executed on this machine; no Postgres available
locally, so no live/heavy test was run here — see HEAVY VERIFICATION):
- `npm run typecheck` (`tsc --noEmit`) — clean, 0 errors.
- `npm run lint` (`oxlint .`) — 0 errors; 1 pre-existing warning in an
  unrelated file (`accounting/.../coding-structure-accounts.spec.ts:896`,
  `no-unsafe-optional-chaining`), not introduced by this change.
- `npm run format:check` (`prettier --check .`) — clean after
  `prettier --write` was applied to the 2 new spec files (pre-existing
  modified files were already compliant).
- `npm run build` (`nest build`) — succeeds.
- Focused vitest runs:
  - `npx vitest run src/modules/inventory/application/warehouses.service.spec.ts` → 24/24 passed.
  - `npx vitest run src/modules/organization/application/master-data-authorization.spec.ts` → 25/25 passed.
  - `npx vitest run --config vitest.config.e2e.ts test/master-data.e2e-spec.ts` → 41/41 passed.
  - `npx vitest run --config vitest.config.e2e.ts test/warehouse-master-live.e2e-spec.ts` (no `VARDENA_TEST_DATABASE_URL` set locally) → 1 file, 5 tests, all correctly **skipped** (`describe.skipIf`), confirming the opt-in gate works and the file does not attempt a connection it cannot make locally.
  - Full hermetic unit suite `npm test` (`vitest run --config vitest.config.ts`, no Postgres involved) → **120 files / 1391 tests passed**, confirming no pre-existing test was broken or weakened.
- `npm run test:e2e` (the full hermetic + live e2e suite) was deliberately
  **not** run locally, per this task's binding local-testing policy; it runs
  in CI where Postgres is provisioned.

HEAVY VERIFICATION (must run in GitHub CI; see CI EVIDENCE for the actual
observed run — do not trust this section alone):
- CI's `backend` job already provisions a real `postgres:16` service,
  deploys migrations (`npm run prisma:deploy`), and runs
  `npm run test:e2e` with `VARDENA_TEST_DATABASE_URL` set
  (`.github/workflows/ci.yml`). This executes, for the first time, the new
  `backend/test/warehouse-master-live.e2e-spec.ts` against a real database,
  plus the extended hermetic `master-data.e2e-spec.ts`.
- Required heavy-test outcomes for acceptance of this task:
  1. The concurrent-write race test proves the database unique index — not
     the application pre-check — is the final authority (exactly 1 success,
     7 `Conflict`, 1 row in the table).
  2. Organization/branch isolation hold against real rows.
  3. Both lifecycle freeze guards fire against real
     `inventory_movements`/`inventory_balances` rows written by the real
     posting path, and the disable guard correctly lifts once the real
     balance clears while the branch guard remains permanently blocked.

SECURITY:
- Ordering preserved and verified: Permission (`@RequirePermission` +
  `WAREHOUSE_PERMISSIONS.*`) → Organization scope
  (`assertOrganizationInScope`) → business validation (branch
  usability/lifecycle via Organization's public service, code uniqueness,
  freeze guards) → repository operation. No step was reordered, skipped, or
  bypassed.
- No NODE_ENV, role-name, username, wildcard-permission, or system-admin
  bypass exists or was added; confirmed by the new authorization tests,
  which run through the real `AuthorizationService` and real RBAC
  repositories (not a stub that always allows).
- Tenancy: the single tenant-check mechanism remains
  `assertOrganizationInScope`; no second mechanism was introduced. IDOR is
  now proven false at three independent layers for Warehouse specifically:
  unit level (fake repos), authorization level (real `AuthorizationService`,
  hermetic RBAC store), HTTP level (hermetic e2e), and — pending CI —
  live-database level (real committed rows, real Prisma client).
- No secrets, credentials, or environment values were added or changed.

OPEN QUESTIONS PRESERVED: OQ-11, OQ-22, OQ-24, OQ-29, OQ-33, OQ-36, OQ-39,
OQ-41, OQ-42, OQ-43, OQ-54 — all left exactly as open as they were before
this task; none were resolved, narrowed, or silently assumed.

NON-GOALS PRESERVED: Item Master, Warehouse Receipt/Issue, Material Request,
valuation, costing, Kardex, reports, Inventory→Accounting/Sales/Purchasing/
AR/AP/Treasury integration, outbox, jobs, audit module, notifications,
licensing changes, auth/membership redesign, bins, lots, serials, new
movement/reservation models, cross-module posting logic, generic workflow,
and any frontend UI change. None were implemented; none were found to be a
hidden dependency of this work.

CI EVIDENCE: PR [#104](https://github.com/MR-AliEsmaeili/Vardena/pull/104)
(`arena/01a0f91f-vardena` → `main`), run
[36922724152](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36922724152),
head SHA `8dfc8556b71db65821c104e0d11648e762a13962`. `backend` job
`conclusion=success` (all 17 real steps succeeded, including step 17 "E2E
tests (incl. live-DB suites)" = `timeout 540 npm run test:e2e` against the
job's real `postgres:16` service); `frontend` job `conclusion=success`
(unaffected, included for completeness). Retrieved directly from the GitHub
REST API (`gh api repos/.../actions/jobs/110572464981`), not assumed from
the workflow file. Full per-step status table and a disclosed limitation
(this sandbox cannot reach the Azure Blob Storage host GitHub uses to serve
raw log text, so the literal vitest output lines could not be quoted — only
the authoritative step exit status could be retrieved) are in
`test-evidence.md`.

READY FOR REVIEW: Implementation complete, focused local verification
complete, and CI evidence observed green for the exact commit that
contains this work (see above and `test-evidence.md`). Status is
**READY FOR REVIEW** — this task is never marked ACCEPTED by this agent;
only IMPLEMENTED / MERGED / CI VERIFIED states are agent-assignable, and
CI VERIFIED here means "the run completed successfully," not "the raw log
text was read line-by-line" (that distinction is disclosed, not hidden).
Final Owner acceptance of PR #104 remains a separate, human decision.
