-- PDR-18 §1 (Product Owner decision 2026-10-17), corrected 2026-10-17:
-- commercial contract dates, Owner-side observation metadata and customer-side
-- signed-license validity are THREE SEPARATE concepts, and this model records
-- only the first two.
--
--   owner.customers.contract_start_date / contract_end_date
--     Commercial and administrative information recorded by the Owner. They do
--     not define, and never rewrite, a signed license's technical validity, and
--     they may legitimately precede issuance.
--
--   owner.operational_records.observed_validity_end
--     The validity end the OPERATOR RECORDED having seen, and nothing more.
--     The Owner application performs no cryptographic verification
--     (PDR-17: cryptographic issuance, signed receipt, deactivation proof,
--     revocation and recovery are "not implemented"; every response states
--     `cryptographicVerification = NOT_IMPLEMENTED`). This column is therefore
--     an `OPERATOR_OBSERVED` administrative fact about what was recorded, NOT
--     an attested property of a signed artifact.
--
--   The day the observation was recorded — `recordedOn` in the API — is NOT a
--     stored column. It is derived, on read, as the UTC calendar day of the
--     existing `created_at` instant, which is `NOT NULL DEFAULT
--     clock_timestamp()` and is protected against change by the
--     `owner.immutable_operation_facts` trigger of migration 002. Deriving it
--     means no separate column can drift from it, no backfill is needed, and
--     no historical issuance or activation date is ever fabricated for rows
--     recorded before this migration.
--
--   Customer-side signed-license validity (`VLIC2` `validFrom`/`validUntil`,
--     the version model in `backend/src/modules/licensing/`) is owned by the
--     customer runtime and is deliberately NOT modelled here. See OQ-88.
--
-- DELIBERATELY ABSENT: any rule requiring `observed_validity_end` to be later
-- than the recording day. `recordedOn` is when an OPERATOR RECORDED the
-- observation; it is not the signed license's technical activation start, which
-- this application cannot know. An operator must be able to record an
-- observation of an ALREADY-EXPIRED license, so the recorded end may precede,
-- equal or follow the recording day. The signed-license interval convention
-- (an end follows its own technical start) remains valid where that start is
-- authoritatively known — it is simply not this model's start.
--
-- Both stored day columns are PostgreSQL `date` (canonical BusinessDate
-- `YYYY-MM-DD`, docs/datetime.md / AR-32), never a UTC-midnight JS `Date` on
-- the wire. Forward-only migration; preserves 001, 002, 003 and 004 checksums.
--
-- 005 has never been part of a released migration history (it exists only on
-- the unmerged PR branch that introduces it), so it is corrected in place
-- rather than superseded by a follow-up migration. No supported installation
-- can have applied it; the ledger checksum guard makes any such mismatch loud.

ALTER TABLE owner.customers
  ADD COLUMN contract_start_date date,
  ADD COLUMN contract_end_date date,
  ADD CONSTRAINT contract_date_order CHECK (
    contract_start_date IS NULL
    OR contract_end_date IS NULL
    OR contract_end_date >= contract_start_date
  );

ALTER TABLE owner.operational_records
  ADD COLUMN observed_validity_end date,
  -- An observed validity end is a license concept; a server-replacement record
  -- records no license validity at all.
  ADD CONSTRAINT observed_validity_end_license_only CHECK (
    kind = 'LICENSE'
    OR observed_validity_end IS NULL
  );
