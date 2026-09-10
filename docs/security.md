# Vardena — Security Architecture

Status: Accepted (foundation) · Updated: 2026-09-10

Scope: authentication, authorization (RBAC), audit logging, API security,
credential/session policies, integration security. Security **defaults** below
are architectural configuration values (tunable per deployment via config); they
are *not* business rules. Where a value is a business/policy decision, it is
registered as an OQ instead of being assumed.

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

| Aspect | Decision |
|---|---|
| Credential | username + password |
| Password storage | argon2id (memory/time/parallelism tuned for server; salted) |
| Token | opaque random 256-bit, base64url; only the SHA-256 hash is stored |
| Delivery | httpOnly cookie (`vardena_session`), `SameSite=Lax`, `Secure` when HTTPS, `Path=/` |
| Storage | `identity.sessions`: token hash, user, user-agent, IP, created, last-seen, absolute expiry, revoked-at |
| Sliding expiry | idle timeout default **30 min** (config) |
| Absolute expiry | default **12 h** (config) — hard session cap regardless of activity |
| Revocation | user logout, admin revoke (self/any), user deactivation, password change revokes other sessions (keep current configurable) |
| Concurrent sessions | allowed by default; per-user max is config (OQ-06) |
| MFA | deferred; hooks reserved in Users (OQ-06) |

Why not JWT: on-premise ERP needs **revocability** and centralized session
management (admin "kill sessions", deactivation, lockout) without relying on
stateless trust; sessions-in-DB keep the future cloud path simple (stateless
API nodes sharing Postgres). JWTs remain an option for future machine-to-machine
integration APIs (would need an ADR).

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
   `AuthorizationGuard`. The guard answers *before* any controller logic. A
   guarded route that declares nothing **fails closed** (500): it must never
   become an open endpoint.
2. **Application service check** — the application service re-checks the same
   permission(s) through `AuthorizationService.requireAllPermissions`. The
   service layer is the *authoritative* layer; the guard is defense-in-depth and
   the fast path. Several permissions on one route mean **ALL of them** are
   required — there are no permission expressions.
3. **Data-level rules** — e.g. deactivated users cannot authenticate (and their
   sessions are revoked on the `User.Disabled` event); soft-deleted records are
   invisible to reads; permission evaluation always reads current assignments.

**Failure semantics:** no session (or expired/revoked session) → **401
`Unauthorized`**; valid session without the required permission → **403
`PermissionDenied`** with a generic message (the client is never told which
permission it lacks). Inside application services the same rule holds, with one
documented exception: calls that run *outside* an HTTP request (bootstrap/seed,
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
and no `Rbac.Role.Delete` permission in v1 (OQ-20). System roles (if any are
seeded) and the role set itself are a **business decision — OQ-14**; do not
invent them. The first administrator's bootstrap procedure is OQ-19.

**Denial logging:** authorization denials are logged with actor, required codes,
route and correlation id (and are emitted as domain events where a module owns
the action) for security review; the Audit module consumes them when it lands —
this session does not create a parallel audit store.

## 4. Audit Logging (AR-23)

- **What:** who, what, when, from where, and *what changed*:
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
