-- OQ-73 resolution (C-63 correction, ADR-0042 §2) — BusinessDate columns
-- become true PostgreSQL `date`; Instants stay `timestamptz`.
--
-- A business date is a CALENDAR DAY, not an instant: it has no time of day
-- and no time zone. Until this migration the inventory module carried its
-- business days in `timestamptz` columns under the documented convention
-- "the day's UTC-midnight instant" (`{YYYY-MM-DD}T00:00:00.000Z`). That
-- convention is RETIRED by this migration: the authoritative stored value of
-- a business date is now `YYYY-MM-DD` in a `date` column. Jalali remains a
-- presentation/input calendar at the boundary; nothing but canonical
-- Gregorian days is stored (docs/datetime.md §2, ADR-0042).
--
-- CONVERTED COLUMNS (each audited semantically — every one is the calendar
-- day a stock fact or document belongs to, never the moment something
-- happened; all `*_at` instant columns are untouched):
--
-- 1. `inventory.inventory_movements.movement_date` — the business day of the
--    ledger fact (drives period filters and Kardex ordering; the exact
--    registration moment stays `created_at`, a `timestamptz`).
-- 2. `inventory.inventory_business_documents.business_date` — the document's
--    business day (independent of `created_at`: a document may be created
--    today for an earlier business day).
-- 3. `inventory.inventory_accounting_posting_snapshots.document_date` — the
--    frozen copy of that same document day sent to Accounting (the snapshot's
--    `captured_at` instant is untouched).
-- 4. `inventory.inventory_pricing_runs.from_date` / `to_date` — the range
--    BOUNDS over movement business dates: `(from_date, to_date]` on days.
-- 5. `inventory.inventory_valuation_runs.from_date` — "the business date the
--    run was requested for" (audit-only, but still a day).
-- 6. `inventory.inventory_balances.last_movement_at` → RENAMED to
--    `last_movement_date` — the projection of the key's greatest
--    `movement_date`; the old name implied an instant it never was.
--
-- NOT converted (explicit audit outcome — they are Instants): every `*_at`
-- column (`created_at`, `updated_at`, `finalized_at`, `accounting_posted_at`,
-- `sealed_at`, `cancelled_at`, `valued_at`, `stale_since`, `last_valued_at`,
-- `executed_at`, `captured_at`, `requested_at`, `completed_at`, …), the
-- unit-conversion and valuation-method validity windows (`valid_from` /
-- `valid_to`), `accounting.posting_timestamp`, and every licensing/workflow
-- `effective_from` / `valid_until`. Accounting's own `document_date` and the
-- fiscal-calendar `start_date` / `end_date` columns are ALREADY `date`.
--
-- LEGACY NORMALIZATION POLICY (deterministic, documented):
-- Every converted value keeps the UTC CALENDAR DAY of the stored instant:
--
--     (column AT TIME ZONE 'UTC')::date
--
-- This is exactly the day every existing read path reported before this
-- migration (`businessDateFromUtcMidnight` — the UTC day of the stored
-- instant, chosen precisely so no organization zone could shift it), so no
-- row changes its business date: rows written as UTC midnight map to the
-- identical day, and legacy rows carrying an arbitrary instant (the old
-- backward-compatibility path stored ISO instants verbatim) keep the UTC day
-- that instant falls on. The discarded time-of-day component was never a
-- business-date fact: the registration moment of every row survives in its
-- `created_at` instant. No data is deleted and no row is lost.
--
-- Indexes that reference the converted columns are rebuilt by the type
-- change automatically; their column lists are unchanged, so every existing
-- day filter stays index-friendly (and becomes a pure date comparison).

-- 1. Movement ledger ---------------------------------------------------------

ALTER TABLE "inventory"."inventory_movements"
  ALTER COLUMN "movement_date" TYPE date
  USING ("movement_date" AT TIME ZONE 'UTC')::date;

-- 2. Inventory business documents --------------------------------------------

ALTER TABLE "inventory"."inventory_business_documents"
  ALTER COLUMN "business_date" TYPE date
  USING ("business_date" AT TIME ZONE 'UTC')::date;

-- 3. Accounting posting snapshots --------------------------------------------

ALTER TABLE "inventory"."inventory_accounting_posting_snapshots"
  ALTER COLUMN "document_date" TYPE date
  USING ("document_date" AT TIME ZONE 'UTC')::date;

-- 4. Pricing run range bounds ------------------------------------------------

ALTER TABLE "inventory"."inventory_pricing_runs"
  ALTER COLUMN "from_date" TYPE date
  USING ("from_date" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "to_date" TYPE date
  USING ("to_date" AT TIME ZONE 'UTC')::date;

-- 5. Valuation run audit day --------------------------------------------------

ALTER TABLE "inventory"."inventory_valuation_runs"
  ALTER COLUMN "from_date" TYPE date
  USING ("from_date" AT TIME ZONE 'UTC')::date;

-- 6. Balance projection of the newest movement day (rename + retype) ---------

ALTER TABLE "inventory"."inventory_balances"
  RENAME COLUMN "last_movement_at" TO "last_movement_date";

ALTER TABLE "inventory"."inventory_balances"
  ALTER COLUMN "last_movement_date" TYPE date
  USING ("last_movement_date" AT TIME ZONE 'UTC')::date;
