import { ulid } from "ulid";
import type { PoolClient } from "pg";
import { audit } from "./db.js";
import {
  assertActiveAuthorizedActor,
  fail,
  invalid,
  hasEffectivePermission,
  isGrantablePermission,
  isRole,
  object,
  page,
  permissions,
  text,
  type Permission,
  type User,
} from "./domain.js";
import {
  LicenseArtifactStore,
  licenseArtifactStoreKey,
  sha256Bytes,
} from "./artifact-store.js";
import {
  KNOWN_MODULE_CODES,
  ProtocolError,
  REVOCATION_REASONS,
  decodeLicenseEnvelope,
  decodeRevocationEnvelope,
  prepareLicenseRequest,
  prepareRevocationRequest,
  sha256Hex,
  verifyLicenseVersion,
  verifyRevocation,
  type LicenseRequestPayload,
  type LicenseVersionPayload,
  type RevocationPayload,
  type RevocationReason,
  type TrustedLicenseKey,
} from "./protocol.js";

/**
 * Owner-side license lifecycle services.
 *
 * Every entry point re-checks the actor's **effective** permissions (role
 * eligibility ∩ active grants, resolved under the same lock as the work) and
 * writes its audit evidence in the same transaction as the state change.
 * Nothing here trusts a client-supplied actor, date or derived identity.
 */

export type ServiceActor = Pick<
  User,
  "id" | "role" | "is_active" | "must_change_password"
> & {
  permissions?: readonly Permission[];
};

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUEST_MAX_BYTES = 64 * 1024;

function ulidValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !ULID.test(value))
    invalid(`${field} is invalid.`);
  return value;
}

function anyPermission(actor: ServiceActor, required: Permission[]): void {
  if (!required.some((permission) => hasEffectivePermission(actor, permission)))
    fail(403, "PermissionDenied", "You do not have permission.");
}

function ownerAdmin(actor: ServiceActor): void {
  assertActiveAuthorizedActor(actor, "licenses.issue.perpetual");
  if (actor.role !== "OWNER_ADMIN")
    fail(403, "PermissionDenied", "Only an Owner Admin may do this.");
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  return null;
}

function integerOrNull(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) <= 0)
    invalid(`${field} must be a positive integer or null.`);
  return value as number;
}

function deviceLimit(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0)
    invalid("deviceLimit must be a non-negative integer or null.");
  return value as number;
}

function codeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    invalid(`${field} must contain at least one code.`);
  const codes = value.map((entry) => {
    if (typeof entry !== "string") invalid(`${field} must contain strings.`);
    return entry;
  });
  if (new Set(codes).size !== codes.length) invalid(`${field} repeats a code.`);
  return codes;
}

function instant(value: unknown, field: string): Date {
  if (typeof value !== "string") invalid(`${field} is required.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value)
    invalid(`${field} must be a canonical ISO-8601 instant.`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Per-user permission grants (OD-LIC-12, R-1 — default deny)
// ---------------------------------------------------------------------------

export async function listUserPermissions(
  tx: PoolClient,
  actor: ServiceActor,
  rawUserId: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  const userId = ulidValue(rawUserId, "userId");
  const found = await tx.query<User>(
    "SELECT id, role FROM owner.users WHERE id=$1",
    [userId],
  );
  const user = found.rows[0];
  if (!user) fail(404, "EntityNotFound", "User not found.");
  const grants = await tx.query<{
    permission: string;
    granted_by: string;
    granted_at: Date;
    revoked_by: string | null;
    revoked_at: Date | null;
    revocation_reason: string | null;
  }>(
    "SELECT permission,granted_by,granted_at,revoked_by,revoked_at,revocation_reason FROM owner.user_permission_grants WHERE user_id=$1 ORDER BY permission",
    [userId],
  );
  return {
    userId,
    role: user.role,
    eligible: permissions(user.role),
    grants: grants.rows.map((row) => ({
      permission: row.permission,
      grantedBy: row.granted_by,
      grantedAt: iso(row.granted_at),
      revokedBy: row.revoked_by,
      revokedAt: iso(row.revoked_at),
      revocationReason: row.revocation_reason,
      active: row.revoked_at === null,
    })),
  };
}

export async function grantPermission(
  tx: PoolClient,
  actor: ServiceActor,
  rawUserId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  if (actor.role !== "OWNER_ADMIN")
    fail(403, "PermissionDenied", "Only an Owner Admin may grant.");
  const userId = ulidValue(rawUserId, "userId");
  const input = object(body, ["permission"]);
  const permission = input.permission;
  if (!isGrantablePermission(permission))
    fail(400, "ValidationFailed", "The permission is not grantable.");
  const target = (
    await tx.query<User>("SELECT * FROM owner.users WHERE id=$1 FOR UPDATE", [
      userId,
    ])
  ).rows[0];
  if (!target) fail(404, "EntityNotFound", "User not found.");
  if (!isRole(target.role) || target.role !== "LICENSE_OPERATOR")
    fail(400, "ValidationFailed", "Grants apply only to License Operators.");
  const previous = (
    await tx.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM owner.user_permission_grants WHERE user_id=$1 AND permission=$2",
      [userId, permission],
    )
  ).rows[0];
  await tx.query(
    `INSERT INTO owner.user_permission_grants(user_id,permission,granted_by,granted_at)
     VALUES($1,$2,$3,clock_timestamp())
     ON CONFLICT (user_id,permission) DO UPDATE SET
       granted_by=EXCLUDED.granted_by,
       granted_at=clock_timestamp(),
       revoked_by=NULL,
       revoked_at=NULL,
       revocation_reason=NULL`,
    [userId, permission, actor.id],
  );
  await audit(tx, {
    actor: actor.id,
    type: "PERMISSION_GRANTED",
    targetType: "User",
    targetId: userId,
    before: {
      permission,
      active: previous ? previous.revoked_at === null : false,
    },
    after: { permission, active: true },
  });
  return listUserPermissions(tx, actor, userId);
}

export async function revokePermission(
  tx: PoolClient,
  actor: ServiceActor,
  rawUserId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  if (actor.role !== "OWNER_ADMIN")
    fail(403, "PermissionDenied", "Only an Owner Admin may revoke.");
  const userId = ulidValue(rawUserId, "userId");
  const input = object(body, ["permission", "reason"]);
  if (!isGrantablePermission(input.permission))
    invalid("The permission is not grantable.");
  const reason = text(input.reason, "reason", 1, 500);
  const updated = await tx.query(
    `UPDATE owner.user_permission_grants
       SET revoked_by=$3, revoked_at=clock_timestamp(), revocation_reason=$4
     WHERE user_id=$1 AND permission=$2 AND revoked_at IS NULL
     RETURNING permission`,
    [userId, input.permission, actor.id, reason],
  );
  if (!updated.rowCount)
    fail(404, "GrantNotActive", "No active grant exists for that permission.");
  await audit(tx, {
    actor: actor.id,
    type: "PERMISSION_REVOKED",
    targetType: "User",
    targetId: userId,
    reason,
    before: { permission: input.permission, active: true },
    after: { permission: input.permission, active: false },
  });
  return listUserPermissions(tx, actor, userId);
}

// ---------------------------------------------------------------------------
// Limit profiles (F-1, OD-LIC-13, OD-LIC-14)
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  customer_id: string;
  organization_limit: number | null;
  user_limit: number | null;
  allowed_modules: string[];
  perpetual_allowed: boolean;
  status: "ACTIVE" | "RETIRED";
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

function profileResponse(row: ProfileRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    organizationLimit: row.organization_limit,
    userLimit: row.user_limit,
    allowedModules: row.allowed_modules,
    perpetualAllowed: row.perpetual_allowed,
    status: row.status,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

export async function listLimitProfiles(
  tx: PoolClient,
  actor: ServiceActor,
  customerId: string,
) {
  anyPermission(actor, ["licenses.view", "limit_profiles.manage"]);
  const customer = ulidValue(customerId, "customerId");
  const rows = await tx.query<ProfileRow>(
    "SELECT * FROM owner.customer_limit_profiles WHERE customer_id=$1 ORDER BY created_at DESC, id DESC",
    [customer],
  );
  const active = rows.rows.find((row) => row.status === "ACTIVE") ?? null;
  return {
    customerId: customer,
    activeProfile: active ? profileResponse(active) : null,
    items: rows.rows.map(profileResponse),
  };
}

export async function createLimitProfile(
  tx: PoolClient,
  actor: ServiceActor,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "limit_profiles.manage");
  const input = object(body, [
    "customerId",
    "organizationLimit",
    "userLimit",
    "allowedModules",
    "perpetualAllowed",
  ]);
  const customerId = ulidValue(input.customerId, "customerId");
  const organizationLimit = integerOrNull(
    input.organizationLimit,
    "organizationLimit",
  );
  const userLimit = integerOrNull(input.userLimit, "userLimit");
  const allowedModules = codeList(input.allowedModules, "allowedModules");
  for (const code of allowedModules) {
    if (!KNOWN_MODULE_CODES.includes(code))
      invalid("allowedModules contains an unknown module.");
  }
  if (typeof input.perpetualAllowed !== "boolean")
    invalid("perpetualAllowed is required.");
  const customer = await tx.query(
    "SELECT id FROM owner.customers WHERE id=$1 FOR UPDATE",
    [customerId],
  );
  if (!customer.rows[0]) fail(404, "EntityNotFound", "Customer not found.");
  const id = ulid();
  try {
    await tx.query(
      `INSERT INTO owner.customer_limit_profiles
         (id,customer_id,organization_limit,user_limit,allowed_modules,perpetual_allowed,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
      [
        id,
        customerId,
        organizationLimit,
        userLimit,
        allowedModules,
        input.perpetualAllowed,
        actor.id,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      fail(
        409,
        "ActiveProfileExists",
        "This customer already has an active limit profile.",
      );
    throw error;
  }
  await audit(tx, {
    actor: actor.id,
    type: "LIMIT_PROFILE_CREATED",
    targetType: "Customer",
    targetId: customerId,
    after: {
      profileId: id,
      organizationLimit,
      userLimit,
      allowedModules,
      perpetualAllowed: input.perpetualAllowed,
    },
  });
  return listLimitProfiles(tx, actor, customerId);
}

async function lockProfile(tx: PoolClient, profileId: string) {
  const row = (
    await tx.query<ProfileRow>(
      "SELECT * FROM owner.customer_limit_profiles WHERE id=$1 FOR UPDATE",
      [profileId],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Limit profile not found.");
  return row;
}

export async function retireLimitProfile(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "limit_profiles.manage");
  const profileId = ulidValue(rawId, "profileId");
  const input = object(body, ["reason"]);
  const reason = text(input.reason, "reason", 1, 500);
  const row = await lockProfile(tx, profileId);
  if (row.status !== "ACTIVE")
    fail(409, "InvalidTransition", "Only an active profile can be retired.");
  await tx.query(
    "UPDATE owner.customer_limit_profiles SET status='RETIRED', updated_by=$2, updated_at=clock_timestamp() WHERE id=$1 AND status='ACTIVE'",
    [profileId, actor.id],
  );
  await audit(tx, {
    actor: actor.id,
    type: "LIMIT_PROFILE_RETIRED",
    targetType: "Customer",
    targetId: row.customer_id,
    reason,
    before: { profileId, status: "ACTIVE" },
    after: { profileId, status: "RETIRED" },
  });
  return listLimitProfiles(tx, actor, row.customer_id);
}

export async function reactivateLimitProfile(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "limit_profiles.manage");
  const profileId = ulidValue(rawId, "profileId");
  const input = object(body, ["reason"]);
  const reason = text(input.reason, "reason", 1, 500);
  const row = await lockProfile(tx, profileId);
  if (row.status !== "RETIRED")
    fail(
      409,
      "InvalidTransition",
      "Only a retired profile can be reactivated.",
    );
  const conflicting = await tx.query<{ id: string }>(
    "SELECT id FROM owner.customer_limit_profiles WHERE customer_id=$1 AND status='ACTIVE' AND id<>$2 FOR UPDATE",
    [row.customer_id, profileId],
  );
  if (conflicting.rowCount)
    fail(
      409,
      "ActiveProfileExists",
      "Another limit profile is active for this customer; resolve it first.",
    );
  try {
    await tx.query(
      "UPDATE owner.customer_limit_profiles SET status='ACTIVE', updated_by=$2, updated_at=clock_timestamp() WHERE id=$1 AND status='RETIRED'",
      [profileId, actor.id],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      fail(
        409,
        "ActiveProfileExists",
        "Another limit profile is active for this customer.",
      );
    throw error;
  }
  await audit(tx, {
    actor: actor.id,
    type: "LIMIT_PROFILE_REACTIVATED",
    targetType: "Customer",
    targetId: row.customer_id,
    reason,
    before: { profileId, status: "RETIRED" },
    after: { profileId, status: "ACTIVE" },
  });
  return listLimitProfiles(tx, actor, row.customer_id);
}

// ---------------------------------------------------------------------------
// Installation identity (OD-LIC-09)
// ---------------------------------------------------------------------------

interface InstallationIdentityRow {
  id: string;
  customer_id: string;
  installation_id: string;
  source: string;
  source_detail: string | null;
  confirmed_by: string;
  confirmed_at: Date;
  confirmation_evidence_ref: string | null;
  status: "ACTIVE" | "RETIRED";
  created_by: string;
  created_at: Date;
}

function installationIdentityResponse(row: InstallationIdentityRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    installationId: row.installation_id,
    source: row.source,
    sourceDetail: row.source_detail,
    confirmedBy: row.confirmed_by,
    confirmedAt: iso(row.confirmed_at),
    confirmationEvidenceRef: row.confirmation_evidence_ref,
    status: row.status,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    /** Recorded claim, never cryptographic proof (ADR-0048 Decision 5). */
    bindingEvidence: "OPERATOR_RECORDED_NOT_CRYPTOGRAPHIC",
  };
}

export async function listInstallationIdentities(
  tx: PoolClient,
  actor: ServiceActor,
  customerId: string,
) {
  assertActiveAuthorizedActor(actor, "customers.view");
  const customer = ulidValue(customerId, "customerId");
  const rows = await tx.query<InstallationIdentityRow>(
    "SELECT * FROM owner.installation_identities WHERE customer_id=$1 ORDER BY created_at DESC, id DESC",
    [customer],
  );
  return {
    customerId: customer,
    items: rows.rows.map(installationIdentityResponse),
  };
}

export async function registerInstallationIdentity(
  tx: PoolClient,
  actor: ServiceActor,
  body: unknown,
) {
  anyPermission(actor, [
    "licenses.issue.time_limited",
    "licenses.issue.perpetual",
  ]);
  const input = object(body, [
    "customerId",
    "installationId",
    "source",
    "sourceDetail",
    "confirmationInstallationId",
    "confirmationEvidenceRef",
    "confirmed",
  ]);
  const customerId = ulidValue(input.customerId, "customerId");
  if (
    typeof input.installationId !== "string" ||
    !ULID.test(input.installationId)
  )
    invalid(
      "installationId must be a ULID read from the customer Vardena page.",
    );
  if (
    input.confirmationInstallationId !== input.installationId ||
    input.confirmed !== true
  )
    invalid(
      "The installation identifier must be confirmed by re-entering it and acknowledging the consequence.",
    );
  if (input.source !== "CUSTOMER_VARDENA_SCREEN")
    invalid("source is not a known provenance value.");
  const sourceDetail =
    input.sourceDetail === undefined || input.sourceDetail === null
      ? null
      : text(input.sourceDetail, "sourceDetail", 1, 500);
  const evidenceRef =
    input.confirmationEvidenceRef === undefined ||
    input.confirmationEvidenceRef === null
      ? null
      : text(input.confirmationEvidenceRef, "confirmationEvidenceRef", 1, 200);
  const customer = await tx.query(
    "SELECT id FROM owner.customers WHERE id=$1 FOR UPDATE",
    [customerId],
  );
  if (!customer.rows[0]) fail(404, "EntityNotFound", "Customer not found.");
  const id = ulid();
  try {
    await tx.query(
      `INSERT INTO owner.installation_identities
         (id,customer_id,installation_id,source,source_detail,confirmed_by,confirmation_evidence_ref,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$6,$6)`,
      [
        id,
        customerId,
        input.installationId,
        input.source,
        sourceDetail,
        actor.id,
        evidenceRef,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      fail(
        409,
        "DuplicateInstallationIdentity",
        "That installation is already registered for this customer.",
      );
    throw error;
  }
  await audit(tx, {
    actor: actor.id,
    type: "INSTALLATION_IDENTITY_REGISTERED",
    targetType: "Customer",
    targetId: customerId,
    after: {
      identityId: id,
      installationId: input.installationId,
      source: input.source,
    },
  });
  return listInstallationIdentities(tx, actor, customerId);
}

export async function retireInstallationIdentity(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
  body: unknown,
) {
  ownerAdmin(actor);
  const identityId = ulidValue(rawId, "identityId");
  const input = object(body, ["reason"]);
  const reason = text(input.reason, "reason", 1, 500);
  const row = (
    await tx.query<InstallationIdentityRow>(
      "SELECT * FROM owner.installation_identities WHERE id=$1 FOR UPDATE",
      [identityId],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Installation identity not found.");
  if (row.status !== "ACTIVE")
    fail(409, "InvalidTransition", "The identity is already retired.");
  await tx.query(
    "UPDATE owner.installation_identities SET status='RETIRED', updated_by=$2, updated_at=clock_timestamp() WHERE id=$1",
    [identityId, actor.id],
  );
  await audit(tx, {
    actor: actor.id,
    type: "INSTALLATION_IDENTITY_RETIRED",
    targetType: "Customer",
    targetId: row.customer_id,
    reason,
    before: { identityId, status: "ACTIVE" },
    after: { identityId, status: "RETIRED" },
  });
  return listInstallationIdentities(tx, actor, row.customer_id);
}

// ---------------------------------------------------------------------------
// Issuance request preparation (phase C)
// ---------------------------------------------------------------------------

interface IssuanceRow {
  id: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  license_id: string;
  operation_id: string;
  installation_identity_id: string;
  installation_id: string;
  license_kind: "PERPETUAL" | "TIME_LIMITED";
  valid_from: Date;
  valid_until: Date | null;
  organization_limit: number | null;
  user_limit: number | null;
  device_limit: number | null;
  device_limit_specified: boolean;
  module_entitlements: string[];
  feature_entitlements: string[];
  limit_profile_id: string | null;
  signing_key_id: string | null;
  supersedes_operation_id: string | null;
  renews_operation_id: string | null;
  status: "REQUEST_PREPARED" | "SIGNED_RECORDED" | "ABANDONED";
  request_payload_sha256: string;
  request_binding_sha256: string;
  request_document: string;
  request_file_name: string;
  requested_at: Date;
  requested_by: string;
  signed_at: Date | null;
  imported_at: Date | null;
  imported_by: string | null;
  artifact_sha256: string | null;
  artifact_store_key: string | null;
}

function requestAgeDays(requestedAt: Date, now: number): number {
  return Math.max(0, Math.floor((now - requestedAt.getTime()) / 86_400_000));
}

export function issuanceResponse(
  row: IssuanceRow,
  extra: {
    now?: number;
    revocation?: {
      revocationId: string;
      reason: string;
      status: string;
      importedAt: string | null;
    } | null;
  } = {},
) {
  const now = extra.now ?? Date.now();
  const ended = row.valid_until !== null && row.valid_until.getTime() <= now;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    licenseId: row.license_id,
    operationId: row.operation_id,
    installationIdentityId: row.installation_identity_id,
    installationId: row.installation_id,
    licenseKind: row.license_kind,
    validFrom: iso(row.valid_from),
    validUntil: iso(row.valid_until),
    organizationLimit: row.organization_limit,
    userLimit: row.user_limit,
    deviceLimit: row.device_limit,
    deviceLimitSpecified: row.device_limit_specified,
    modules: row.module_entitlements,
    features: row.feature_entitlements,
    limitProfileId: row.limit_profile_id,
    signingKeyId: row.signing_key_id,
    supersedesOperationId: row.supersedes_operation_id,
    renewsOperationId: row.renews_operation_id,
    status: row.status,
    protocolVersion: "VLIC2",
    requestPayloadSha256: row.request_payload_sha256,
    requestBindingSha256: row.request_binding_sha256,
    requestedAt: iso(row.requested_at),
    requestedBy: row.requested_by,
    signedAt: iso(row.signed_at),
    importedAt: iso(row.imported_at),
    importedBy: row.imported_by,
    artifactSha256: row.artifact_sha256,
    artifactAvailable: row.artifact_sha256 !== null,
    requestAgeDays: requestAgeDays(row.requested_at, now),
    /** The customer refuses a document whose term already ended. */
    customerImportAdvisory: ended ? "TERM_ENDED" : "IMPORTABLE",
    revocation: extra.revocation ?? null,
    signedArtifactProduced: row.status === "SIGNED_RECORDED",
  };
}

async function revocationForIssuance(tx: PoolClient, issuanceId: string) {
  const row = (
    await tx.query<{
      id: string;
      reason: string;
      status: string;
      imported_at: Date | null;
    }>(
      "SELECT id,reason,status,imported_at FROM owner.license_revocations WHERE issuance_id=$1",
      [issuanceId],
    )
  ).rows[0];
  return row
    ? {
        revocationId: row.id,
        reason: row.reason,
        status: row.status,
        importedAt: iso(row.imported_at),
      }
    : null;
}

async function readIssuance(tx: PoolClient, id: string, lock = false) {
  const row = (
    await tx.query<IssuanceRow>(
      `SELECT * FROM owner.license_issuances WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Issuance not found.");
  return row;
}

export async function listIssuances(
  tx: PoolClient,
  actor: ServiceActor,
  query: Record<string, unknown>,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const currentPage = page(query.page);
  const customerId =
    typeof query.customerId === "string" && query.customerId !== ""
      ? ulidValue(query.customerId, "customerId")
      : null;
  const rows = await tx.query<IssuanceRow>(
    `SELECT * FROM owner.license_issuances
     WHERE ($1::varchar IS NULL OR customer_id=$1)
     ORDER BY requested_at DESC, id DESC LIMIT 50 OFFSET $2`,
    [customerId, (currentPage - 1) * 50],
  );
  return {
    items: rows.rows.map((row) => issuanceResponse(row)),
    page: currentPage,
    pageSize: 50,
  };
}

export async function getIssuance(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const row = await readIssuance(tx, ulidValue(rawId, "issuanceId"));
  return issuanceResponse(row, {
    revocation: await revocationForIssuance(tx, row.id),
  });
}

export async function getIssuanceRequest(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const row = await readIssuance(tx, ulidValue(rawId, "issuanceId"));
  if (row.status === "ABANDONED")
    fail(409, "InvalidTransition", "The request was abandoned.");
  return {
    issuanceId: row.id,
    operationId: row.operation_id,
    fileName: row.request_file_name,
    fileContent: row.request_document,
    requestPayloadSha256: row.request_payload_sha256,
    requestBindingSha256: row.request_binding_sha256,
    unsigned: true,
  };
}

interface ActiveProfile {
  id: string;
  organization_limit: number | null;
  user_limit: number | null;
  allowed_modules: string[];
  perpetual_allowed: boolean;
}

function assertWithinProfile(
  profile: ActiveProfile,
  request: {
    organizationLimit: number | null;
    userLimit: number | null;
    modules: string[];
    perpetual: boolean;
  },
): void {
  const refusal = (field: string) =>
    fail(
      409,
      "LimitProfileExceeded",
      `The active limit profile for this customer refuses the requested ${field}.`,
    );
  if (request.perpetual && !profile.perpetual_allowed)
    refusal("perpetual term");
  if (profile.organization_limit === null) {
    if (request.organizationLimit !== null) refusal("organizationLimit");
  } else if (
    request.organizationLimit === null ||
    request.organizationLimit > profile.organization_limit
  ) {
    refusal("organizationLimit");
  }
  if (profile.user_limit === null) {
    if (request.userLimit !== null) refusal("userLimit");
  } else if (
    request.userLimit === null ||
    request.userLimit > profile.user_limit
  ) {
    refusal("userLimit");
  }
  for (const code of request.modules) {
    if (!profile.allowed_modules.includes(code)) refusal("modules");
  }
}

export async function prepareIssuance(
  tx: PoolClient,
  actor: ServiceActor,
  trustedKeys: readonly TrustedLicenseKey[],
  body: unknown,
) {
  const input = object(body, [
    "customerId",
    "installationIdentityId",
    "validUntil",
    "organizationLimit",
    "userLimit",
    "deviceLimit",
    "deviceLimitSpecified",
    "modules",
    "features",
    "signingKeyId",
    "supersedesOperationId",
    "renewsOperationId",
  ]);
  const customerId = ulidValue(input.customerId, "customerId");
  const installationIdentityId = ulidValue(
    input.installationIdentityId,
    "installationIdentityId",
  );
  if (!Object.prototype.hasOwnProperty.call(input, "validUntil"))
    invalid("validUntil is required (null means a perpetual license).");
  const perpetual = input.validUntil === null;
  assertActiveAuthorizedActor(
    actor,
    perpetual ? "licenses.issue.perpetual" : "licenses.issue.time_limited",
  );
  // OD-LIC-16: renewal and supersession are OWNER_ADMIN-only, whatever grants
  // an operator holds. The refusal is server-side and applies to direct API
  // calls exactly like the UI.
  const lineageRequested =
    (input.supersedesOperationId !== undefined &&
      input.supersedesOperationId !== null) ||
    (input.renewsOperationId !== undefined && input.renewsOperationId !== null);
  if (lineageRequested && actor.role !== "OWNER_ADMIN") {
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_REQUEST_DENIED",
      targetType: "Customer",
      targetId: customerId,
      outcome: "DENIED",
      reason: "Renewal and supersession are OWNER_ADMIN-only",
    });
    fail(
      403,
      "PermissionDenied",
      "Only an Owner Admin may prepare a renewal or a supersession.",
    );
  }
  const supersedes =
    input.supersedesOperationId === undefined ||
    input.supersedesOperationId === null
      ? null
      : ulidValue(input.supersedesOperationId, "supersedesOperationId");
  const renews =
    input.renewsOperationId === undefined || input.renewsOperationId === null
      ? null
      : ulidValue(input.renewsOperationId, "renewsOperationId");
  if (supersedes !== null && renews !== null)
    invalid("A request cannot both renew and supersede a version.");
  for (const target of [supersedes, renews]) {
    if (target === null) continue;
    const found = await tx.query(
      "SELECT id FROM owner.license_issuances WHERE operation_id=$1 AND customer_id=$2 AND status='SIGNED_RECORDED'",
      [target, customerId],
    );
    if (!found.rowCount)
      invalid("The renewal or supersession target is not a recorded issuance.");
  }

  const organizationLimit = integerOrNull(
    input.organizationLimit,
    "organizationLimit",
  );
  const userLimit = integerOrNull(input.userLimit, "userLimit");
  const limit = deviceLimit(input.deviceLimit);
  const limitSpecified = input.deviceLimitSpecified === true;
  if (
    input.deviceLimitSpecified !== undefined &&
    input.deviceLimitSpecified !== null &&
    typeof input.deviceLimitSpecified !== "boolean"
  )
    invalid("deviceLimitSpecified must be a boolean.");
  if (!limitSpecified && limit !== null)
    invalid("deviceLimit requires deviceLimitSpecified.");
  const modules = codeList(input.modules, "modules");
  for (const code of modules) {
    if (!KNOWN_MODULE_CODES.includes(code))
      invalid("modules contains an unknown module.");
  }
  const features =
    input.features === undefined || input.features === null
      ? []
      : codeList(input.features, "features");

  const signingKeyId = input.signingKeyId;
  if (typeof signingKeyId !== "string" || !KEY_ID.test(signingKeyId))
    invalid("signingKeyId is required.");
  if (!trustedKeys.some((key) => key.id === signingKeyId))
    invalid("The signing key is not in the configured trust list.");
  const keyRow = await tx.query<{ status: string }>(
    "SELECT status FROM owner.signing_keys WHERE id=$1",
    [signingKeyId],
  );
  if (keyRow.rows[0]?.status !== "ACTIVE")
    fail(
      409,
      "SigningKeyUnavailable",
      "The selected signing key is not an active Owner signing key.",
    );

  const customer = (
    await tx.query<{
      id: string;
      customer_code: string;
      display_name: string;
      status: string;
    }>(
      "SELECT id,customer_code,display_name,status FROM owner.customers WHERE id=$1 FOR SHARE",
      [customerId],
    )
  ).rows[0];
  if (!customer) fail(404, "EntityNotFound", "Customer not found.");
  if (customer.status !== "ACTIVE")
    fail(
      409,
      "CustomerInactive",
      "An inactive customer cannot be issued a license.",
    );

  const installation = (
    await tx.query<{ id: string; installation_id: string; status: string }>(
      "SELECT id,installation_id,status FROM owner.installation_identities WHERE id=$1 AND customer_id=$2 FOR SHARE",
      [installationIdentityId, customerId],
    )
  ).rows[0];
  if (!installation)
    fail(
      404,
      "EntityNotFound",
      "The installation identity does not belong to this customer.",
    );
  if (installation.status !== "ACTIVE")
    fail(
      409,
      "InstallationIdentityRetired",
      "A retired installation identity cannot be issued a license.",
    );

  // OD-LIC-14: the ceiling is evaluated once, here, against the profile that is
  // ACTIVE at creation. A later profile change never invalidates this request.
  const profile = (
    await tx.query<ActiveProfile>(
      "SELECT id,organization_limit,user_limit,allowed_modules,perpetual_allowed FROM owner.customer_limit_profiles WHERE customer_id=$1 AND status='ACTIVE' FOR SHARE",
      [customerId],
    )
  ).rows[0];
  if (profile) {
    assertWithinProfile(profile, {
      organizationLimit,
      userLimit,
      modules,
      perpetual,
    });
  }

  const clock = (
    await tx.query<{ now: Date; valid_from: Date }>(
      "SELECT clock_timestamp() AS now, (date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS valid_from",
    )
  ).rows[0]!;
  const now = clock.now;
  const validFrom = clock.valid_from;
  let validUntil: Date | null = null;
  if (!perpetual) {
    validUntil = instant(input.validUntil, "validUntil");
    if (validUntil.getTime() <= validFrom.getTime())
      invalid("validUntil must be later than the issuance day.");
    if (validUntil.getTime() <= now.getTime())
      invalid(
        "validUntil has already passed; the customer runtime would refuse the document.",
      );
  }

  const operationId = ulid();
  const licenseId = ulid();
  const requestId = ulid();
  const requestPayload: LicenseRequestPayload = {
    v: 1,
    kind: "SERVER_LICENSE_ISSUANCE_REQUEST",
    requestId,
    operationId,
    licenseId,
    customerId,
    customerCode: customer.customer_code,
    customerName: customer.display_name,
    installationId: installation.installation_id,
    status: "ACTIVE",
    validFrom,
    validUntil,
    organizationLimit,
    userLimit,
    deviceLimit: limit,
    deviceLimitSpecified: limitSpecified,
    modules,
    features,
    supersedesOperationId: supersedes,
    renewsOperationId: renews,
    issuedAt: now,
    requestedAt: now,
    requestedByUserId: actor.id,
    signingKeyId,
  };
  let prepared;
  try {
    prepared = prepareLicenseRequest(requestPayload);
  } catch (error) {
    if (error instanceof ProtocolError) invalid(error.message);
    throw error;
  }
  const id = ulid();
  await tx.query(
    `INSERT INTO owner.license_issuances
      (id,customer_id,customer_code,customer_name,license_id,operation_id,
       installation_identity_id,installation_id,license_kind,valid_from,valid_until,
       organization_limit,user_limit,device_limit,device_limit_specified,
       module_entitlements,feature_entitlements,limit_profile_id,signing_key_id,
       supersedes_operation_id,renews_operation_id,request_payload_sha256,
       request_binding_sha256,request_document,request_file_name,requested_at,requested_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [
      id,
      customerId,
      customer.customer_code,
      customer.display_name,
      licenseId,
      operationId,
      installationIdentityId,
      installation.installation_id,
      perpetual ? "PERPETUAL" : "TIME_LIMITED",
      validFrom,
      validUntil,
      organizationLimit,
      userLimit,
      limit,
      limitSpecified,
      modules,
      features,
      profile?.id ?? null,
      signingKeyId,
      supersedes,
      renews,
      prepared.requestDigest,
      prepared.bindingDigest,
      prepared.envelope,
      prepared.fileName,
      now,
      actor.id,
    ],
  );
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_REQUEST_PREPARED",
    targetType: "LicenseIssuance",
    targetId: id,
    after: {
      operationId,
      licenseId,
      customerId,
      licenseKind: perpetual ? "PERPETUAL" : "TIME_LIMITED",
      limitProfileId: profile?.id ?? null,
      signingKeyId,
      requestPayloadSha256: prepared.requestDigest,
    },
  });
  const row = await readIssuance(tx, id);
  return {
    issuance: issuanceResponse(row),
    requestPayloadSha256: prepared.requestDigest,
    requestBindingSha256: prepared.bindingDigest,
    requestFileName: prepared.fileName,
    unsignedRequest: true,
    signedArtifactProduced: false,
  };
}

export async function abandonIssuance(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const issuanceId = ulidValue(rawId, "issuanceId");
  const input = object(body, ["reason"]);
  const reason = text(input.reason, "reason", 1, 500);
  const row = await readIssuance(tx, issuanceId, true);
  if (actor.role !== "OWNER_ADMIN" && row.requested_by !== actor.id)
    fail(
      403,
      "PermissionDenied",
      "Only the requester or an Owner Admin may abandon a request.",
    );
  if (row.status !== "REQUEST_PREPARED")
    fail(409, "InvalidTransition", "Only a prepared request can be abandoned.");
  await tx.query(
    "UPDATE owner.license_issuances SET status='ABANDONED', abandoned_at=clock_timestamp(), abandoned_by=$2, abandonment_reason=$3 WHERE id=$1",
    [issuanceId, actor.id, reason],
  );
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_REQUEST_ABANDONED",
    targetType: "LicenseIssuance",
    targetId: issuanceId,
    reason,
    before: { status: row.status },
    after: { status: "ABANDONED" },
  });
  return getIssuance(tx, actor, issuanceId);
}

// ---------------------------------------------------------------------------
// Signed artifact import (phase E, OD-LIC-11, OD-LIC-18, OD-LIC-19)
// ---------------------------------------------------------------------------

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null ? b === null : b !== null && a.getTime() === b.getTime();
}

export function assertPayloadMatchesIssuance(
  row: IssuanceRow,
  payload: LicenseVersionPayload,
): void {
  const mismatch = (field: string) =>
    fail(
      409,
      "ArtifactBindingMismatch",
      `The signed artifact does not match the authorized request (${field}).`,
    );
  if (payload.operationId !== row.operation_id) mismatch("operationId");
  if (payload.licenseId !== row.license_id) mismatch("licenseId");
  if (payload.customerId !== row.customer_id) mismatch("customerId");
  if (payload.customerCode !== row.customer_code) mismatch("customerCode");
  if (payload.customerName !== row.customer_name) mismatch("customerName");
  if (payload.installationId !== row.installation_id)
    mismatch("installationId");
  if (payload.status !== "ACTIVE") mismatch("status");
  if (!sameInstant(payload.validFrom, row.valid_from)) mismatch("validFrom");
  if (!sameInstant(payload.validUntil, row.valid_until)) mismatch("validUntil");
  if (payload.organizationLimit !== row.organization_limit)
    mismatch("organizationLimit");
  if (payload.userLimit !== row.user_limit) mismatch("userLimit");
  if (payload.deviceLimit !== row.device_limit) mismatch("deviceLimit");
  if (payload.deviceLimitSpecified !== row.device_limit_specified)
    mismatch("deviceLimitSpecified");
  if (
    [...payload.moduleEntitlements].sort().join(",") !==
    [...row.module_entitlements].sort().join(",")
  )
    mismatch("modules");
  if (
    [...payload.featureEntitlements].sort().join(",") !==
    [...row.feature_entitlements].sort().join(",")
  )
    mismatch("features");
  if (payload.supersedesOperationId !== row.supersedes_operation_id)
    mismatch("supersedesOperationId");
  if (payload.renewsOperationId !== row.renews_operation_id)
    mismatch("renewsOperationId");
  if (!sameInstant(payload.issuedAt, row.requested_at)) mismatch("issuedAt");
}

async function assertActiveSigningKey(
  tx: PoolClient,
  keyId: string,
): Promise<void> {
  const row = (
    await tx.query<{ status: string }>(
      "SELECT status FROM owner.signing_keys WHERE id=$1",
      [keyId],
    )
  ).rows[0];
  if (!row)
    fail(
      409,
      "UnknownSigningKey",
      "The signing key is not registered in the Owner signing-key metadata.",
    );
  if (row.status !== "ACTIVE")
    fail(
      409,
      "SigningKeyNotActive",
      "The signing key is not ACTIVE; the artifact cannot be recorded.",
    );
}

async function archiveArtifact(
  tx: PoolClient,
  store: LicenseArtifactStore,
  actor: ServiceActor,
  kind: "LICENSE" | "REVOCATION",
  targetId: string,
  bytes: Buffer,
  fileName: string,
  digest: string,
): Promise<string> {
  const storeKey = licenseArtifactStoreKey(
    kind === "LICENSE" ? "licenses" : "revocations",
    targetId,
  );
  // Staged state: the row exists as PENDING until the exact bytes are written,
  // read back and digest-verified. A crash before COMMIT leaves an orphan file
  // that `reconcile` reports; nothing is ever reported as durable before the
  // read-back succeeds.
  await tx.query(
    `INSERT INTO owner.license_artifacts
       (id,kind,issuance_id,revocation_id,sha256,byte_size,store_key,original_file_name,status,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9)`,
    [
      ulid(),
      kind,
      kind === "LICENSE" ? targetId : null,
      kind === "REVOCATION" ? targetId : null,
      digest,
      bytes.length,
      storeKey,
      fileName,
      actor.id,
    ],
  );
  try {
    await store.writeOnce(storeKey, bytes);
  } catch {
    fail(
      503,
      "ArtifactStorageUnavailable",
      "The signed artifact could not be stored durably.",
    );
  }
  const readBack = await store.read(storeKey).catch(() => null);
  if (!readBack || sha256Bytes(readBack) !== digest)
    fail(
      503,
      "ArtifactStorageUnavailable",
      "The signed artifact failed read-back verification.",
    );
  await tx.query(
    "UPDATE owner.license_artifacts SET status='DURABLE', verified_at=clock_timestamp(), verified_by=$2 WHERE store_key=$1 AND status='PENDING'",
    [storeKey, actor.id],
  );
  return storeKey;
}

export async function importIssuanceArtifact(
  tx: PoolClient,
  actor: ServiceActor,
  store: LicenseArtifactStore,
  trustedKeys: readonly TrustedLicenseKey[],
  rawId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.import");
  const issuanceId = ulidValue(rawId, "issuanceId");
  const input = object(body, ["fileContent"]);
  if (typeof input.fileContent !== "string")
    invalid("fileContent is required.");
  if (Buffer.byteLength(input.fileContent, "utf8") > REQUEST_MAX_BYTES)
    invalid("The artifact is too large.");
  const row = await readIssuance(tx, issuanceId, true);

  // OD-LIC-18: a duplicate import returns the historical result and creates
  // nothing new. Authorization has already been checked above.
  if (row.status === "SIGNED_RECORDED") {
    let replayDigest: string | null = null;
    try {
      const envelope = decodeLicenseEnvelope(input.fileContent);
      const verified = verifyLicenseVersion(envelope.document, trustedKeys, {
        keyIdHint: envelope.keyId,
      });
      replayDigest = sha256Hex(Buffer.from(verified.canonicalBody, "utf8"));
    } catch {
      replayDigest = null;
    }
    if (replayDigest === null || replayDigest !== row.request_binding_sha256)
      fail(
        409,
        "OperationConflict",
        "This operation is already recorded with a different artifact.",
      );
    // OD-LIC-18: the replay creates no new issuance fact and no new issuance
    // audit event; the first registration remains the only record.
    return {
      issuance: issuanceResponse(row, {
        revocation: await revocationForIssuance(tx, issuanceId),
      }),
      replayed: true,
      historicalResult: true,
    };
  }
  if (row.status !== "REQUEST_PREPARED")
    fail(409, "InvalidTransition", "The request cannot accept an artifact.");

  try {
    const envelope = decodeLicenseEnvelope(input.fileContent);
    const verified = verifyLicenseVersion(envelope.document, trustedKeys, {
      keyIdHint: envelope.keyId,
    });
    assertPayloadMatchesIssuance(row, verified.payload);
    const binding = sha256Hex(Buffer.from(verified.canonicalBody, "utf8"));
    if (binding !== row.request_binding_sha256)
      fail(
        409,
        "ArtifactBindingMismatch",
        "The signed terms are not the terms this request authorized.",
      );
    if (row.signing_key_id !== null && verified.keyId !== row.signing_key_id)
      fail(
        409,
        "SigningKeyMismatch",
        "The artifact was signed by a key the request did not authorize.",
      );
    await assertActiveSigningKey(tx, verified.keyId);
    const bytes = Buffer.from(input.fileContent, "utf8");
    const digest = sha256Bytes(bytes);
    const storeKey = await archiveArtifact(
      tx,
      store,
      actor,
      "LICENSE",
      issuanceId,
      bytes,
      `vardena-license-${row.operation_id}.json`,
      digest,
    );
    await tx.query(
      `UPDATE owner.license_issuances
         SET status='SIGNED_RECORDED', signing_key_id=$2, signed_at=$3,
             signed_by=$7, imported_at=clock_timestamp(), imported_by=$4,
             artifact_sha256=$5, artifact_store_key=$6, updated_at=clock_timestamp()
       WHERE id=$1 AND status='REQUEST_PREPARED'`,
      [
        issuanceId,
        verified.keyId,
        verified.payload.issuedAt,
        actor.id,
        digest,
        storeKey,
        actor.id,
      ],
    );
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_ARTIFACT_IMPORTED",
      targetType: "LicenseIssuance",
      targetId: issuanceId,
      after: {
        operationId: row.operation_id,
        signingKeyId: verified.keyId,
        artifactSha256: digest,
      },
    });
    return {
      issuance: issuanceResponse(await readIssuance(tx, issuanceId)),
      replayed: false,
      historicalResult: false,
    };
  } catch (error) {
    if (error instanceof ProtocolError) {
      await audit(tx, {
        actor: actor.id,
        type: "LICENSE_ARTIFACT_REJECTED",
        targetType: "LicenseIssuance",
        targetId: issuanceId,
        outcome: "DENIED",
        reason: `Protocol:${error.reason}`,
      });
      fail(409, `ArtifactRejected:${error.reason}`, error.message);
    }
    throw error;
  }
}

export async function downloadIssuanceArtifact(
  tx: PoolClient,
  actor: ServiceActor,
  store: LicenseArtifactStore,
  rawId: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.download");
  const row = await readIssuance(tx, ulidValue(rawId, "issuanceId"));
  if (row.status !== "SIGNED_RECORDED" || row.artifact_store_key === null)
    fail(409, "NoArtifact", "No signed artifact has been recorded.");
  let bytes: Buffer;
  try {
    bytes = await store.read(row.artifact_store_key);
  } catch {
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_ARTIFACT_INTEGRITY_FAILED",
      targetType: "LicenseIssuance",
      targetId: row.id,
      outcome: "DENIED",
      reason: "Stored artifact is missing",
    });
    fail(503, "ArtifactStorageUnavailable", "The stored artifact is missing.");
  }
  if (sha256Bytes(bytes) !== row.artifact_sha256) {
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_ARTIFACT_INTEGRITY_FAILED",
      targetType: "LicenseIssuance",
      targetId: row.id,
      outcome: "DENIED",
      reason: "Stored artifact digest mismatch",
    });
    fail(
      503,
      "ArtifactIntegrityFailed",
      "The stored artifact failed integrity verification.",
    );
  }
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_ARTIFACT_DOWNLOADED",
    targetType: "LicenseIssuance",
    targetId: row.id,
    after: { artifactSha256: row.artifact_sha256 },
  });
  return {
    fileName: `vardena-license-${row.operation_id}.json`,
    contentType: "application/json",
    bytes,
  };
}

// ---------------------------------------------------------------------------
// Signed revocation artifact (OD-LIC-17, protocol design)
// ---------------------------------------------------------------------------

interface RevocationRow {
  id: string;
  issuance_id: string;
  license_id: string;
  target_operation_id: string;
  customer_id: string;
  customer_code: string;
  installation_id: string;
  reason: RevocationReason;
  reason_detail: string | null;
  effect: string;
  signing_key_id: string | null;
  status: "REQUEST_PREPARED" | "SIGNED_RECORDED" | "ABANDONED";
  issued_at: Date;
  request_payload_sha256: string;
  request_binding_sha256: string;
  request_document: string;
  request_file_name: string;
  requested_at: Date;
  requested_by: string;
  imported_at: Date | null;
  imported_by: string | null;
  artifact_sha256: string | null;
  artifact_store_key: string | null;
}

function revocationResponse(row: RevocationRow) {
  return {
    revocationId: row.id,
    issuanceId: row.issuance_id,
    licenseId: row.license_id,
    targetOperationId: row.target_operation_id,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    installationId: row.installation_id,
    reason: row.reason,
    reasonDetail: row.reason_detail,
    effect: row.effect,
    protocolVersion: "VREV1",
    signingKeyId: row.signing_key_id,
    status: row.status,
    issuedAt: iso(row.issued_at),
    requestPayloadSha256: row.request_payload_sha256,
    requestBindingSha256: row.request_binding_sha256,
    requestedAt: iso(row.requested_at),
    requestedBy: row.requested_by,
    importedAt: iso(row.imported_at),
    importedBy: row.imported_by,
    artifactSha256: row.artifact_sha256,
    artifactAvailable: row.artifact_sha256 !== null,
    signedArtifactProduced: row.status === "SIGNED_RECORDED",
    reactivationPermitted: false,
  };
}

async function readRevocation(tx: PoolClient, id: string, lock = false) {
  const row = (
    await tx.query<RevocationRow>(
      `SELECT * FROM owner.license_revocations WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Revocation not found.");
  return row;
}

export async function listRevocations(
  tx: PoolClient,
  actor: ServiceActor,
  query: Record<string, unknown>,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const currentPage = page(query.page);
  const rows = await tx.query<RevocationRow>(
    "SELECT * FROM owner.license_revocations ORDER BY requested_at DESC, id DESC LIMIT 50 OFFSET $1",
    [(currentPage - 1) * 50],
  );
  return {
    items: rows.rows.map(revocationResponse),
    page: currentPage,
    pageSize: 50,
  };
}

export async function getRevocation(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
) {
  assertActiveAuthorizedActor(actor, "licenses.view");
  return revocationResponse(
    await readRevocation(tx, ulidValue(rawId, "revocationId")),
  );
}

export async function prepareRevocation(
  tx: PoolClient,
  actor: ServiceActor,
  trustedKeys: readonly TrustedLicenseKey[],
  rawIssuanceId: unknown,
  body: unknown,
) {
  ownerAdmin(actor);
  const issuanceId = ulidValue(rawIssuanceId, "issuanceId");
  const input = object(body, ["reason", "reasonDetail", "signingKeyId"]);
  if (
    typeof input.reason !== "string" ||
    !(REVOCATION_REASONS as readonly string[]).includes(input.reason)
  )
    invalid("reason is not a known revocation reason.");
  const reason = input.reason as RevocationReason;
  const reasonDetailRaw = input.reasonDetail;
  if (reasonDetailRaw !== undefined && reasonDetailRaw !== null) {
    if (typeof reasonDetailRaw !== "string")
      invalid("reasonDetail must be a string.");
  }
  const reasonDetail =
    reasonDetailRaw === undefined || reasonDetailRaw === null
      ? null
      : text(reasonDetailRaw, "reasonDetail", 1, 500);
  if (reason === "OTHER" && reasonDetail === null)
    invalid("A reason of OTHER requires reasonDetail.");
  if (
    typeof input.signingKeyId !== "string" ||
    !KEY_ID.test(input.signingKeyId)
  )
    invalid("signingKeyId is required.");
  if (!trustedKeys.some((key) => key.id === input.signingKeyId))
    invalid("The signing key is not in the configured trust list.");
  const issuance = await readIssuance(tx, issuanceId, true);
  if (issuance.status !== "SIGNED_RECORDED")
    fail(
      409,
      "InvalidTransition",
      "Only a recorded signed issuance can be revoked.",
    );
  const existing = await tx.query<{ id: string }>(
    "SELECT id FROM owner.license_revocations WHERE issuance_id=$1",
    [issuanceId],
  );
  if (existing.rowCount)
    fail(409, "AlreadyRevoked", "This issuance already has a revocation.");
  await assertActiveSigningKey(tx, input.signingKeyId);
  const now = (await tx.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
    .rows[0]!.now;
  const revocationId = ulid();
  const payload: RevocationPayload = {
    v: 1,
    kind: "SERVER_LICENSE_REVOCATION",
    revocationId,
    licenseId: issuance.license_id,
    targetOperationId: issuance.operation_id,
    customerId: issuance.customer_id,
    customerCode: issuance.customer_code,
    installationId: issuance.installation_id,
    effect: "LICENSE_ONLY",
    reason,
    reasonDetail,
    issuerKeyId: input.signingKeyId,
    issuedAt: now,
  };
  let prepared;
  try {
    prepared = prepareRevocationRequest(payload);
  } catch (error) {
    if (error instanceof ProtocolError) invalid(error.message);
    throw error;
  }
  await tx.query(
    `INSERT INTO owner.license_revocations
      (id,issuance_id,license_id,target_operation_id,customer_id,customer_code,
       installation_id,reason,reason_detail,effect,signing_key_id,issued_at,
       request_payload_sha256,request_binding_sha256,request_document,
       request_file_name,requested_at,requested_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'LICENSE_ONLY',$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      revocationId,
      issuanceId,
      payload.licenseId,
      payload.targetOperationId,
      payload.customerId,
      payload.customerCode,
      payload.installationId,
      reason,
      reasonDetail,
      input.signingKeyId,
      now,
      prepared.requestDigest,
      prepared.bindingDigest,
      prepared.envelope,
      prepared.fileName,
      now,
      actor.id,
    ],
  );
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_REVOCATION_REQUEST_PREPARED",
    targetType: "LicenseRevocation",
    targetId: revocationId,
    after: {
      issuanceId,
      licenseId: payload.licenseId,
      reason,
      signingKeyId: input.signingKeyId,
      requestPayloadSha256: prepared.requestDigest,
    },
  });
  return {
    revocation: revocationResponse(await readRevocation(tx, revocationId)),
    requestPayloadSha256: prepared.requestDigest,
    requestBindingSha256: prepared.bindingDigest,
    requestFileName: prepared.fileName,
    unsignedRequest: true,
    signedArtifactProduced: false,
  };
}

export async function getRevocationRequest(
  tx: PoolClient,
  actor: ServiceActor,
  rawId: unknown,
) {
  ownerAdmin(actor);
  const row = await readRevocation(tx, ulidValue(rawId, "revocationId"));
  return {
    revocationId: row.id,
    fileName: row.request_file_name,
    fileContent: row.request_document,
    requestPayloadSha256: row.request_payload_sha256,
    requestBindingSha256: row.request_binding_sha256,
    unsigned: true,
  };
}

export async function importRevocationArtifact(
  tx: PoolClient,
  actor: ServiceActor,
  store: LicenseArtifactStore,
  trustedKeys: readonly TrustedLicenseKey[],
  rawId: unknown,
  body: unknown,
) {
  ownerAdmin(actor);
  const revocationId = ulidValue(rawId, "revocationId");
  const input = object(body, ["fileContent"]);
  if (typeof input.fileContent !== "string")
    invalid("fileContent is required.");
  if (Buffer.byteLength(input.fileContent, "utf8") > REQUEST_MAX_BYTES)
    invalid("The artifact is too large.");
  const row = await readRevocation(tx, revocationId, true);
  if (row.status === "SIGNED_RECORDED") {
    let digest: string | null = null;
    try {
      const envelope = decodeRevocationEnvelope(input.fileContent);
      const verified = verifyRevocation(envelope.document, trustedKeys, {
        keyIdHint: envelope.keyId,
      });
      digest = sha256Hex(Buffer.from(verified.canonicalBody, "utf8"));
    } catch {
      digest = null;
    }
    if (digest === null || digest !== row.request_binding_sha256)
      fail(
        409,
        "OperationConflict",
        "This revocation is already recorded with a different artifact.",
      );
    // OD-LIC-18 applies to revocation artifacts too: a replay is not a new fact.
    return {
      revocation: revocationResponse(row),
      replayed: true,
      historicalResult: true,
    };
  }
  if (row.status !== "REQUEST_PREPARED")
    fail(409, "InvalidTransition", "The revocation cannot accept an artifact.");
  try {
    const envelope = decodeRevocationEnvelope(input.fileContent);
    const verified = verifyRevocation(envelope.document, trustedKeys, {
      keyIdHint: envelope.keyId,
    });
    const payload = verified.payload;
    const mismatch = (field: string) =>
      fail(
        409,
        "ArtifactBindingMismatch",
        `The signed revocation does not match the authorized request (${field}).`,
      );
    if (payload.revocationId !== row.id) mismatch("revocationId");
    if (payload.licenseId !== row.license_id) mismatch("licenseId");
    if (payload.targetOperationId !== row.target_operation_id)
      mismatch("targetOperationId");
    if (payload.customerId !== row.customer_id) mismatch("customerId");
    if (payload.customerCode !== row.customer_code) mismatch("customerCode");
    if (payload.installationId !== row.installation_id)
      mismatch("installationId");
    if (payload.reason !== row.reason) mismatch("reason");
    if (payload.reasonDetail !== row.reason_detail) mismatch("reasonDetail");
    if (payload.effect !== "LICENSE_ONLY") mismatch("effect");
    if (payload.issuerKeyId !== row.signing_key_id) mismatch("issuerKeyId");
    if (!sameInstant(payload.issuedAt, row.issued_at)) mismatch("issuedAt");
    const binding = sha256Hex(Buffer.from(verified.canonicalBody, "utf8"));
    if (binding !== row.request_binding_sha256)
      fail(
        409,
        "ArtifactBindingMismatch",
        "The signed revocation is not the one this request authorized.",
      );
    await assertActiveSigningKey(tx, verified.keyId);
    const bytes = Buffer.from(input.fileContent, "utf8");
    const artifactDigest = sha256Bytes(bytes);
    const storeKey = await archiveArtifact(
      tx,
      store,
      actor,
      "REVOCATION",
      revocationId,
      bytes,
      `vardena-revocation-${row.id}.json`,
      artifactDigest,
    );
    await tx.query(
      `UPDATE owner.license_revocations
         SET status='SIGNED_RECORDED', signing_key_id=$2,
             imported_at=clock_timestamp(), imported_by=$3,
             artifact_sha256=$4, artifact_store_key=$5, updated_at=clock_timestamp()
       WHERE id=$1 AND status='REQUEST_PREPARED'`,
      [revocationId, verified.keyId, actor.id, artifactDigest, storeKey],
    );
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_REVOCATION_ARTIFACT_IMPORTED",
      targetType: "LicenseRevocation",
      targetId: revocationId,
      after: {
        licenseId: row.license_id,
        signingKeyId: verified.keyId,
        artifactSha256: artifactDigest,
      },
    });
    return {
      revocation: revocationResponse(await readRevocation(tx, revocationId)),
      replayed: false,
      historicalResult: false,
    };
  } catch (error) {
    if (error instanceof ProtocolError) {
      await audit(tx, {
        actor: actor.id,
        type: "LICENSE_REVOCATION_ARTIFACT_REJECTED",
        targetType: "LicenseRevocation",
        targetId: revocationId,
        outcome: "DENIED",
        reason: `Protocol:${error.reason}`,
      });
      fail(409, `ArtifactRejected:${error.reason}`, error.message);
    }
    throw error;
  }
}

export async function downloadRevocationArtifact(
  tx: PoolClient,
  actor: ServiceActor,
  store: LicenseArtifactStore,
  rawId: unknown,
) {
  ownerAdmin(actor);
  const row = await readRevocation(tx, ulidValue(rawId, "revocationId"));
  if (row.status !== "SIGNED_RECORDED" || row.artifact_store_key === null)
    fail(409, "NoArtifact", "No signed revocation has been recorded.");
  let bytes: Buffer;
  try {
    bytes = await store.read(row.artifact_store_key);
  } catch {
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_REVOCATION_INTEGRITY_FAILED",
      targetType: "LicenseRevocation",
      targetId: row.id,
      outcome: "DENIED",
      reason: "Stored artifact is missing",
    });
    fail(503, "ArtifactStorageUnavailable", "The stored artifact is missing.");
  }
  if (sha256Bytes(bytes) !== row.artifact_sha256) {
    await audit(tx, {
      actor: actor.id,
      type: "LICENSE_REVOCATION_INTEGRITY_FAILED",
      targetType: "LicenseRevocation",
      targetId: row.id,
      outcome: "DENIED",
      reason: "Stored artifact digest mismatch",
    });
    fail(
      503,
      "ArtifactIntegrityFailed",
      "The stored artifact failed integrity verification.",
    );
  }
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_REVOCATION_ARTIFACT_DOWNLOADED",
    targetType: "LicenseRevocation",
    targetId: row.id,
    after: { artifactSha256: row.artifact_sha256 },
  });
  return {
    fileName: `vardena-revocation-${row.id}.json`,
    contentType: "application/json",
    bytes,
  };
}

// ---------------------------------------------------------------------------
// Recovery (OD-LIC-19)
// ---------------------------------------------------------------------------

export async function reconcileArtifacts(
  tx: PoolClient,
  actor: ServiceActor,
  store: LicenseArtifactStore,
) {
  ownerAdmin(actor);
  const rows = await tx.query<{
    id: string;
    store_key: string;
    sha256: string;
    status: string;
  }>(
    "SELECT id,store_key,sha256,status FROM owner.license_artifacts ORDER BY id",
  );
  const known = new Map(rows.rows.map((row) => [row.store_key, row]));
  const outcomes: {
    artifactId: string;
    storeKey: string;
    outcome: "INTACT" | "REPAIRED" | "QUARANTINED";
  }[] = [];
  for (const row of rows.rows) {
    const bytes = await store.read(row.store_key).catch(() => null);
    const intact = bytes !== null && sha256Bytes(bytes) === row.sha256;
    if (intact) {
      if (row.status === "PENDING") {
        await tx.query(
          "UPDATE owner.license_artifacts SET status='DURABLE', verified_at=clock_timestamp(), verified_by=$2 WHERE id=$1 AND status='PENDING'",
          [row.id, actor.id],
        );
        outcomes.push({
          artifactId: row.id,
          storeKey: row.store_key,
          outcome: "REPAIRED",
        });
      } else {
        outcomes.push({
          artifactId: row.id,
          storeKey: row.store_key,
          outcome: "INTACT",
        });
      }
    } else if (row.status !== "QUARANTINED") {
      await tx.query(
        "UPDATE owner.license_artifacts SET status='QUARANTINED', quarantine_reason=$2 WHERE id=$1",
        [row.id, bytes === null ? "file-missing" : "digest-mismatch"],
      );
      outcomes.push({
        artifactId: row.id,
        storeKey: row.store_key,
        outcome: "QUARANTINED",
      });
    } else {
      outcomes.push({
        artifactId: row.id,
        storeKey: row.store_key,
        outcome: "QUARANTINED",
      });
    }
  }
  const orphans = (await store.listKeys()).filter((key) => !known.has(key));
  await audit(tx, {
    actor: actor.id,
    type: "LICENSE_ARTIFACT_RECONCILED",
    targetType: "LicenseArtifact",
    targetId: null,
    after: {
      checked: rows.rows.length,
      repaired: outcomes.filter((o) => o.outcome === "REPAIRED").length,
      quarantined: outcomes.filter((o) => o.outcome === "QUARANTINED").length,
      orphanFiles: orphans.length,
    },
  });
  return { outcomes, orphanFiles: orphans };
}
