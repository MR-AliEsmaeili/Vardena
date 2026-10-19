-- OQ-74: administrative metadata only. No keys, signatures, trust rollout or
-- automatic license invalidation. Additive on populated 005 databases; no backfill.
CREATE TABLE owner.signing_keys (
  id varchar(120) PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120 AND id !~ '[[:space:][:cntrl:]]' AND id !~* '(PRIVATE KEY|-----BEGIN |VLIC1|VLIC2|VDEA1|VDRQ1|VDRP1)'),
  label varchar(200) NOT NULL CHECK (length(btrim(label)) > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPROMISED','REVOKED')),
  status_detected_at timestamptz,
  status_reason varchar(500) CHECK (status_reason IS NULL OR length(btrim(status_reason)) > 0),
  evidence_ref varchar(200),
  notes varchar(2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  updated_by varchar(26) NOT NULL REFERENCES owner.users(id),
  CHECK ((status_detected_at IS NULL AND status_reason IS NULL AND status='ACTIVE')
    OR (status_detected_at IS NOT NULL AND status_reason IS NOT NULL)),
  CHECK (concat(label,status_reason,evidence_ref,notes) !~ '[[:cntrl:]]'
    AND concat(label,status_reason,evidence_ref,notes) !~* '(PRIVATE KEY|-----BEGIN |VLIC1|VLIC2|VDEA1|VDRQ1|VDRP1)')
);
ALTER TABLE owner.operational_records
  ADD COLUMN signing_key_id varchar(120) REFERENCES owner.signing_keys(id),
  ADD CONSTRAINT signing_key_id_license_only CHECK (kind='LICENSE' OR signing_key_id IS NULL);
CREATE INDEX operational_records_signing_key ON owner.operational_records(signing_key_id);
CREATE INDEX signing_keys_status ON owner.signing_keys(status);
-- IDs up to 120 characters must survive source audit and independent archive.
ALTER TABLE owner.audit_events ALTER COLUMN target_id TYPE varchar(120);

-- Associations are immutable observed facts, including null legacy associations.
CREATE FUNCTION owner.immutable_signing_key_association() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signing_key_id IS DISTINCT FROM OLD.signing_key_id THEN
    RAISE EXCEPTION 'Signing-key observation is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_signing_key_association BEFORE UPDATE ON owner.operational_records
  FOR EACH ROW EXECUTE FUNCTION owner.immutable_signing_key_association();
REVOKE ALL ON owner.signing_keys FROM PUBLIC;
