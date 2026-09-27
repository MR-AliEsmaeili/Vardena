# ADR-0038: Installation bootstrap of the pinned deployment organization and the administrator's membership

Status: Proposed
Date: 2026-09-27

## Context

ADR-0025 pins a deployment to exactly one organization through
`DEPLOYMENT_ORGANIZATION_ID` and deliberately refuses organization creation
through the API while the pin is set: the pinned organization is "bootstrapped
out-of-band". No code implemented that out-of-band step, so a pinned fresh
installation had a configured organization id pointing at no row, and no
documented way to create it other than manual SQL — which the repository's
migration-only database rule and the installation documentation both reject.

Separately, `bootstrap:system-admin` provisioned the administrator `مدیر`, the
`System Administrator` role and every registered permission, but no
`organization.organization_memberships` row. ODR-3 binds organization access to
membership, not to permissions, so the freshly installed administrator held the
complete permission catalog and still received 404 from every organization-scoped
route. In unpinned (ADR-0021) mode that is resolvable through the accepted
first-member grant; in pinned mode it was not resolvable at all, because the
organization itself could not be created.

## Decision

1. **The installation command is the out-of-band step.**
   `OrganizationsService.ensureDeploymentOrganization()` creates at most the
   single row whose id equals the configured pin. It is called only by
   `bootstrap:system-admin`, and it is refused (403) whenever an HTTP request
   context is in flight, so it adds no API surface. ADR-0025's rule that the
   API may not create organizations in pinned mode is unchanged.
2. **Initial identity only.** The row is created with code `MAIN` and name
   `سازمان اصلی`. Operators rename it through the ordinary `Organization.Edit`
   API; re-running bootstrap never overwrites the stored code or name.
3. **Ordinary membership, no bypass.** The bootstrap grants the administrator's
   membership through `OrganizationMembershipsService.grantMembership` — the
   service that owns the table — and treats the existing duplicate-grant
   conflict as the idempotent "already correct" case. There is no username
   check, no role-name check, no wildcard permission and no organization-scope
   exception: the administrator passes `assertOrganizationInScope` because a
   real membership row exists, and loses access the moment it is revoked.
4. **Unpinned deployments invent nothing.** With no pin configured the method
   returns `null`; the administrator creates the first organization through the
   ordinary API and takes the accepted ODR-3 first-member grant, exactly as
   before.
5. **No schema change.** Existing tables, unique constraints and the membership
   composite primary key provide all idempotency guarantees.

## Consequences

- A pinned fresh install is complete after `prisma migrate deploy` +
  `bootstrap:system-admin`: login as `مدیر` reaches organization-scoped APIs
  with no manual SQL and no intermediate API call.
- Repeated installs cannot create a second organization: the row is keyed by the
  configured pin.
- Operators who set the pin must give the same value to the migrate/bootstrap
  service and the API/worker processes (recorded in `docker-compose.yml` and
  `backend/.env.example`).
- This ADR refines ADR-0025's provisioning story only. It does not resolve
  OQ-01/OQ-22 multi-tenancy, does not change ODR-3, and does not establish any
  administrator privilege beyond ordinary RBAC rows.
