-- Read-only, aggregate-only preflight report for migration
-- 20261012000000_inventory_business_date_validity_windows.
--
-- Run after 20261011000000_business_date_persistence and before the validity-
-- window migration, against a production-like snapshot or a read-only target
-- connection. This query returns table/column counts only: no IDs, organization
-- identifiers, conversion factors, names, or business payloads are emitted.
--
-- Example:
--   psql "$READ_ONLY_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f backend/prisma/rehearsal/business-date-validity-windows/audit.sql
--
-- The report mirrors the migration's UTC-day conversion and representability
-- guards. A non-midnight count is evidence of discarded clock components, not
-- by itself a migration failure. Any collision, invalid range, unsupported
-- date, missing/invalid organization calendar, or overlap must be investigated;
-- this report does not repair data or authorize a production migration.

WITH validity_windows AS (
  SELECT
    'unit_conversions'::text AS source_table,
    "organization_id",
    jsonb_build_array("organization_id", "from_unit_id", "to_unit_id")::text AS scope_key,
    "id"::text AS row_id,
    "valid_from" AS valid_from_instant,
    "valid_to" AS valid_to_instant,
    ("valid_from" AT TIME ZONE 'UTC')::date AS valid_from_day,
    ("valid_to" AT TIME ZONE 'UTC')::date AS valid_to_day
  FROM "inventory"."unit_conversions"

  UNION ALL

  SELECT
    'item_unit_conversions',
    "organization_id",
    jsonb_build_array("item_id", "from_unit_id", "to_unit_id")::text,
    "id"::text,
    "valid_from",
    "valid_to",
    ("valid_from" AT TIME ZONE 'UTC')::date,
    ("valid_to" AT TIME ZONE 'UTC')::date
  FROM "inventory"."item_unit_conversions"

  UNION ALL

  SELECT
    'item_valuation_methods',
    "organization_id",
    jsonb_build_array("organization_id", "item_id")::text,
    "id"::text,
    "valid_from",
    "valid_to",
    ("valid_from" AT TIME ZONE 'UTC')::date,
    ("valid_to" AT TIME ZONE 'UTC')::date
  FROM "inventory"."item_valuation_methods"
),
window_conflicts AS (
  SELECT
    "source_table",
    count(*) FILTER (
      WHERE "has_open_prior"
         OR "latest_prior_end" > "valid_from_day"
    ) AS overlapping_rows
  FROM (
    SELECT
      "source_table",
      "scope_key",
      "row_id",
      "valid_from_day",
      max("valid_to_day") OVER prior_windows AS "latest_prior_end",
      bool_or("valid_to_day" IS NULL) OVER prior_windows AS "has_open_prior"
    FROM validity_windows
    WINDOW prior_windows AS (
      PARTITION BY "source_table", "scope_key"
      ORDER BY "valid_from_day", "row_id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    )
  ) AS ordered_windows
  GROUP BY "source_table"
),
duplicate_starts AS (
  SELECT
    "source_table",
    count(*) AS duplicate_start_groups,
    sum("rows_in_group" - 1) AS duplicate_start_extra_rows
  FROM (
    SELECT
      "source_table",
      "scope_key",
      "valid_from_day",
      count(*) AS "rows_in_group"
    FROM validity_windows
    GROUP BY "source_table", "scope_key", "valid_from_day"
    HAVING count(*) > 1
  ) AS duplicate_groups
  GROUP BY "source_table"
),
validity_tables AS (
  VALUES
    ('unit_conversions'::text),
    ('item_unit_conversions'::text),
    ('item_valuation_methods'::text)
),
window_summary AS (
  SELECT
    tables.column1 AS source_table,
    count(windows.row_id) AS row_count,
    count(windows.row_id) FILTER (
      WHERE CASE
        WHEN isfinite(windows.valid_from_instant)
        THEN (windows.valid_from_instant AT TIME ZONE 'UTC')::time <> TIME '00:00:00'
        ELSE false
      END
    ) AS valid_from_non_midnight_utc,
    count(windows.row_id) FILTER (
      WHERE CASE
        WHEN windows.valid_to_instant IS NULL THEN false
        WHEN isfinite(windows.valid_to_instant)
        THEN (windows.valid_to_instant AT TIME ZONE 'UTC')::time <> TIME '00:00:00'
        ELSE false
      END
    ) AS valid_to_non_midnight_utc,
    count(windows.row_id) FILTER (
      WHERE windows.row_id IS NOT NULL
        AND windows.valid_to_instant IS NULL
    ) AS open_ended_rows,
    count(windows.row_id) FILTER (
      WHERE windows.valid_to_day IS NOT NULL
        AND windows.valid_to_day <= windows.valid_from_day
    ) AS collapsed_or_reversed_rows,
    count(windows.row_id) FILTER (
      WHERE organizations.id IS NULL
         OR organizations.calendar_system IS NULL
         OR organizations.calendar_system NOT IN ('GREGORIAN', 'JALALI')
         OR NOT isfinite(windows.valid_from_day)
         OR windows.valid_from_day < DATE '0001-01-01'
         OR windows.valid_from_day > DATE '9999-12-31'
         OR (
           windows.valid_to_day IS NOT NULL
           AND (
             NOT isfinite(windows.valid_to_day)
             OR windows.valid_to_day < DATE '0001-01-01'
             OR windows.valid_to_day > DATE '9999-12-31'
           )
         )
         OR (
           organizations.calendar_system = 'JALALI'
           AND (
             windows.valid_from_day < DATE '0621-03-21'
             OR windows.valid_from_day > DATE '3798-12-31'
             OR (
               windows.valid_to_day IS NOT NULL
               AND (
                 windows.valid_to_day < DATE '0621-03-21'
                 OR windows.valid_to_day > DATE '3798-12-31'
               )
             )
           )
         )
    ) AS unrenderable_version_rows
  FROM validity_tables AS tables
  LEFT JOIN validity_windows AS windows
    ON windows.source_table = tables.column1
  LEFT JOIN "organization"."organizations" AS organizations
    ON organizations.id = windows.organization_id
  GROUP BY tables.column1
),
business_date_values AS (
  SELECT
    'inventory_movements.movement_date'::text AS source_table,
    "organization_id",
    "movement_date" AS business_date
  FROM "inventory"."inventory_movements"

  UNION ALL

  SELECT
    'inventory_business_documents.business_date',
    "organization_id",
    "business_date"
  FROM "inventory"."inventory_business_documents"

  UNION ALL

  SELECT
    'inventory_accounting_posting_snapshots.document_date',
    "organization_id",
    "document_date"
  FROM "inventory"."inventory_accounting_posting_snapshots"

  UNION ALL

  SELECT
    'inventory_pricing_runs.from_date',
    "organization_id",
    "from_date"
  FROM "inventory"."inventory_pricing_runs"
  WHERE "from_date" IS NOT NULL

  UNION ALL

  SELECT
    'inventory_pricing_runs.to_date',
    "organization_id",
    "to_date"
  FROM "inventory"."inventory_pricing_runs"

  UNION ALL

  SELECT
    'inventory_valuation_runs.from_date',
    "organization_id",
    "from_date"
  FROM "inventory"."inventory_valuation_runs"
  WHERE "from_date" IS NOT NULL

  UNION ALL

  SELECT
    'inventory_balances.last_movement_date',
    "organization_id",
    "last_movement_date"
  FROM "inventory"."inventory_balances"
  WHERE "last_movement_date" IS NOT NULL
),
business_date_sources(source_table) AS (
  VALUES
    ('inventory_movements.movement_date'::text),
    ('inventory_business_documents.business_date'::text),
    ('inventory_accounting_posting_snapshots.document_date'::text),
    ('inventory_pricing_runs.from_date'::text),
    ('inventory_pricing_runs.to_date'::text),
    ('inventory_valuation_runs.from_date'::text),
    ('inventory_balances.last_movement_date'::text)
),
-- The Jalali envelope is a display constraint only for JALALI organizations.
-- A GREGORIAN BusinessDate remains valid without a Jalali rendering; Inventory
-- document responses carry that unavailable derived member as null.
business_date_summary AS (
  SELECT
    sources.source_table,
    count(date_values.source_table) AS row_count,
    count(date_values.source_table) FILTER (
      WHERE organizations.id IS NULL
         OR organizations.calendar_system IS NULL
         OR organizations.calendar_system NOT IN ('GREGORIAN', 'JALALI')
    ) AS missing_or_invalid_calendar_rows,
    count(date_values.source_table) FILTER (
      WHERE NOT isfinite(date_values.business_date)
         OR date_values.business_date < DATE '0001-01-01'
         OR date_values.business_date > DATE '9999-12-31'
    ) AS outside_gregorian_api_range_rows,
    count(date_values.source_table) FILTER (
      WHERE organizations.calendar_system = 'JALALI'
        AND (
          date_values.business_date < DATE '0621-03-21'
          OR date_values.business_date > DATE '3798-12-31'
        )
    ) AS outside_jalali_rendering_range_rows,
    count(date_values.source_table) FILTER (
      WHERE organizations.id IS NULL
         OR organizations.calendar_system IS NULL
         OR organizations.calendar_system NOT IN ('GREGORIAN', 'JALALI')
         OR NOT isfinite(date_values.business_date)
         OR date_values.business_date < DATE '0001-01-01'
         OR date_values.business_date > DATE '9999-12-31'
         OR (
           organizations.calendar_system = 'JALALI'
           AND (
             date_values.business_date < DATE '0621-03-21'
             OR date_values.business_date > DATE '3798-12-31'
           )
         )
    ) AS unrenderable_rows
  FROM business_date_sources AS sources
  LEFT JOIN business_date_values AS date_values
    ON date_values.source_table = sources.source_table
  LEFT JOIN "organization"."organizations" AS organizations
    ON organizations.id = date_values.organization_id
  GROUP BY sources.source_table
),
report_rows AS (
  SELECT
    'validity_window'::text AS report_section,
    windows."source_table",
    windows.row_count,
    windows.valid_from_non_midnight_utc,
    windows.valid_to_non_midnight_utc,
    windows.open_ended_rows,
    windows.collapsed_or_reversed_rows,
    COALESCE(duplicates.duplicate_start_groups, 0) AS duplicate_start_groups,
    COALESCE(duplicates.duplicate_start_extra_rows, 0) AS duplicate_start_extra_rows,
    COALESCE(conflicts.overlapping_rows, 0) AS overlapping_rows,
    windows.unrenderable_version_rows AS unrenderable_rows,
    0::bigint AS missing_or_invalid_calendar_rows,
    0::bigint AS outside_gregorian_api_range_rows,
    0::bigint AS outside_jalali_rendering_range_rows
  FROM window_summary AS windows
  LEFT JOIN duplicate_starts AS duplicates USING ("source_table")
  LEFT JOIN window_conflicts AS conflicts USING ("source_table")

  UNION ALL

  SELECT
    'existing_business_date_column',
    business_dates."source_table",
    business_dates.row_count,
    0::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    business_dates.unrenderable_rows,
    business_dates.missing_or_invalid_calendar_rows,
    business_dates.outside_gregorian_api_range_rows,
    business_dates.outside_jalali_rendering_range_rows
  FROM business_date_summary AS business_dates
)
SELECT
  report_section,
  source_table,
  row_count,
  valid_from_non_midnight_utc,
  valid_to_non_midnight_utc,
  open_ended_rows,
  collapsed_or_reversed_rows,
  duplicate_start_groups,
  duplicate_start_extra_rows,
  overlapping_rows,
  unrenderable_rows,
  missing_or_invalid_calendar_rows,
  outside_gregorian_api_range_rows,
  outside_jalali_rendering_range_rows
FROM report_rows
ORDER BY report_section, source_table;
