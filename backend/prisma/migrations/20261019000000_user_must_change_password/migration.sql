-- F-12: Persistent forced-password-change state for user accounts.
--
-- Additive column with DEFAULT false: existing user rows in an already-
-- provisioned installation remain unaffected (`must_change_password = false`)
-- when the migration is deployed. Fresh initial administrator provisioning
-- sets `must_change_password = true` explicitly through the Users module.
ALTER TABLE "users"."users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "users"."users"."must_change_password" IS
  'True when the user must change their password before accessing normal application functionality.';
