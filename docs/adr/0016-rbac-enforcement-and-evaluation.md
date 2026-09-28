# ADR-0016: RBAC Enforcement and Evaluation

Status: Accepted (refines ADR-0006 — permission caching)
Date: 2026-09-10

## Context

ADR-0006 fixed the model (users → roles → permissions, code registry as the
source of truth, backend-only enforcement) and said evaluation is "cached per
session and invalidated on RBAC changes". The first RBAC implementation must pin
how _every_ endpoint is enforced, what happens when an endpoint forgets to
declare a permission, how multiple permissions are combined, and how revocation
behaves — before several modules start consuming the authorization service.

## Decision

1. **Two layers, one authority.** The route declares `@RequirePermission(...)`
   and applies `AuthGuard` + `AuthorizationGuard`; the application service
   re-checks the same codes through `AuthorizationService.requireAllPermissions`.
   The guard is defense-in-depth and the fast path; the service layer is
   authoritative (AR-04/AR-21).
2. **Fail closed.** A guarded route without a declared permission is a
   programming error and returns 500 — it must never become an open endpoint.
3. **401 vs 403.** Missing/invalid session → 401 `Unauthorized` (Identity).
   Valid session without the required permission → 403 `PermissionDenied` with a
   generic message (the client is not told which permission it lacks, AR-24).
4. **Multiple permissions mean ALL of them.** There is no "any" policy on a
   route, no permission expressions, no role inheritance and no wildcards
   (wildcard/superuser semantics are OQ-21).
5. **No permission cache in v1.** Evaluation reads `rbac.user_roles →
rbac.role_permissions → rbac.permissions` on every authenticated request.
   Correctness and immediate revocation beat a premature optimization: with no
   cache there is nothing to invalidate, and "remove a permission" takes effect
   on the requester's _current_ session (proven by e2e tests). If a cache is ever
   added it must be invalidated on `Role.Updated`, `RolePermission.*`,
   `UserRole.*` **and** on session revocation/disable, and a shared store (e.g.
   Redis) is new infrastructure — a new ADR, not a config flag.
6. **System context.** Application services are callable outside an HTTP
   request (bootstrap/seed, worker, tests). With no request context the
   authorization check is the caller's concern; with a request context but no
   authenticated principal the service throws 401. HTTP paths are therefore
   never silently authorized.
7. **Self-scoped reads are the documented exception.** `GET
/api/v1/permissions/effective` is authenticated but declares no permission
   code: it returns the caller's own effective codes for UI bootstrapping
   (AR-21 exception, recorded in the route docs).

## Consequences

- Every new endpoint must declare a permission code from its module's registry;
  codes are mirrored into `rbac.permissions` at startup (no code exists without
  an enforcement point).
- Authorization costs one indexed join per request. Acceptable for the
  on-premise single-replica target; revisit with measurements (point 5).
- Permission changes are visible immediately, including to the session that is
  being changed — no invalidation bugs, no stale-access window.
- Denials are logged (actor, required codes, route, correlation id) as domain
  events/structured logs until the Audit module lands; no parallel audit store
  is created here.
