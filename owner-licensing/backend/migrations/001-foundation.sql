CREATE SCHEMA owner;
CREATE TABLE owner.users (
  id varchar(26) PRIMARY KEY,
  username varchar(64) NOT NULL UNIQUE CHECK (length(btrim(username)) > 0),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  role text NOT NULL CHECK (role IN ('SYSTEM_ADMIN','LICENSE_ISSUANCE','READ_ONLY_OBSERVER','SUPPORT_SPECIALIST')),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE owner.sessions (
  id varchar(26) PRIMARY KEY,
  user_id varchar(26) NOT NULL REFERENCES owner.users(id),
  token_hash char(64) UNIQUE NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 minutes',
  absolute_expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '12 hours',
  revoked_at timestamptz
);
CREATE INDEX sessions_user ON owner.sessions(user_id);
CREATE TABLE owner.login_limits (
  bucket char(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  reset_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '15 minutes'
);
CREATE TABLE owner.customers (
  id varchar(26) PRIMARY KEY,
  customer_code varchar(64) NOT NULL UNIQUE,
  display_name varchar(200) NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  contract_reference varchar(200) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  updated_by varchar(26) NOT NULL REFERENCES owner.users(id),
  CONSTRAINT customer_code_valid CHECK (customer_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$' AND customer_code <> id)
);
-- Identity/code are stable, even a future unrelated SQL update cannot rebind them.
CREATE FUNCTION owner.immutable_customer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_code IS DISTINCT FROM OLD.customer_code THEN
    RAISE EXCEPTION 'Customer identity and code are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_identity BEFORE UPDATE ON owner.customers FOR EACH ROW EXECUTE FUNCTION owner.immutable_customer_identity();
CREATE TABLE owner.audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id varchar(26) PRIMARY KEY,
  actor_id varchar(26) REFERENCES owner.users(id),
  event_type varchar(120) NOT NULL,
  target_type varchar(64) NOT NULL,
  target_id varchar(64),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','DENIED')),
  reason varchar(500),
  before_state jsonb,
  after_state jsonb
);
CREATE INDEX audit_target ON owner.audit_events(target_type,target_id,sequence DESC);
CREATE FUNCTION owner.reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Owner audit is append-only'; END $$;
CREATE TRIGGER retain_audit BEFORE UPDATE OR DELETE ON owner.audit_events FOR EACH ROW EXECUTE FUNCTION owner.reject_audit_change();
-- Reserved lifecycle boundary; no API writes or signed artifacts in this phase.
CREATE TABLE owner.operational_records (
  id varchar(26) PRIMARY KEY,
  customer_id varchar(26) NOT NULL REFERENCES owner.customers(id),
  kind text NOT NULL CHECK (kind IN ('LICENSE','SERVER_REPLACEMENT')),
  observed_status varchar(64) NOT NULL,
  installation_reference varchar(200),
  replaces_record_id varchar(26),
  emergency_old_server_lost boolean NOT NULL DEFAULT false,
  UNIQUE (id,customer_id),
  FOREIGN KEY (replaces_record_id,customer_id) REFERENCES owner.operational_records(id,customer_id)
);
CREATE TABLE owner.operational_transitions (
  id varchar(26) PRIMARY KEY,
  record_id varchar(26) NOT NULL REFERENCES owner.operational_records(id),
  actor_id varchar(26) NOT NULL REFERENCES owner.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prior_status varchar(64) NOT NULL,
  new_status varchar(64) NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  evidence_reference varchar(200),
  confirmation_kind text NOT NULL CHECK (confirmation_kind = 'OPERATOR_OBSERVED')
);
REVOKE ALL ON SCHEMA owner FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA owner FROM PUBLIC;
