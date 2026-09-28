# 0021 — Organization-scoped master data (every master-data row carries `organization_id`)

- **Status:** Proposed
- **Date:** 2026-09-11
- **Supersedes:** — (refines ADR-0020, which is still Proposed)
- **Implements:** Task 6 — Organization & Master Data Foundation

## Context

Task 6 creates the first business tables: `organization.{organizations, branches,
departments, employees, parties}` and `inventory.{units, unit_conversions,
item_unit_conversions, item_groups, items, warehouses}`.

Every one of them carries an `organization_id` column, a unique business key
scoped by organization, an index on `(organization_id, …)` for every list query,
and a foreign key to `organization.organizations`.

That shape contradicts two _open_ questions:

- **OQ-22** assumes "one organization per deployment" as the interim position,
  with branch as a scope dimension of the same books, and says multi-company is
  deferred to its own ADR.
- **OQ-01** (and the multi-company deferral in ADR-0020) leaves open whether one
  database will ever host more than one legal entity.

So the decision has to be recorded rather than taken silently: Task 6 either
builds the tables with `organization_id` now, or it builds them without and
rewrites every table later.

## Decision

**Every master-data table is organization-scoped from the first migration.**

1. `organization_id` is `NOT NULL` on all eleven tables and references
   `organization.organizations(id)` with `ON DELETE RESTRICT`.
2. Business keys are unique **per organization**:
   `UNIQUE (organization_id, code)` — with the exception of
   `organization.organizations.code`, which is unique deployment-wide because it
   _is_ the organization identity.
3. Every list endpoint requires an explicit `organizationId`. There is no
   endpoint that returns master data across organizations, and no query that
   omits the scope.
4. Cross-organization **references** are rejected in the application service with
   `404 EntityNotFound`, not `422`: a branch in another organization is reported
   as not found, so one tenant cannot probe another's rows into existence. A
   foreign key cannot express "same organization" — it only proves the row
   exists — so the check belongs to the service.
5. Cross-schema foreign keys (`inventory.* → organization.organizations`) are
   allowed and follow the existing precedent of `identity.sessions → users.users`.

### What this decision is NOT

- It does **not** decide multi-company. Nothing here makes two legal entities in
  one database correct: shared chart of accounts, separate books, consolidation
  and inter-company settlement (OQ-22, OQ-31) are all still open.
- It does **not** implement tenant isolation. There is no principal→organization
  binding anywhere in the system, so no request is _restricted_ to one
  organization. Isolation here is **structural**: the scope is an explicit,
  mandatory parameter, and references cannot cross it. Enforcement — deriving the
  caller's organization from the principal and rejecting anything else — is a
  later, separate decision (OQ-01/OQ-22).
- It does **not** change ADR-0020's ownership table, which places
  Unit/UnitConversion/ItemGroup/Item/Warehouse in the **Inventory** module and
  Organization/Branch/Department/Employee/Party in the **Organization** module.

## Consequences

**Positive**

- Adding a second organization later is a data change, not a migration: no column
  has to be added to eleven tables and no unique key rewritten.
- Every list query is indexed on its leading scope column from day one, so the
  indexes do not have to be rebuilt when the scope starts to matter.
- The "which organization is this row in" question is answerable for every row,
  which audit and reporting need regardless of the multi-company outcome.

**Negative / cost**

- Every service call carries an `organizationId`, and every cross-module
  reference check needs one (`requireUsable*InOrganization`). That is real
  repetition across ten services.
- Structural scope is not security. Until a principal→organization binding
  exists, any authenticated principal holding the right permission may pass any
  `organizationId` it likes. This is acceptable while the deployment hosts one
  organization, and it must not be mistaken for tenancy.

**If the decision is reversed** (one organization per deployment, permanently) the
column becomes a constant and the unique keys could drop the scope — a strictly
additive migration in reverse. Reversing later is therefore cheaper than
postponing the column now, which is why the column is added first.

## Alternatives considered

- **No `organization_id` (defer until multi-company is decided).** Rejected:
  eleven tables would need a backfilled `NOT NULL` column plus rewritten unique
  keys and indexes, and every repository/service/controller would change again.
  The cost of carrying the column now is one parameter per call.
- **An `organizations` row created implicitly by a bootstrap seed.** Rejected:
  the brief forbids permanent "Admin organization / Test Company" assumptions,
  and there is no established seeding convention (AG-19). The table starts empty
  and the first organization is created through the API by a principal that
  already holds `Organization.Organization.Create`.
- **Deriving the caller's organization from the principal now.** Rejected: that
  requires deciding how a principal is bound to an organization (users are
  deployment-level today and hold no organization), which is exactly the open
  question. Implementing it would mean inventing the answer.

## Related

- ADR-0008 (ULID primary keys, per-module schemas)
- ADR-0020 (organizational scope and master-data ownership) — Proposed
- `docs/architecture/domain/master-data-strategy.md` §1 (module ownership), §5
  (party), §7.4 (lifecycle)
- OQ-01, OQ-22 (organizational scope), OQ-31 (inter-company), OQ-36 (deletion)
