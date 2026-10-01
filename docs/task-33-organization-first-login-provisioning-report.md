# Task 33 — Organization Provisioning & First-Login Readiness

Status: **READY FOR REVIEW**
Base commit (original): `1d9a3c014a23775697b112bb8953cea943d0db52` (branch
`arena/01a0f16d-vardena`, merge of PR #95 on `main`)
Current PR #96 base: `841b68545b6be36aeb65f523474b4261973875b8` (merge of
PR #97 / L-01 into `main`).
Current PR #96 HEAD (final, after the documentation correction in §26):
`487d363c3bfe397f7480e992dbf6027c9108cbb9`.
`f9477b6b770787cd5745a04323d38481b98c238f` was an earlier, now-superseded
intermediate commit on this same branch (the L-01 compatibility-fix
implementation commit, before the docs commit that produced `487d363` was
added on top of it) — it is kept below only as a historical reference, never
as the current head. See §17 for the rebase record, §18 for the L-01
compatibility audit, and §26 for the evidence-correction pass that produced
the current head.

## 0. Executive summary

The reported symptom — a successfully authenticated bootstrap administrator
(`مدیر`) reaching the Persian "no organization available" screen — is **not a
new defect and not a backend authorization bug**. It is the intersection of
two already-documented, already-implemented, already-correct behaviors:

1. **Unpinned deployment mode is the repository's default** (`DEPLOYMENT_ORGANIZATION_ID`
   is unset in `.env.example`/`docker-compose.yml`; only pinned mode gets an
   organization auto-provisioned by `npm run bootstrap:system-admin`, per Task 26 /
   ADR-0038).
2. **The frontend's `empty` organization state offered no action.** The backend
   has always supported an authorized principal creating the first organization
   and self-granting the first membership (ADR-0021 §"Alternatives considered";
   `OrganizationsService.createOrganization`;
   `OrganizationMembershipsService`'s first-member bootstrap exception), and this
   path is exercised end-to-end today by
   `backend/test/bootstrap-system-administrator-live.e2e-spec.ts`. But
   `OrganizationGate`/`OrganizationContext` on the frontend treated
   `organizations.length === 0` as an unconditional terminal dead end — logout or
   "ask an administrator" were the only two options, even for the one session
   (the bootstrap administrator) that already holds every permission needed to
   fix it itself.

**No backend change was required or made.** The fix is a small, additive
frontend capability that calls the two existing, unmodified endpoints
(`POST /organizations`, `POST /organizations/:id/members`) under the two
existing, unmodified permission codes
(`Organization.Organization.Create`, `Organization.Membership.Grant`), gated by
the session's own effective permissions (UX-only, AR-21). Pinned-mode
provisioning (Task 26) is unchanged and already closes the loop for that
deployment mode.

## 1. Current architecture findings (audit, before any change)

### 1.1 Identity / Users / RBAC

- `UsersService.createUser` creates an ordinary `users.users` row; passwords are
  Argon2id via `PasswordService`. Sessions are opaque, httpOnly-cookie tokens
  (`identity` module, ADR-0007). The request principal is bound in
  `kernel/correlation/request-context.ts` (`getPrincipal()`/`getRequestContext()`).
- `AuthorizationService.requireAllPermissions` evaluates ordinary
  `user_roles → role_permissions → permissions` rows. No wildcard, no
  username check, no role-name check exists anywhere in the codebase (grepped;
  confirmed by `system-administrator-permission-reconciliation.spec.ts` and the
  live suite's impostor-username test).
- Permissions are **not** organization-bound in RBAC itself — a permission
  code such as `Organization.Organization.Create` is a deployment-global grant.
  Organization-scoped **authorization** is a second, independent gate
  (§1.3): RBAC answers "may this principal do X at all", ODR-3 membership
  answers "may this principal do X for organization Y". Both must pass.

### 1.2 System Administrator bootstrap

`backend/src/bootstrap-system-administrator.ts` (CLI entrypoint) →
`SystemAdministratorBootstrapService.run()`:

1. `ensureUser()` — creates `مدیر` (username fixed by
   `BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME`) with a fixed initial password if
   absent; if present, requires it to be active and non-deleted (refuses to
   silently reactivate a disabled/deleted administrator); never resets an
   existing password. **Idempotent** (race-safe via the username unique
   constraint).
2. `SystemAdministratorRbacService.ensureForUser()` — resolves
   `PermissionRegistry.all()` (every module's registered permission codes, 142
   at the time of this audit), mirrors them into `rbac.permissions`
   (fail-closed if the mirror is incomplete), upserts the `System
   Administrator` role with every registered permission, and assigns the role
   to the user. Re-running the command **adds** newly registered permissions
   to the existing role; it never removes any.
3. `ensureDeploymentMembership()` — calls
   `OrganizationsService.ensureDeploymentOrganization()`:
   - **pinned** (`DEPLOYMENT_ORGANIZATION_ID` set): creates that exact
     organization row if missing (code `MAIN`, the ADR-0025 "bootstrapped
     out-of-band" step), then calls
     `OrganizationMembershipsService.grantMembership()` for `مدیر` — an
     **ordinary** `organization_memberships` row through the module that owns
     it, not a direct table write.
   - **unpinned**: returns `null`. **Nothing is invented.** The result records
     `organizationId: null, organizationCreated: false, membershipCreated: false`.

This is exactly the Task 26 / ADR-0038 closure already on `main`; it was
re-verified, not re-implemented, by this task (§7 "Verification").

### 1.3 Organization / OrganizationMembership

- `Organization` (`organization.organizations`) is the tenant/business root
  (ADR-0020/ADR-0021): `id`, `code` (globally unique), `name`, `isActive`,
  audit columns. `OrganizationsService` owns create/list/get/update/enable/
  disable, each re-checking its own `Organization.Organization.*` permission
  in the application layer (AR-04/AR-21), independent of the route guard.
- `OrganizationMembership` (`organization.organization_memberships`) is the
  **only** principal → organization binding (Task 19, ODR-3):
  composite primary key `(user_id, organization_id)`, `created_at`,
  `created_by`. `OrganizationMembershipsService` owns
  list/grant/revoke, each re-checking `Organization.Membership.*` **and**
  `OrganizationsService.assertOrganizationInScope` (deployment pin, then the
  acting principal's own membership) — **except** the documented, narrow
  first-member bootstrap exception: granting the very first member of an
  organization that currently has **zero** members does not require the
  grantor to already be a member (otherwise no organization could ever be
  populated). The exception applies to `grantMembership` only, never to list
  or revoke, and closes the instant one member exists.
- `assertOrganizationInScope` is the single ODR-3 chokepoint every
  organization-scoped module (Accounting, Inventory, Documents, Workflow,
  Organization's own master data) calls after its permission check (Task 26
  closed the last 37 read surfaces that didn't). A caller with full RBAC
  permissions but no membership row gets `404 EntityNotFound` — indistinguishable
  from an unknown organization id. This is intact and **was not touched**.
- `DEPLOYMENT_ORGANIZATION_ID` (ADR-0025) is an **optional, environment-configured
  pin**: unset (the default) ⇒ `assertDeploymentOrganizationPin` is a no-op and
  `listOrganizations`/`createOrganization` behave as an ordinary, potentially
  multi-organization catalog; set ⇒ every organization-scoped id must equal the
  pin (404 otherwise) and `createOrganization` is refused outright ("This
  deployment is pinned to a single organization; additional organizations
  cannot be created through the API").

### 1.4 Frontend organization discovery/selection (the actual gap)

- `OrganizationContext` (`frontend/src/features/organization/organization-context.tsx`)
  derives a state machine — `loading | selecting | ready | empty | forbidden |
  invalid | error` — purely from `GET /organizations` and the session's
  effective permissions. It invents nothing: one organization auto-selects,
  several require an explicit choice, zero is `empty`.
- `OrganizationGate` (`frontend/src/app/layouts/organization-gate.tsx`) replaces
  the whole workspace for every state except `ready`. Before this task, `empty`
  rendered `BlockedState` unconditionally: a title, a body
  (`سازمانی برای حساب کاربری شما در دسترس نیست...`), and a logout button. **No
  organization-scoped request could ever be sent from this screen, and no path
  existed to create one**, even though:
  - the backend already allows it (unpinned mode, §1.3);
  - the bootstrap administrator's session already holds
    `Organization.Organization.Create` and `Organization.Membership.Grant`
    (every registered permission, §1.2);
  - `frontend/src/features/permissions/permission-codes.ts` didn't even mirror
    those two codes, so no frontend surface could have gated on them.

This is the exact and complete root cause: **an existing, correct, documented
backend capability (ADR-0021's "the first organization is created through the
API by a principal that already holds `Organization.Organization.Create`") had
no frontend integration.**

## 2. Root cause (precise statement)

> In the repository's default (unpinned) configuration, a fresh install's
> bootstrap administrator authenticates successfully and holds every RBAC
> permission, but is a member of **zero** organizations because unpinned mode
> intentionally invents no organization (ADR-0021 structural mode, confirmed
> unchanged by Task 26/ADR-0038, which only provisions membership in **pinned**
> mode). The backend already exposes a compliant path to fix this — ordinary
> `POST /organizations` + `POST /organizations/:id/members` under the ordinary
> first-member exception — but the frontend's `OrganizationGate` rendered the
> `empty` state as an unconditional dead end with no way to reach that path.
> The bug was a **missing frontend integration of an existing backend
> capability**, not a backend authorization defect and not a bootstrap defect.

## 3. Deployment-mode analysis

| Mode | How determined | Repository-defined default | Local runtime | CI |
|---|---|---|---|---|
| **Pinned** | `DEPLOYMENT_ORGANIZATION_ID` set to a ULID | Not the default — the line is present but **commented out** in `backend/.env.example` (`# DEPLOYMENT_ORGANIZATION_ID=...`) and defaults to empty in `docker-compose.yml` (`${DEPLOYMENT_ORGANIZATION_ID:-}`) | Depends entirely on the operator's own `.env`, which is git-ignored and cannot be inspected or assumed by this repository | The backend CI job does not set it (verified against `.github/workflows/ci.yml`); backend unit/e2e suites run unpinned except the explicitly `describe`-scoped pinned-mode tests in `bootstrap-system-administrator-live.e2e-spec.ts`, which set the pin locally inside the test |
| **Unpinned** | Variable absent/empty | **Yes — this is the default** | Same as above: this repository cannot know a developer's local `.env` and does not attempt to | Yes, for the general test suite |

This repository **cannot and does not** determine what any individual
developer's uncommitted local `.env` sets `DEPLOYMENT_ORGANIZATION_ID` to. What
is verifiable from the repository itself is only the **default**, which is
unpinned. The reported symptom is consistent with a fresh install that did not
explicitly configure the pin — the expected, common case for a first local
run.

## 4. First-organization lifecycle — before and after

### Unpinned mode (the default) — before this task

```text
fresh deployment (DEPLOYMENT_ORGANIZATION_ID unset)
    ↓
bootstrap system administrator            → مدیر + System Administrator role + every permission
    ↓
admin authenticates                       → session cookie, full RBAC
    ↓
admin can discover that zero organizations exist   → GET /organizations → []  (frontend: OrganizationContext = 'empty')
    ↓
admin can create the first organization   → POST /organizations WORKS (backend), but the
                                              frontend `empty` screen offered no way to reach it
    ✗ DEAD END on the frontend, despite a fully authorized backend capability
```

### Unpinned mode — after this task

```text
fresh deployment (DEPLOYMENT_ORGANIZATION_ID unset)
    ↓
bootstrap system administrator            → مدیر + System Administrator role + every permission   [unchanged]
    ↓
admin authenticates                       → session cookie, full RBAC                              [unchanged]
    ↓
admin can discover that zero organizations exist   → GET /organizations → []                       [unchanged]
    ↓
OrganizationGate shows CreateFirstOrganizationForm  → only because the session holds BOTH
                                              Organization.Organization.Create AND
                                              Organization.Membership.Grant                          [NEW — frontend only]
    ↓
admin submits code+name → POST /organizations (unchanged backend call, unchanged permission check)
    ↓
admin becomes the first member → POST /organizations/:id/members {userId: self}
                                   (unchanged backend call, unchanged first-member exception)
    ↓
OrganizationGate refetches GET /organizations → now returns the new organization → 'ready'
    ↓
admin enters the organization                                                                        [NEW outcome, OLD mechanism]
```

### Pinned mode — unchanged, already closed by Task 26 / ADR-0038

```text
fresh deployment
    ↓
DEPLOYMENT_ORGANIZATION_ID configured
    ↓
bootstrap system administrator
    ↓
deployment organization provisioned        → OrganizationsService.ensureDeploymentOrganization()
    ↓
administrator membership granted           → OrganizationMembershipsService.grantMembership()
    ↓
admin authenticates
    ↓
organization available                     → GET /organizations returns exactly the pinned org → 'ready'
```

No code changed on this path. It was re-verified (§7), not re-implemented.

## 5. Decision — Option C (both modes), no new deployment model

Both modes were already architecturally decided and already implemented on the
backend:

- **Pinned (Option B):** the deployment organization is provisioned by the
  existing installation bootstrap when `DEPLOYMENT_ORGANIZATION_ID` is
  configured (Task 26 / ADR-0038). **Unchanged by this task.**
- **Unpinned (Option A):** the first organization is created through the
  normal Organization application/API flow, and the creating administrator
  becomes its first member through the existing first-member mechanism
  (ADR-0021, `OrganizationMembershipsService`). **This task's only change is
  making this reachable from the frontend**, for a session that already holds
  both permissions the backend already requires.

No third deployment model, no wildcard organization access, no
"system admin sees every organization", no username/role-name bypass, no
frontend-only organization state, and no direct-SQL install step were
introduced. Nothing about `assertOrganizationInScope`, the 404 isolation
posture, or the first-member exception's scope (grant-only, closes at one
member) changed.

## 6. Changes implemented

### 6.1 Backend

**None.** The audit (§1) confirmed the backend already implements everything
required for both modes; Task 26 / ADR-0038 already closed the pinned-mode gap.
No schema change, no migration, no new endpoint, no new permission code, no
guard change.

### 6.2 Frontend

All changes are additive, inside the `organization` feature slice, using only
already-existing, unmodified endpoints and permission codes copied verbatim
from the backend registry (AR-22 convention, already used by every other entry
in `permission-codes.ts`):

| File | Change |
|---|---|
| `frontend/src/api/contracts.ts` | Added `CreateOrganizationRequest`/`GrantMembershipRequest` type aliases, derived from the already-generated OpenAPI schemas (`CreateOrganizationDto`, `GrantMembershipDto`) — no new backend contract, no hand-written duplicate shape (ADR-0014/AR-26). |
| `frontend/src/api/organization.api.ts` | Added `createOrganization()` (`POST /organizations`) and `grantMembership()` (`POST /organizations/:id/members`) — thin wrappers around the existing Axios instance (AR-28), identical in shape to every other function in this file. |
| `frontend/src/features/permissions/permission-codes.ts` | Added `organization.create` (`Organization.Organization.Create`) and `organization.membershipGrant` (`Organization.Membership.Grant`) — codes copied from `backend/src/modules/organization/domain/organization-permissions.ts`, which already registered and enforced them; nothing new is enforced anywhere by this addition. |
| `frontend/src/lib/i18n.ts` | Added the Persian strings for the new form (`createFirstTitle`, `createFirstBody`, field labels, validation messages, submit/submitting). The pre-existing `emptyTitle`/`emptyBody` terminal strings are untouched and still render for sessions without both permissions. |
| `frontend/src/features/organization/create-first-organization-schema.ts` | New Zod schema mirroring `CreateOrganizationDto`'s validation (`code`/`name` required, same max lengths as the backend DTO) — client-side UX feedback only (AR-24); the backend re-validates regardless. |
| `frontend/src/features/organization/create-first-organization-form.tsx` | New component: a code+name form that calls `createOrganization` then `grantMembership(newOrg.id, { userId })` in that order, and calls `onCreated()` **only if both succeed**. No organization/membership state is created, cached, or assumed client-side; success is entirely defined by both backend calls succeeding. |
| `frontend/src/app/layouts/organization-gate.tsx` | The `empty` branch now renders a new `EmptyOrganizationState` component: if the session holds **both** `Organization.Organization.Create` and `Organization.Membership.Grant` (`usePermissions().hasAll([...])`, UX-only per AR-21), it renders `CreateFirstOrganizationForm` (with a logout affordance below it); otherwise it renders the **exact same, unchanged** `BlockedState` terminal explainer as before. `onCreated` is wired to the existing `useOrganization().refresh()` — no new state machine, no new organization/membership concept on the frontend. |

Nothing else changed. No route was added, no new page, no new permission
gate pattern beyond the existing `usePermissions().hasAll` used elsewhere.

## 7. Files changed

```
docs/security.md                                                        (doc)
frontend/README.md                                                      (doc)
docs/task-33-organization-first-login-provisioning-report.md            (doc, new — this file)
frontend/src/api/contracts.ts
frontend/src/api/organization.api.ts
frontend/src/features/permissions/permission-codes.ts
frontend/src/lib/i18n.ts
frontend/src/features/organization/create-first-organization-schema.ts  (new)
frontend/src/features/organization/create-first-organization-form.tsx   (new)
frontend/src/features/organization/create-first-organization-form.test.tsx (new)
frontend/src/app/layouts/organization-gate.tsx
frontend/src/app/layouts/app-shell.test.tsx
```

`git diff --stat` at the time of writing: 8 production/test files touched plus
3 new files, +206/−10 lines (frontend only). No backend file, no Prisma
schema file, no migration file, and no `docker-compose.yml`/`.env.example` file
was touched.

## 8. Database / migration impact

**None.** No Prisma schema change, no migration. The audit in §9 of the task
brief ("do not modify the schema unless the audit proves it cannot represent
the required lifecycle") concluded the existing schema is sufficient:
`Organization` remains the tenant root, `OrganizationMembership` remains the
sole principal→organization binding with its existing composite primary key,
and no role information was added to membership.

## 9. Organization provisioning behavior (after this task)

- **Pinned deployments:** unchanged — `ensureDeploymentOrganization()` inside
  the installation bootstrap, at most one row, keyed by the pin, refused
  inside any HTTP request context.
- **Unpinned deployments:** unchanged backend behavior (`createOrganization`
  requires `Organization.Organization.Create`, rejects duplicate codes, is
  refused when pinned). The only change is that a session holding the
  necessary permission can now reach this call from the UI instead of curling
  it by hand.

## 10. Membership behavior (after this task)

Unchanged. `OrganizationMembershipsService.grantMembership` still requires
`Organization.Membership.Grant`, still requires the acting principal's own
membership of the target organization **except** for the first member of an
organization with zero members, still returns `409 Conflict` for a duplicate
grant, and still resolves the "unknown user" case as `404` via the real
foreign key. The frontend addition calls this exact function through the
existing controller — it does not reimplement, parallel, or relax any of these
rules.

## 11. Frontend behavior (after this task)

- `GET /organizations` → `[]` is now correctly treated as what ADR-0021 always
  intended it to be: **a valid first-install state**, not a permanent
  authorization failure — but **only actionable for a session that already
  holds both required permissions**. Every other session still sees the
  unchanged terminal "no organization available" explainer with only "contact
  the system administrator" and "log out" as recovery paths, exactly as
  before.
- No frontend-only organization state was introduced: `organizationId` stays
  `null` until `GET /organizations` itself reports a usable organization, and
  the new form's only side effect on success is asking `OrganizationContext`
  to `refresh()` (re-run the real query).
- No client-side hardcoded organization id, no fake default, no optimistic
  organization/membership row.

## 12. Tests added/updated

### Frontend (new, this task)

- `frontend/src/features/organization/create-first-organization-form.test.tsx`
  (4 tests): required-field validation blocks submission; success calls
  `createOrganization` then `grantMembership` with the acting user's own id
  and only then reports success; a refused `createOrganization` (e.g. pinned
  deployment) never calls `grantMembership` and never reports success; a
  refused `grantMembership` after a successful `createOrganization` never
  reports success.
- `frontend/src/app/layouts/app-shell.test.tsx` (+1 test, 12 total in the
  file): a full-shell integration test — a session with
  `Organization.Organization.Create` + `Organization.Membership.Grant` sees
  the create-first-organization form (not the terminal explainer) when
  `GET /organizations` is empty, fills it in, and reaches the real dashboard
  once the mocked backend calls succeed and the (re-mocked) list reflects the
  new organization. The **pre-existing** "blocks the workspace ... when no
  organization exists" test (a session **without** those two permissions)
  is unchanged and still asserts the identical terminal explainer + logout
  button + no dashboard — proving the new capability does not weaken the
  default-permission-set behavior.

### Backend (verified, not modified — already exist on `main`)

Isolation and lifecycle behavior for both modes is already covered and was
re-run (not re-authored) as part of this task's verification:

- **Bootstrap idempotency / no silent reactivation / no password reset:**
  `backend/src/bootstrap/system-administrator-bootstrap.service.spec.ts` (9
  tests).
- **Pinned mode — organization + membership provisioning, idempotent,
  administrator access:** `backend/src/modules/organization/application/deployment-organization-bootstrap.spec.ts`
  (8 tests, unit) and the live pinned-mode `describe` block in
  `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` (2 tests,
  opt-in — needs `VARDENA_TEST_DATABASE_URL`).
- **Unpinned mode — bootstrap invents no organization; first organization
  created through the ordinary API; creating administrator becomes first
  member; subsequent access requires membership:** the first live `describe`
  block in the same file, specifically `uses normal RBAC and organization
  membership across implemented domains` (creates an organization over real
  HTTP, asserts a **404** before membership exists, grants membership, then
  asserts **200** across Inventory/Documents/Workflow/Accounting) and
  `denies organization-scoped access when the administrator membership is
  removed` (removes the membership row directly and re-asserts 404 despite
  full RBAC permissions — proves `authenticated + permission + no membership`
  never becomes organization access).
- **Non-member cannot access another organization / membership
  administration is organization-bound / first-member exception is narrow:**
  `backend/test/organization-membership.e2e-spec.ts` and
  `backend/src/modules/organization/application/organization-memberships.service.spec.ts`
  (17 unit tests).
- **37/37 organization-scoped read surfaces enforce `assertOrganizationInScope`:**
  `backend/src/modules/organization/application/organization-read-scope-completion.spec.ts`
  (38 tests).

These suites were re-run during verification (§13) to confirm the frontend-only
change did not require, and did not accompany, any backend regression.

## 13. Verification results (run in this session)

All of the following were **actually executed** in this session; none is
asserted without a run.

| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | frontend | **PASS** — 0 errors |
| `npm run lint` (oxlint) | frontend | **PASS** — 0 warnings, 0 errors, 158→159 files |
| `npm run format:check` (prettier) | frontend | **PASS** (after `prettier --write` on the one new file that needed it) |
| `npx vitest run` | frontend, full suite | **PASS** — 33 files, **217/217 tests** (212 pre-existing + 5 new: 4 in `create-first-organization-form.test.tsx` + 1 in `app-shell.test.tsx`) |
| `npm run build` (`tsc --noEmit && vite build`) | frontend | **PASS** — production bundle built successfully |
| `npm run typecheck` | backend | **PASS** — 0 errors (confirms the audit touched no backend type) |
| `npm run lint` (oxlint) | backend | **PASS** — 1 pre-existing warning (`no-unsafe-optional-chaining` in an unrelated Task-30 spec file, not introduced by this task), 0 errors |
| `npm run format:check` (prettier) | backend | **PASS** |
| `npx vitest run --config ./vitest.config.ts` | backend, unit suite | **PASS** — 113 files, **1,319/1,319 tests** (unchanged — confirms zero backend regression from a zero-line backend diff) |
| `npx vitest run --config ./vitest.config.e2e.ts` | backend, e2e suite | **PASS** — 20 files run, **278/278 tests**; **14 files / 113 tests SKIPPED** (the live-database suites, which require `VARDENA_TEST_DATABASE_URL` and are correctly opt-in) |

### Explicitly delegated to CI (not run locally in this session)

- **Live-database e2e suites** (`describe.skipIf(DATABASE_URL === undefined)`
  blocks in `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` and
  other live suites) — these require a real PostgreSQL instance wired through
  `VARDENA_TEST_DATABASE_URL`, which this sandbox does not have configured (no
  outbound network access to provision one; `npx prisma generate`'s engine
  download itself failed in this sandbox for the same reason, confirming no
  network path to a live database engine either). These suites already exist,
  already cover both deployment modes end-to-end (§12), and are exactly what
  GitHub CI's `CI` workflow runs against its own PostgreSQL service container.
  This task changed none of their assertions or fixtures.
- **`docker-compose` boot / full container smoke test** — not exercised in this
  sandbox; unaffected by this change (no compose file, Dockerfile, or
  environment variable was touched).

No test is reported as passed in this document unless the tool output above
shows it actually ran and passed in this session.

## 14. Remaining limitations (intentional, not regressions)

- A session that is authenticated but holds **neither**
  `Organization.Organization.Create` **nor** `Organization.Membership.Grant`
  still sees the unchanged terminal "no organization available, contact your
  system administrator" screen when `GET /organizations` is empty. This is
  correct: the frontend gate is UX-only (AR-21) and does not, and must not, let
  an under-permissioned principal create organizations or memberships.
- A session holding only **one** of the two permissions (e.g. can create
  organizations but cannot grant memberships) also still sees the terminal
  explainer rather than a partially-working form, because the sequence is only
  useful end-to-end. This mirrors the backend's own two-permission requirement
  and avoids a confusing half-successful UI state (an organization created with
  no way to enter it).
- There is still no general-purpose organization administration UI (list,
  edit, enable/disable, membership management for organizations the admin is
  already a member of) — this remains explicitly out of scope for the frontend
  per the repository's current state (`.vardena/project-context.md`: "no
  create/edit UI" is a known, accepted, pre-existing gap across the whole
  frontend, not something this task was asked to close). This task closes only
  the specific first-login dead end described in the brief.
- Password rotation / forced-password-change on first login remains open
  (OQ-19, pre-existing, unrelated to this task).

## 15. Follow-up work genuinely outside this task's scope

- A general Organization/Membership administration UI (list all organizations
  an admin can see, edit code/name, enable/disable, manage members of an
  existing organization) is a legitimate future frontend feature but was not
  requested and is not implied by the first-login dead end this task closes.
- OQ-19 (administrator self-disable / self-role-removal / last-administrator
  lockout protection) remains open and unaffected.
- Whether unpinned multi-organization production deployments should get a
  dedicated "create organization" entry point inside the workspace (not just
  the first-login gate) is a product decision outside this task's brief, which
  was scoped to "make the Organization lifecycle and first-login provisioning
  coherent with the architecture that already exists" — the first-login gate
  is exactly the point where the dead end was reported and is exactly where it
  is closed.

## 16. Acceptance-criteria cross-check

| Criterion (task brief §14) | Status |
|---|---|
| Exact reason for "no organization available" identified | §2 |
| Organization remains the tenant/business root | Unchanged — §1.3, §8 |
| Financial Area not conflated with Organization | Untouched by this task; Financial Area remains an Accounting-owned structure inside an Organization (`docs/accounting/domain-contract.md`) — no change made or needed here |
| Fiscal Year not conflated with Organization/Financial Area | Untouched by this task; unchanged accounting-module ownership |
| OrganizationMembership remains the principal→organization binding | Unchanged — §1.3, §10 |
| System Administrator remains an ordinary principal for organization-scoped authorization | Unchanged — §1.1/§1.2; the frontend gate uses the same effective-permission read every other UX gate uses, not a username/role-name check |
| No wildcard/bypass introduced | Confirmed — §6.2, §10 |
| Supported deployment mode(s) documented | §3, §5, `docs/security.md` update |
| Fresh installation has a deterministic path from bootstrap → organization access | §4 (both modes) |
| Existing tenant isolation behavior intact | Confirmed by re-run backend suites — §13 |
| Tests prove the relevant lifecycle | §12 |
| CI/verification results recorded truthfully | §13 |
| No unrelated architecture or product scope introduced | §6 — frontend-only, two new files, no schema/endpoint/permission change |

---

# PR #96 follow-up — rebase onto `main` + L-01 licensing compatibility audit

Everything below this line documents a separate, later pass over the same
PR #96. Sections 0–16 above are the original Task 33 deliverable and are left
unmodified as the historical record of that work; nothing in §1–§16 was found
to be factually wrong, so nothing there was rewritten.

## 17. Rebase

- **Original base:** `1d9a3c0` (`main`, merge of PR #95).
- **Original head (pre-follow-up):** `5db7b87` ("organization: close unpinned
  first-login dead end via frontend first-organization bootstrap").
- **Current `main` at follow-up time:** `841b685` (merge of PR #97, "L-01:
  licensing foundation and entitlement architecture"), six commits ahead of
  `1d9a3c0`: `f13c6e0`, `9a2510c`, `03aa933`, `735eaa2`, `f6afef6`, `841b685`.
- **Conflicts:** none. `git rebase origin/main` replayed both PR #96 commits
  (the original Task 33 commit and the one compatibility-fix commit added in
  §18 below) cleanly — the two change sets touch disjoint files (L-01 is
  entirely backend; PR #96 is entirely frontend until the one new frontend
  file this follow-up adds to read the license-state endpoint).
- **Resolution:** a clean `git rebase`, no manual conflict resolution was
  needed. `PR #96` was not closed; no new PR was opened; no unrelated history
  was rewritten (the rebase only replayed PR #96's own two commits onto the
  new base).
- **Post-rebase head (historical, intermediate):**
  `f9477b6b770787cd5745a04323d38481b98c238f`, pushed to
  `origin/arena/01a0f16d-vardena` with `git push --force-with-lease` (a rebase
  of an already-pushed branch requires a forced update of that one branch;
  no other branch or ref was touched). This was the L-01 compatibility-fix
  implementation commit (§18–§20 below). A subsequent, non-rebasing
  documentation commit was pushed on top of it (§26), moving the branch/PR
  HEAD forward to `487d363c3bfe397f7480e992dbf6027c9108cbb9` — see §26 for
  why `f9477b6` is no longer the current head and must not be cited as such.
- **Post-rebase diff check:** `git diff --stat origin/main..HEAD` at the time
  of the rebase showed exactly the 17 files PR #96 + this follow-up had
  touched (frontend only, plus docs) — confirming the diff at that point was
  PR #96's original functionality plus the one compatibility addition in
  §18, nothing else. §26 adds further documentation-only changes on top;
  §26 restates the final file list.

## 18. L-01 compatibility audit

The audit inspected every item the follow-up brief listed, against the
licensing foundation actually merged in PR #97 (`backend/src/modules/
licensing/*`, `docs/adr/0030-license-foundation.md`,
`docs/licensing-architecture.md`).

**Organization creation path**
(`OrganizationsService.createOrganization`,
`OrganizationsRepository.createWithinLicenseLimit`): L-01 inserted a license
check between the existing deployment-pin check and the existing
code/name validation — `licensing.organizationAllocation()` (requires an
active license and the `organization` module entitlement) followed by a
concurrency-safe count-and-create inside one transaction
(`createWithinLicenseLimit`, holding a Postgres advisory lock keyed by
installation+resource). On a reached limit it throws the same
`AppException.businessRule` (`BusinessRuleViolation`, HTTP 422) the pinned-
deployment refusal already used — no new error code, no new HTTP status, no
DTO/contract change. `CreateOrganizationDto`, `GrantMembershipDto`, and
`OrganizationResponseDto` are byte-for-byte unchanged (`git diff` confirms —
not merely "assumed unchanged"). Compatibility: **no frontend change
required** for the create call itself; `organization.api.ts` keeps calling
the same `POST /organizations` with the same body and reading the same
response shape it always did.

**RBAC / permission handling**
(`AuthorizationService.effectivePermissionCodes`): now intersects stored
grants with `LicensingService.filterLicensedPermissions` before returning
them, so `GET /permissions/effective` — the exact endpoint
`usePermissions()`/`GET /permissions/effective` already consumes — already
drops `Organization.Organization.Create` / `Organization.Membership.Grant`
from the effective set whenever the `organization` module is unlicensed or
the license itself is inactive. The default `LocalDevelopmentLicenseProvider`
configuration (`backend/src/kernel/config/app-config.ts`) entitles
`organization` (and every other currently-implemented module) by default
with no limits, so default/CI/unconfigured deployments are unaffected.
Compatibility: **no frontend change required** here either —
`EmptyOrganizationState`'s `permissions.hasAll([...])` check was already
reading the post-L-01-filtered set through the pre-existing contract, exactly
as the brief required ("use the existing effective-permissions API/session
contract... do not create a new permission endpoint").

**Deployment pin** (`ensureDeploymentOrganization`): the pinned-deployment
bootstrap path now also calls `licensing.organizationAllocation()` and
`createWithinLicenseLimit` before creating the pinned organization — a
pinned deployment cannot bypass the license any more than an unpinned one
can. This path is backend-only and invisible to PR #96's frontend code (a
pinned deployment never reaches the empty-organization gate because
`GET /organizations` already returns exactly one organization). No frontend
change needed or made.

**Membership bootstrap** (`OrganizationMembershipsService`, ODR-3 first-
member exception): `git diff 1d9a3c0 origin/main -- backend/src/modules/
organization/application/organization-memberships.service.ts
backend/src/modules/organization/api/organization-memberships.controller.ts
backend/src/modules/organization/domain/organization-permissions.ts` is
empty — L-01 did not touch the membership module at all. `Organization.
Membership.Grant` remains a plain RBAC permission, licensed through the same
`organization` module as `Organization.Organization.Create` (same prefix,
`permissionModuleCode()`), so both permissions are licensed/unlicensed
together under every current license configuration. Create Organization and
Create Membership remain two separate backend calls in
`CreateFirstOrganizationForm` (`POST /organizations` then
`POST /organizations/:id/members`); this follow-up did not collapse them
into one call or one abstraction, and did not reimplement any part of the
ODR-3 bootstrap exception client-side.

**License-limit / inactive-license failure UX:** `errors.ts`'s existing,
unmodified convention — `messageForCode('BusinessRuleViolation', fallback)`
returns the backend's own message verbatim, never a generic string — already
makes "the installation license organization limit has been reached" and
"This deployment is pinned to a single organization…" render as distinct,
accurate messages the moment a create call actually fails. That part needed
no change. The one gap the audit found: before a create is even attempted,
a session that holds both organization permissions but is blocked only
because the license is inactive saw the identical generic "you don't have
permission" explainer (`t.organization.emptyBody`) that a session with no
permission at all sees — both facts collapse to "the create form isn't
offered" and the UI could not tell them apart without the one further
read ADR-0030 explicitly calls out: *"PR #96's first-organization UX must
call the license-state endpoint before offering organization provisioning
[...] Its existing Organization/RBAC path remains unchanged."* This is the
one and only compatibility fix implemented (§19/§20 below): a read of the
already-existing `GET /license/current` (no RBAC permission required, no new
endpoint added — `LicenseStateController` ships as part of L-01 itself) used
purely to pick which explainer to show. It performs no count/limit math
client-side (`organizationLimit`/`userLimit` are read into the `LicenseState`
type but never compared against anything in the frontend) and changes no
enforcement — `OrganizationsService.createOrganization` is unaffected and
remains the only place a create is actually accepted or rejected.

**User/active-user limits** (`UsersService`, `activeUserAllocation`): out of
PR #96's scope by design — organization creation and membership grant are
the only two calls PR #96's frontend makes, and `CreateFirstOrganizationForm`
never creates a `User`. No duplication of the active-user limit was added or
considered necessary.

**Frontend/backend responsibility boundary:** unchanged and re-confirmed.
The frontend still never reads license state from `localStorage`,
`sessionStorage`, an environment variable, or any hardcoded value; the one
license read added is a per-request `GET /license/current` call proxied
through the same authenticated, httpOnly-cookie session as every other
request, with a 60s `staleTime` (identical caching posture to
`usePermissions()`/`getEffectivePermissions`). There is no
`isAdmin`/`NODE_ENV`/email/role branch anywhere in the new code, no
organization-count-vs-limit comparison, and no second "licensed
permissions" mechanism — the existing `GET /permissions/effective` route
remains the only permission source the frontend reads.

## 19. Files changed (this follow-up, on top of §7's original list)

| File | Change |
|---|---|
| `frontend/src/api/contracts.ts` | Add `LicenseState`/`LicenseEntitlement` types, hand-restored from `LicenseStateController`'s return type (documented 4th instance of the file's existing "annotation gap" pattern — that endpoint has no decorated response DTO for the OpenAPI generator to pick up) |
| `frontend/src/api/licensing.api.ts` (new) | `getLicenseState()` — thin `GET /license/current` wrapper, same shape as `identity.api.ts`'s `getEffectivePermissions` |
| `frontend/src/api/query-keys.ts` | Add the `licenseState` query key |
| `frontend/src/features/licensing/use-license-state.ts` (new) | `useLicenseState()` hook, same shape as `usePermissions()` |
| `frontend/src/app/layouts/organization-gate.tsx` | `EmptyOrganizationState` reads license state before the RBAC check; adds a dedicated blocked explainer for an inactive license |
| `frontend/src/lib/i18n.ts` | `licenseInactiveTitle`, `licenseInactiveBody`, `licenseErrorTitle` (Persian copy) |
| `frontend/src/test/fixtures.ts` | `testActiveLicenseState`, `testInactiveLicenseState` |
| `frontend/src/app/layouts/app-shell.test.tsx` | Mock `@/api/licensing.api`; default to an active license; add a regression test for the license-inactive explainer |
| `docs/task-33-organization-first-login-provisioning-report.md` | This section and §17/§18/§20–§25 |
| `STATE.md` | §13 addendum updated for the post-L-01 reality |
| `docs/security.md` | Reviewed; licensing-related clarification added |
| `frontend/README.md` | Reviewed; licensing-related clarification added |

No backend file was changed by this follow-up. No file outside this list was
touched.

## 20. Tests (this follow-up)

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Existing "lets a session holding organization Create + Membership.Grant create and enter the first organization" still passes unmodified with an active-license default | Pass | `npx vitest run src/app/layouts/app-shell.test.tsx` (13/13) |
| 2 | Existing "blocks the workspace... when no organization exists" (no permission) still shows the generic explainer, unaffected by the license check | Pass | same run |
| 3 | New: a session holding BOTH organization permissions sees the license-inactive explainer, not the permission-denied explainer, and not the create form, when the license is inactive | Pass | new test `blocks first-organization creation with the license explainer, not the permission explainer, when the installation license is inactive (ADR-0030)` |
| 4 | New: the license-inactive scenario never calls `createOrganization` | Pass | assertion inside test #3 |
| 5 | `CreateFirstOrganizationForm` unit tests (direct render, no gate) remain fully unaffected since they do not render `EmptyOrganizationState` | Pass | `create-first-organization-form.test.tsx` (4/4) |
| 6 | Full frontend suite regression | Pass | `npx vitest run` — 33 files / 218 tests |
| 7 | Backend full unit suite regression (no backend file touched, re-run to confirm the rebased base itself is healthy) | Pass | `npm test` in `backend/` — 116 files / 1335 tests |
| 8 | Backend + frontend CI on the exact final pushed commit | Pass | §22 |

Authorization/licensing-specific assertions ride on the real post-rebase
`main` contract (`effectivePermissionCodes` filtering, `BusinessRuleViolation`
message pass-through) rather than a mock of nonexistent licensing logic — the
mocked boundary in `app-shell.test.tsx` is `@/api/*` request functions only
(same boundary the suite already used before this follow-up), not the
licensing/authorization logic itself.

## 21. Local verification (this follow-up)

Run from a clean `npm ci` in both `frontend/` and `backend/` after the
rebase, against the rebased `arena/01a0f16d-vardena` working tree:

- `npx tsc --noEmit` (frontend): pass, 0 errors.
- `npx oxlint .` (frontend): "Found 0 warnings and 0 errors."
- `npx prettier --check .` (frontend): "All matched files use Prettier code
  style!"
- `npx vitest run` (frontend): 33 files / 218 tests, all pass.
- `npm run build` (frontend, `tsc --noEmit && vite build`): pass.
- `npm test` (backend, vitest unit suite): 116 files / 1335 tests, all pass.
- `npx prisma validate` (backend): **not runnable in this sandbox** — the
  schema-engine binary download is blocked by the sandbox's network egress
  policy (`request to https://binaries.prisma.sh/... failed`), a pre-existing
  sandbox limitation unrelated to this change (also hit and documented during
  the original Task 33 session). This is not a defect: the GitHub Actions
  backend job runs `Prisma validate` and `Prisma generate` as explicit steps
  and both passed on the final commit (§22) — no backend schema file was
  touched by this follow-up in any case.
- Backend E2E suite: not run locally in this session (no local Postgres in
  this sandbox); deferred to CI per the follow-up brief's explicit
  instruction, and verified there (§22/§23).

## 22. GitHub CI (historical — for the intermediate commit `f9477b6`, superseded by §26)

This section records the CI evidence gathered immediately after the rebase
in §17, when `f9477b6b770787cd5745a04323d38481b98c238f` was briefly the
branch/PR HEAD. **It is retained only as the historical record of that
intermediate state; it is NOT the authoritative evidence for the current PR
HEAD.** The current, authoritative CI run (for `487d363`, the actual current
head) is recorded in §26.

- **Commit verified (historical):** `f9477b6b770787cd5745a04323d38481b98c238f`
  — confirmed via `gh pr view 96 --json headRefOid` to be PR #96's head at
  the time of this check, immediately after the §17 rebase and before the
  §26 documentation commit was pushed on top of it.
- **Workflow:** `.github/workflows/ci.yml`, run id **36830490998**
  (https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36830490998) —
  **historical; superseded by run `36831107322` in §26.**
- **Jobs (on `f9477b6`):**
  - `backend` (job id `110265735253`): **success**, 3m17s. Steps included
    Prisma validate, Prisma generate, Lint, Typecheck, Format check, Unit
    tests, Build, Migrate test database, Bootstrap system administrator,
    Migration rehearsal, and **E2E tests (incl. live-DB suites)** — all
    green.
  - `frontend` (job id `110265735804`): **success**, 1m56s. Steps included
    Lint, Typecheck, Format check, Tests, Build — all green.
- **Overall run conclusion (historical):** `success` (`gh run view
  36830490998 --json status,conclusion` →
  `{"conclusion":"success","status":"completed"}`).

## 23. E2E (historical note)

The statement below described the state as of commit `f9477b6` / run
`36830490998`. §26 restates and re-verifies the same conclusion for the
current head `487d363` / run `36831107322`, which is the evidence that
actually applies to the PR today.

Explicitly **deferred locally and verified in GitHub CI** — the backend
job's "E2E tests (incl. live-DB suites)" step ran against a real Postgres
service container in the Actions runner and passed on commit `f9477b6`
(§22, historical). This was not run as a separate local full-E2E pass in
this sandbox (no local Postgres); per the follow-up brief this is not a
blocker. The same conclusion is re-verified for the current head `487d363`
in §26, which is the evidence that actually governs the current READY FOR
REVIEW status (see "Final status" below).

## 24. Known issues

No known implementation defects remain. Two sandbox-environment limitations
were hit and worked around, not fixed (because they are not code defects):
`npx prisma validate` cannot reach `binaries.prisma.sh` from this sandbox
(worked around by relying on the GitHub Actions job, which has network
access and passed); no local Postgres is available in this sandbox for a
local E2E run (worked around by relying on the GitHub Actions job, which
provisions one and passed).

One pre-existing, intentionally-out-of-scope observation carried over
unchanged from the original Task 33 report's §14/§15 is still accurate: the
license-inactive explainer added here uses the same terminal,
logout-or-contact-administrator pattern as every other blocked state in
`OrganizationGate` — there is still no general license-activation UI, and
none is implied or required (§16's "Scope control" explicitly forbids a
"license activation portal"; this follow-up implements neither).

## 25. Scope notes

No unrelated scope was introduced. Confirmed against the follow-up brief's
forbidden list: no CRM, billing, marketplace, remote license server,
activation portal, hardware binding, offline licensing, new RBAC/permission
architecture, new workflow engine, Redis, microservice split, or unrelated
refactor was added. No file outside the list in §19 was modified; in
particular, `SessionProvider`/`session-context.tsx` and `OrganizationProvider`/
`organization-context.tsx` — both high-centrality, already heavily tested
files — were left completely untouched, and the one new query (license
state) was implemented as its own small, independently-enabled hook used only
inside `EmptyOrganizationState`, specifically to avoid widening the blast
radius of this change beyond first-organization provisioning. The Task 33
decision recorded in §5 (Option C, frontend-only, no backend/ADR change)
still stands; this follow-up did not reopen or redo that decision, it only
added the one reactive UX read ADR-0030 itself called for.

## 26. Documentation/evidence correction pass (no code change)

After §17–§25 were written, one further commit
(`docs(task-33): record PR #96 rebase + L-01 compatibility audit`) was
pushed to the branch to add this report, the `STATE.md` §13.1 addendum, and
the `docs/security.md`/`frontend/README.md` clarifications. That commit
moved the branch/PR HEAD from `f9477b6` to `487d363` — a documentation-only
change, not a rebase and not an implementation change, so it needed its own
CI confirmation and its own correct evidence trail, which §22's text
originally failed to update after the fact. This section is that correction;
it changes no production code.

**Evidence distinction (do not confuse these three):**

| What | Value | Role |
|---|---|---|
| Historical intermediate commit | `f9477b6b770787cd5745a04323d38481b98c238f` | The L-01 compatibility-fix *implementation* commit (§18–§20). Real work happened here, but it is **not** the current PR HEAD. |
| Current final PR #96 HEAD | `487d363c3bfe397f7480e992dbf6027c9108cbb9` | The actual current branch/PR HEAD, confirmed via `git rev-parse HEAD` and `gh pr view 96 --json headRefOid` at the time of this correction. One documentation-only commit ahead of `f9477b6`. |
| Current PR #96 base | `841b68545b6be36aeb65f523474b4261973875b8` | `main`'s current tip (merge of PR #97 / L-01), confirmed via `git rev-parse origin/main` and `gh pr view 96 --json baseRefName` (PR #96's base branch is `main`, which is at this SHA). |
| Current authoritative CI run | **36831107322** | `.github/workflows/ci.yml`, triggered for commit `487d363`. Confirmed via `gh pr view 96 --json headRefOid` returning `487d363...` and `gh run view 36831107322 --json headSha` returning the same SHA. |
| Historical CI run (superseded) | `36830490998` | Ran against `f9477b6`; valid evidence for that historical intermediate state only, superseded as "current" by `36831107322`. |

**Re-verified repository/PR state at the time of this correction:**

- `git rev-parse HEAD` → `487d363c3bfe397f7480e992dbf6027c9108cbb9`.
- Current branch → `arena/01a0f16d-vardena`.
- `git rev-parse origin/main` → `841b68545b6be36aeb65f523474b4261973875b8`.
- `gh pr view 96 --json headRefOid,baseRefName,state,mergeable,mergeStateStatus`
  → head `487d363c3bfe397f7480e992dbf6027c9108cbb9`, base `main`, state
  `OPEN`, mergeable `MERGEABLE`, merge state `CLEAN`.
- `gh pr checks 96` → `backend` pass (3m7s), `frontend` pass (1m25s), both
  tied to run `36831107322`.
- `gh run view 36831107322 --json status,conclusion,headSha` →
  `{"conclusion":"success","headSha":"487d363c3bfe397f7480e992dbf6027c9108cbb9","status":"completed"}`.
- Backend job steps on that run included Prisma validate, Prisma generate,
  Lint, Typecheck, Format check, Unit tests, Build, Migrate test database,
  Bootstrap system administrator, Migration rehearsal, and **E2E tests
  (incl. live-DB suites)** — all `success`.
- Frontend job steps on that run: Lint, Typecheck, Format check, Tests,
  Build — all `success`.
- Changed-file list for the full PR #96 diff
  (`git diff --stat origin/main..HEAD`, i.e. `841b685..487d363`): the same
  17 files listed in §19, unchanged in count or content by this correction
  pass except for the four documentation files this section itself
  describes (`docs/task-33-organization-first-login-provisioning-report.md`,
  `STATE.md`, `docs/security.md`, `frontend/README.md`). No backend source
  file is part of the diff; `git diff --stat origin/main..HEAD -- backend/`
  is empty.
- No local full E2E re-run was performed for this documentation-only
  correction — not required, since no implementation file changed and the
  already-authoritative CI run `36831107322` remains the valid, current
  evidence for the unchanged implementation.

**Outcome:** this section corrects every place in this report and in
`STATE.md` that previously described `f9477b6`/`36830490998` as the current
PR HEAD/CI evidence. Those two values are preserved above and in §17/§22/§23
strictly as labeled historical references to the intermediate compatibility-
fix commit; they are no longer presented as the current or final state
anywhere in this document.

## Final status

**READY FOR REVIEW** — implementation (original Task 33 scope + the L-01
compatibility fix in §18–§20) is complete, no known defects remain, local
fast verification passed at the time of the implementation commit (frontend:
typecheck/lint/format/unit+component tests/build; backend: full unit suite —
prisma validate deferred to CI per §21). The branch/PR #96 is pushed to
`origin/arena/01a0f16d-vardena` with current HEAD
`487d363c3bfe397f7480e992dbf6027c9108cbb9` against base
`841b68545b6be36aeb65f523474b4261973875b8`; GitHub Actions CI run
**36831107322** passed in full (backend incl. E2E/live-DB suites, and
frontend) on that exact current commit (§26). E2E (including live-DB
suites) is verified via that same, current CI run — not via the superseded
historical run `36830490998`. Documentation
(`docs/task-33-organization-first-login-provisioning-report.md`,
`docs/security.md`, `frontend/README.md`, `STATE.md`) is updated to reflect
the post-L-01 reality and this evidence correction. No production behavior,
backend source, or implementation file changed in this correction pass.
