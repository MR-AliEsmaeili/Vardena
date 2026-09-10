-- Identity + Users: authentication foundation (ADR-0007, AR-09, docs/security.md §2).
--
-- Creates the `users` schema with a minimal user record (id, username,
-- password hash, active flag, audit/soft-delete columns) and the `identity`
-- schema with server-side sessions (hashed opaque tokens, idle/absolute
-- expiry, revocation metadata).
--
-- Passwords are hashed with argon2id by the application; this migration
-- only sets up storage. The session token column stores a SHA-256 hash;
-- the raw token travels in an httpOnly cookie and is NEVER persisted.

-- Create schemas (idempotent).
CREATE SCHEMA IF NOT EXISTS "users";
CREATE SCHEMA IF NOT EXISTS "identity";

-- ---- `users.users` ---------------------------------------------------------
CREATE TABLE "users"."users" (
    "id"              TEXT            NOT NULL,
    "username"        VARCHAR(64)     NOT NULL,
    "password_hash"   TEXT            NOT NULL,
    "is_active"       BOOLEAN         NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    "deleted_at"      TIMESTAMPTZ,
    "deleted_by"      TEXT,
    CONSTRAINT "pk_users_users" PRIMARY KEY ("id")
);

-- Username is globally unique (v1). When full soft-delete semantics (re-use
-- of a username) are implemented in the Users module session, this becomes
-- a partial unique index via a follow-up migration (docs/database-strategy §7).
CREATE UNIQUE INDEX "uq_users_username"
    ON "users"."users" ("username");

CREATE INDEX "idx_users_deleted_at"
    ON "users"."users" ("deleted_at");

-- ---- `identity.sessions` ---------------------------------------------------
CREATE TABLE "identity"."sessions" (
    "id"                    TEXT            NOT NULL,
    "user_id"               TEXT            NOT NULL,
    "token_hash"            TEXT            NOT NULL,
    "user_agent"            TEXT,
    "ip_address"            TEXT,
    "created_at"            TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"          TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"            TIMESTAMPTZ     NOT NULL,
    "absolute_expires_at"   TIMESTAMPTZ     NOT NULL,
    "revoked_at"            TIMESTAMPTZ,
    CONSTRAINT "pk_identity_sessions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_identity_sessions_user"
        FOREIGN KEY ("user_id") REFERENCES "users"."users"("id")
        ON DELETE CASCADE
);

-- Unique constraint on the token hash: lookup by cookie hash must hit one row.
CREATE UNIQUE INDEX "uq_sessions_token_hash"
    ON "identity"."sessions" ("token_hash");

-- Lookup sessions for a user (admin list, revoke-on-disable).
CREATE INDEX "idx_sessions_user_id_revoked_at"
    ON "identity"."sessions" ("user_id", "revoked_at");

-- Sweep expired/revoked sessions in background jobs.
CREATE INDEX "idx_sessions_expires_at"
    ON "identity"."sessions" ("expires_at");
