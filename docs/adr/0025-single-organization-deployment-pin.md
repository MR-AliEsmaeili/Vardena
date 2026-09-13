# ADR-0025: Optional Single-Organization Deployment Pin

Status: Accepted (implemented by Task 9.6, 2026-09-13)
Date: 2026-09-13

## Context

ADR-0021 gives every master-data and ledger row an `organization_id` and
scopes every by-id route to it (structural isolation), but `organizationId`
remains a *caller-supplied parameter*: nothing binds the authenticated
principal to an organization. OQ-01/OQ-22 assume "one organization per
deployment" for v1 while deferring real multi-tenancy and inter-company
settlement. Until the principal binding exists, a deployment that serves
exactly one organization has no enforcement layer proving a caller cannot
name another organization's id — the Task 9.6 tenant-isolation review found
this gap on by-id ledger routes. Full principal→organization mapping is a
later security-architecture decision and must not be invented in a hardening
pass.

## Decision

1. **Opt-in, environment-configured pin.** `DEPLOYMENT_ORGANIZATION_ID`
   (validated as a ULID at boot; empty/unset ⇒ off) names the single
   organization the deployment serves. The pin is explicit deployment
   configuration, NEVER derived from the session/principal — deriving it from
   a principal would be the deferred multi-tenancy feature by another name.
2. **Default off preserves ADR-0021.** With no pin, nothing changes:
   `organizationId` stays caller-supplied and structural scoping is the only
   isolation. Multi-organization test and development boots are unaffected.
3. **One global guard confines every scoped route.**
   `DeploymentOrganizationScopeGuard` is registered as `APP_GUARD`, so new
   organization-scoped routes are confined automatically and cannot forget
   the check. When pinned, every organization id the request names — JSON
   body field, `?organizationId=` query (including repeated values), or the
   marked path parameter on organization-root routes — must equal the pin;
   a mismatch throws 404 `EntityNotFound`, never 403, so the API never
   confirms an out-of-scope organization exists (ADR-0021 §4).
4. **Services enforce the same pin independently.** Scoped service
   lookups go through `mustFindInOrganization`, which asserts the pin before
   the row match; cross-org by-id access is 404 even if a route carried the
   id in an unmarked location. The organizations service lists only the
   pinned row and rejects creating further organizations with 422
   (`businessRule`). Routes that name no organization (login, health, users,
   RBAC) are untouched.
5. **Pinning does not replace structural scoping.** Every row still carries
   `organization_id` and every by-id query remains org-qualified; the pin is
   an additional, deployment-level assertion, not the mechanism that scopes
   queries. Turning the pin off leaves the structural isolation intact.

## Consequences

- A single-organization customer deployment gets verifiable confinement via
  configuration, proven by `test/deployment-scope.e2e-spec.ts` (two-phase
  boot over the same in-memory store: seed app unpinned, serving app pinned)
  and guard-level unit tests.
- The pin is per process/deployment: one database shared by independently
  pinned deployments is NOT supported, and pinning does not isolate
  organizations within one process (that is the deferred OQ-01/OQ-22 work).
- A misconfigured pin (id that does not exist) yields a running app whose
  scoped routes 404; boot validation checks the ULID shape only — existence
  is observable immediately through the API and needs no extra subsystem.
- When principal→organization binding is finally designed (multi-tenancy),
  this guard is removed or narrowed to a deployment-shape assertion; the
  service-level `mustFindInOrganization` checks remain valid either way.
- Documents and workflow services already enforced organization scoping and
  needed no change; the pin does not weaken any authorization or validation
  rule (AG-12).

## Links

- Builds on: ADR-0020, ADR-0021 (structural scoping); same 404 posture: ADR-0022
- Defers: OQ-01, OQ-22 (principal→organization binding, multi-tenancy, inter-company)
- Config: `src/kernel/config/app-config.ts` (`deploymentOrganizationId`)
- Tests: `test/deployment-scope.e2e-spec.ts`,
  `src/modules/organization/application/deployment-scope.guard.spec.ts`
