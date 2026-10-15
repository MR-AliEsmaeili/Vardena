-- Phase 1.1 manual observation facts. Applied only by the Owner migrator.
-- Expects owner.operational_records to be empty: Phase 1 exposed no write API.
-- Fails closed if rows already exist rather than inventing actors or backfill.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM owner.operational_records) THEN
    RAISE EXCEPTION 'Refusing to extend operational records that already contain rows';
  END IF;
END $$;

ALTER TABLE owner.operational_records
  ADD COLUMN observation_category text NOT NULL,
  ADD COLUMN old_installation_reference varchar(200),
  ADD COLUMN replacement_installation_reference varchar(200),
  ADD COLUMN old_server_observed_state varchar(64),
  ADD COLUMN replacement_observed_state varchar(64),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  ADD COLUMN updated_by varchar(26) NOT NULL REFERENCES owner.users(id);

ALTER TABLE owner.operational_records
  ADD CONSTRAINT installation_reference_shape CHECK (
    installation_reference IS NULL
    OR installation_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$'
  ),
  ADD CONSTRAINT old_installation_reference_shape CHECK (
    old_installation_reference IS NULL
    OR old_installation_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$'
  ),
  ADD CONSTRAINT replacement_installation_reference_shape CHECK (
    replacement_installation_reference IS NULL
    OR replacement_installation_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$'
  ),
  ADD CONSTRAINT replacement_link_kind CHECK (
    replaces_record_id IS NULL OR kind = 'SERVER_REPLACEMENT'
  ),
  ADD CONSTRAINT license_observation_shape CHECK (
    kind <> 'LICENSE'
    OR (
      observed_status IN ('ISSUED', 'ACTIVATED')
      AND installation_reference IS NOT NULL
      AND old_installation_reference IS NULL
      AND replacement_installation_reference IS NULL
      AND old_server_observed_state IS NULL
      AND replacement_observed_state IS NULL
      AND emergency_old_server_lost = false
      AND replaces_record_id IS NULL
      AND (
        (
          observed_status = 'ISSUED'
          AND observation_category = 'EXTERNAL_ISSUANCE_OBSERVED'
        )
        OR (
          observed_status = 'ACTIVATED'
          AND observation_category = 'ACTIVATION_OBSERVED'
        )
      )
    )
  ),
  ADD CONSTRAINT server_replacement_shape CHECK (
    kind <> 'SERVER_REPLACEMENT'
    OR (
      installation_reference IS NULL
      AND old_installation_reference IS NOT NULL
      AND replacement_installation_reference IS NOT NULL
      AND old_installation_reference <> replacement_installation_reference
      AND observed_status IN (
        'REPLACEMENT_AUTHORIZED',
        'OLD_SERVER_STATE_RECORDED',
        'REPLACEMENT_RECORDED'
      )
      AND (
        (
          observed_status = 'REPLACEMENT_AUTHORIZED'
          AND observation_category = 'REPLACEMENT_AUTHORIZED'
          AND emergency_old_server_lost = false
          AND old_server_observed_state IS NULL
          AND replacement_observed_state IS NULL
        )
        OR (
          observed_status = 'OLD_SERVER_STATE_RECORDED'
          AND observation_category = 'OLD_SERVER_STATE_OBSERVED'
          AND replacement_observed_state IS NULL
          AND (
            (
              emergency_old_server_lost = false
              AND old_server_observed_state = 'DEACTIVATION_OBSERVED'
            )
            OR (
              emergency_old_server_lost = true
              AND old_server_observed_state = 'UNAVAILABLE_EMERGENCY_LOSS'
            )
          )
        )
        OR (
          observed_status = 'REPLACEMENT_RECORDED'
          AND observation_category = 'REPLACEMENT_INSTALLATION_OBSERVED'
          AND replacement_observed_state = 'INSTALLATION_OBSERVED'
          AND (
            (
              emergency_old_server_lost = false
              AND old_server_observed_state = 'DEACTIVATION_OBSERVED'
            )
            OR (
              emergency_old_server_lost = true
              AND old_server_observed_state = 'UNAVAILABLE_EMERGENCY_LOSS'
            )
          )
        )
      )
    )
  );

-- One license observation chain per installation. A second chain is a duplicate,
-- not a renewal (renewal is outside this manual slice).
CREATE UNIQUE INDEX operational_license_installation_unique
  ON owner.operational_records (customer_id, installation_reference)
  WHERE kind = 'LICENSE';
-- One replacement record per old installation, including a completed one.
-- An abandoned non-terminal record also occupies this slot; PDR-17 defines no
-- withdrawal transition, so this migration does not invent one.
CREATE UNIQUE INDEX operational_replacement_old_once
  ON owner.operational_records (customer_id, old_installation_reference)
  WHERE kind = 'SERVER_REPLACEMENT';
CREATE UNIQUE INDEX operational_replacement_new_once
  ON owner.operational_records (customer_id, replacement_installation_reference)
  WHERE kind = 'SERVER_REPLACEMENT';
CREATE INDEX operational_records_customer
  ON owner.operational_records (customer_id, id DESC);

ALTER TABLE owner.operational_transitions
  ADD CONSTRAINT transition_status_vocabulary CHECK (
    prior_status IN (
      'UNRECORDED',
      'ISSUED',
      'ACTIVATED',
      'REPLACEMENT_AUTHORIZED',
      'OLD_SERVER_STATE_RECORDED',
      'REPLACEMENT_RECORDED'
    )
    AND new_status IN (
      'ISSUED',
      'ACTIVATED',
      'REPLACEMENT_AUTHORIZED',
      'OLD_SERVER_STATE_RECORDED',
      'REPLACEMENT_RECORDED'
    )
    AND prior_status <> new_status
  );
CREATE INDEX operational_transitions_record
  ON owner.operational_transitions (record_id, occurred_at, id);

CREATE FUNCTION owner.immutable_operation_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.installation_reference IS DISTINCT FROM OLD.installation_reference
    OR NEW.old_installation_reference IS DISTINCT FROM OLD.old_installation_reference
    OR NEW.replacement_installation_reference IS DISTINCT FROM OLD.replacement_installation_reference
    OR NEW.emergency_old_server_lost IS DISTINCT FROM OLD.emergency_old_server_lost
    OR NEW.replaces_record_id IS DISTINCT FROM OLD.replaces_record_id
    OR (
      OLD.old_server_observed_state IS NOT NULL
      AND NEW.old_server_observed_state IS DISTINCT FROM OLD.old_server_observed_state
    )
    OR (
      OLD.replacement_observed_state IS NOT NULL
      AND NEW.replacement_observed_state IS DISTINCT FROM OLD.replacement_observed_state
    )
  THEN
    RAISE EXCEPTION 'Operational record identity and recorded facts are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_operation_facts
  BEFORE UPDATE ON owner.operational_records
  FOR EACH ROW EXECUTE FUNCTION owner.immutable_operation_facts();

CREATE FUNCTION owner.enforce_observed_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.observed_status IS NOT DISTINCT FROM OLD.observed_status THEN
    RETURN NEW;
  END IF;
  IF OLD.kind = 'LICENSE'
    AND OLD.observed_status = 'ISSUED'
    AND NEW.observed_status = 'ACTIVATED'
  THEN
    RETURN NEW;
  END IF;
  IF OLD.kind = 'SERVER_REPLACEMENT'
    AND OLD.observed_status = 'REPLACEMENT_AUTHORIZED'
    AND NEW.observed_status = 'OLD_SERVER_STATE_RECORDED'
    AND OLD.emergency_old_server_lost = false
    AND NEW.old_server_observed_state = 'DEACTIVATION_OBSERVED'
  THEN
    RETURN NEW;
  END IF;
  IF OLD.kind = 'SERVER_REPLACEMENT'
    AND OLD.observed_status = 'OLD_SERVER_STATE_RECORDED'
    AND NEW.observed_status = 'REPLACEMENT_RECORDED'
    AND NEW.replacement_observed_state = 'INSTALLATION_OBSERVED'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Observed status transition is not permitted'
    USING ERRCODE = '23514';
END $$;
CREATE TRIGGER enforce_observed_transition
  BEFORE UPDATE ON owner.operational_records
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_observed_transition();

-- Same-customer FK already rejects a cross-customer link. This additionally
-- requires the link to be that customer's license observation for the old
-- installation, not an arbitrary operational row.
CREATE FUNCTION owner.replacement_link_matches_license() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  linked_kind text;
  linked_installation varchar(200);
BEGIN
  IF NEW.replaces_record_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT kind, installation_reference
    INTO linked_kind, linked_installation
    FROM owner.operational_records
    WHERE id = NEW.replaces_record_id AND customer_id = NEW.customer_id;
  IF linked_kind IS DISTINCT FROM 'LICENSE'
    OR linked_installation IS DISTINCT FROM NEW.old_installation_reference
  THEN
    RAISE EXCEPTION 'Replacement link must match the same-customer license installation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER replacement_link_matches_license
  BEFORE INSERT OR UPDATE ON owner.operational_records
  FOR EACH ROW EXECUTE FUNCTION owner.replacement_link_matches_license();

CREATE FUNCTION owner.reject_transition_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operational transitions are append-only';
END $$;
CREATE TRIGGER retain_transitions
  BEFORE UPDATE OR DELETE ON owner.operational_transitions
  FOR EACH ROW EXECUTE FUNCTION owner.reject_transition_change();

-- Runtime grants are deployment-specific and are NOT applied here. The runtime
-- role needs SELECT/INSERT/UPDATE on owner.operational_records and
-- SELECT/INSERT on owner.operational_transitions only. Do not grant DELETE,
-- TRUNCATE, trigger bypass, or UPDATE/DELETE on transitions.
