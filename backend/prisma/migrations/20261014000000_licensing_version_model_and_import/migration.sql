-- L-03: retained license versions, replay-safe import and a typed licensing
-- audit trail (ADR-0046, PDR-11 §3.2/§12.4/§12.7).
--
-- The L-02 model stored ONE current license per installation: a new valid code
-- replaced the previous row (`replaced_at` + a partial unique index). PDR-11
-- requires the opposite shape: a future-dated renewal must coexist with a
-- license that is still valid, and every version must be retained. So
-- `licensing.licenses` becomes the commercial License (customer +
-- installation), and every version it has ever received — including the rows
-- that exist today — becomes a row in `licensing.license_versions`.
--
-- Nothing is lost and nothing is rewritten:
--   * one version per existing license row, same id, same status, same
--     dates/limits, same idempotency hash (`code_hash` -> `document_hash`);
--   * `replaced_at` becomes `superseded_at` (retained, ineligible history);
--   * status values are copied verbatim — the SUSPENDED/revoked mapping is an
--     OPEN product question (PDR-11 PQ-4 / OQ-79) and a lossy status migration
--     is explicitly forbidden;
--   * the operation id of a legacy row is `legacy-code:<code_hash>:<id>` —
--     deterministic and unique even when the same code was activated twice;
--   * entitlements move to `license_version_entitlements` unchanged.
--
-- The L-02 partial unique index is dropped because it encodes the model this
-- migration removes; the replay guarantee moves to the unique
-- `(installation_id, operation_id)` index, which is stricter and per operation
-- rather than per installation.

-- 1. Composite unique target: a version can only name a license of its own
--    installation. Created before the referencing table.
CREATE UNIQUE INDEX "uq_licenses_id_installation"
  ON "licensing"."licenses" ("id", "installation_id");

CREATE INDEX "idx_licenses_installation_id"
  ON "licensing"."licenses" ("installation_id");

-- 2. Retained versions.
CREATE TABLE "licensing"."license_versions" (
  "id" TEXT NOT NULL,
  "license_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "status" "licensing"."LicenseStatus" NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "document_version" INTEGER NOT NULL,
  "document_hash" TEXT NOT NULL,
  "key_id" VARCHAR(120),
  "source" VARCHAR(20) NOT NULL,
  "valid_from" TIMESTAMPTZ(6) NOT NULL,
  "valid_until" TIMESTAMPTZ(6),
  "organization_limit" INTEGER,
  "user_limit" INTEGER,
  "imported_at" TIMESTAMPTZ(6) NOT NULL,
  "imported_by" TEXT,
  "supersedes_version_id" TEXT,
  "superseded_at" TIMESTAMPTZ(6),
  "superseded_by_version_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "license_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "license_versions_validity_check"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "license_versions_organization_limit_check"
    CHECK ("organization_limit" IS NULL OR "organization_limit" > 0),
  CONSTRAINT "license_versions_user_limit_check"
    CHECK ("user_limit" IS NULL OR "user_limit" > 0),
  CONSTRAINT "license_versions_source_check"
    CHECK ("source" IN ('file', 'text', 'legacy-code')),
  CONSTRAINT "license_versions_document_version_check"
    CHECK ("document_version" > 0)
);

CREATE UNIQUE INDEX "uq_license_versions_installation_operation"
  ON "licensing"."license_versions" ("installation_id", "operation_id");

CREATE INDEX "idx_license_versions_installation_superseded"
  ON "licensing"."license_versions" ("installation_id", "superseded_at");

CREATE INDEX "idx_license_versions_installation_valid_from"
  ON "licensing"."license_versions" ("installation_id", "valid_from");

CREATE INDEX "idx_license_versions_license_id"
  ON "licensing"."license_versions" ("license_id");

-- A signed artifact is applied at most once per installation, whatever
-- operation id it carries or claims: this is the database-level guard against
-- a replayed import creating a second version of the same document.
CREATE UNIQUE INDEX "uq_license_versions_installation_document"
  ON "licensing"."license_versions" ("installation_id", "document_hash");

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_license_id_installation_id_fkey"
  FOREIGN KEY ("license_id", "installation_id")
  REFERENCES "licensing"."licenses" ("id", "installation_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_supersedes_version_id_fkey"
  FOREIGN KEY ("supersedes_version_id") REFERENCES "licensing"."license_versions" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_superseded_by_version_id_fkey"
  FOREIGN KEY ("superseded_by_version_id") REFERENCES "licensing"."license_versions" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Version entitlements.
CREATE TABLE "licensing"."license_version_entitlements" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "kind" "licensing"."EntitlementKind" NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "license_version_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_license_version_entitlements_version_kind_code"
  ON "licensing"."license_version_entitlements" ("version_id", "kind", "code");

CREATE INDEX "idx_license_version_entitlements_kind_code"
  ON "licensing"."license_version_entitlements" ("kind", "code");

ALTER TABLE "licensing"."license_version_entitlements"
  ADD CONSTRAINT "license_version_entitlements_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "licensing"."license_versions" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Preflight: refuse data the new model cannot represent faithfully.
--    The version table keeps one row per (installation, artifact hash); two
--    legacy rows of one installation carrying the same hash would mean two
--    versions of the same artifact, and the migration must stop with a clear
--    message instead of failing on a constraint or silently dropping one.
DO $$
DECLARE duplicates bigint;
BEGIN
  SELECT COUNT(*) INTO duplicates FROM (
    SELECT "installation_id", "code_hash"
      FROM "licensing"."licenses"
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
  ) AS duplicate_artifact_hash;
  IF duplicates > 0 THEN
    RAISE EXCEPTION
      'Licensing migration aborted: % duplicate artifact hash group(s) per installation. Reconcile licensing.licenses before migrating (see docs/licensing/version-model-and-file-exchange.md section 11).',
      duplicates;
  END IF;
END $$;

-- 5. Backfill: every existing license row becomes a retained version of itself.
INSERT INTO "licensing"."license_versions" (
  "id", "license_id", "installation_id", "operation_id", "status", "provider",
  "document_version", "document_hash", "key_id", "source", "valid_from",
  "valid_until", "organization_limit", "user_limit", "imported_at",
  "imported_by", "supersedes_version_id", "superseded_at",
  "superseded_by_version_id", "created_at", "updated_at", "created_by",
  "updated_by"
)
SELECT
  "id", "id", "installation_id",
  'legacy-code:' || "code_hash" || ':' || "id",
  "status", "provider",
  1, "code_hash", NULL, 'legacy-code', "valid_from",
  "valid_until", "organization_limit", "user_limit", "activated_at",
  "activated_by", NULL, "replaced_at",
  NULL, "created_at", "updated_at", "created_by",
  "updated_by"
FROM "licensing"."licenses";

INSERT INTO "licensing"."license_version_entitlements" (
  "id", "version_id", "kind", "code", "created_at", "updated_at",
  "created_by", "updated_by"
)
SELECT
  "id", "license_id", "kind", "code", "created_at", "updated_at",
  "created_by", "updated_by"
FROM "licensing"."license_entitlements";

-- 6. Remove the L-02 version columns from the license identity row, and the
--    partial unique index that encoded "exactly one current license".
DROP INDEX "licensing"."uq_licenses_installation_current";
DROP INDEX "licensing"."idx_licenses_installation_id_status";
DROP INDEX "licensing"."idx_licenses_installation_id_replaced_at";

ALTER TABLE "licensing"."licenses"
  DROP COLUMN "status",
  DROP COLUMN "provider",
  DROP COLUMN "code_hash",
  DROP COLUMN "valid_from",
  DROP COLUMN "valid_until",
  DROP COLUMN "organization_limit",
  DROP COLUMN "user_limit",
  DROP COLUMN "activated_at",
  DROP COLUMN "activated_by",
  DROP COLUMN "replaced_at";

DROP TABLE "licensing"."license_entitlements";

-- 7. Typed, append-only licensing audit trail (PDR-11 §12.7).
CREATE TABLE "licensing"."license_audit_events" (
  "id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "event_type" VARCHAR(60) NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "operation_id" TEXT,
  "license_id" TEXT,
  "version_id" TEXT,
  "actor_id" TEXT,
  "source" VARCHAR(20) NOT NULL,
  "document_hash" TEXT,
  "reason" VARCHAR(60),
  "detail" VARCHAR(500),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "license_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_license_audit_events_installation_occurred_at"
  ON "licensing"."license_audit_events" ("installation_id", "occurred_at");

CREATE INDEX "idx_license_audit_events_event_type"
  ON "licensing"."license_audit_events" ("event_type");

ALTER TABLE "licensing"."license_audit_events"
  ADD CONSTRAINT "license_audit_events_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "licensing"."installations" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
