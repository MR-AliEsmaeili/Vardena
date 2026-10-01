CREATE SCHEMA IF NOT EXISTS "licensing";

CREATE TYPE "licensing"."LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');
CREATE TYPE "licensing"."EntitlementKind" AS ENUM ('MODULE', 'FEATURE');

CREATE TABLE "licensing"."customers" (
  "id" TEXT NOT NULL,
  "display_name" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "licensing"."installations" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "licensing"."licenses" (
  "id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "status" "licensing"."LicenseStatus" NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "valid_from" TIMESTAMPTZ(6) NOT NULL,
  "valid_until" TIMESTAMPTZ(6),
  "organization_limit" INTEGER,
  "user_limit" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "licenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "licenses_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "licenses_organization_limit_check" CHECK ("organization_limit" IS NULL OR "organization_limit" > 0),
  CONSTRAINT "licenses_user_limit_check" CHECK ("user_limit" IS NULL OR "user_limit" > 0)
);

CREATE TABLE "licensing"."license_entitlements" (
  "id" TEXT NOT NULL,
  "license_id" TEXT NOT NULL,
  "kind" "licensing"."EntitlementKind" NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "license_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_installations_customer_id" ON "licensing"."installations"("customer_id");
CREATE INDEX "idx_licenses_installation_id_status" ON "licensing"."licenses"("installation_id", "status");
CREATE UNIQUE INDEX "uq_license_entitlements_license_kind_code" ON "licensing"."license_entitlements"("license_id", "kind", "code");
CREATE INDEX "idx_license_entitlements_kind_code" ON "licensing"."license_entitlements"("kind", "code");

ALTER TABLE "licensing"."installations" ADD CONSTRAINT "installations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "licensing"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "licensing"."licenses" ADD CONSTRAINT "licenses_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "licensing"."installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "licensing"."license_entitlements" ADD CONSTRAINT "license_entitlements_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licensing"."licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
