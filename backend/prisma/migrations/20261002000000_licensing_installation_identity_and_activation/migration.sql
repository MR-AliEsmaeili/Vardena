-- L-02: persistent installation identity + persistent license activation.
--
-- The licensing foundation (20261001000000) created typed Customer /
-- Installation / License / Entitlement tables but nothing ever wrote to them:
-- the runtime license came from configuration. This migration turns those
-- tables into the actual source of truth.
--
-- 1. An installation identity exists BEFORE any license, so `customer_id`
--    becomes nullable and exactly one row may be flagged as the identity of
--    this deployment (`is_self`).
-- 2. A license row records the signed code it was activated from, who
--    activated it, and when it was replaced, so the current license of an
--    installation is a single unambiguous row that survives restarts.

ALTER TABLE "licensing"."installations"
  ALTER COLUMN "customer_id" DROP NOT NULL;

ALTER TABLE "licensing"."installations"
  ADD COLUMN "is_self" BOOLEAN NOT NULL DEFAULT false;

-- At most one self-identity row per database: the deployment is one
-- installation (ADR-0030). A DB-level backstop, not the primary guard.
CREATE UNIQUE INDEX "uq_installations_self"
  ON "licensing"."installations" ("is_self")
  WHERE "is_self";

-- Licenses are activated from a signed code; the previous rows (there are
-- none in any deployment, the tables were never written) would have no code.
ALTER TABLE "licensing"."licenses"
  ADD COLUMN "customer_id" TEXT NOT NULL,
  ADD COLUMN "code" TEXT NOT NULL,
  ADD COLUMN "code_hash" TEXT NOT NULL,
  ADD COLUMN "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "activated_by" TEXT,
  ADD COLUMN "replaced_at" TIMESTAMPTZ(6);

ALTER TABLE "licensing"."licenses"
  ADD CONSTRAINT "licenses_customer_id_fkey" FOREIGN KEY ("customer_id")
  REFERENCES "licensing"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one current (not replaced) license per installation.
CREATE UNIQUE INDEX "uq_licenses_installation_current"
  ON "licensing"."licenses" ("installation_id")
  WHERE "replaced_at" IS NULL;

CREATE INDEX "idx_licenses_installation_id_replaced_at"
  ON "licensing"."licenses" ("installation_id", "replaced_at");
