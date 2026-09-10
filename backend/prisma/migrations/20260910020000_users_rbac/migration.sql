-- RBAC: roles, permissions, role ↔ permission and user ↔ role assignments.
--
-- Module + intent (docs/database-strategy.md §2): `rbac` module — create the
-- tables behind roles, the permission mirror, and the two assignment tables.
--
-- Design notes:
--   * `rbac.permissions` is the DB mirror of the code-defined permission
--     registry (ADR-0006, AR-22). Permissions are *not* creatable through the
--     API: a permission no code checks must not be able to exist.
--   * `rbac.role_permissions` and `rbac.user_roles` use composite primary keys,
--     so a duplicate assignment is impossible at the database level (§26) —
--     the application never relies on a read-then-write uniqueness check.
--   * Both assignment tables cascade on delete. An assignment is not a
--     business record: it must not be able to outlive the role, permission, or
--     user it references (no orphans).
--   * No role inheritance, no permission inheritance, no wildcard semantics
--     (docs/security.md §3; OQ-14 keeps the role *set* a product decision).

CREATE SCHEMA IF NOT EXISTS "rbac";

-- ---- `rbac.permissions` ----------------------------------------------------
CREATE TABLE "rbac"."permissions" (
    "id"          TEXT            NOT NULL,
    "code"        VARCHAR(160)    NOT NULL,
    "description" VARCHAR(500)    NOT NULL,
    "created_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_rbac_permissions" PRIMARY KEY ("id")
);

-- Permission codes are unique (`Module.Entity.Action`); the registry sync
-- upserts on this key.
CREATE UNIQUE INDEX "uq_permissions_code"
    ON "rbac"."permissions" ("code");

-- ---- `rbac.roles` ----------------------------------------------------------
CREATE TABLE "rbac"."roles" (
    "id"          TEXT            NOT NULL,
    "name"        VARCHAR(120)    NOT NULL,
    "description" VARCHAR(500),
    "created_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"  TEXT,
    "updated_by"  TEXT,
    CONSTRAINT "pk_rbac_roles" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_roles_name"
    ON "rbac"."roles" ("name");

-- ---- `rbac.role_permissions` -----------------------------------------------
CREATE TABLE "rbac"."role_permissions" (
    "role_id"       TEXT            NOT NULL,
    "permission_id" TEXT            NOT NULL,
    "created_at"    TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"    TEXT,
    CONSTRAINT "pk_rbac_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "fk_rbac_role_permissions_role"
        FOREIGN KEY ("role_id") REFERENCES "rbac"."roles"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_rbac_role_permissions_permission"
        FOREIGN KEY ("permission_id") REFERENCES "rbac"."permissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Reverse lookup: which roles hold a permission (role_id is the leading PK
-- column, so no separate index is needed for the forward direction).
CREATE INDEX "idx_role_permissions_permission_id"
    ON "rbac"."role_permissions" ("permission_id");

-- ---- `rbac.user_roles` -----------------------------------------------------
CREATE TABLE "rbac"."user_roles" (
    "user_id"    TEXT            NOT NULL,
    "role_id"    TEXT            NOT NULL,
    "created_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    CONSTRAINT "pk_rbac_user_roles" PRIMARY KEY ("user_id", "role_id"),
    CONSTRAINT "fk_rbac_user_roles_user"
        FOREIGN KEY ("user_id") REFERENCES "users"."users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_rbac_user_roles_role"
        FOREIGN KEY ("role_id") REFERENCES "rbac"."roles"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Reverse lookup: which users hold a role (user_id is the leading PK column).
CREATE INDEX "idx_user_roles_role_id"
    ON "rbac"."user_roles" ("role_id");
