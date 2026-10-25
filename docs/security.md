# Vardena — Security Architecture

Status: Accepted (foundation) · Updated: 2026-09-27

Scope: authentication, authorization (RBAC), audit logging, API security,
credential/session policies, integration security. Security **defaults** below
are architectural configuration values (tunable per deployment via config); they
are _not_ business rules. Where a value is a business/policy decision, it is
registered as an OQ instead of being assumed.

## Official Developer License authority (2026-10-25)

The offline Developer License boundary is specified in
[ADR-0053](adr/0053-official-offline-developer-license.md) and the
[operational/security guide](licensing/developer-license.md). The target runtime
contains only dedicated Ed25519 **public** trust configured through
`DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS`; acceptance is separately gated by
`DEVELOPER_LICENSES_ENABLED=false` by default in every environment. Commercial
and developer trust may not overlap commercial key IDs or Ed25519 key material.

The issuer is a `dist-tools` artifact, excluded from production `dist` and the
customer Docker image. It reads a private key only from a filesystem path whose
POSIX mode or Windows DACL it can validate, uses exclusive no-overwrite writes,
self-verifies output, and never prints private material or signed license bytes.
Private keys and real licenses must not enter Git, databases, frontend bundles,
logs, APIs, environment variables, tickets, or chat. VDEV1 is bound to one
backend-owned installation and uses the existing authenticated import, replay,
transaction, audit, RBAC, limit, and entitlement enforcement chain.

> **Licensing product-policy cross-reference (2026-10-15):**
> [PDR-11 §§9–10, 12 and 20](decisions/product/PDR-11-vardena-licensing-product-requirements.md)
> approves distinct expiry, emergency and integrity reasons, independent approved
> administrator authentication for restricted recovery, automatic rollback-only
> clearance after trusted-time revalidation, permanent separate audit archive and
> key-compromise non-automatic-invalidation policy. The foundation/session model
> below describes existing runtime, not implemented emergency enforcement.
> Required session/recovery/incident/archive mechanisms need security design;
> no commercial access bypass, cryptographic immutability or safe compromised-key
> handling is claimed. Read-Only preserves normal authorized login/read access;
> ordinary renewal/clock repair must not clear an independent emergency stop.

## 1. Threat Model & Boundaries

- v1 deployment: single organization per installation (on-premise / local
  network). Multi-tenancy is **not** designed for yet — see OQ-01. The schema
  deliberately omits `organization_id` from core tables; introducing tenancy
  later is an ADR + schema migration, not an afterthought field.
- Trust boundary: the browser is **untrusted**. The Vardena API is the single
  backend of the SPA; external systems (legacy ERP, tax, payments) are outside
  the trust boundary and reached only by the backend worker through adapters
  (AR-18/19).
- Transport: HTTPS strongly recommended. For plain-HTTP local networks, the
  cookie `Secure` flag follows configuration; the risk is documented per
  deployment. (OQ-06 covers the deployment TLS posture.)

## 2. Authentication (ADR-0007)

**Mechanism: server-side opaque sessions.**

| Aspect              | Decision                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Credential          | username + password                                                                                                         |
| Password storage    | argon2id (memory/time/parallelism tuned for server; salted)                                                                 |
| Token               | opaque random 256-bit, base64url; only the SHA-256 hash is stored                                                           |
| Delivery            | httpOnly cookie (`vardena_session`), `SameSite=Lax`, `Secure` when HTTPS, `Path=/`                                          |
| Storage             | `identity.sessions`: token hash, user, user-agent, IP, created, last-seen, absolute expiry, revoked-at                      |
| Sliding expiry      | idle timeout default **30 min** (config)                                                                                    |
| Absolute expiry     | default **12 h** (config) — hard session cap regardless of activity                                                         |
| Revocation          | user logout, admin revoke (self/any), user deactivation, password change revokes other sessions (keep current configurable) |
| Concurrent sessions | allowed by default; per-user max is config (OQ-06)                                                                          |
| MFA                 | deferred; hooks reserved in Users (OQ-06)                                                                                   |

Why not JWT: on-premise ERP needs **revocability** and centralized session
management (admin "kill sessions", deactivation, lockout) without relying on
stateless trust; sessions-in-DB keep the future cloud path simple (stateless
API nodes sharing Postgres). JWTs remain an option for future machine-to-machine
integration APIs (would need an ADR).

**Session continuity (L-02).** There is no separate access token to refresh:
the opaque session *is* the credential, and continuity comes from the sliding
idle deadline. Every authenticated request pushes `last_seen_at` forward
(`SessionsService.touch`), so ordinary continuous use never signs a user out
before the absolute cap; only real inactivity beyond the idle timeout, an
explicit revocation, or the absolute cap ends it, and each of those requires a
genuine login afterwards. The cookie carries the **absolute** lifetime as its
`Max-Age` (Express takes milliseconds there — a bug that divided it by 1000
expired the browser cookie after ~43 s of a 12 h session and produced
spurious "logged out" reports). Both timeouts stay configurable
(`AUTH_SESSION_IDLE_TIMEOUT_MS`, `AUTH_SESSION_ABSOLUTE_TIMEOUT_MS`); the
defaults above are the security baseline, not a workaround. Licensing is an
independent state machine: an expired or inactive installation license never
ends a session and never forces a login (`docs/licensing-architecture.md`).

**Login flow:** verify credentials → create session row → set cookie → return
user + effective permissions (for UI bootstrapping; UI checks are UX-only,
AR-21). **Lockout:** N (default 5) consecutive failed logins → lockout for
default 15 min (config); lockout state + `Login.Failed` events are audited.
Password **reset** is admin-initiated (Users module) in v1; self-service reset
via email is deferred (needs email infra — OQ-15).

## 3. Authorization — RBAC (ADR-0006)

**Model:** users → roles → permissions. Permissions are **granular** codes:

```
<Module>.<Entity>.<Action>     e.g. Inventory.Receipt.View
```

- `Module`: module name (Inventory, Sales, Accounting, Rbac, Audit, …).
- `Entity`: business entity in that module (Receipt, Invoice, Journal, Role…).
- `Action`: `View`, `Create`, `Edit`, `Delete` plus domain actions
  (`Post`, `Approve`, `Import`, `Export`, `Print`, `Sync`, `Manage`, …).
  Domain actions are defined per module as needed — they are part of the module's
  permission registry, not free-form strings.

**Source of truth:** each module registers its permissions **in code** (a
permission registry with code, description, scope notes). A startup/migration
sync mirrors the registry into `rbac.permissions` so the admin UI can manage
roles without free-text permission entry. Consequence: a permission that no code
checks cannot exist (prevents "DB-only permissions" that are never enforced).

**Enforcement layers (all backend, AR-21, ADR-0016):**

1. **Route guard** — declarative: every controller method declares required
   permission(s) via `@RequirePermission(...)` and applies `AuthGuard` +
   `AuthorizationGuard`. The guard answers _before_ any controller logic. A
   guarded route that declares nothing **fails closed** (500): it must never
   become an open endpoint.
2. **Application service check** — the application service re-checks the same
   permission(s) through `AuthorizationService.requireAllPermissions`. The
   service layer is the _authoritative_ layer; the guard is defense-in-depth and
   the fast path. Several permissions on one route mean **ALL of them** are
   required — there are no permission expressions.
3. **Data-level rules** — e.g. deactivated users cannot authenticate (and their
   sessions are revoked on the `User.Disabled` event); soft-deleted records are
   invisible to reads; permission evaluation always reads current assignments.

**Organization-scoped data (ODR-3):** every organization-scoped read and write
passes through `OrganizationsService.assertOrganizationInScope` (directly or
through an established resolver). The chokepoint applies the deployment pin and,
for HTTP request context, binds the authenticated principal to an ordinary
organization-membership row. An unknown, unpinned, or non-member organization
answers **404 `EntityNotFound`**; changing a caller-supplied `organizationId`
cannot widen scope. Task 26 completed the 37 read surfaces identified by Task 25
SEC-01. Permission checks remain independent and run before the scope assertion:
access requires **the required permission AND valid organization scope**. The
existing globally registered `DeploymentOrganizationScopeGuard` remains
defense-in-depth; no second guard or authorization model is used.

**Failure semantics:** no session (or expired/revoked session) → **401
`Unauthorized`**; valid session without the required permission → **403
`PermissionDenied`** with a generic message (the client is never told which
permission it lacks). Inside application services the same rule holds, with one
documented exception: calls that run _outside_ an HTTP request (bootstrap/seed,
worker, tests) are **system context** where authorization is the caller's
concern — HTTP requests always carry a context and can never use that path.

**Evaluation and caching (ADR-0016):** permission checks read
`rbac.user_roles → rbac.role_permissions → rbac.permissions` on every request.
There is **no cache in v1** — immediate revocation is worth one indexed join, and
a cache would need an explicit invalidation contract (on `Role.Updated`,
`RolePermission.*`, `UserRole.*` and session disable/revoke); a shared cache is
new infrastructure and needs an ADR.

**Frontend:** permissions drive UI visibility (buttons, menus, routes). This is
convenience only — **never** a security boundary. The frontend fetches effective
permissions at login (`GET /api/v1/permissions/effective`, a documented AR-21
exception: authenticated, no permission code, returns only the caller's own
codes) and refetches on RBAC change events.

**Role administration:** roles are created, renamed and given/removed
permissions and users through the RBAC endpoints; there is **no role deletion**
and no `Rbac.Role.Delete` permission in v1 (OQ-20). PR #64's merged
implementation (work item **READY FOR REVIEW — NOT ACCEPTED**) provisions one
installation role named `System Administrator`
and reconciles it to every permission in the current code registry. It uses
ordinary `roles`, `role_permissions`, and `user_roles` rows: role names have no
runtime semantics, and there is no wildcard or administrator bypass. This is an
implementation fact, not a new Owner Decision or complete role policy. OQ-14
remains OPEN for occupational roles (Accountant, Warehouse, Sales, Auditor, and
so on), their permission baselines, auditor/administrator separation, and
future role permission baselines.

**Future permission reconciliation contract (registry-driven, Task 26
follow-up).** `مدیر` is the default system administrator and receives
administrative authority through the ordinary `User → Role → Permission` model
only. The `System Administrator` role represents the _complete currently
registered_ application permission catalog, and that catalog is derived from
code:

```text
New module / feature
        ↓
Permission declared in the module's canonical PermissionRegistry registration
        ↓
Canonical application permission catalog (PermissionRegistry → rbac.permissions)
        ↓
System Administrator reconciliation (SystemAdministratorRbacService.ensureForUser)
        ↓
مدیر receives the permission through the ordinary role assignment (user_roles)
```

_Fresh installation._ `prisma migrate deploy` then `npm run bootstrap:system-admin`
creates/adopts `مدیر`, creates/adopts the `System Administrator` role, mirrors
the registry into `rbac.permissions`, grants every registered code to the role,
assigns the role to `مدیر`, and adds the organization membership required by the
deployment mode (see the bootstrap paragraph below).

_Existing installation, new module deployed._ The same reconciliation resolves
`PermissionRegistry.all()` again and inserts only the missing
`role_permissions` rows on the existing role — nothing is removed, so
operator-granted extra permissions on that role survive. **This is not a runtime
effect:** the new permission reaches `مدیر` when the deployment runs
`npm run bootstrap:system-admin` (Docker Compose runs it in the `migrate`
service; CI runs the same built command). No manual modification of the `مدیر`
user, role, or any administrator permission list is required or permitted.

_Developer rule for a new protected capability_ — for example
`Sales.Invoice.Export`:

1. Define the permission in the module's canonical permission registry
   (`*-permissions.ts` definitions, AR-22).
2. Register it through the existing module registration class
   (`…PermissionRegistration` → `PermissionRegistry`), so it enters the
   canonical catalog and the `rbac.permissions` mirror.
3. Protect the route with `@RequirePermission(...)` **and** re-check it in the
   application service (AR-21).
4. Add authorization tests, including a denial test.
5. Do **not** add the code to any special `مدیر` permission list — no such list
   exists and none may be created.
6. Do **not** maintain a hardcoded administrator permission count anywhere.
7. Do **not** write a username-specific rule such as
   `if (user.username === 'مدیر')`.
8. Do **not** introduce wildcard permissions (`*`, `Admin.*`, `Module.*`).
9. The existing System Administrator reconciliation makes the permission
   available to `مدیر` on the next bootstrap run — that is the only supported
   mechanism.

_Explicitly prohibited_ as authorization mechanisms, now and in future modules:
`if (user.username === 'مدیر')`; `if (role.name === 'System Administrator')`;
a manually maintained `ADMIN_PERMISSIONS = [...]`; a hardcoded permission count
as an architectural contract; wildcard permission codes; an administrator-only
guard, interceptor or service bypass; an `isSystemAdmin`/superuser flag; or a
second administrator authorization subsystem. The `user_roles →
role_permissions → permissions` relationship remains the single source of
truth, and role names and usernames carry no runtime authority.

**First-administrator bootstrap (PR #64 merged implementation; F-12 secure
initial credential & mandatory first-login password change):**
after migrations, `npm run bootstrap:system-admin` creates the real Users-domain
account `مدیر` using the explicit `BOOTSTRAP_SYSTEM_ADMIN_PASSWORD` environment
variable (8–128 characters, never hardcoded), hashing the password through the
existing Argon2id `PasswordService` and setting `mustChangePassword = true`,
then assigns `System Administrator`. If `مدیر` does not exist yet and
`BOOTSTRAP_SYSTEM_ADMIN_PASSWORD` is missing or invalid, the bootstrap command
fails safely before writing any user record. Once `مدیر` exists, the command is
idempotent: it requires no bootstrap password to start or re-run, creates no
duplicate user/role/assignment/membership, adds newly registered permissions on
later deployment runs, and never resets an existing user's password,
`mustChangePassword` flag, or lifecycle state — a disabled or soft-deleted
`مدیر` is never silently reactivated; the command fails loudly instead (Task 26
closure). Docker Compose runs it in the `migrate` service; CI runs the same
built command against PostgreSQL. There is no bootstrap HTTP endpoint.
Self-disable protection, self-role-removal protection, and last-administrator
lockout protection remain OPEN (OQ-19). The bootstrap does not invent
or hardcode an organization. Its organization behaviour depends on the
deployment shape (ADR-0025):

- **Pinned deployment (`DEPLOYMENT_ORGANIZATION_ID` set).** The bootstrap
  command provisions that exact organization row if it does not exist yet (the
  ADR-0025 "bootstrapped out-of-band" step, refused inside any HTTP request) and
  creates `مدیر`'s ordinary `organization.organization_memberships` row through
  the owning service. The administrator therefore authorizes organization-scoped
  APIs through the normal ODR-3 membership check, with no bypass, no second
  organization on re-runs, and no manual SQL. An existing membership is left
  alone; other memberships are never removed or replaced.
- **Unpinned deployment (default, ADR-0021 structural mode).** No organization
  is invented. The administrator creates the initial organization through the
  ordinary API and then grants their own membership through the existing
  empty-organization first-grant rule; until that membership exists, ODR-3 still
  returns 404 from organization-scoped paths despite the full RBAC role. The
  frontend's organization gate (`OrganizationGate` /
  `CreateFirstOrganizationForm`, `docs/task-33-organization-first-login-provisioning-report.md`)
  surfaces exactly this two-call sequence as a small form when the session
  holds both
  `Organization.Organization.Create` and `Organization.Membership.Grant`; a
  session without both codes still sees the unchanged terminal "no organization
  available" explainer. The backend contract, the permission checks, and the
  first-member exception are unchanged — the frontend adds no new endpoint, no
  bypass, and no client-side organization state.
  `OrganizationsService.createOrganization` is additionally gated by the
  installation License (ADR-0030, `docs/licensing-architecture.md`): an
  active license and an entitled `organization` module are required, and
  organization creation is further limited by the license's organization
  count (server-side, inside the same transaction as the count-and-create —
  never a frontend count comparison). `AuthorizationService.
  effectivePermissionCodes` already filters `Organization.Organization.Create`
  / `Organization.Membership.Grant` out of the effective set whenever the
  license disallows them, so the gate above is license-aware without any
  frontend licensing logic; the one additional frontend behavior is a
  read-only check of the authenticated `GET /license/current` self-read
  (no RBAC permission required) used solely to show an accurate "license is
  not active" explainer instead of a misleading "you lack permission" one —
  it enforces nothing and the backend check above is unaffected by it.

Authorization stays `required permission AND organization membership`: removing
one permission from the `System Administrator` role denies exactly that
operation (403), and removing the membership denies organization-scoped reads
(404). Neither the username `مدیر` nor the role name carries any authority. When
`mustChangePassword = true`, the server-side authentication/authorization guards
quarantine the session to `GET /api/v1/auth/me`,
`POST /api/v1/auth/change-password`, and `POST /api/v1/auth/logout` until the
user completes a self-service password change (which verifies `currentPassword`,
stores a new Argon2id hash, clears `mustChangePassword`, and revokes all other
sessions for that user while keeping the current session active).

**F-12 concurrency correction ([ADR-0047](adr/0047-atomic-self-service-credential-transition.md)):**
self-service password/flag updates and other-session revocation now share one
transaction. Users locks/revalidates its credential row; Identity locks/checks
the initiating session's owner, revocation and expiry before committing session
effects. A stale credential or invalidated initiating session returns 401; no
partial password, flag or session write survives a refusal or transaction
failure. Login session creation uses the same credential lock, and request
authentication rechecks the session after reading user state. The current
session survives a successful change; passwords/hashes/tokens never enter the
response or lifecycle event. Events remain post-commit, in-memory notifications,
not a durable audit store. This atomic guarantee does not extend the existing
administrator-reset/event-consumer flow or cancel already-authorized in-flight
requests. Existing accounts' bootstrap state is not retroactively rewritten.


**Organization membership boundary (ODR-3, Task 19):** organization-scoped
access is principal-bound. A module permission alone NEVER crosses
organizations: every organization-scoped read and write passes through
`OrganizationsService.assertOrganizationInScope` (deployment pin → principal
→ membership), so a caller without a membership row gets **404**,
indistinguishable from an unknown organization id (the approved isolation
posture — no existence leak via 403). Memberships are granted and revoked
through `GET/POST/DELETE /api/v1/organizations/:id/members` under
`Organization.Membership.{View,Grant,Revoke}`; presence IS the authorization
(no per-org roles, no wildcard).

**Membership ADMINISTRATION is organization-bound too** (ODR-3, corrected
post-merge — the first Task 19 implementation bound only the data paths and
deliberately exempted the grantor, which was a cross-organization
authorization bypass on the administration surface). The rule now:

| Target organization           | Required of the acting principal                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **has ≥ 1 member**            | authenticated **+** member of that organization **+** the operation's permission (`Membership.View` to list, `Membership.Grant` to grant, `Membership.Revoke` to revoke) |
| **has 0 members** (bootstrap) | authenticated **+** `Organization.Membership.Grant` — may create the **FIRST** membership only; list and revoke stay membership-bound                                    |

The bootstrap exception is the only case in which a permission alone is
authority over an organization, it is confined to the first `POST
/organizations/:id/members` of an organization whose membership set is empty
(an existence probe, `OrganizationMembershipsRepository.hasAnyMember`), and it
closes as soon as one member exists. If the last member revokes themselves the
set becomes empty again and the organization re-enters bootstrap — accepted,
and still not a standing bypass, because every non-first operation re-checks
the acting principal's membership. Order per request: authentication →
permission → deployment pin → membership → business operation; a non-member
always receives **404**, never 403 and never "exists but forbidden". The full
membership model (per-organization roles, deactivation, effective dating)
remains OQ-01/OQ-22.

**Denial logging:** authorization denials are logged with actor, required codes,
route and correlation id (and are emitted as domain events where a module owns
the action) for security review; the Audit module consumes them when it lands —
this session does not create a parallel audit store.

## 4. Audit Logging (AR-23)

- **What:** who, what, when, from where, and _what changed_:
  (actor id + type [user/system], action, module, entity type + id, before/after
  JSONB snapshots, correlation id, IP, user-agent, timestamp).
- **Where:** `audit.audit_logs`, append-only. No update/delete API; DB-level
  hardening (dedicated role without UPDATE/DELETE) as a later hardening step.
- **How:** modules call the kernel audit port **inside the business transaction**
  so audit and change commit together. For events that are not direct writes
  (denials, dead-letters), Audit consumes the events.
- **Who is audited (v1 list):** user management, RBAC changes, authentication
  events (login success/fail, lockout, session revoke), all accounting writes
  (posting, period close, manual journals), inventory movements, sales document
  lifecycle, import session apply, print jobs (admin), template changes,
  integration admin actions (credentials, retry/cancel), report exports of
  sensitive reports (flagged per report definition).
- **Access:** `Audit.Log.View` / `Audit.Log.Export` permissions; intended to be
  granted to a dedicated auditor role separate from admin (OQ-14 role set).
- **Retention/archival:** OQ-17.

## 5. API Security (AR-24)

- **Validation at the edge:** every request body/query validated by typed DTOs
  (class-validator); unknown fields rejected on strict endpoints (write paths
  default strict). Frontend mirrors with Zod.
- **Error safety:** errors return `{ code, message, details?, correlationId }` with stable
  machine codes; **no** stack traces, SQL, file paths, or internal ids beyond
  what the entity contract exposes.
- **Rate limiting:** global per-IP throttle (NestJS throttler) with defaults
  (e.g. 300 req/min/IP, burst config); **stricter** on auth endpoints (e.g.
  10/15 min/IP on login) in addition to lockout; per-user limits on heavy
  endpoints (report execution, exports). Values are config, not rules.
- **Pagination caps:** `pageSize` default 100, hard max 500; report rows capped
  per `docs/reporting-strategy.md` §Performance.
- **Upload limits:** import file size cap (config, default 10 MB v1) + type
  validation (xlsx only); parsed content processed by the Excel module only.
- **CORS:** same-origin only (SPA served from the API host or a configured
  origin allowlist); no `*` in production.
- **Headers:** standard hardening (CSP matching the SPA's asset origins,
  X-Content-Type-Options, Referrer-Policy, HSTS when HTTPS).
- **CSRF:** mitigated by `SameSite=Lax` + same-origin CORS for the v1 SPA;
  re-evaluate if cross-origin SPAs or browser extensions enter the threat model
  (hardening note, not a v1 blocker).
- **Correlation ids:** every request gets a correlation id (client-supplied if
  valid format, else server-generated); propagated into logs, audit rows,
  domain events, and outbox rows — end-to-end traceability.

## 6. Secrets & Configuration

- All secrets (DB password, session signing n/a — opaque tokens, integration
  credentials, storage keys) via **environment variables / config**, never in
  the repo, images, or logs (AR-20, AG-12).
- Integration credentials additionally **encrypted at rest** (envelope key from
  config) — see `docs/integrations.md` §Credentials.
- Config is per-deployment (compose env / env file outside the image); a
  `config.schema` documents every key with default and required-ness (part of
  the first implementation).

## 7. Integration Security (summary — full: docs/integrations.md)

- Outbound: only the worker calls external systems, through adapters, with
  timeouts, bounded retries (outbox), and no secrets in logs.
- Inbound (external → Vardena, where a system pushes): receive endpoints are
  permission-protected by **adapter-level credentials** (per-adapter token/mTLS,
  not user sessions), validated, idempotent, and rate-limited; they translate to
  idempotent commands into business modules (never direct writes).
- Least privilege: each adapter holds only the credentials its system needs.

## 8. Data Protection

- PII in v1 is limited to user profile fields; no credit-card-like data in v1
  scope (payment integration specifics pending — OQ-07).
- Backups: see `docs/database-strategy.md` §Backups; backup encryption at rest
  is deployment policy (OQ-17 adjacent).
- Generated artifacts (PDFs, import files): stored on a volume with strict
  permissions; download endpoints are permission-gated per document type;
  artifact retention default 30 days (config).

## 9. Feature Security Checklist (for every new feature/endpoint)

1. Permission code defined in the module registry? (AR-22)
2. Guard + service-level check + denial test? (AR-21)
3. Inputs validated with DTO (+ FE Zod mirror)? (AR-24)
4. Sensitive write → audit port in-transaction? (AR-23)
5. External side effect → outbox row, not direct call? (AR-14)
6. Response shape leaks nothing internal? (AR-24)
7. Rate-limit/pagination/upload caps appropriate for the endpoint? (AR-24)
8. Any new secret → config/env only, encrypted at rest if integration credential?
9. Docs updated (module section + permission list) + ADR if architectural? (AG-07)

### 9.1 RBAC / System Administrator evolution check (every new protected capability)

- [ ] Every new protected capability has an explicit permission.
- [ ] The permission is registered in the module's canonical permission registry.
- [ ] The permission is included in the canonical application permission catalog
      (`PermissionRegistry` → `rbac.permissions` mirror).
- [ ] The endpoint/controller has the normal `@RequirePermission(...)` guard.
- [ ] The application service performs the authoritative permission check.
- [ ] Authorization tests exist (grant **and** denial).
- [ ] No separate permission assignment for `مدیر` was introduced.
- [ ] No username-based administrator bypass was introduced.
- [ ] No wildcard permission was introduced.
- [ ] The System Administrator receives the permission through the existing
      registry/reconciliation mechanism (§3, "Future permission reconciliation
      contract") — i.e. by re-running `npm run bootstrap:system-admin` at
      deployment, not by editing any list.
