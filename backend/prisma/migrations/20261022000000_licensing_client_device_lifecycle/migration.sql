-- OQ-83 / PDR-15 (OD-LIC-04): authoritative signed device quota, retained
-- client-device lifecycle, one-use enrollment proof, atomic offline replacement
-- and typed audit context. Existing signed license bytes and hashes are not
-- rewritten. A missing deviceLimit stays UNSPECIFIED, distinct from signed null.

ALTER TABLE "licensing"."license_versions"
  ADD COLUMN "device_limit" INTEGER,
  ADD COLUMN "device_limit_specified" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "licensing"."license_versions"
  ADD CONSTRAINT "license_versions_device_limit_nonnegative_check"
    CHECK ("device_limit" IS NULL OR "device_limit" >= 0),
  ADD CONSTRAINT "license_versions_device_limit_presence_check"
    CHECK ("device_limit_specified" OR "device_limit" IS NULL);

COMMENT ON COLUMN "licensing"."license_versions"."device_limit" IS
  'Signed device capacity; null is unlimited only when device_limit_specified is true.';
COMMENT ON COLUMN "licensing"."license_versions"."device_limit_specified" IS
  'False for legacy signed payloads that predate the field; missing is UNSPECIFIED, not unlimited.';

CREATE TYPE "licensing"."ClientDeviceStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'REPLACED');
CREATE TYPE "licensing"."DeviceEnrollmentState" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED');
CREATE TYPE "licensing"."DeviceReplacementState" AS ENUM ('CHALLENGE', 'PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED');

ALTER TABLE "licensing"."license_audit_events"
  ADD COLUMN "device_id" TEXT,
  ADD COLUMN "replacement_request_id" TEXT;

COMMENT ON COLUMN "licensing"."license_audit_events"."device_id" IS
  'Typed client-device subject for OQ-83 audit events; no key material.';
COMMENT ON COLUMN "licensing"."license_audit_events"."replacement_request_id" IS
  'Typed replacement request subject for OQ-83 audit events.';

CREATE INDEX "idx_license_audit_events_installation_device_occurred_at"
  ON "licensing"."license_audit_events"("installation_id", "device_id", "occurred_at");
CREATE INDEX "idx_license_audit_events_installation_replacement_occurred_at"
  ON "licensing"."license_audit_events"("installation_id", "replacement_request_id", "occurred_at");

CREATE TABLE "licensing"."client_devices" (
  "id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "key_fingerprint" VARCHAR(64) NOT NULL,
  "public_key" TEXT NOT NULL,
  "status" "licensing"."ClientDeviceStatus" NOT NULL,
  "activated_at" TIMESTAMPTZ(6) NOT NULL,
  "deactivated_at" TIMESTAMPTZ(6),
  "deactivated_by" TEXT,
  "replaced_at" TIMESTAMPTZ(6),
  "replaced_by_device_id" TEXT,
  "enrollment_challenge_id" TEXT,
  "replacement_request_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "client_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_client_devices_id_installation" UNIQUE ("id", "installation_id"),
  CONSTRAINT "uq_client_devices_installation_operation" UNIQUE ("installation_id", "operation_id"),
  CONSTRAINT "uq_client_devices_installation_fingerprint" UNIQUE ("installation_id", "key_fingerprint"),
  CONSTRAINT "uq_client_devices_installation_replaced_by" UNIQUE ("installation_id", "replaced_by_device_id"),
  CONSTRAINT "uq_client_devices_installation_enrollment_challenge" UNIQUE ("installation_id", "enrollment_challenge_id"),
  CONSTRAINT "uq_client_devices_installation_replacement_request" UNIQUE ("installation_id", "replacement_request_id"),
  CONSTRAINT "uq_client_devices_enrollment_challenge_installation" UNIQUE ("enrollment_challenge_id", "installation_id"),
  CONSTRAINT "uq_client_devices_replacement_request_installation" UNIQUE ("replacement_request_id", "installation_id"),
  CONSTRAINT "client_devices_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "licensing"."installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "client_devices_replaced_by_same_installation_fkey"
    FOREIGN KEY ("replaced_by_device_id", "installation_id")
    REFERENCES "licensing"."client_devices"("id", "installation_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "client_devices_state_timestamps_check"
    CHECK (
      ("status" = 'ACTIVE' AND "deactivated_at" IS NULL AND "replaced_at" IS NULL AND "replaced_by_device_id" IS NULL)
      OR ("status" = 'DEACTIVATED' AND "deactivated_at" IS NOT NULL AND "replaced_at" IS NULL AND "replaced_by_device_id" IS NULL)
      OR ("status" = 'REPLACED' AND "deactivated_at" IS NULL AND "replaced_at" IS NOT NULL AND "replaced_by_device_id" IS NOT NULL)
    ),
  CONSTRAINT "client_devices_origin_check"
    CHECK (("enrollment_challenge_id" IS NOT NULL AND "replacement_request_id" IS NULL)
        OR ("enrollment_challenge_id" IS NULL AND "replacement_request_id" IS NOT NULL))
);

CREATE INDEX "idx_client_devices_installation_status_activated_at"
  ON "licensing"."client_devices"("installation_id", "status", "activated_at");

CREATE TABLE "licensing"."device_enrollment_challenges" (
  "id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "key_fingerprint" VARCHAR(64) NOT NULL,
  "public_key" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "customer_code" VARCHAR(64) NOT NULL,
  "license_id" TEXT NOT NULL,
  "license_version_id" TEXT NOT NULL,
  "canonical_payload" TEXT NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "state" "licensing"."DeviceEnrollmentState" NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  CONSTRAINT "device_enrollment_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_enrollment_challenges_id_installation" UNIQUE ("id", "installation_id"),
  CONSTRAINT "uq_device_enrollment_challenges_installation_operation" UNIQUE ("installation_id", "operation_id"),
  CONSTRAINT "device_enrollment_challenges_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "licensing"."installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "device_enrollment_challenges_expiry_check" CHECK ("expires_at" > "issued_at"),
  CONSTRAINT "device_enrollment_challenges_state_timestamp_check"
    CHECK (("state" = 'PENDING' AND "consumed_at" IS NULL)
        OR ("state" = 'CONSUMED' AND "consumed_at" IS NOT NULL)
        OR ("state" = 'EXPIRED' AND "consumed_at" IS NULL))
);

CREATE INDEX "idx_device_enrollment_challenges_installation_state_expires"
  ON "licensing"."device_enrollment_challenges"("installation_id", "state", "expires_at");
CREATE UNIQUE INDEX "uq_device_enrollment_challenges_pending_fingerprint"
  ON "licensing"."device_enrollment_challenges"("installation_id", "key_fingerprint")
  WHERE "state" = 'PENDING';

CREATE TABLE "licensing"."client_device_replacement_requests" (
  "id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "challenge_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "old_device_id" TEXT NOT NULL,
  "new_device_id" TEXT NOT NULL,
  "key_fingerprint" VARCHAR(64) NOT NULL,
  "public_key" TEXT NOT NULL,
  "nonce" VARCHAR(128) NOT NULL,
  "canonical_payload" TEXT NOT NULL,
  "request_signature" TEXT,
  "request_hash" VARCHAR(64),
  "customer_id" TEXT NOT NULL,
  "customer_code" VARCHAR(64) NOT NULL,
  "license_id" TEXT NOT NULL,
  "license_version_id" TEXT NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL,
  "challenge_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "request_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "state" "licensing"."DeviceReplacementState" NOT NULL,
  "response_operation_id" TEXT,
  "response_hash" VARCHAR(64),
  "response_key_id" VARCHAR(120),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "client_device_replacement_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_replacement_requests_id_installation" UNIQUE ("id", "installation_id"),
  CONSTRAINT "uq_device_replacement_requests_installation_challenge" UNIQUE ("installation_id", "challenge_id"),
  CONSTRAINT "uq_device_replacement_requests_installation_operation" UNIQUE ("installation_id", "operation_id"),
  CONSTRAINT "uq_device_replacement_requests_installation_response_operation" UNIQUE ("installation_id", "response_operation_id"),
  CONSTRAINT "client_device_replacement_requests_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "licensing"."installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "client_device_replacement_requests_old_device_same_installation_fkey"
    FOREIGN KEY ("old_device_id", "installation_id")
    REFERENCES "licensing"."client_devices"("id", "installation_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "client_device_replacement_requests_expiry_check"
    CHECK ("challenge_expires_at" > "issued_at" AND "request_expires_at" > "issued_at"),
  CONSTRAINT "client_device_replacement_requests_state_check"
    CHECK (
      ("state" = 'CHALLENGE' AND "request_signature" IS NULL AND "request_hash" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL AND "expired_at" IS NULL AND "response_operation_id" IS NULL AND "response_hash" IS NULL)
      OR ("state" = 'PENDING' AND "request_signature" IS NOT NULL AND "request_hash" IS NOT NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL AND "expired_at" IS NULL AND "response_operation_id" IS NULL AND "response_hash" IS NULL)
      OR ("state" = 'COMPLETED' AND "request_signature" IS NOT NULL AND "request_hash" IS NOT NULL AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL AND "expired_at" IS NULL AND "response_operation_id" IS NOT NULL AND "response_hash" IS NOT NULL AND "response_key_id" IS NOT NULL)
      OR ("state" = 'CANCELLED' AND (("request_signature" IS NULL AND "request_hash" IS NULL) OR ("request_signature" IS NOT NULL AND "request_hash" IS NOT NULL)) AND "completed_at" IS NULL AND "cancelled_at" IS NOT NULL AND "expired_at" IS NULL AND "response_operation_id" IS NULL AND "response_hash" IS NULL)
      OR ("state" = 'EXPIRED' AND (("request_signature" IS NULL AND "request_hash" IS NULL) OR ("request_signature" IS NOT NULL AND "request_hash" IS NOT NULL)) AND "completed_at" IS NULL AND "cancelled_at" IS NULL AND "expired_at" IS NOT NULL AND "response_operation_id" IS NULL AND "response_hash" IS NULL)
    )
);

ALTER TABLE "licensing"."client_devices"
  ADD CONSTRAINT "client_devices_enrollment_challenge_same_installation_fkey"
    FOREIGN KEY ("enrollment_challenge_id", "installation_id")
    REFERENCES "licensing"."device_enrollment_challenges"("id", "installation_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_devices_replacement_request_same_installation_fkey"
    FOREIGN KEY ("replacement_request_id", "installation_id")
    REFERENCES "licensing"."client_device_replacement_requests"("id", "installation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_device_replacement_requests_one_pending_per_old_device"
  ON "licensing"."client_device_replacement_requests"("installation_id", "old_device_id")
  WHERE "state" IN ('CHALLENGE', 'PENDING');
CREATE UNIQUE INDEX "uq_device_replacement_requests_active_key_fingerprint"
  ON "licensing"."client_device_replacement_requests"("installation_id", "key_fingerprint")
  WHERE "state" IN ('CHALLENGE', 'PENDING');
CREATE INDEX "idx_device_replacement_requests_installation_old_state"
  ON "licensing"."client_device_replacement_requests"("installation_id", "old_device_id", "state");
CREATE INDEX "idx_device_replacement_requests_installation_state_expires"
  ON "licensing"."client_device_replacement_requests"("installation_id", "state", "request_expires_at");

COMMENT ON TABLE "licensing"."client_devices" IS
  'Retained client-device identities; only the public key is stored. OQ-83 / PDR-15.';
COMMENT ON TABLE "licensing"."device_enrollment_challenges" IS
  'One-use server-issued device proof challenges; a challenge does not consume quota.';
COMMENT ON TABLE "licensing"."client_device_replacement_requests" IS
  'Retained device replacement requests, signed request evidence and completion/cancellation/expiry state.';
