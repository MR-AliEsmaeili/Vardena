-- L-03 correction (PDR-11 corrective review, ADR-0046 Decision 4):
-- distinguish WHEN a supersession was recorded from WHEN the predecessor stops
-- governing.
--
-- Before this migration `superseded_at` served as both facts: the import that
-- recorded a supersession also made the predecessor ineligible immediately.
-- That made a future-dated renewal interrupt the license that was still valid
-- (importing a successor that starts in 2027 retired the governing version
-- today), which is exactly what PDR-11 §3.2/CF-1 forbids.
--
-- `governs_until` is the instant from which a version no longer governs. It is
-- the retiring successor's `valid_from`, so the predecessor governs until the
-- hand-over and not one instant longer; a version is therefore retired AT an
-- instant instead of FOREVER AFTER an import. `superseded_at` keeps its
-- recorded-at meaning and stays the audit fact.
--
-- Nothing is deleted or rewritten: every existing row keeps its
-- `superseded_at`, its artifact hash, its status, its dates and its
-- entitlements.
--
-- Backfill rule, in order:
--   1. `superseded_by_version_id` set (every row written by the L-03 import
--      path) -> the successor's `valid_from`. This also REPAIRS rows that the
--      pre-correction behaviour retired prematurely.
--   2. no successor recorded (rows backfilled from L-02 `replaced_at`, where
--      the replaced-by pointer was never persisted) -> `superseded_at`, which
--      is the instant the old model stopped treating the row as current.
--   3. never superseded -> NULL.
--
-- Consequence, documented in docs/licensing/version-model-and-file-exchange.md
-- section 11: for L-02-era rows the hand-over instant can predate the successor
-- rows' own `valid_from`, so an as-of read strictly BEFORE the recorded
-- supersession may report two covering versions (the deterministic defensive
-- path, logged). Evaluation at the present and the future is exact, and every
-- import from this migration on satisfies "no two retained versions govern the
-- same instant" by construction.

ALTER TABLE "licensing"."license_versions"
  ADD COLUMN "governs_until" TIMESTAMPTZ(6);

UPDATE "licensing"."license_versions" AS "version"
   SET "governs_until" = COALESCE(
         (
           SELECT "successor"."valid_from"
             FROM "licensing"."license_versions" AS "successor"
            WHERE "successor"."id" = "version"."superseded_by_version_id"
         ),
         "version"."superseded_at"
       )
 WHERE "version"."superseded_at" IS NOT NULL;

-- A supersession always records both facts together, or neither: a row with a
-- recorded supersession but no hand-over instant (the pre-correction shape)
-- would silently mean "ineligible from the import instant" again, and a
-- hand-over instant without a recorded supersession would have no audit trail.
ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_supersession_pair_check"
  CHECK (("superseded_at" IS NULL) = ("governs_until" IS NULL));

COMMENT ON COLUMN "licensing"."license_versions"."superseded_at" IS
  'When the supersession was recorded (successor import instant). Audit only.';
COMMENT ON COLUMN "licensing"."license_versions"."governs_until" IS
  'Instant from which this version no longer governs (retiring successor valid_from). Eligibility boundary.';
