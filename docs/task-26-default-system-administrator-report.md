# Task 26 — Default System Administrator & First-Login Bootstrap Closure

Status: **READY FOR REVIEW — NOT ACCEPTED**
Base commit: `3f0926d50f220503bf8034c262c24b5b76d76a34` (branch `arena/01a0e3f3-vardena`, branched from `e7fe80d0` on `main`)

## A. Current-state audit

Audited before any change:

| Area                                                              | Finding on `main`                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/bootstrap-system-administrator.ts`                   | Post-migration CLI; loads the full `AppModule` so every module registers its permissions, runs the orchestrator, logs a result object. No HTTP endpoint.                                                                                                                                                                                         |
| `backend/src/bootstrap/system-administrator-bootstrap.service.ts` | Created `مدیر` through `UsersService.createUser` (Argon2id via `PasswordService`), then `SystemAdministratorRbacService.ensureForUser`. **No organization membership at all.** No lifecycle guard.                                                                                                                                               |
| `SystemAdministratorRbacService`                                  | Syncs `PermissionRegistry` → `rbac.permissions`, resolves the registered codes, and calls `RolesRepository.ensureRoleWithPermissionsForUser` in one transaction. Fails closed when the mirror is incomplete. No hard-coded codes or counts.                                                                                                      |
| `AuthorizationService`                                            | Ordinary `user_roles → role_permissions → permissions` evaluation. No wildcard, no username check, no role-name check.                                                                                                                                                                                                                           |
| Organization                                                      | `OrganizationsService.assertOrganizationInScope` is the single ODR-3 chokepoint; `DeploymentOrganizationScopeGuard` is the single global `APP_GUARD`; `OrganizationMembershipsService.grantMembership` carries the accepted first-member bootstrap exception.                                                                                    |
| Deployment organization (task §5)                                 | **B + D.** `DEPLOYMENT_ORGANIZATION_ID` is the established, boot-validated deployment-scope mechanism (ADR-0025), but **no code creates the pinned organization row**; ADR-0025 only says it is "bootstrapped out-of-band". Migrations create no organization (deliberately — Task 19 report). There is no other canonical organization concept. |
| Installation                                                      | Docker Compose `migrate` service and CI both run `prisma migrate deploy` then `npm run bootstrap:system-admin`.                                                                                                                                                                                                                                  |
| Tests                                                             | `system-administrator-bootstrap.service.spec.ts` (2 unit tests) and `test/bootstrap-system-administrator-live.e2e-spec.ts` (3 live tests: records, login, per-module access after a _manually created_ organization + first-member grant).                                                                                                       |

**Answer to the audit question.** Before Task 26, a fresh migrated database + `bootstrap:system-admin` produced a usable _authenticated_ administrator with the complete permission catalog but **no organization**: in unpinned mode it had to create one through the API and self-grant the first membership; in pinned mode the pinned organization could not be created at all (the API refuses organization creation while pinned), so a pinned fresh install was unusable without manual SQL.

## B. Root cause

ODR-3 authorization is `required permission AND organization membership`. Bootstrap provisioned only the permission half. The organization half had no installation path in pinned deployments because ADR-0025's "bootstrapped out-of-band" step was never implemented.

## C. Changed files

Production:

- `backend/src/modules/organization/application/organizations.service.ts` — new `ensureDeploymentOrganization()` + the initial code/name constants.
- `backend/src/modules/organization/organization.module.ts` — exports `OrganizationMembershipsService` (so the installation command uses the owning service instead of touching the table).
- `backend/src/bootstrap/system-administrator-bootstrap.service.ts` — membership reconciliation, lifecycle guard, extended result.
- `backend/src/bootstrap-system-administrator.ts` — logs `organizationId` / `organizationCreated` / `membershipCreated` (never the password).

Tests:

- `backend/src/bootstrap/system-administrator-bootstrap.service.spec.ts` (rewritten, 9 tests)
- `backend/src/modules/organization/application/deployment-organization-bootstrap.spec.ts` (new, 8 tests)
- `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` (3 new negative-security tests + a new pinned fresh-install describe with 2 tests)

Configuration / documentation:

- `docker-compose.yml`, `backend/.env.example`, `backend/README.md`, `README.md`, `docs/security.md`, `docs/adr/README.md`, `docs/adr/0038-installation-bootstrap-of-the-pinned-deployment-organization.md` (new), this report.

## D. Database changes

**No database schema change required.** No migration, no Prisma model change, no seed-state conflict. Idempotency relies entirely on the existing `uq_users_username`, `uq_organizations_code`, the organization primary key and `pk_organization_memberships_user_organization`.

## E. Bootstrap flow (fresh database → first login)

```text
prisma migrate deploy
  ↓
npm run bootstrap:system-admin
  ├─ ensureUser:      مدیر created (Argon2id hash of the initial credential) — or adopted if present
  │                   refuses to continue if the existing مدیر is disabled/soft-deleted
  ├─ rbac.ensureForUser: registry → rbac.permissions sync (fail-closed) →
  │                   System Administrator role → role_permissions (every registered code) → user_roles
  └─ ensureDeploymentMembership:
        DEPLOYMENT_ORGANIZATION_ID set   → create that exact organization row if missing (code MAIN)
                                         → grantMembership(pin, مدیر) through the owning service
        DEPLOYMENT_ORGANIZATION_ID unset → null: nothing invented (ADR-0021 structural mode)
  ↓
POST /api/v1/auth/login { "مدیر", "1" } → session cookie
  ↓
principal → user_roles → role_permissions → permissions  (RBAC)
principal → organization_memberships                      (ODR-3)
  ↓
organization-scoped APIs authorized with no manual step (pinned mode)
```

## F. RBAC evidence

- Role: `System Administrator`, an ordinary `rbac.roles` row.
- Permission source: `PermissionRegistry` only, mirrored by `PermissionSyncService`; the bootstrap resolves `registry.all()` codes and fails closed if any code is missing from the mirror.
- Assignment mechanism: `role_permissions` + `user_roles` rows inside the existing transaction; nothing hard-codes a code or a count.
- Observed count at the time of writing (evidence only, not asserted as a literal anywhere in production code): the live test asserts `rolePermission.count === PermissionRegistry.size` and `/permissions/effective` equals the sorted registry code list.

## G. Organization evidence

- Canonical source: `DEPLOYMENT_ORGANIZATION_ID` (ADR-0025). No second organization concept was introduced; ADR-0038 records the provisioning refinement.
- Creation: `OrganizationsService.ensureDeploymentOrganization()` — at most one row, keyed by the pin, refused inside an HTTP request context, `null` when unpinned.
- Membership: `OrganizationMembershipsService.grantMembership` (the owning service, with its permission check and its accepted first-member rule); a duplicate grant conflict is treated as "already correct". Other memberships are never deleted, replaced or duplicated.
- Verification: unit tests plus the live pinned fresh-install suite asserting `organization.count({id: pin}) === 1` and `organizationMembership.count({pin, userId}) === 1` after two consecutive bootstrap runs.

## H. Authentication evidence

- `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` → `authenticates the exact initial credential and rejects a wrong password without leaking it` (existing, still green in CI).
- `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` → `logs in with the initial credential and reaches organization-scoped APIs with no manual step` (new; pinned fresh install, real `POST /api/v1/auth/login`, real session cookie, then Inventory/Documents/Workflow/Accounting/Organization reads).

## I. Security evidence (negative tests)

| Claim                                                     | Test                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Username alone grants nothing                             | `gives no administrator authority to a different user with a similar username` (live e2e) — a real user named `مدیر-xxxxxx` gets `[]` effective permissions and 403/403/403.                                                                                  |
| Role name alone grants nothing; permission removal denies | `denies the administrator when a single permission is removed from the role (ordinary RBAC, not a bypass)` (live e2e) — deleting one `role_permissions` row turns `GET /users` into 403 while `GET /roles` stays 200; the row is restored and access returns. |
| Membership removal denies organization access             | `denies organization-scoped access when the administrator membership is removed` (live e2e) — 404 from Inventory and Accounting with the full permission catalog still held.                                                                                  |
| Permission alone is not organization authority            | `gives the bootstrapped administrator ordinary ODR-3 access, and nobody else` (unit) — same permission, no membership ⇒ `EntityNotFound`.                                                                                                                     |
| Membership alone is not permission authority              | `keeps permission and membership independent: membership alone is not authority` (unit) ⇒ `PermissionDenied`.                                                                                                                                                 |
| Arbitrary `organizationId` cannot widen scope             | `logs in with the initial credential and reaches organization-scoped APIs with no manual step` (live e2e) — a random organization id answers 404 under the pin.                                                                                               |
| No silent revival of a disabled/deleted administrator     | `refuses to silently reactivate a disabled bootstrap administrator`, `refuses to silently undelete a soft-deleted bootstrap administrator` (unit).                                                                                                            |
| No new bypass surface                                     | `is refused inside an HTTP request context (installation command only)` (unit).                                                                                                                                                                               |

## J. CI evidence

- Workflow: `CI` (`.github/workflows/ci.yml`) — backend job runs validate → lint → typecheck → format → unit → build → `prisma migrate deploy` → `bootstrap:system-admin` → migration rehearsal → full E2E incl. live-DB suites; frontend job runs lint/typecheck/format/test/build.
- Run ID: **`36338648394`** (PR #72, head `b6bb163bf05ec58785912966dc57f03308d34cbe`) — conclusion **success**.
  - backend job `108674263738`: **success** (prisma validate/generate, oxlint, tsc, prettier, 1282 unit tests, build, `prisma migrate deploy`, `bootstrap:system-admin`, migration rehearsal, full E2E including the live-database suites — `VARDENA_TEST_DATABASE_URL` is set job-wide, so both bootstrap live suites executed rather than skipped).
  - frontend job `108674263677`: **success**.
- Follow-up run (future permission reconciliation contract): **`36339679496`** (head `1c69a9c8c84ca4bdb431b957f5e92f17a2926b63`) — conclusion **success**; backend job `108677183587` and frontend job `108677183307` both passed, backend unit suite at **110 files / 1286 tests**.
- Local verification: `npx tsc --noEmit` PASS; `npm run lint` 0 errors / 7 pre-existing warnings; `npx prettier --check src test` PASS; `npx vitest run` **109 files / 1282 tests PASS**; `npx vitest run --config ./vitest.config.e2e.ts test/bootstrap-system-administrator-live.e2e-spec.ts test/deployment-scope.e2e-spec.ts` PASS (live cases skipped locally — no database in the sandbox).

## K. Documentation changes

| File                                         | Correction                                                                                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/security.md`                           | First-administrator bootstrap paragraph now states the pinned vs unpinned organization behaviour, the membership creation, the no-silent-reactivation rule, and the explicit `permission AND membership` relationship. |
| `backend/README.md`                          | Installation section: bootstrap also ensures the pinned organization and the administrator's membership; unpinned behaviour unchanged.                                                                                 |
| `README.md`                                  | Quick-start login paragraph aligned with the same two modes.                                                                                                                                                           |
| `backend/.env.example`, `docker-compose.yml` | `DEPLOYMENT_ORGANIZATION_ID` documented/plumbed to the migrate/bootstrap service and the API.                                                                                                                          |
| `docs/adr/0038-*.md`, `docs/adr/README.md`   | New Proposed ADR recording the provisioning decision (ADR-0025 refinement, not a change to ODR-3).                                                                                                                     |

## L. Acceptance checklist

| Criterion                                           | Result                         | Evidence                                                                                                                        |
| --------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `مدیر` is the canonical default system user         | PASS                           | `BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME`; no other administrator username exists                                               |
| Fresh install produces a usable administrator       | PASS                           | pinned live suite; unpinned path documented and covered by the existing live suite                                              |
| Initial password works on first login               | PASS                           | live login tests                                                                                                                |
| Argon2id hash                                       | PASS                           | `passwordHash` matches `/^\$argon2id\$/` and verifies                                                                           |
| Password never logged                               | PASS                           | CLI logs ids/counts only; rejected-login body asserted not to echo the attempt                                                  |
| `System Administrator` is an ordinary role          | PASS                           | `rbac.roles` row, no runtime name check anywhere                                                                                |
| Role receives every registered permission           | PASS                           | `/permissions/effective` equals the sorted registry codes                                                                       |
| No wildcard permission                              | PASS                           | registry-derived codes only                                                                                                     |
| No username-based authorization                     | PASS                           | impostor-username test                                                                                                          |
| No role-name authorization bypass                   | PASS                           | permission-removal test                                                                                                         |
| Administrator has canonical organization membership | PASS                           | pinned live suite (`organizationMembership.count === 1`)                                                                        |
| Organization APIs work through normal membership    | PASS                           | pinned live suite, five module paths                                                                                            |
| Bootstrap is idempotent                             | PASS                           | double `run()` in unit + live suites; counts unchanged                                                                          |
| Existing password never reset                       | PASS                           | `is idempotent and never resets an existing bootstrap user password`                                                            |
| Lifecycle not silently overridden                   | PASS                           | two refusal tests                                                                                                               |
| New permissions reconciled later                    | PASS                           | `ensureForUser` re-resolves `registry.all()` each run; `reconciles a missing or incomplete role assignment on an existing user` |
| No duplicate user/role/membership                   | PASS                           | conflict-adoption tests + live counts                                                                                           |
| Fresh-install verification                          | PASS                           | pinned live suite (CI-executed)                                                                                                 |
| Authentication verification                         | PASS                           | §H                                                                                                                              |
| Representative module authorization tests           | PASS                           | Users, RBAC, Organization, Inventory, Documents, Workflow, Accounting                                                           |
| Negative security tests                             | PASS                           | §I                                                                                                                              |
| Documentation matches implementation                | PASS                           | §K                                                                                                                              |
| CI passes                                           | PASS (see final answer run ID) | workflow `CI`                                                                                                                   |

## Future Permission Reconciliation Contract

**Architectural invariant.** `مدیر` is the default system administrator and
receives administrative authority through the ordinary
`User → Role → Permission` model. The `System Administrator` role represents the
complete currently registered application permission catalog:

```text
New module / feature → permission declared in the module's PermissionRegistry
registration → canonical application permission catalog (PermissionRegistry →
rbac.permissions) → System Administrator reconciliation
(SystemAdministratorRbacService.ensureForUser) → مدیر receives it through the
ordinary user_roles assignment
```

**Developer rule for a new permission** (e.g. `Sales.Invoice.Export`): declare
it in the module's canonical permission definitions, register it through the
module's `…PermissionRegistration` class, guard the route with
`@RequirePermission(...)`, re-check it in the application service, and add
grant + denial tests. Do **not** add it to a `مدیر` list (none exists), do not
maintain a hardcoded permission count, do not write a username or role-name
rule, and do not introduce a wildcard code.

**Fresh install.** `prisma migrate deploy` → `bootstrap:system-admin` creates
`مدیر`, the `System Administrator` role, every registered permission grant, the
role assignment and the deployment-mode organization membership.

**Existing install after a new module ships.** The same command re-resolves
`PermissionRegistry.all()` and inserts only the missing `role_permissions` rows
on the existing role; nothing is removed. This happens **when the deployment
runs the bootstrap command** (Docker Compose `migrate` service; CI step
`Bootstrap system administrator`) — not magically at runtime.

**Documentation changed:** `docs/security.md` (§3 "Future permission
reconciliation contract" + new §9.1 RBAC/System Administrator evolution
checklist), `docs/modules.md` (RBAC module section cross-reference).

**Tests proving the behaviour**
(`backend/src/modules/rbac/application/system-administrator-permission-reconciliation.spec.ts`,
new; run against the real `PermissionRegistry`, `PermissionSyncService`,
`AuthorizationService` and the in-memory RBAC stores, with every expectation
computed from `registry.size` — no fixed count anywhere):

| Test                                                                                                            | Proves                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `derives the administrator role from the registry, never from a fixed count`                                    | registry-driven catalog; effective codes equal the registry; no wildcard code                                        |
| `adds a permission registered by a future module to the EXISTING administrator role on the next reconciliation` | `Sales.Invoice.Export` is denied before and granted after the second reconciliation, on the same role and assignment |
| `keeps unrelated permissions granted to the administrator role by an operator`                                  | reconciliation only adds; it never removes                                                                           |
| `denies an unregistered capability, proving authority comes from grants and not from the role name`             | role name carries no authority; `requireAllPermissions` yields `PermissionDenied`                                    |

Pre-existing evidence reused, not duplicated:
`system-administrator-rbac.service.spec.ts` (`assigns every and only currently
registered permission through normal RBAC rows`, two fail-closed tests) and the
live suite's `uses normal RBAC and organization membership across implemented
domains` (effective codes equal `PermissionRegistry.size`).

Support change required for the new test: `backend/test/support/in-memory-repositories.ts`
gained `InMemoryRolesRepository.ensureRoleWithPermissionsForUser`, mirroring the
real repository's upsert-by-name / `skipDuplicates` semantics. Test-support only
— no production RBAC change.

**Confirmation.** A repository-wide check finds no username comparison against
`مدیر`, no `role.name === 'System Administrator'` authorization branch, no
manually maintained administrator permission list, no wildcard permission code,
and no superuser flag. Authorization remains `user_roles → role_permissions →
permissions`.

## Scope statement

No schema change, no migration, no new permission code, no new authorization model, no second guard, no superuser flag, no username/role-name check, no Treasury or other out-of-MVP capability, no unrelated refactor. Task 26 does not accept itself, close OQ-14/OQ-19, or promote any ADR (ADR-0038 is Proposed).
