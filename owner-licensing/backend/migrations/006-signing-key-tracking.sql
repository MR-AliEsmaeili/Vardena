-- OQ-74 (Product Owner decision 2026-10-18): signing-key compromise response.
--
-- When an Owner signing key is compromised:
--   1. A new key is generated as replacement; the trust list on the customer
--      runtime is rotated so the new key verifies and the compromised key no
--      longer does. Future licenses are issued with the new key.
--   2. Disposition of customers whose licenses were signed with the compromised
--      key is the Owner's CASE-BY-CASE decision. There is NO automatic
--      invalidation of already-issued licenses solely because the signing key
--      was compromised (PDR-11 §3.9 / §10.1 invariant preserved).
--   3. The Owner UI displays, per license observation, which signing key
--      signed it, and a safety status derived from the key's current status:
--        - SAFE          — signed with an ACTIVE key
--        - NEEDS_REVIEW  — signed with a COMPROMISED or REVOKED key
--        - UNKNOWN       — no signing key recorded for this observation
--
-- This migration is observational only (PDR-17: cryptographic issuance is
-- "not implemented" in the Owner app). The Owner Admin records which signing
-- key was used for a license observation, and marks a key as COMPROMISED or
-- REVOKED from the UI. The customer runtime remains the authority for actual
-- signature verification.
--
-- Forward-only additive migration; preserves 001..005 checksums.

CREATE TABLE owner.signing_keys (
  id text PRIMARY KEY,
  -- Human-friendly label (e.g. "Production key 2026-10"). Not the key material.
  label text NOT NULL,
  -- ACTIVE: trusted; licenses signed with it are SAFE.
  -- COMPROMISED: suspected/known compromise; licenses signed with it NEEDS_REVIEW.
  -- REVOKED: explicitly revoked (separate from compromise); licenses signed with it NEEDS_REVIEW.
  status text NOT NULL CHECK (status IN ('ACTIVE','COMPROMISED','REVOKED')) DEFAULT 'ACTIVE',
  -- When the current status was detected/recorded. Null while ACTIVE.
  status_detected_at timestamptz,
  -- Operator reason for the latest status change (1..500). Null while ACTIVE.
  status_reason text,
  -- Optional reference to external evidence (ticket URL, doc id, etc.).
  evidence_ref text,
  -- Free-form notes about this key. Bounded to a reasonable size.
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  CHECK (status = 'ACTIVE' OR status_detected_at IS NOT NULL),
  CHECK (status = 'ACTIVE' OR status_reason IS NOT NULL)
);

-- One signing key may have many license observations; one license observation
-- records at most one signing key (the key visible on the artifact that the
-- operator observed).
ALTER TABLE owner.operational_records
  ADD COLUMN signing_key_id text REFERENCES owner.signing_keys(id),
  -- A signing key is only meaningful on a LICENSE observation, not a
  -- server-replacement record.
  ADD CONSTRAINT signing_key_id_license_only CHECK (
    kind = 'LICENSE'
    OR signing_key_id IS NULL
  );

CREATE INDEX signing_keys_status_idx ON owner.signing_keys(status);
CREATE INDEX operational_records_signing_key_id_idx
  ON owner.operational_records(signing_key_id);
