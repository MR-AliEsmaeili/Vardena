# Task 19 — Chart Configuration Coherence, Accounting-owned Chart Tree, Principal-bound Organization Authorization — Implementation Report

Status: **READY FOR REVIEW — NOT ACCEPTED** (the implementation agent never
self-accepts; acceptance is the Owner/Reviewer's explicit act)
Date: 2026-09-26 · PR **#54** (`arena/01a0dd0a-vardena` → `main`) ·
Implementation commits `4e2e57e` (implementation), `b91b231` (e2e enablement
+ focused suites), `180dcf3` (e2e fix loop), `aaf34c6` (e2e fix loop)

Governing decisions: `docs/accounting/owner-decision-baseline.md` §11
(ODR-1/ODR-2/ODR-3, DECIDED) ·
Gate: `docs/tasks/task-19/task-19-implementation-gate.md`
(READY FOR IMPLEMENTATION) ·
Investigation: `docs/tasks/task-19/accounting-chart-configuration-investigation.md`

---

## 1. Scope

Exactly the three authorized slices; nothing outside gate §E was touched.

- **Slice 1 — ODR-1 Explicit Configuration Coherence.** An account write
  whose two configuration pins (`coding_structure_version_id`,
  `accounting_configuration_id`) diverge in the defined code shape (level
  count, per-level digit length) is REFUSED — no silent pin selection. Valid
  coherent pins stay accepted. No second configuration root. Historical
  ledger identity and immutable codes untouched. Repair of existing divergent
  rows remains OQ-62/OQ-63 (OPEN).
- **Slice 2 — ODR-2 Accounting-owned Chart Tree.** A read-only,
  organization-scoped, deterministic (fixed code-ascending) tree read surface
  over the account master — identity, hierarchy, code, name, level,
  active/inactive, `isPostable` (posting leaf vs aggregation). No invented
  `account_type`, no balances/turnovers (Task 18 owns every figure), no
  Reporting module, no second Account master (ADR-0009), no migration.
- **Slice 3 — ODR-3 Principal-bound Organization Authorization.** The
  requested `organizationId` is bound to the principal's organization
  membership through one chokepoint (`assertOrganizationInScope`: deployment
  pin → principal → membership, 404 indistinguishable from unknown).
  Permission alone no longer crosses organizations. Existing RBAC semantics
  and the Accounting 404 posture preserved. No wildcard org access. The
  membership binding is the smallest Organization-owned design: presence IS
  the authorization; the full membership model stays OQ-01/OQ-22.

## 2. Delivered surface

### Slice 1 (ODR-1)

- `domain/account.ts`: `PinCoherenceProblem`,
  `planPinCoherence` (the decision table — code-shape projection only:
  level count + per-level digit length; fails closed), `pinCoherenceProblemMessage`
  (AR-24 messages naming the remedy).
- `data/accounting-structure-errors.ts`: `AccountPinsIncoherentError`
  (same contract as `AccountPlacementRejectedError`).
- `application/accounts.service.ts`: pre-flight `assertPinCoherence` on root
  create, child create and move; mapped to 422 `BusinessRuleViolation`
  with `details.rule`.
- `data/accounts.repository.ts`: the same decision table re-applied inside
  the locked transactions; `AccountStructureSnapshot.codingLevels` carries
  the coding half of the pair from the same snapshot the service validated
  (the published roots are immutable, so the snapshot cannot drift).
- `test/support/accounting-structure-repositories.ts`: the in-memory twin
  mirrors the write boundary (create + move).
- Specs: `domain/pin-coherence.spec.ts` (11), application
  `account-pin-coherence.spec.ts` (6 — coherent accepted; divergent
  digit-length/level-count refused 422 with no row; legacy divergent
  parent/move refused; reads never blocked; coherent pins stay movable),
  `data/accounts.repository.spec.ts` (+3 boundary cases).

### Slice 2 (ODR-2)

- `application/chart-tree.service.ts` + `api/chart-tree.controller.ts` +
  `api/dto/chart-tree.dto.ts`: `GET /api/v1/accounting/chart-tree` and
  `GET /api/v1/accounting/chart-tree/:id` — read-only, flat
  (`parentId`/`level` carry the hierarchy), fixed order, bounded paging
  (`PageQueryDto` caps), explicit `sort` rejected 400, inactive nodes
  included, `Accounting.Account.View`, foreign/unknown ids 404, disabled
  organization 422. Reuses `AccountsRepository` read paths; no new
  repository, no new table.
- `api/accounts.controller.ts`: the stale "no tree endpoint" comment
  replaced with the ODR-2 pointer.
- Specs: `application/chart-tree.service.spec.ts` (8).

### Slice 3 (ODR-3)

- `prisma/schema/organization.prisma` + `users.prisma` + migration
  `20260926000000_organization_membership`: `organization.organization_memberships`
  — composite PK `(user_id, organization_id)` (the database makes duplicate
  grants impossible, like `rbac.user_roles`), user CASCADE, organization
  RESTRICT, no backfill (operational grant decision, not a schema fact).
- `domain/organization-membership.ts` (entity/mapper/DTO),
  `data/organization-memberships.repository.ts`,
  `application/organization-memberships.service.ts`,
  `api/organization-memberships.controller.ts` + DTO:
  `GET/POST/DELETE /api/v1/organizations/:id/members` — paged list
  (grant-audit order), grant 204 / duplicate 409 / unknown user 404 (user
  FK) / revoke 204 / non-member 404; events
  `OrganizationMembership.Granted/Revoked`.
- `domain/organization-permissions.ts`: `Organization.Membership.{View,Grant,Revoke}`
  (28 Organization codes; master-data action set gains Grant/Revoke).
- `application/organizations.service.ts`: `assertOrganizationInScope`
  (pin → principal → membership; system context skips), used by
  `requireUsableOrganization`, `requireAdministrableOrganization` and every
  module's `mustFindInOrganization` resolver. 23 service files +
  `accounting-report-support.ts` now await the scope assertion (previously
  a floating promise — enforcement is now real).
- `test/support/master-data-repositories.ts`:
  `InMemoryOrganizationMembershipsRepository` (P2002/P2003 fidelity, `seed`).

### Focused e2e (CI-executed)

- `test/chart-tree.e2e-spec.ts` (12): read surface over HTTP (order, flat
  shape, inactive retention, paging, sort 400, by-id 404s, disabled-org 422),
  the 403/404 authorization boundary, and ODR-1 coherence through HTTP
  (coherent pair accepts; divergent ACTIVE pair refused 422 with
  `details.rule`; reads unaffected).
- `test/organization-membership.e2e-spec.ts` (11): bootstrap-first-grant
  (grantor membership not required — permission is the authority),
  list/grant/revoke lifecycle (204/409/404), user-FK 404, per-operation 403,
  and the ODR-3 boundary (grant → readable, revoke → 404, permission alone
  never crosses, no wildcard).
- All 10 hermetic org-scoped suites: membership repository override +
  persona membership seeding (the established pattern — cross-org assertions
  stay data-scoped; no assertion weakened). The two deployment-pinned inner
  apps (`accounting-ledger-movements`, `accounting-account-statements`) got
  the same override. Live-DB suites needed nothing (system-context only).

## 3. Verification

### Test execution matrix

**LOCAL (ARENA):**

| Gate | Result |
|---|---|
| `format:check` | ✅ pass (after prettier on first-authored files) |
| `lint` (oxlint) | ✅ **0 errors**; 6 warnings — all pre-existing on base `5cff2ab`, verified by diff, not introduced |
| `typecheck` (`tsc --noEmit`) | ✅ pass |
| `npm test` (unit) | ✅ **100 files / 1131 tests** passed (includes the 28 new tests of this task) |
| `build` (`nest build`) | ✅ pass |
| `prisma:validate` / `prisma:generate` | ⚠️ blocked locally — sandbox cannot download the Prisma engine (`binaries.prisma.sh` unreachable); **delegated to CI** (passed there from the first run) |

**DELEGATED TO GITHUB CI:** `prisma validate/generate`, `migrate deploy`
(new membership migration), migration rehearsals, E2E including live
PostgreSQL (`postgres:16`), concurrency, full CI-equivalent pipeline.

**CI RUNS (PR #54, job `backend`):**

| Run | Commit | Result |
|---|---|---|
| `36235566364` | `4e2e57e` | ❌ E2E step only — the predicted hermetic persona-membership fallout; all earlier steps green (incl. `migrate deploy` + live-DB prerequisites) |
| `36236743575` | `b91b231` | ❌ E2E — 4 residual failures (wrong permission-code string in the new membership spec; unseeded mid-test org; two inner pinned apps missing the memberships override) |
| `36237079134` | `180dcf3` | ❌ E2E — 1 residual failure (invalid-ULID probe: `@IsUlid()` correctly answers 400, not 404) |
| `36237376395` | `aaf34c6` | ✅ **success** — prisma validate/generate, lint, typecheck, format, unit, build, `migrate deploy`, migration rehearsals, E2E incl. live-DB suites |

**No heavy E2E/live-DB test was executed locally unless explicitly
authorized.** Every e2e failure above was diagnosed from CI annotations and
code inspection, never by local reproduction; every fix strengthened the
suites' fidelity (harness wiring, correct probes), and no assertion,
suite or gate was weakened, skipped or ignored at any point.

## 4. Limitations and deferred items

- **OQ-62/OQ-63 remain OPEN**: the coherence rule refuses new incoherence;
  it does not repair existing divergent rows (reads stay unblocked by
  design). **OQ-25/OQ-43 remain OPEN.** **OQ-01/OQ-22 remain OPEN** — the
  membership model is deliberately presence-only; per-organization roles,
  deactivation and effective dating are future authorized work.
- No ADR promotion (ADR-0033…0037 stay Proposed; ADR-0009/0025/0028 are
  preserved, not amended).
- Gate §E exclusions all honored: no Reporting module/`/api/v1/reports`, no
  deletion, no legal/statutory, no code-length/level-count migration, no
  ADR-0035 service, no dimensions, no `postable ⇒ leaf` relaxation (D-1),
  no frontend, no dependency additions, no Slice-2 migration.
- Test-execution policy recorded as canonical documentation:
  `docs/testing/test-execution-policy.md` (Local Fast / CI Heavy / CI
  Live-DB / CI Migration / CI Concurrency gates — an execution-environment
  decision, not reduced coverage).

## 5. Status

**Task 19 implementation: READY FOR REVIEW — NOT ACCEPTED.** This report
and PR #54 are the review basis. Task 19 status is never self-accepted.
