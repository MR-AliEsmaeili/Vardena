-- Organization module: principal → organization membership (Task 19, ODR-3).
--
-- Module + intent (docs/database-strategy.md §2): `organization` module — the
-- smallest Organization-owned binding that makes organization authorization
-- principal-bound: a caller must hold a membership of an organization before
-- any organization-scoped data path may resolve it for them, so a module
-- permission plus an arbitrary `organizationId` can no longer cross
-- organizations (the Task 19 investigation's finding S-1).
--
-- Design notes:
--   * COMPOSITE primary key (user_id, organization_id), exactly as
--     `rbac.user_roles`: the database itself makes a duplicate grant
--     impossible, so the application never relies on a read-then-write
--     uniqueness check.
--   * CASCADE on the user relation — a membership is not a business record
--     and must not outlive the user it references (same reasoning as
--     `rbac.user_roles`; users are soft-deleted in practice, so the cascade is
--     a safety net, not the normal path).
--   * RESTRICT on the organization relation — an organization row can never
--     disappear under its memberships (every other `organization_id` FK in
--     the repository is RESTRICT too).
--   * Presence IS the authorization. No `is_active`, no role column, no
--     validity window: the full membership model (per-organization roles,
--     deactivation, effective dating) stays future work under OQ-01/OQ-22,
--     and running two competing lifecycle mechanisms is what
--     master-data-strategy.md §7 forbids.
--   * NO backfill. Which principals may access which existing organizations
--     is an operational grant decision, not a schema fact; deployments grant
--     memberships explicitly after upgrading. The table starts empty.
--   * No CHECK constraints (not representable in the Prisma schema; a later
--     `prisma migrate dev` would emit a DROP for each one).

-- ---- `organization.organization_memberships` -------------------------------
CREATE TABLE "organization"."organization_memberships" (
    "user_id"         TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    CONSTRAINT "pk_organization_memberships_user_organization"
        PRIMARY KEY ("user_id", "organization_id"),
    CONSTRAINT "fk_organization_memberships_user"
        FOREIGN KEY ("user_id") REFERENCES "users"."users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_organization_memberships_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The principal-side lookup (user_id, organization_id) is the composite
-- primary key itself; this index serves the organization-side listing.
CREATE INDEX "idx_organization_memberships_organization_id"
    ON "organization"."organization_memberships" ("organization_id");
