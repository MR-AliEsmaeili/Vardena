-- OQ-77: Append-only audit retention floor (3 years minimum from event occurrence),
-- unresolved security-incident hold, and permanent separate archive ledger schema
-- paired with the independent durable filesystem archive store (OWNER_AUDIT_ARCHIVE_DIR).
-- Forward-only migration; preserves 001, 002, and 003 checksums.

CREATE OR REPLACE FUNCTION owner.compute_minimum_retained_until(p_occurred_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (((p_occurred_at AT TIME ZONE 'UTC') + INTERVAL '3 years') AT TIME ZONE 'UTC');
$$;

CREATE OR REPLACE FUNCTION owner.is_security_incident_event(
  p_event_type VARCHAR,
  p_outcome VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    p_outcome IN ('DENIED', 'FAILED')
    OR p_event_type IN (
      'AUTH_LOGIN_FAILED',
      'OPERATION_MUTATION_DENIED',
      'AUDIT_ARCHIVE_ACCESS_DENIED',
      'AUDIT_RETENTION_VIOLATION_BLOCKED'
    )
  );
$$;

ALTER TABLE owner.audit_events
  ADD COLUMN IF NOT EXISTS minimum_retained_until TIMESTAMPTZ
    GENERATED ALWAYS AS (owner.compute_minimum_retained_until(occurred_at)) STORED NOT NULL,
  ADD COLUMN IF NOT EXISTS security_incident BOOLEAN,
  ADD COLUMN IF NOT EXISTS incident_status VARCHAR(16);

ALTER TABLE owner.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_incident_metadata_check,
  ADD CONSTRAINT audit_events_incident_metadata_check CHECK (
    (security_incident IS NULL AND incident_status IS NULL)
    OR (
      security_incident = TRUE
      AND incident_status = 'UNRESOLVED'
    )
    OR (
      security_incident = FALSE
      AND incident_status = 'NONE'
      AND NOT owner.is_security_incident_event(event_type, outcome)
    )
  );

CREATE OR REPLACE FUNCTION owner.enforce_audit_retention_metadata()
RETURNS TRIGGER AS $$
DECLARE
  v_inherent BOOLEAN;
BEGIN
  NEW.occurred_at := date_trunc('milliseconds', COALESCE(NEW.occurred_at, clock_timestamp()));
  v_inherent := owner.is_security_incident_event(NEW.event_type, NEW.outcome);
  IF v_inherent AND NEW.security_incident IS FALSE THEN
    RAISE EXCEPTION 'Inconsistent incident metadata: security denial or failure event (%) must have security_incident = true', NEW.event_type
      USING ERRCODE = '23514';
  END IF;

  NEW.security_incident := COALESCE(NEW.security_incident, v_inherent);

  IF NEW.security_incident THEN
    IF NEW.incident_status IS NOT NULL AND NEW.incident_status <> 'UNRESOLVED' THEN
      RAISE EXCEPTION 'Invalid or unsupported incident_status % for security_incident = true (unresolved security incidents are protected)', NEW.incident_status
        USING ERRCODE = '23514';
    END IF;
    NEW.incident_status := 'UNRESOLVED';
  ELSE
    IF NEW.incident_status IS NOT NULL AND NEW.incident_status <> 'NONE' THEN
      RAISE EXCEPTION 'Inconsistent incident_status % for security_incident = false', NEW.incident_status
        USING ERRCODE = '23514';
    END IF;
    NEW.incident_status := 'NONE';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_audit_retention_metadata ON owner.audit_events;
CREATE TRIGGER enforce_audit_retention_metadata
BEFORE INSERT ON owner.audit_events
FOR EACH ROW EXECUTE FUNCTION owner.enforce_audit_retention_metadata();

CREATE INDEX IF NOT EXISTS audit_events_retention_floor_idx
  ON owner.audit_events (minimum_retained_until, sequence DESC);

CREATE SCHEMA IF NOT EXISTS owner_audit_archive;

CREATE TABLE IF NOT EXISTS owner_audit_archive.archive_batches (
  id VARCHAR(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  batch_number BIGINT UNIQUE NOT NULL CHECK (batch_number >= 1),
  created_by VARCHAR(26) NOT NULL REFERENCES owner.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reason VARCHAR(500) NOT NULL CHECK (
    length(btrim(reason)) BETWEEN 1 AND 500
    AND reason !~* 'BEGIN [A-Z0-9 ]*PRIVATE KEY'
  ),
  first_sequence BIGINT NOT NULL CHECK (first_sequence >= 1),
  last_sequence BIGINT NOT NULL CHECK (last_sequence >= first_sequence),
  event_count INTEGER NOT NULL CHECK (event_count >= 1),
  retention_cutoff_at TIMESTAMPTZ NOT NULL,
  previous_batch_digest VARCHAR(64) CHECK (
    previous_batch_digest IS NULL OR previous_batch_digest ~ '^[0-9a-f]{64}$'
  ),
  batch_digest_sha256 VARCHAR(64) NOT NULL UNIQUE CHECK (
    batch_digest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  durable_file_name VARCHAR(128) NOT NULL UNIQUE CHECK (
    durable_file_name ~ '^batch-[0-9]{6,}-[0-9A-HJKMNP-TV-Z]{26}\.json$'
  ),
  durable_bundle_sha256 VARCHAR(64) NOT NULL UNIQUE CHECK (
    durable_bundle_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE IF NOT EXISTS owner_audit_archive.archived_audit_events (
  id VARCHAR(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  batch_id VARCHAR(26) NOT NULL REFERENCES owner_audit_archive.archive_batches(id),
  sequence BIGINT UNIQUE NOT NULL CHECK (sequence >= 1),
  actor_id VARCHAR(26) CHECK (actor_id IS NULL OR actor_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  event_type VARCHAR(120) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) CHECK (target_id IS NULL OR length(btrim(target_id)) > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  minimum_retained_until TIMESTAMPTZ NOT NULL,
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  security_incident BOOLEAN NOT NULL,
  incident_status VARCHAR(16) NOT NULL CHECK (
    (security_incident = TRUE AND incident_status = 'UNRESOLVED')
    OR (
      security_incident = FALSE
      AND incident_status = 'NONE'
      AND NOT owner.is_security_incident_event(event_type, outcome)
    )
  ),
  reason TEXT CHECK (reason IS NULL OR reason !~* 'BEGIN [A-Z0-9 ]*PRIVATE KEY'),
  before_state JSONB CHECK (
    before_state IS NULL OR (
      before_state::text !~* '(password_hash|token_hash|sessionToken|\$argon2|BEGIN [A-Z0-9 ]*PRIVATE KEY)'
    )
  ),
  after_state JSONB CHECK (
    after_state IS NULL OR (
      after_state::text !~* '(password_hash|token_hash|sessionToken|\$argon2|BEGIN [A-Z0-9 ]*PRIVATE KEY)'
    )
  ),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  record_sha256 VARCHAR(64) NOT NULL CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT archived_audit_events_retention_floor_check CHECK (
    minimum_retained_until = owner.compute_minimum_retained_until(occurred_at)
  )
);

CREATE INDEX IF NOT EXISTS archived_audit_events_batch_seq_idx
  ON owner_audit_archive.archived_audit_events (batch_id, sequence ASC);

CREATE INDEX IF NOT EXISTS archived_audit_events_occurred_idx
  ON owner_audit_archive.archived_audit_events (occurred_at DESC, sequence DESC);

CREATE OR REPLACE FUNCTION owner_audit_archive.reject_archive_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'owner_audit_archive is append-only and permanent; UPDATE and DELETE are forbidden'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retain_archive_batches ON owner_audit_archive.archive_batches;
CREATE TRIGGER retain_archive_batches
BEFORE UPDATE OR DELETE ON owner_audit_archive.archive_batches
FOR EACH ROW EXECUTE FUNCTION owner_audit_archive.reject_archive_change();

DROP TRIGGER IF EXISTS retain_archived_events ON owner_audit_archive.archived_audit_events;
CREATE TRIGGER retain_archived_events
BEFORE UPDATE OR DELETE ON owner_audit_archive.archived_audit_events
FOR EACH ROW EXECUTE FUNCTION owner_audit_archive.reject_archive_change();

CREATE OR REPLACE FUNCTION owner_audit_archive.validate_archive_batch_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_prev owner_audit_archive.archive_batches%ROWTYPE;
  v_author owner.users%ROWTYPE;
BEGIN
  NEW.created_at := date_trunc('milliseconds', COALESCE(NEW.created_at, clock_timestamp()));
  NEW.retention_cutoff_at := date_trunc('milliseconds', NEW.retention_cutoff_at);

  SELECT * INTO v_author FROM owner.users WHERE id = NEW.created_by;
  IF NOT FOUND OR v_author.role <> 'OWNER_ADMIN' THEN
    RAISE EXCEPTION 'Archive batches require an OWNER_ADMIN created_by actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prev
  FROM owner_audit_archive.archive_batches
  ORDER BY batch_number DESC
  LIMIT 1;

  IF FOUND THEN
    IF NEW.batch_number IS NULL THEN
      NEW.batch_number := v_prev.batch_number + 1;
    ELSIF NEW.batch_number <> v_prev.batch_number + 1 THEN
      RAISE EXCEPTION 'Archive batch batch_number (%) must equal previous batch_number + 1 (%)',
        NEW.batch_number, v_prev.batch_number + 1
        USING ERRCODE = '23514';
    END IF;
    IF NEW.previous_batch_digest IS DISTINCT FROM v_prev.batch_digest_sha256 THEN
      RAISE EXCEPTION 'Archive batch previous_batch_digest does not match latest batch_digest_sha256'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.first_sequence <= v_prev.last_sequence THEN
      RAISE EXCEPTION 'Archive batch first_sequence (%) must be greater than previous batch last_sequence (%)',
        NEW.first_sequence, v_prev.last_sequence
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.batch_number IS NULL THEN
      NEW.batch_number := 1;
    ELSIF NEW.batch_number <> 1 THEN
      RAISE EXCEPTION 'First archive batch must have batch_number = 1'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.previous_batch_digest IS NOT NULL THEN
      RAISE EXCEPTION 'First archive batch must have previous_batch_digest = NULL'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_archive_batch_insert ON owner_audit_archive.archive_batches;
CREATE TRIGGER validate_archive_batch_insert
BEFORE INSERT ON owner_audit_archive.archive_batches
FOR EACH ROW EXECUTE FUNCTION owner_audit_archive.validate_archive_batch_insert();

CREATE OR REPLACE FUNCTION owner_audit_archive.verify_archived_event_matches_source()
RETURNS TRIGGER AS $$
DECLARE
  v_src owner.audit_events%ROWTYPE;
  v_batch owner_audit_archive.archive_batches%ROWTYPE;
  v_src_incident BOOLEAN;
  v_src_status VARCHAR(16);
BEGIN
  NEW.archived_at := date_trunc('milliseconds', COALESCE(NEW.archived_at, clock_timestamp()));

  SELECT * INTO v_batch
  FROM owner_audit_archive.archive_batches
  WHERE id = NEW.batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archive batch % does not exist', NEW.batch_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.sequence < v_batch.first_sequence OR NEW.sequence > v_batch.last_sequence THEN
    RAISE EXCEPTION 'Archived event sequence % is outside batch sequence bounds [%, %]',
      NEW.sequence, v_batch.first_sequence, v_batch.last_sequence
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_src
  FROM owner.audit_events
  WHERE id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archived audit event % does not exist in source owner.audit_events', NEW.id
      USING ERRCODE = '23514';
  END IF;

  v_src_incident := COALESCE(
    v_src.security_incident,
    owner.is_security_incident_event(v_src.event_type, v_src.outcome)
  );
  v_src_status := COALESCE(
    v_src.incident_status,
    CASE WHEN v_src_incident THEN 'UNRESOLVED' ELSE 'NONE' END
  );

  IF v_src.sequence <> NEW.sequence
     OR v_src.actor_id IS DISTINCT FROM NEW.actor_id
     OR v_src.event_type <> NEW.event_type
     OR v_src.target_type <> NEW.target_type
     OR v_src.target_id IS DISTINCT FROM NEW.target_id
     OR ABS(EXTRACT(EPOCH FROM (v_src.occurred_at - NEW.occurred_at))) > 0.001
     OR ABS(EXTRACT(EPOCH FROM (v_src.minimum_retained_until - NEW.minimum_retained_until))) > 0.001
     OR v_src.outcome <> NEW.outcome
     OR v_src_incident <> NEW.security_incident
     OR v_src_status <> NEW.incident_status
     OR v_src.reason IS DISTINCT FROM NEW.reason THEN
    RAISE EXCEPTION 'Archived audit event % contradicts source owner.audit_events record', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS verify_archived_event_matches_source ON owner_audit_archive.archived_audit_events;
CREATE TRIGGER verify_archived_event_matches_source
BEFORE INSERT ON owner_audit_archive.archived_audit_events
FOR EACH ROW EXECUTE FUNCTION owner_audit_archive.verify_archived_event_matches_source();

REVOKE ALL ON SCHEMA owner_audit_archive FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA owner_audit_archive FROM PUBLIC;
