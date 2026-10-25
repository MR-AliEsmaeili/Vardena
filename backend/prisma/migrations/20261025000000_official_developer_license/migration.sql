-- Official, offline Developer License (ADR-0053).
--
-- Existing rows are commercial by default and retain their customer binding.
-- Developer licenses use explicit holder columns and MUST NOT reference or
-- create licensing.customers. The check constraint makes the two identity
-- models mutually exclusive in PostgreSQL as well as in the application.

CREATE TYPE "licensing"."LicenseType" AS ENUM ('COMMERCIAL', 'DEVELOPER');

ALTER TABLE "licensing"."licenses"
  ADD COLUMN "license_type" "licensing"."LicenseType" NOT NULL DEFAULT 'COMMERCIAL',
  ADD COLUMN "developer_id" VARCHAR(64),
  ADD COLUMN "developer_name" VARCHAR(200),
  ALTER COLUMN "customer_id" DROP NOT NULL;

ALTER TABLE "licensing"."licenses"
  ADD CONSTRAINT "licenses_holder_type_check" CHECK (
    (
      "license_type" = 'COMMERCIAL'
      AND "customer_id" IS NOT NULL
      AND "developer_id" IS NULL
      AND "developer_name" IS NULL
    )
    OR
    (
      "license_type" = 'DEVELOPER'
      AND "customer_id" IS NULL
      AND "developer_id" IS NOT NULL
      AND length(btrim("developer_id")) >= 2
      AND "developer_name" IS NOT NULL
      AND length(btrim("developer_name")) >= 1
    )
  );

CREATE INDEX "idx_licenses_type_developer_id"
  ON "licensing"."licenses" ("license_type", "developer_id");
