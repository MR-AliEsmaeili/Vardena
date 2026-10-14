-- L-06 (PDR-14 / OD-LIC-03): Stable customer code across the license lifecycle.
--
-- Every licensing customer row in `licensing.customers` carries a stable,
-- independent business `customer_code` (`VARCHAR(64) NOT NULL`), unique across
-- `licensing.customers` (`uq_customers_customer_code`) and distinct from the
-- internal database identity `id` (`customerId`). `display_name`
-- (`customerName`) remains a mutable display name and is not an identity key.
--
-- Migration safety:
-- 1. Adds `customer_code VARCHAR(64)` if not already present (supporting a
--    staged owner-supplied backfill before constraint enforcement on a
--    populated database).
-- 2. Fails closed (`RAISE EXCEPTION`) if any existing row in
--    `licensing.customers` has a NULL, blank, malformed, `customer_code = id`,
--    or duplicate `customer_code` — never fabricating or guessing business
--    codes from `id` or `display_name`.
-- 3. Enforces `NOT NULL`, `customers_customer_code_check`, and
--    `uq_customers_customer_code`.
--
-- Forward-only migration: no destructive DDL and no down migration.

ALTER TABLE "licensing"."customers"
  ADD COLUMN IF NOT EXISTS "customer_code" VARCHAR(64);

DO $$
DECLARE
  missing_count integer;
  invalid_sample text;
  equal_id_sample text;
  duplicate_sample text;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "licensing"."customers"
  WHERE "customer_code" IS NULL OR BTRIM("customer_code") = '';

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Cannot apply L-06 customer_code migration: licensing.customers has % row(s) without an explicit customer_code. Populate owner-assigned business customer_code values before enforcing NOT NULL; never infer customer_code from id or display_name.',
      missing_count;
  END IF;

  SELECT "id" INTO invalid_sample
  FROM "licensing"."customers"
  WHERE "customer_code" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
  LIMIT 1;

  IF invalid_sample IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot apply L-06 customer_code migration: licensing.customers row "%" has a malformed customer_code (expected 2..64 ASCII code characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$).',
      invalid_sample;
  END IF;

  SELECT "id" INTO equal_id_sample
  FROM "licensing"."customers"
  WHERE "customer_code" = "id"
  LIMIT 1;

  IF equal_id_sample IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot apply L-06 customer_code migration: licensing.customers row "%" has customer_code equal to id; customer_code must be an independent business code.',
      equal_id_sample;
  END IF;

  SELECT "customer_code" INTO duplicate_sample
  FROM "licensing"."customers"
  GROUP BY "customer_code"
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_sample IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot apply L-06 customer_code migration: duplicate customer_code "%" found in licensing.customers.',
      duplicate_sample;
  END IF;
END $$;

ALTER TABLE "licensing"."customers"
  ALTER COLUMN "customer_code" SET NOT NULL;

ALTER TABLE "licensing"."customers"
  DROP CONSTRAINT IF EXISTS "customers_customer_code_check",
  ADD CONSTRAINT "customers_customer_code_check"
    CHECK (
      "customer_code" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
      AND "customer_code" <> "id"
    );

CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_customer_code"
  ON "licensing"."customers"("customer_code");

COMMENT ON COLUMN "licensing"."customers"."customer_code" IS
  'PDR-14 / L-06: Stable, unique business customer code independent of internal id and display_name.';

ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN IF NOT EXISTS "previous_customer_code" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "new_customer_code" VARCHAR(64);

ALTER TABLE "licensing"."license_audit_events"
  DROP CONSTRAINT IF EXISTS "license_audit_events_customer_transfer_code_pair_check",
  ADD CONSTRAINT "license_audit_events_customer_transfer_code_pair_check"
    CHECK (("previous_customer_code" IS NULL) = ("new_customer_code" IS NULL));

COMMENT ON COLUMN "licensing"."license_audit_events"."previous_customer_code" IS
  'PDR-14 / L-06: Business customer code before an explicit customer transfer; null on every other event.';

COMMENT ON COLUMN "licensing"."license_audit_events"."new_customer_code" IS
  'PDR-14 / L-06: Business customer code after an explicit customer transfer; null on every other event.';

