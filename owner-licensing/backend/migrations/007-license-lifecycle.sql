-- OD-LIC-07…19 — Owner-side license lifecycle storage.
--
-- Additive, forward-only, safe on a fresh and on a populated 006 database.
-- No backfill invents a fact: every table starts empty and every row records
-- who created it and when, from the server clock.
--
--   owner.user_permission_grants     per-user operator grants (OD-LIC-12, R-1:
--                                    creation writes NO row; a permission is
--                                    effective only with an active grant and
--                                    only inside the role's eligibility)
--   owner.customer_limit_profiles    optional per-customer ceiling (F-1, OD-LIC-13
--                                    reactivation, OD-LIC-14 request snapshots)
--   owner.installation_identities    OD-LIC-09 controlled registration
--   owner.license_issuances          the issuance ledger + immutable request
--                                    snapshot and both digests (OD-LIC-11)
--   owner.license_revocations        the revocation ledger (OD-LIC-17)
--   owner.license_artifacts          staged durable artifact archive (OD-LIC-19)
--
-- No JSONB column, no wildcard permission, no key material.

-- ---------------------------------------------------------------------------
-- Permission eligibility: a closed list. No prefix, no pattern, no wildcard.
-- ---------------------------------------------------------------------------

CREATE FUNCTION owner.is_operator_eligible_permission(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT p IN (
    'customers.view',
    'audit.view',
    'operations.view',
    'operations.record',
    'licenses.issue.time_limited',
    'licenses.import',
    'licenses.view',
    'licenses.download'
  );
$$;

CREATE TABLE owner.user_permission_grants (
  user_id varchar(26) NOT NULL REFERENCES owner.users(id),
  permission text NOT NULL CHECK (owner.is_operator_eligible_permission(permission)),
  granted_by varchar(26) NOT NULL REFERENCES owner.users(id),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by varchar(26) REFERENCES owner.users(id),
  revoked_at timestamptz,
  revocation_reason varchar(500) CHECK (
    revocation_reason IS NULL OR length(btrim(revocation_reason)) > 0
  ),
  PRIMARY KEY (user_id, permission),
  CONSTRAINT grant_revocation_together CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND revoked_by IS NOT NULL
      AND revocation_reason IS NOT NULL
    )
  )
);

CREATE FUNCTION owner.validate_permission_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_subject_role text;
  v_grantor_role text;
  v_revoker_role text;
BEGIN
  SELECT role INTO v_subject_role FROM owner.users WHERE id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grant subject does not exist' USING ERRCODE = '23503';
  END IF;
  -- OD-LIC-12: OWNER_ADMIN is not under the grant model and never appears here.
  IF v_subject_role <> 'LICENSE_OPERATOR' THEN
    RAISE EXCEPTION 'Only a LICENSE_OPERATOR account may hold per-user grants'
      USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_grantor_role FROM owner.users WHERE id = NEW.granted_by;
  IF v_grantor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
    RAISE EXCEPTION 'Only an OWNER_ADMIN may grant or re-grant a permission'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_by IS NOT NULL THEN
    SELECT role INTO v_revoker_role FROM owner.users WHERE id = NEW.revoked_by;
    IF v_revoker_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
      RAISE EXCEPTION 'Only an OWNER_ADMIN may revoke a permission'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.permission IS DISTINCT FROM OLD.permission) THEN
    RAISE EXCEPTION 'A grant row identifies one (user, permission) pair'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_permission_grant
  BEFORE INSERT OR UPDATE ON owner.user_permission_grants
  FOR EACH ROW EXECUTE FUNCTION owner.validate_permission_grant();

CREATE INDEX user_permission_grants_active
  ON owner.user_permission_grants (user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Optional per-customer limit profile (F-1 hybrid, OD-LIC-13, OD-LIC-14)
-- ---------------------------------------------------------------------------

CREATE FUNCTION owner.modules_are_unique(p_modules text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_modules IS NOT NULL
    AND cardinality(p_modules) > 0
    AND cardinality(p_modules) = (
      SELECT count(DISTINCT entry) FROM unnest(p_modules) AS entry
    );
$$;

CREATE FUNCTION owner.modules_are_known(p_modules text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_modules IS NOT NULL
    AND p_modules <@ ARRAY[
      'accounting','documents','inventory','organization','rbac','users','workflow'
    ]::text[];
$$;

CREATE TABLE owner.customer_limit_profiles (
  id varchar(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  customer_id varchar(26) NOT NULL REFERENCES owner.customers(id),
  organization_limit integer,
  user_limit integer,
  allowed_modules text[] NOT NULL,
  perpetual_allowed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by varchar(26) NOT NULL REFERENCES owner.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT limit_profile_limits_positive CHECK (
    (organization_limit IS NULL OR organization_limit > 0)
    AND (user_limit IS NULL OR user_limit > 0)
  ),
  CONSTRAINT limit_profile_modules_known CHECK (owner.modules_are_known(allowed_modules)),
  CONSTRAINT limit_profile_modules_unique CHECK (owner.modules_are_unique(allowed_modules))
);

-- At most one ACTIVE profile per customer; retired rows keep their history and
-- a replacement (or a reactivation of the same row) is possible.
CREATE UNIQUE INDEX customer_limit_profiles_one_active_per_customer
  ON owner.customer_limit_profiles (customer_id)
  WHERE status = 'ACTIVE';

CREATE INDEX customer_limit_profiles_customer
  ON owner.customer_limit_profiles (customer_id, created_at DESC);

CREATE FUNCTION owner.enforce_limit_profile_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor_role text;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.organization_limit IS DISTINCT FROM OLD.organization_limit
     OR NEW.user_limit IS DISTINCT FROM OLD.user_limit
     OR NEW.allowed_modules IS DISTINCT FROM OLD.allowed_modules
     OR NEW.perpetual_allowed IS DISTINCT FROM OLD.perpetual_allowed
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Limit-profile ceiling values are immutable; retire and create instead'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED')
       OR (OLD.status = 'RETIRED' AND NEW.status = 'ACTIVE')
     ) THEN
    RAISE EXCEPTION 'Illegal limit-profile status transition'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    RAISE EXCEPTION 'A limit-profile update must be a status transition'
      USING ERRCODE = '23514';
  END IF;
  SELECT role INTO v_actor_role FROM owner.users WHERE id = NEW.updated_by;
  IF v_actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
    RAISE EXCEPTION 'Only an OWNER_ADMIN may change a limit profile'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_limit_profile_lifecycle
  BEFORE UPDATE ON owner.customer_limit_profiles
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_limit_profile_lifecycle();

CREATE FUNCTION owner.validate_limit_profile_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor_role text;
BEGIN
  SELECT role INTO v_actor_role FROM owner.users WHERE id = NEW.created_by;
  IF v_actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
    RAISE EXCEPTION 'Only an OWNER_ADMIN may create a limit profile'
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_by := NEW.created_by;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_limit_profile_insert
  BEFORE INSERT ON owner.customer_limit_profiles
  FOR EACH ROW EXECUTE FUNCTION owner.validate_limit_profile_insert();

-- ---------------------------------------------------------------------------
-- Installation identity (OD-LIC-09). Source is a recorded claim, not proof.
-- ---------------------------------------------------------------------------

CREATE TABLE owner.installation_identities (
  id varchar(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  customer_id varchar(26) NOT NULL REFERENCES owner.customers(id),
  installation_id varchar(64) NOT NULL CHECK (
    installation_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
  ),
  source text NOT NULL CHECK (source IN ('CUSTOMER_VARDENA_SCREEN')),
  source_detail varchar(500) CHECK (
    source_detail IS NULL
    OR (
      length(btrim(source_detail)) > 0
      AND source_detail !~ '[[:cntrl:]]'
      AND source_detail !~* '(PRIVATE KEY|-----BEGIN )'
    )
  ),
  confirmed_by varchar(26) NOT NULL REFERENCES owner.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmation_evidence_ref varchar(200) CHECK (
    confirmation_evidence_ref IS NULL
    OR (
      length(btrim(confirmation_evidence_ref)) > 0
      AND confirmation_evidence_ref !~ '[[:cntrl:]]'
      AND confirmation_evidence_ref !~* '(PRIVATE KEY|-----BEGIN )'
    )
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by varchar(26) NOT NULL REFERENCES owner.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT installation_identity_per_customer UNIQUE (customer_id, installation_id),
  CONSTRAINT installation_identity_composite UNIQUE (id, customer_id),
  CONSTRAINT installation_identity_installation UNIQUE (id, installation_id)
);

CREATE FUNCTION owner.enforce_installation_identity_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_detail IS DISTINCT FROM OLD.source_detail
     OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.confirmation_evidence_ref IS DISTINCT FROM OLD.confirmation_evidence_ref
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Installation identity facts are immutable'
      USING ERRCODE = '23514';
  END IF;
  -- No reactivation decision exists for installation identities, so retirement
  -- is terminal here (OD-LIC-13 is about limit profiles only).
  IF NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'Installation identity may only be retired once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_installation_identity_immutability
  BEFORE UPDATE ON owner.installation_identities
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_installation_identity_immutability();

CREATE INDEX installation_identities_customer
  ON owner.installation_identities (customer_id, status);

-- ---------------------------------------------------------------------------
-- Issuance ledger (design §5.1) with the immutable request snapshot
-- ---------------------------------------------------------------------------

CREATE TABLE owner.license_issuances (
  id varchar(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  customer_id varchar(26) NOT NULL REFERENCES owner.customers(id),
  customer_code varchar(64) NOT NULL CHECK (
    customer_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
  ),
  customer_name varchar(200) NOT NULL CHECK (length(btrim(customer_name)) > 0),
  license_id varchar(64) NOT NULL UNIQUE CHECK (license_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'),
  operation_id varchar(64) NOT NULL UNIQUE CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'),
  installation_identity_id varchar(26) NOT NULL,
  installation_id varchar(64) NOT NULL CHECK (installation_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  license_kind text NOT NULL CHECK (license_kind IN ('PERPETUAL','TIME_LIMITED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  organization_limit integer,
  user_limit integer,
  device_limit integer,
  device_limit_specified boolean NOT NULL DEFAULT false,
  module_entitlements text[] NOT NULL,
  feature_entitlements text[] NOT NULL DEFAULT ARRAY[]::text[],
  limit_profile_id varchar(26) REFERENCES owner.customer_limit_profiles(id),
  signing_key_id varchar(120) REFERENCES owner.signing_keys(id),
  supersedes_operation_id varchar(64),
  renews_operation_id varchar(64),
  protocol_version text NOT NULL DEFAULT 'VLIC2' CHECK (protocol_version = 'VLIC2'),
  file_format_version integer NOT NULL DEFAULT 1 CHECK (file_format_version = 1),
  status text NOT NULL DEFAULT 'REQUEST_PREPARED' CHECK (
    status IN ('REQUEST_PREPARED','SIGNED_RECORDED','ABANDONED')
  ),
  request_payload_sha256 char(64) NOT NULL CHECK (request_payload_sha256 ~ '^[0-9a-f]{64}$'),
  request_binding_sha256 char(64) NOT NULL CHECK (request_binding_sha256 ~ '^[0-9a-f]{64}$'),
  request_document text NOT NULL CHECK (length(request_document) > 0),
  request_file_name varchar(200) NOT NULL CHECK (length(btrim(request_file_name)) > 0),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by varchar(26) NOT NULL REFERENCES owner.users(id),
  signed_at timestamptz,
  signed_by varchar(26) REFERENCES owner.users(id),
  imported_at timestamptz,
  imported_by varchar(26) REFERENCES owner.users(id),
  artifact_sha256 char(64) CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_store_key varchar(400),
  abandoned_at timestamptz,
  abandoned_by varchar(26) REFERENCES owner.users(id),
  abandonment_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT issuance_customer_code_independent CHECK (customer_code <> customer_id),
  CONSTRAINT issuance_kind_dates CHECK (
    (license_kind = 'PERPETUAL' AND valid_until IS NULL)
    OR (license_kind = 'TIME_LIMITED' AND valid_until IS NOT NULL)
  ),
  CONSTRAINT issuance_validity_order CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT issuance_limits_positive CHECK (
    (organization_limit IS NULL OR organization_limit > 0)
    AND (user_limit IS NULL OR user_limit > 0)
  ),
  CONSTRAINT issuance_device_limit CHECK (
    (device_limit_specified = false AND device_limit IS NULL)
    OR (device_limit_specified = true AND (device_limit IS NULL OR device_limit >= 0))
  ),
  CONSTRAINT issuance_modules_known CHECK (owner.modules_are_known(module_entitlements)),
  CONSTRAINT issuance_modules_unique CHECK (owner.modules_are_unique(module_entitlements)),
  CONSTRAINT issuance_features_unique CHECK (
    cardinality(feature_entitlements) = (
      SELECT count(DISTINCT entry) FROM unnest(feature_entitlements) AS entry
    )
  ),
  CONSTRAINT issuance_lineage_mutually_exclusive CHECK (
    supersedes_operation_id IS NULL OR renews_operation_id IS NULL
  ),
  CONSTRAINT issuance_lineage_self CHECK (
    (supersedes_operation_id IS NULL OR supersedes_operation_id <> operation_id)
    AND (renews_operation_id IS NULL OR renews_operation_id <> operation_id)
  ),
  CONSTRAINT issuance_signed_state CHECK (
    (status = 'SIGNED_RECORDED'
      AND signing_key_id IS NOT NULL
      AND signed_at IS NOT NULL
      AND signed_by IS NOT NULL
      AND imported_at IS NOT NULL
      AND imported_by IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND artifact_store_key IS NOT NULL)
    OR (status <> 'SIGNED_RECORDED'
      AND signed_at IS NULL
      AND signed_by IS NULL
      AND imported_at IS NULL
      AND imported_by IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_store_key IS NULL)
  ),
  CONSTRAINT issuance_abandoned_state CHECK (
    (status = 'ABANDONED'
      AND abandoned_at IS NOT NULL
      AND abandoned_by IS NOT NULL
      AND abandonment_reason IS NOT NULL)
    OR (status <> 'ABANDONED'
      AND abandoned_at IS NULL
      AND abandoned_by IS NULL
      AND abandonment_reason IS NULL)
  ),
  CONSTRAINT issuance_installation_customer FOREIGN KEY (installation_identity_id, customer_id)
    REFERENCES owner.installation_identities(id, customer_id),
  CONSTRAINT issuance_installation_value FOREIGN KEY (installation_identity_id, installation_id)
    REFERENCES owner.installation_identities(id, installation_id)
);

CREATE INDEX license_issuances_customer ON owner.license_issuances (customer_id, requested_at DESC);
CREATE INDEX license_issuances_status ON owner.license_issuances (status, requested_at DESC);
CREATE INDEX license_issuances_profile ON owner.license_issuances (limit_profile_id);

CREATE FUNCTION owner.enforce_issuance_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_code IS DISTINCT FROM OLD.customer_code
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.license_id IS DISTINCT FROM OLD.license_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.installation_identity_id IS DISTINCT FROM OLD.installation_identity_id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.license_kind IS DISTINCT FROM OLD.license_kind
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.organization_limit IS DISTINCT FROM OLD.organization_limit
     OR NEW.user_limit IS DISTINCT FROM OLD.user_limit
     OR NEW.device_limit IS DISTINCT FROM OLD.device_limit
     OR NEW.device_limit_specified IS DISTINCT FROM OLD.device_limit_specified
     OR NEW.module_entitlements IS DISTINCT FROM OLD.module_entitlements
     OR NEW.feature_entitlements IS DISTINCT FROM OLD.feature_entitlements
     OR NEW.limit_profile_id IS DISTINCT FROM OLD.limit_profile_id
     OR NEW.supersedes_operation_id IS DISTINCT FROM OLD.supersedes_operation_id
     OR NEW.renews_operation_id IS DISTINCT FROM OLD.renews_operation_id
     OR NEW.request_payload_sha256 IS DISTINCT FROM OLD.request_payload_sha256
     OR NEW.request_binding_sha256 IS DISTINCT FROM OLD.request_binding_sha256
     OR NEW.request_document IS DISTINCT FROM OLD.request_document
     OR NEW.request_file_name IS DISTINCT FROM OLD.request_file_name
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Issuance identity, snapshot and digests are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'REQUEST_PREPARED' AND NEW.status = 'SIGNED_RECORDED')
      OR (OLD.status = 'REQUEST_PREPARED' AND NEW.status = 'ABANDONED')
    ) THEN
      RAISE EXCEPTION 'Illegal issuance status transition'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_issuance_facts
  BEFORE UPDATE ON owner.license_issuances
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_issuance_facts();

-- ---------------------------------------------------------------------------
-- Revocation ledger (OD-LIC-17, protocol §7–§8)
-- ---------------------------------------------------------------------------

CREATE TABLE owner.license_revocations (
  id varchar(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  issuance_id varchar(26) NOT NULL UNIQUE REFERENCES owner.license_issuances(id),
  license_id varchar(64) NOT NULL,
  target_operation_id varchar(64) NOT NULL,
  customer_id varchar(26) NOT NULL,
  customer_code varchar(64) NOT NULL CHECK (
    customer_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
  ),
  installation_id varchar(64) NOT NULL CHECK (installation_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  reason text NOT NULL CHECK (
    reason IN ('NON_PAYMENT','CONTRACT_TERMINATION','FRAUD','KEY_COMPROMISE','ISSUED_IN_ERROR','COURT_ORDER','OTHER')
  ),
  reason_detail varchar(500),
  effect text NOT NULL DEFAULT 'LICENSE_ONLY' CHECK (effect = 'LICENSE_ONLY'),
  signing_key_id varchar(120) REFERENCES owner.signing_keys(id),
  protocol_version text NOT NULL DEFAULT 'VREV1' CHECK (protocol_version = 'VREV1'),
  file_format_version integer NOT NULL DEFAULT 1 CHECK (file_format_version = 1),
  status text NOT NULL DEFAULT 'REQUEST_PREPARED' CHECK (
    status IN ('REQUEST_PREPARED','SIGNED_RECORDED','ABANDONED')
  ),
  issued_at timestamptz NOT NULL,
  request_payload_sha256 char(64) NOT NULL CHECK (request_payload_sha256 ~ '^[0-9a-f]{64}$'),
  request_binding_sha256 char(64) NOT NULL CHECK (request_binding_sha256 ~ '^[0-9a-f]{64}$'),
  request_document text NOT NULL CHECK (length(request_document) > 0),
  request_file_name varchar(200) NOT NULL CHECK (length(btrim(request_file_name)) > 0),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by varchar(26) NOT NULL REFERENCES owner.users(id),
  imported_at timestamptz,
  imported_by varchar(26) REFERENCES owner.users(id),
  artifact_sha256 char(64) CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_store_key varchar(400),
  abandoned_at timestamptz,
  abandoned_by varchar(26) REFERENCES owner.users(id),
  abandonment_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT revocation_customer_code_independent CHECK (customer_code <> customer_id),
  CONSTRAINT revocation_other_reason CHECK (
    (reason = 'OTHER' AND reason_detail IS NOT NULL AND length(btrim(reason_detail)) > 0)
    OR reason <> 'OTHER'
  ),
  CONSTRAINT revocation_reason_detail_bounds CHECK (
    reason_detail IS NULL
    OR (
      length(btrim(reason_detail)) > 0
      AND length(reason_detail) <= 500
      AND reason_detail !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT revocation_signed_state CHECK (
    (status = 'SIGNED_RECORDED'
      AND signing_key_id IS NOT NULL
      AND imported_at IS NOT NULL
      AND imported_by IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND artifact_store_key IS NOT NULL)
    OR (status <> 'SIGNED_RECORDED'
      AND imported_at IS NULL
      AND imported_by IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_store_key IS NULL)
  ),
  CONSTRAINT revocation_abandoned_state CHECK (
    (status = 'ABANDONED'
      AND abandoned_at IS NOT NULL
      AND abandoned_by IS NOT NULL
      AND abandonment_reason IS NOT NULL)
    OR (status <> 'ABANDONED'
      AND abandoned_at IS NULL
      AND abandoned_by IS NULL
      AND abandonment_reason IS NULL)
  )
);

CREATE INDEX license_revocations_customer ON owner.license_revocations (customer_id, requested_at DESC);

CREATE FUNCTION owner.enforce_revocation_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.issuance_id IS DISTINCT FROM OLD.issuance_id
     OR NEW.license_id IS DISTINCT FROM OLD.license_id
     OR NEW.target_operation_id IS DISTINCT FROM OLD.target_operation_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_code IS DISTINCT FROM OLD.customer_code
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.reason_detail IS DISTINCT FROM OLD.reason_detail
     OR NEW.effect IS DISTINCT FROM OLD.effect
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.request_payload_sha256 IS DISTINCT FROM OLD.request_payload_sha256
     OR NEW.request_binding_sha256 IS DISTINCT FROM OLD.request_binding_sha256
     OR NEW.request_document IS DISTINCT FROM OLD.request_document
     OR NEW.request_file_name IS DISTINCT FROM OLD.request_file_name
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Revocation identity, target, snapshot and digests are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'REQUEST_PREPARED' AND NEW.status = 'SIGNED_RECORDED')
      OR (OLD.status = 'REQUEST_PREPARED' AND NEW.status = 'ABANDONED')
    ) THEN
      RAISE EXCEPTION 'Illegal revocation status transition'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_revocation_facts
  BEFORE UPDATE ON owner.license_revocations
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_revocation_facts();

-- ---------------------------------------------------------------------------
-- Durable artifact archive with explicit staged states (OD-LIC-19)
-- ---------------------------------------------------------------------------

CREATE TABLE owner.license_artifacts (
  id varchar(26) PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  kind text NOT NULL CHECK (kind IN ('LICENSE','REVOCATION')),
  issuance_id varchar(26) REFERENCES owner.license_issuances(id),
  revocation_id varchar(26) REFERENCES owner.license_revocations(id),
  sha256 char(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  store_key varchar(400) NOT NULL CHECK (
    store_key ~ '^licenses/[0-9A-Z]{4}/[0-9A-Z]{26}\.json$'
    OR store_key ~ '^revocations/[0-9A-Z]{4}/[0-9A-Z]{26}\.json$'
  ),
  original_file_name varchar(200) NOT NULL CHECK (length(btrim(original_file_name)) > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','DURABLE','QUARANTINED')
  ),
  created_by varchar(26) NOT NULL REFERENCES owner.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz,
  verified_by varchar(26) REFERENCES owner.users(id),
  quarantine_reason varchar(500),
  CONSTRAINT license_artifact_target CHECK (
    (kind = 'LICENSE' AND issuance_id IS NOT NULL AND revocation_id IS NULL AND store_key ~ '^licenses/')
    OR (kind = 'REVOCATION' AND revocation_id IS NOT NULL AND issuance_id IS NULL AND store_key ~ '^revocations/')
  ),
  CONSTRAINT license_artifact_verified CHECK (
    (status = 'DURABLE' AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND quarantine_reason IS NULL)
    OR (status = 'PENDING' AND verified_at IS NULL AND verified_by IS NULL AND quarantine_reason IS NULL)
    OR (status = 'QUARANTINED' AND quarantine_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX license_artifacts_one_per_issuance
  ON owner.license_artifacts (issuance_id) WHERE issuance_id IS NOT NULL;
CREATE UNIQUE INDEX license_artifacts_one_per_revocation
  ON owner.license_artifacts (revocation_id) WHERE revocation_id IS NOT NULL;
CREATE INDEX license_artifacts_status ON owner.license_artifacts (status, created_at);

CREATE FUNCTION owner.enforce_artifact_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.issuance_id IS DISTINCT FROM OLD.issuance_id
     OR NEW.revocation_id IS DISTINCT FROM OLD.revocation_id
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.store_key IS DISTINCT FROM OLD.store_key
     OR NEW.original_file_name IS DISTINCT FROM OLD.original_file_name
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Artifact identity and content digest are immutable'
      USING ERRCODE = '23514';
  END IF;
  -- PENDING -> DURABLE (verified), PENDING -> QUARANTINED (write failed) and
  -- DURABLE -> QUARANTINED (later integrity failure found by reconciliation).
  -- QUARANTINED is terminal; nothing returns an artifact to DURABLE silently.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('DURABLE','QUARANTINED'))
       OR (OLD.status = 'DURABLE' AND NEW.status = 'QUARANTINED')
     ) THEN
    RAISE EXCEPTION 'Illegal artifact state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_artifact_facts
  BEFORE UPDATE ON owner.license_artifacts
  FOR EACH ROW EXECUTE FUNCTION owner.enforce_artifact_facts();

REVOKE ALL ON owner.user_permission_grants FROM PUBLIC;
REVOKE ALL ON owner.customer_limit_profiles FROM PUBLIC;
REVOKE ALL ON owner.installation_identities FROM PUBLIC;
REVOKE ALL ON owner.license_issuances FROM PUBLIC;
REVOKE ALL ON owner.license_revocations FROM PUBLIC;
REVOKE ALL ON owner.license_artifacts FROM PUBLIC;
