-- The PO confirmed on 2026-10-09 that unit-conversion and item-valuation
-- validity windows are BusinessDate ranges, not effective instants. Convert
-- their legacy timestamptz carriers using the same UTC-calendar-day rule as
-- OQ-73; do not silently choose an organization zone or preserve time-of-day.
--
-- Before altering data, rehearse the date-level history in a transaction and
-- refuse conversions that collapse/reverse windows, create duplicate starts or
-- overlaps, or cannot be represented by the canonical four-digit API day and
-- configured calendar. The representability preflight also checks the
-- Inventory BusinessDates converted by migration 110; its historical values
-- were not representability-gated before conversion. Non-midnight UTC
-- endpoints are counted and emitted as a NOTICE for deployment evidence; their
-- discarded time is not reinterpreted as a different day. See
-- prisma/rehearsal/business-date-validity-windows/.

DO $business_date_validity_preflight$
DECLARE
  non_midnight_endpoints bigint;
  offending_table text;
  offending_id text;
  offending_organization text;
  offending_business_date date;
BEGIN
  CREATE TEMPORARY TABLE "_inventory_business_date_validity_windows" (
    "source_table" text NOT NULL,
    "organization_id" text NOT NULL,
    "scope_key" text NOT NULL,
    "row_id" text NOT NULL,
    "valid_from" date NOT NULL,
    "valid_to" date
  );

  INSERT INTO "_inventory_business_date_validity_windows"
    ("source_table", "organization_id", "scope_key", "row_id", "valid_from", "valid_to")
  SELECT
    'unit_conversions',
    "organization_id",
    jsonb_build_array("organization_id", "from_unit_id", "to_unit_id")::text,
    "id",
    ("valid_from" AT TIME ZONE 'UTC')::date,
    ("valid_to" AT TIME ZONE 'UTC')::date
  FROM "inventory"."unit_conversions"
  UNION ALL
  SELECT
    'item_unit_conversions',
    "organization_id",
    jsonb_build_array("item_id", "from_unit_id", "to_unit_id")::text,
    "id",
    ("valid_from" AT TIME ZONE 'UTC')::date,
    ("valid_to" AT TIME ZONE 'UTC')::date
  FROM "inventory"."item_unit_conversions"
  UNION ALL
  SELECT
    'item_valuation_methods',
    "organization_id",
    jsonb_build_array("organization_id", "item_id")::text,
    "id",
    ("valid_from" AT TIME ZONE 'UTC')::date,
    ("valid_to" AT TIME ZONE 'UTC')::date
  FROM "inventory"."item_valuation_methods";

  -- Compare both the proposed window conversions and the BusinessDate columns
  -- already converted by migration 110 against the application/API range. A
  -- PostgreSQL date can represent years the four-digit API cannot; Jalali
  -- rendering has the additional bounded range used by kernel/datetime/jalali.
  CREATE TEMPORARY TABLE "_inventory_business_date_representability" (
    "source_table" text NOT NULL,
    "row_id" text NOT NULL,
    "organization_id" text NOT NULL,
    "business_date" date NOT NULL
  );

  INSERT INTO "_inventory_business_date_representability"
    ("source_table", "row_id", "organization_id", "business_date")
  SELECT "source_table" || '.valid_from', "row_id", "organization_id", "valid_from"
    FROM "_inventory_business_date_validity_windows"
  UNION ALL
  SELECT "source_table" || '.valid_to', "row_id", "organization_id", "valid_to"
    FROM "_inventory_business_date_validity_windows"
   WHERE "valid_to" IS NOT NULL
  UNION ALL
  SELECT 'inventory_movements.movement_date', "id", "organization_id", "movement_date"
    FROM "inventory"."inventory_movements"
  UNION ALL
  SELECT 'inventory_business_documents.business_date', "id", "organization_id", "business_date"
    FROM "inventory"."inventory_business_documents"
  UNION ALL
  SELECT 'inventory_accounting_posting_snapshots.document_date', "id", "organization_id", "document_date"
    FROM "inventory"."inventory_accounting_posting_snapshots"
  UNION ALL
  SELECT 'inventory_pricing_runs.from_date', "id", "organization_id", "from_date"
    FROM "inventory"."inventory_pricing_runs"
   WHERE "from_date" IS NOT NULL
  UNION ALL
  SELECT 'inventory_pricing_runs.to_date', "id", "organization_id", "to_date"
    FROM "inventory"."inventory_pricing_runs"
  UNION ALL
  SELECT 'inventory_valuation_runs.from_date', "id", "organization_id", "from_date"
    FROM "inventory"."inventory_valuation_runs"
   WHERE "from_date" IS NOT NULL
  UNION ALL
  SELECT 'inventory_balances.last_movement_date', "id", "organization_id", "last_movement_date"
    FROM "inventory"."inventory_balances"
   WHERE "last_movement_date" IS NOT NULL;

  SELECT
    business_dates."source_table",
    business_dates."row_id",
    business_dates."organization_id",
    business_dates."business_date"
    INTO offending_table, offending_id, offending_organization, offending_business_date
    FROM "_inventory_business_date_representability" AS business_dates
    LEFT JOIN "organization"."organizations" AS organizations
      ON organizations."id" = business_dates."organization_id"
   WHERE organizations."id" IS NULL
      OR organizations."calendar_system" IS NULL
      OR organizations."calendar_system" NOT IN ('GREGORIAN', 'JALALI')
      OR business_dates."business_date" < DATE '0001-01-01'
      OR business_dates."business_date" > DATE '9999-12-31'
      OR (
        (organizations."calendar_system" = 'JALALI'
          OR business_dates."source_table" = 'inventory_business_documents.business_date')
        AND (
          business_dates."business_date" < DATE '0621-03-21'
          OR business_dates."business_date" > DATE '3798-12-31'
        )
      )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'BusinessDate migration rejected: row % in % for organization % has day %, outside the supported BusinessDate/API/calendar rendering range.',
      offending_id, offending_table, offending_organization, offending_business_date;
  END IF;

  SELECT count(*)
    INTO non_midnight_endpoints
    FROM (
      SELECT "valid_from" AS endpoint FROM "inventory"."unit_conversions"
      UNION ALL SELECT "valid_to" FROM "inventory"."unit_conversions"
      UNION ALL SELECT "valid_from" FROM "inventory"."item_unit_conversions"
      UNION ALL SELECT "valid_to" FROM "inventory"."item_unit_conversions"
      UNION ALL SELECT "valid_from" FROM "inventory"."item_valuation_methods"
      UNION ALL SELECT "valid_to" FROM "inventory"."item_valuation_methods"
    ) AS endpoints
   WHERE endpoint IS NOT NULL
     AND (endpoint AT TIME ZONE 'UTC')::time <> TIME '00:00:00';

  RAISE NOTICE
    'BusinessDate validity-window rehearsal: % legacy endpoints have non-midnight UTC time; conversion preserves their UTC calendar day.',
    non_midnight_endpoints;

  SELECT "source_table", "row_id"
    INTO offending_table, offending_id
    FROM "_inventory_business_date_validity_windows"
   WHERE "valid_to" IS NOT NULL
     AND "valid_to" <= "valid_from"
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'BusinessDate validity migration rejected: % row % collapses to an empty or reversed UTC-day window.',
      offending_table, offending_id;
  END IF;

  -- The unique indexes are narrower than arbitrary timestamp equality. Check
  -- their target keys explicitly after UTC-day conversion so a collision is
  -- reported before PostgreSQL's index rebuild attempts to enforce it.
  IF EXISTS (
    SELECT 1
      FROM "_inventory_business_date_validity_windows"
     GROUP BY "source_table", "scope_key", "valid_from"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'BusinessDate validity migration rejected: multiple versions in one scope collapse to the same UTC business-date start.';
  END IF;

  IF EXISTS (
    WITH ordered_windows AS (
      SELECT
        "source_table",
        "scope_key",
        "row_id",
        "valid_from",
        max("valid_to") OVER prior_windows AS "latest_prior_end",
        bool_or("valid_to" IS NULL) OVER prior_windows AS "has_open_prior"
      FROM "_inventory_business_date_validity_windows"
      WINDOW prior_windows AS (
        PARTITION BY "source_table", "scope_key"
        ORDER BY "valid_from", "row_id"
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      )
    )
    SELECT 1
      FROM ordered_windows
     WHERE "has_open_prior"
        OR "latest_prior_end" > "valid_from"
  ) THEN
    RAISE EXCEPTION
      'BusinessDate validity migration rejected: effective windows overlap after UTC-day conversion.';
  END IF;
END
$business_date_validity_preflight$;

DROP TABLE pg_temp."_inventory_business_date_representability";
DROP TABLE pg_temp."_inventory_business_date_validity_windows";

-- Effective-dated unit conversions: global and item-specific scopes.
ALTER TABLE "inventory"."unit_conversions"
  ALTER COLUMN "valid_from" TYPE date
    USING ("valid_from" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "valid_to" TYPE date
    USING ("valid_to" AT TIME ZONE 'UTC')::date;

ALTER TABLE "inventory"."item_unit_conversions"
  ALTER COLUMN "valid_from" TYPE date
    USING ("valid_from" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "valid_to" TYPE date
    USING ("valid_to" AT TIME ZONE 'UTC')::date;

-- Item valuation method is effective on a business day and is resolved per
-- movement's BusinessDate, not per movement timestamp.
ALTER TABLE "inventory"."item_valuation_methods"
  ALTER COLUMN "valid_from" TYPE date
    USING ("valid_from" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "valid_to" TYPE date
    USING ("valid_to" AT TIME ZONE 'UTC')::date;
