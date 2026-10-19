-- OD-LIC-06 / OQ-88 — renewal effective start and typed renewal audit facts.
--
-- A renewal is a signed VLIC2 document that names the retained version it
-- renews (`renewsOperationId`). It must start governing at the instant that
-- version stops governing — the renewed term boundary — and never at its own
-- signed `valid_from`, which stays the issuance-day fact (PDR-18 §1.2, §9).
--
-- This migration is ADDITIVE and backfills NOTHING:
--   * `governs_from IS NULL` means "govern from the signed valid_from", which is
--     the exact meaning of every row that exists today, so every window,
--     stamp, artifact hash and as-of read is unchanged;
--   * no row's `valid_from` or `valid_until` is rewritten (ADR-0046 Decision 2);
--   * the previous release ignores the new column, so the migration is safe to
--     apply before the application release. The rollout floor is documented in
--     `docs/licensing/version-model-and-file-exchange.md` §11: do not roll the
--     application back below the release that understands this column while
--     any row has a non-null value.
--
-- The constraint is local and cheap: a deferred start exists only on a row
-- that also names the version it renews (written in the same transaction), and
-- it must precede the signed end.

ALTER TABLE "licensing"."license_versions"
  ADD COLUMN "governs_from" TIMESTAMPTZ(6);

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_governs_from_check"
  CHECK (
    "governs_from" IS NULL
    OR (
      "supersedes_version_id" IS NOT NULL
      AND ("valid_until" IS NULL OR "governs_from" < "valid_until")
    )
  );

COMMENT ON COLUMN "licensing"."license_versions"."governs_from" IS
  'Instant from which this version starts governing when it differs from the signed valid_from (a renewal: the renewed term boundary). NULL = signed valid_from.';

-- Typed renewal facts on the append-only audit trail (OD-LIC-06 §8.3). They
-- follow the `previous_license_id` precedent: context, not a foreign key. The
-- columns make a renewal's terms queryable without parsing the detail text.
ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN "renewed_version_id" TEXT,
  ADD COLUMN "renewed_from" TIMESTAMPTZ(6),
  ADD COLUMN "renewed_until" TIMESTAMPTZ(6);

COMMENT ON COLUMN "licensing"."license_audit_events"."renewed_version_id" IS
  'The retained version a renewal extended (its signed operation id was the renewal''s renewsOperationId). Set only on license.import.renewed; null on every other event.';

COMMENT ON COLUMN "licensing"."license_audit_events"."renewed_from" IS
  'The instant the renewal starts governing — the renewed version''s effective end (persisted as the renewal row''s governs_from). Set only on license.import.renewed.';

COMMENT ON COLUMN "licensing"."license_audit_events"."renewed_until" IS
  'The Owner-signed new end date the renewal applies, exactly as signed. Set only on license.import.renewed.';

COMMENT ON COLUMN "licensing"."license_audit_events"."previous_license_id" IS
  'The license governing immediately before the event: license.import.recovered — the license whose lapsed coverage the dedicated recovery follows; license.installation.customer-transferred — the license that governed before an explicit transfer; license.import.renewed — the license of the renewed version when the renewal changed the license identity (the NEW identity is the event''s own licenseId). Null on every other event.';
