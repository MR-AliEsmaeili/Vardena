-- OQ-87 (Owner decision 2026-10-12, Option B; PDR-13): after a coverage lapse,
-- a NEW license identity may cover the lapse only through the dedicated,
-- permission-gated recovery operation, and that operation must leave a
-- traceable history: which license had lapsed, and when its coverage ended.
--
-- The recovery is recorded as its own typed event
-- (`license.import.recovered`) in the existing `licensing.license_audit_events`
-- table, whose `detail` text carries the lapse narrative. What the table could
-- not express is WHICH license the recovery follows as a machine-readable
-- fact: `previous_license_id` is a queryable column, so an installation's
-- recovery history can be answered from the trail without parsing text — the
-- same treatment the transfer columns give the customer pair.
--
-- One nullable column, additive: no backfill, no rewrite of any existing row,
-- no default. It is NULL on every event that is not a recovery. There is no
-- pairing CHECK and no foreign key on purpose: a recovery does not re-bind any
-- identity (the new license is its own row on `license_versions`), and the
-- lapsed license id must remain auditable as history even though license
-- identifiers are only ever added to, never removed from, the retained
-- versions this column points back at.
--
-- Rollback (no down migrations in this repository, F-13): the column is
-- additive and nullable, so dropping it loses the recovery's machine-readable
-- predecessor fact (the bounded `detail` text still names it) and nothing
-- else.

ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN "previous_license_id" TEXT;

COMMENT ON COLUMN "licensing"."license_audit_events"."previous_license_id" IS
  'License whose lapsed coverage a dedicated post-gap recovery follows (recovery events only, OQ-87).';
