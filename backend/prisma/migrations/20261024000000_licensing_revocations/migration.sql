-- OD-LIC-17 — signed revocation artifact (`VREV1`), customer-side persistence.
-- Normative protocol: docs/licensing/revocation-artifact-protocol.md §4, §8.
--
-- This migration is ADDITIVE and rewrites NOTHING:
--   * `license_versions.signed_issued_at` is NULL for every existing row (a
--     legacy `VLIC1` code carries no signed issuance instant, and rows imported
--     before this column existed did not retain it). The staleness rule of
--     protocol §4 step 10 is therefore *not assessable* for those rows and is
--     skipped — it is never approximated from `imported_at` or `valid_from`;
--   * `licenses.revoked_at` / `licenses.revocation_id` are NULL for every
--     existing row, which means "not revoked", i.e. exactly today's meaning;
--   * no signed version, hash, window or entitlement is touched;
--   * the previous release ignores the new columns and the new table, so this
--     migration is safe to apply before the application release.
--
-- Revocation is final: `licenses.revoked_at`/`revocation_id` are set together
-- and never cleared (the CHECK below), the `license_revocations` row is
-- append-only, and nothing is deleted or rewritten. Restoring service requires
-- a NEW license through the normal issuance flow.

CREATE TABLE "licensing"."license_revocations" (
  "revocation_id" TEXT NOT NULL,
  "license_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "customer_code" VARCHAR(64) NOT NULL,
  "target_operation_id" TEXT NOT NULL,
  "reason" VARCHAR(40) NOT NULL,
  "reason_detail" VARCHAR(500),
  "issuer_key_id" VARCHAR(120) NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL,
  "imported_at" TIMESTAMPTZ(6) NOT NULL,
  "imported_by" TEXT,
  "artifact_sha256" VARCHAR(64) NOT NULL,
  "canonical_payload_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "license_revocations_pkey" PRIMARY KEY ("revocation_id")
);

-- One revocation per license, forever. This is the last line of defence behind
-- the per-installation lock: two concurrent revocations of the same license
-- cannot both commit.
CREATE UNIQUE INDEX "uq_license_revocations_license"
  ON "licensing"."license_revocations" ("license_id");

CREATE INDEX "idx_license_revocations_installation_imported_at"
  ON "licensing"."license_revocations" ("installation_id", "imported_at");

CREATE INDEX "idx_license_revocations_customer"
  ON "licensing"."license_revocations" ("customer_id");

-- The target license must belong to the same installation named by the
-- revocation. Composite FK, so a row can never describe a cross-installation
-- target (same integrity pattern as license_versions).
ALTER TABLE "licensing"."license_revocations"
  ADD CONSTRAINT "license_revocations_license_id_installation_id_fkey"
  FOREIGN KEY ("license_id", "installation_id")
  REFERENCES "licensing"."licenses" ("id", "installation_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON TABLE "licensing"."license_revocations" IS
  'Verified, imported signed revocations (OD-LIC-17). Append-only; one row per license. The artifact itself is never stored — only its SHA-256 and the canonical payload SHA-256.';

COMMENT ON COLUMN "licensing"."license_revocations"."target_operation_id" IS
  'The retained version operation id that existed when the revocation was authorized (signed evidence, never a filter).';

COMMENT ON COLUMN "licensing"."license_revocations"."artifact_sha256" IS
  'SHA-256 of the exact armored artifact received. Integrity metadata; the bytes live in the Owner archive, not here.';

-- License-level revocation state. Set together, never cleared: a subquery-free
-- CHECK, so it is accepted by PostgreSQL and mirrorable by Prisma.
ALTER TABLE "licensing"."licenses"
  ADD COLUMN "revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "revocation_id" TEXT;

ALTER TABLE "licensing"."licenses"
  ADD CONSTRAINT "licenses_revocation_state_check"
  CHECK (
    ("revoked_at" IS NULL AND "revocation_id" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revocation_id" IS NOT NULL)
  );

COMMENT ON COLUMN "licensing"."licenses"."revoked_at" IS
  'When the signed revocation was imported. NULL = not revoked. Set together with revocation_id and never cleared (OD-LIC-17).';

COMMENT ON COLUMN "licensing"."licenses"."revocation_id" IS
  'The signed revocation identity (licensing.license_revocations.revocation_id). Context column, set together with revoked_at and never cleared.';

-- The signed issuance instant of the artifact a version came from. Needed to
-- evaluate `stale-revocation` (protocol §4 step 10) against the version the
-- revocation targets instead of guessing from import/validity dates.
ALTER TABLE "licensing"."license_versions"
  ADD COLUMN "signed_issued_at" TIMESTAMPTZ(6);

COMMENT ON COLUMN "licensing"."license_versions"."signed_issued_at" IS
  'The signed issuedAt of the artifact this version came from. NULL on legacy VLIC1 rows and on rows imported before this column existed; the staleness check is then not assessable and is skipped, never approximated.';

-- Typed revocation context on the append-only audit trail: which signed
-- revocation act an applied/rejected event belongs to. Context, not an FK.
ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN "revocation_id" TEXT;

COMMENT ON COLUMN "licensing"."license_audit_events"."revocation_id" IS
  'The signed revocation identity on license.revocation.imported / license.revocation.rejected; null on every other event.';
