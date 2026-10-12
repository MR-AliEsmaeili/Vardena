-- Q4 (Owner decision 2026-10-12): an installation's commercial customer may
-- change only through an explicit, authorized transfer, and that transfer must
-- be auditable with machine-readable facts.
--
-- The transfer is recorded as its own typed event
-- (`license.installation.customer-transferred`) in the existing
-- `licensing.license_audit_events` table, which already carries the
-- installation, the operation, the license version, the actor, the source, the
-- instant and the outcome. What it could not express is WHICH customer the
-- installation left and which one it joined: `detail` is bounded free text and
-- cannot be queried reliably, and `reason` carries rejection vocabulary.
--
-- These two nullable columns are therefore added — additive, no backfill, no
-- rewrite of any existing row, no default. Both are NULL on every event that
-- is not a transfer, and the CHECK keeps them paired, exactly like the
-- supersession pair on `license_versions`: a half-written transfer would be an
-- audit trail that cannot answer "from where to where".
--
-- Rollback (no down migrations in this repository, F-13): the columns are
-- additive and nullable, so dropping them loses the transfer audit facts but
-- nothing else; the binding itself lives on `licensing.installations`.

ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN "previous_customer_id" TEXT,
  ADD COLUMN "new_customer_id" TEXT;

ALTER TABLE "licensing"."license_audit_events"
  ADD CONSTRAINT "license_audit_events_customer_transfer_pair_check"
  CHECK (("previous_customer_id" IS NULL) = ("new_customer_id" IS NULL));

COMMENT ON COLUMN "licensing"."license_audit_events"."previous_customer_id" IS
  'Commercial customer of the installation before an explicit transfer (transfer events only).';
COMMENT ON COLUMN "licensing"."license_audit_events"."new_customer_id" IS
  'Commercial customer of the installation after an explicit transfer (transfer events only).';
