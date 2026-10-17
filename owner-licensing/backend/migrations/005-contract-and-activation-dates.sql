-- PDR-18 §1 (Product Owner decision 2026-10-17): commercial contract dates and
-- technical activation-validity dates are SEPARATE concepts.
--
--   owner.customers.contract_start_date / contract_end_date
--     Commercial and administrative information recorded by the Owner. They do
--     not define, and never rewrite, a signed license's technical
--     activation-validity window, and they may legitimately precede issuance.
--
--   owner.operational_records.activation_valid_from / activation_valid_until
--     The activation-validity window of the recorded license. The start is the
--     authoritative issuance day, asserted by the server; it is never accepted
--     from a client. The end is set by the issuer and is EXCLUSIVE, following
--     the existing half-open signed-license interval convention.
--
-- Both pairs are PostgreSQL `date` (canonical BusinessDate `YYYY-MM-DD`,
-- docs/datetime.md / AR-32), never a UTC-midnight JS `Date` on the wire.
-- Forward-only migration; preserves 001, 002, 003 and 004 checksums.

ALTER TABLE owner.customers
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD CONSTRAINT contract_date_order CHECK (
    contract_start_date IS NULL
    OR contract_end_date IS NULL
    OR contract_end_date >= contract_start_date
  );

ALTER TABLE owner.operational_records
  ADD COLUMN IF NOT EXISTS activation_valid_from date,
  ADD COLUMN IF NOT EXISTS activation_valid_until date,
  ADD CONSTRAINT activation_validity_order CHECK (
    activation_valid_from IS NULL
    OR activation_valid_until IS NULL
    OR activation_valid_until > activation_valid_from
  ),
  -- Activation validity is a license concept; a server-replacement record
  -- carries no activation window at all.
  ADD CONSTRAINT activation_validity_license_only CHECK (
    kind = 'LICENSE'
    OR (
      activation_valid_from IS NULL
      AND activation_valid_until IS NULL
    )
  ),
  -- PDR-18 §1.2: the activation-validity start is mandatory for a license
  -- record. It is added NOT VALID on purpose: a row recorded before this
  -- migration may legitimately carry no recorded start, and this migration
  -- must not fail a populated upgrade. The constraint is enforced for every
  -- insert and update from this point on, and a deployment owner may
  -- `ALTER TABLE owner.operational_records VALIDATE CONSTRAINT
  -- activation_valid_from_required` after reviewing the backfill below.
  ADD CONSTRAINT activation_valid_from_required CHECK (
    kind <> 'LICENSE' OR activation_valid_from IS NOT NULL
  ) NOT VALID;

-- Backward-compatibility backfill for rows recorded before this migration.
-- The issuance-observation instant (`created_at`) is the only authoritative
-- issuance evidence such rows carry, so its UTC calendar day is used as the
-- activation-validity start. No end date is invented: a pre-existing row keeps
-- `activation_valid_until = NULL` (no recorded end) rather than a guessed one.
-- New rows never rely on this branch; the API asserts the start explicitly.
--
-- This statement is deliberately LAST: an UPDATE followed by an ALTER TABLE on
-- the same table inside one transaction fails with SQLSTATE 55006 ("cannot
-- ALTER TABLE ... because it has pending trigger events"), and the migration
-- chain is applied in a single transaction.
UPDATE owner.operational_records
  SET activation_valid_from = (created_at AT TIME ZONE 'UTC')::date
WHERE kind = 'LICENSE'
  AND activation_valid_from IS NULL;
