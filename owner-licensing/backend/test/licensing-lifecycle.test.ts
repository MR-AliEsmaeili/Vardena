// CI-only. Requires an explicit disposable Owner PostgreSQL database; never skips.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import type { Express } from "express";
import { Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import { migrate } from "../src/migrate.js";
import {
  LicenseArtifactStore,
  licenseArtifactStoreKey,
  sha256Bytes,
} from "../src/artifact-store.js";
import {
  deriveKeyId,
  licenseFileEnvelope,
  parseLicenseVersionPayload,
  prepareLicenseRequest,
  signLicenseVersion,
  type LicenseRequestPayload,
  type LicenseVersionPayload,
} from "../src/protocol.js";
import { signLicenseRequest } from "../src/signer/signer.js";
import {
  EXPIRED_REQUEST_REASON,
  PREPARED_REQUEST_MAX_AGE_MS,
  preparedRequestExpiresAt,
} from "../src/licensing.js";
import {
  ARTIFACT_MANIFEST_FILE,
  backupArtifacts,
  verifyArtifactBackup,
  verifyArtifactStore,
} from "../src/artifact-backup.js";

/**
 * Owner-side issuance lifecycle against a fresh PostgreSQL database
 * (migration 007 applied by `migrate`). This suite is the executable evidence
 * for the items the traceability matrix previously recorded as "untested":
 *
 *   OD-LIC-09  installation identity registration, ownership and retirement
 *   OD-LIC-10  artifact store staging and durable state (store unit tests live
 *              in `artifact-store.test.ts`)
 *   OD-LIC-14  database-enforced immutability of the creation-time snapshot and
 *              completion of an in-flight request after a profile change
 *   OD-LIC-16  renewal/supersession denied for a LICENSE_OPERATOR, with no
 *              issuance row and no preparation audit
 *   OD-LIC-18  duplicate import returns the historical result and writes nothing
 *   OD-LIC-19  staged persistence, reconciliation, quarantine and integrity
 *              refusal on download
 *   OD-LIC-17  Owner-side revocation preparation/import records the artifact
 *              only; nothing is applied to a customer installation here
 */

const url = process.env.OWNER_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "OWNER_TEST_DATABASE_URL is required; run this suite only in CI.",
  );

const db = new Database(url);
const origin = "https://owner.test";
const adminInitial = "Disposable_initial_71";
const adminPassword = "Disposable_admin_72";
const operatorPassword = "Disposable_operator_73";

let app: Express;
/** OD-LIC-20: frozen "server now" for the import route; null = real time. */
let clockNow: number | null = null;
let adminCookie: string;
let adminId: string;
let operatorCookie: string;
let operatorId: string;
let viewerCookie: string;
let artifactDir: string;
let store: LicenseArtifactStore;
let customerId: string;
let otherCustomerId: string;
let installationId: string;
let identityId: string;
let retiredIdentityId: string;
let profileId: string;
let signingKeyId: string;
let privateKey: KeyObject;

const write = (
  method: "post" | "patch" | "delete",
  path: string,
  cookie?: string,
) => {
  const r = request(app)
    [method](`/api/v1${path}`)
    .set("Origin", origin)
    .set("x-owner-request", "1")
    .set("Content-Type", "application/json");
  return cookie ? r.set("Cookie", cookie) : r;
};

async function login(username: string, password: string) {
  await db.pool.query("TRUNCATE owner.login_limits");
  const r = await write("post", "/auth/login").send({ username, password });
  return { r, cookie: r.headers["set-cookie"]?.[0]?.split(";")[0] as string };
}

async function signIn(
  username: string,
  initial: string,
  next: string,
): Promise<string> {
  const first = await login(username, initial);
  expect(first.r.status).toBe(200);
  const changed = await write(
    "post",
    "/auth/change-password",
    first.cookie,
  ).send({ currentPassword: initial, newPassword: next });
  expect(changed.status).toBe(200);
  return first.cookie;
}

async function grant(userId: string, permissions: readonly string[]) {
  for (const permission of permissions)
    await db.pool.query(
      `INSERT INTO owner.user_permission_grants(user_id, permission, granted_by)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, permission, adminId],
    );
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]!.n);
}

const auditCount = (type: string, targetId?: string) =>
  count(
    `SELECT count(*) AS n FROM owner.audit_events
     WHERE event_type=$1 AND ($2::text IS NULL OR target_id=$2)`,
    [type, targetId ?? null],
  );

async function createCustomer(code: string): Promise<string> {
  const created = await write("post", "/customers", adminCookie).send({
    customerCode: code,
    displayName: "مشتری چرخه صدور",
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function registerIdentity(
  customer: string,
  installation: string,
): Promise<string> {
  const created = await write(
    "post",
    "/installation-identities",
    operatorCookie,
  ).send({
    customerId: customer,
    installationId: installation,
    source: "CUSTOMER_VARDENA_SCREEN",
    sourceDetail: "screen capture reviewed by the operator",
    confirmationInstallationId: installation,
    confirmed: true,
  });
  expect(created.status).toBe(201);
  return created.body.items[0].id as string;
}

/** Prepare a time-limited request as the operator and return the response. */
async function prepare(overrides: Record<string, unknown> = {}) {
  return write("post", "/license-issuances", operatorCookie).send({
    customerId,
    installationIdentityId: identityId,
    validUntil: new Date(Date.now() + 180 * 86_400_000).toISOString(),
    organizationLimit: 2,
    userLimit: 20,
    modules: ["inventory"],
    features: [],
    signingKeyId,
    ...overrides,
  });
}

/** Sign the stored request with the in-test authority key (offline step). */
async function signIssuance(issuanceId: string) {
  const request_ = await request(app)
    .get(`/api/v1/license-issuances/${issuanceId}/request`)
    .set("Cookie", operatorCookie);
  expect(request_.status).toBe(200);
  return signLicenseRequest({
    requestContent: request_.body.fileContent,
    expectedDigest: request_.body.requestPayloadSha256,
    keyId: signingKeyId,
    loadPrivateKey: () => privateKey,
  });
}

interface IssuanceFacts {
  status: string;
  operation_id: string;
  license_id: string;
  request_document: string;
  request_payload_sha256: string;
  request_binding_sha256: string;
  requested_at: Date;
  valid_from: Date;
  valid_until: Date | null;
  organization_limit: number | null;
  user_limit: number | null;
  module_entitlements: string[];
  feature_entitlements: string[];
  abandonment_reason: string | null;
  abandoned_at: Date | null;
  abandoned_by: string | null;
  artifact_sha256: string | null;
  artifact_store_key: string | null;
  signed_at: Date | null;
  imported_at: Date | null;
}

async function issuanceFacts(id: string): Promise<IssuanceFacts> {
  return (
    await db.pool.query<IssuanceFacts>(
      `SELECT status,operation_id,license_id,request_document,request_payload_sha256,
              request_binding_sha256,requested_at,valid_from,valid_until,
              organization_limit,user_limit,module_entitlements,feature_entitlements,
              abandonment_reason,abandoned_at,abandoned_by,artifact_sha256,
              artifact_store_key,signed_at,imported_at
         FROM owner.license_issuances WHERE id=$1`,
      [id],
    )
  ).rows[0]!;
}

/** The creation-time snapshot columns OD-LIC-14 keeps immutable. */
function snapshotOf(facts: IssuanceFacts) {
  return {
    operationId: facts.operation_id,
    licenseId: facts.license_id,
    requestDocument: facts.request_document,
    requestPayloadSha256: facts.request_payload_sha256,
    requestBindingSha256: facts.request_binding_sha256,
    requestedAt: facts.requested_at.toISOString(),
    validFrom: facts.valid_from.toISOString(),
    validUntil: facts.valid_until?.toISOString() ?? null,
    organizationLimit: facts.organization_limit,
    userLimit: facts.user_limit,
    modules: facts.module_entitlements,
    features: facts.feature_entitlements,
  };
}

/**
 * OD-LIC-20 needs a prepared request whose persisted `requested_at` is old, but
 * that column is immutable and server-set, so an API-prepared request can never
 * be aged. This seeds the row with the production request builder and signs the
 * resulting envelope with the in-test authority key; everything the import
 * checks (snapshot, digests, binding, signature, key) is therefore exactly what
 * a real preparation produces.
 */
async function seedPreparedRequest(requestedAt: Date) {
  const customer = (
    await db.pool.query<{ customer_code: string; display_name: string }>(
      "SELECT customer_code,display_name FROM owner.customers WHERE id=$1",
      [customerId],
    )
  ).rows[0]!;
  const validFrom = new Date(
    Date.UTC(
      requestedAt.getUTCFullYear(),
      requestedAt.getUTCMonth(),
      requestedAt.getUTCDate(),
    ),
  );
  const payload: LicenseRequestPayload = {
    v: 1,
    kind: "SERVER_LICENSE_ISSUANCE_REQUEST",
    requestId: ulid(),
    operationId: ulid(),
    licenseId: ulid(),
    customerId,
    customerCode: customer.customer_code,
    customerName: customer.display_name,
    installationId,
    status: "ACTIVE",
    validFrom,
    validUntil: new Date(validFrom.getTime() + 180 * 86_400_000),
    organizationLimit: 2,
    userLimit: 20,
    deviceLimit: null,
    deviceLimitSpecified: false,
    modules: ["inventory"],
    features: [],
    supersedesOperationId: null,
    renewsOperationId: null,
    issuedAt: requestedAt,
    requestedAt,
    requestedByUserId: operatorId,
    signingKeyId,
  };
  const prepared = prepareLicenseRequest(payload);
  const id = ulid();
  await db.pool.query(
    `INSERT INTO owner.license_issuances
      (id,customer_id,customer_code,customer_name,license_id,operation_id,
       installation_identity_id,installation_id,license_kind,valid_from,valid_until,
       organization_limit,user_limit,device_limit,device_limit_specified,
       module_entitlements,feature_entitlements,limit_profile_id,signing_key_id,
       supersedes_operation_id,renews_operation_id,request_payload_sha256,
       request_binding_sha256,request_document,request_file_name,requested_at,requested_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'TIME_LIMITED',$9,$10,$11,$12,NULL,false,
            $13,$14,NULL,$15,NULL,NULL,$16,$17,$18,$19,$20,$21)`,
    [
      id,
      customerId,
      customer.customer_code,
      customer.display_name,
      payload.licenseId,
      payload.operationId,
      identityId,
      installationId,
      validFrom,
      payload.validUntil,
      payload.organizationLimit,
      payload.userLimit,
      payload.modules,
      payload.features,
      signingKeyId,
      prepared.requestDigest,
      prepared.bindingDigest,
      prepared.envelope,
      prepared.fileName,
      requestedAt,
      operatorId,
    ],
  );
  const signed = await signLicenseRequest({
    requestContent: prepared.envelope,
    expectedDigest: prepared.requestDigest,
    keyId: signingKeyId,
    loadPrivateKey: () => privateKey,
    // The signer's own window check runs at "signing time"; the request is
    // signed an hour after it was requested, exactly like an offline round trip.
    now: new Date(requestedAt.getTime() + 3_600_000),
  });
  return { id, signed, payload, prepared, requestedAt };
}

/** A structurally valid artifact for the same operation with one field changed. */
function tamperedArtifact(
  fileContent: string,
  change: (payload: LicenseVersionPayload) => void,
) {
  const document = fileContent.trim().startsWith("{")
    ? JSON.parse(fileContent).document
    : fileContent.trim();
  const body = Buffer.from(document.split(".")[1]!, "base64url").toString(
    "utf8",
  );
  // Parse with the production wire reader: the canonical bytes carry dates as
  // strings, entitlements as `modules`/`features`, and omit `renewsOperationId`
  // when it is null. Re-signing a hand-mapped object would test a different
  // payload than the one the customer actually receives.
  const payload = parseLicenseVersionPayload(JSON.parse(body));
  change(payload);
  return licenseFileEnvelope(
    signLicenseVersion(payload, privateKey),
    signingKeyId,
  );
}

beforeAll(async () => {
  const { publicKey, privateKey: generated } = generateKeyPairSync("ed25519");
  privateKey = generated;
  signingKeyId = deriveKeyId(publicKey);
  const publicMaterial = Buffer.from(
    publicKey.export({ format: "der", type: "spki" }),
  ).toString("base64");

  await db.pool.query(
    "DROP SCHEMA IF EXISTS owner_audit_archive CASCADE; DROP SCHEMA IF EXISTS owner CASCADE; DROP TABLE IF EXISTS public.owner_migrations",
  );
  await migrate(db);
  expect(await bootstrap(db, "owner", adminInitial)).toBe(true);

  artifactDir = await mkdtemp(
    path.join(os.tmpdir(), "vardena-owner-licensing-lifecycle-"),
  );
  store = new LicenseArtifactStore(artifactDir);
  app = await createApp(
    db,
    {
      databaseUrl: url!,
      origin,
      production: false,
      port: 3001,
      artifactDir,
      trustedPublicKeys: [`${signingKeyId}:${publicMaterial}`],
    },
    { now: () => clockNow ?? Date.now() },
  );

  adminCookie = await signIn("owner", adminInitial, adminPassword);
  adminId = (
    await request(app).get("/api/v1/auth/me").set("Cookie", adminCookie)
  ).body.id;

  // OD-LIC-12: a new operator holds nothing until an explicit grant.
  const operator = await write("post", "/users", adminCookie).send({
    username: "lifecycle_operator",
    password: operatorPassword,
    role: "LICENSE_OPERATOR",
  });
  expect(operator.status).toBe(201);
  operatorId = operator.body.id;
  operatorCookie = await signIn(
    "lifecycle_operator",
    operatorPassword,
    "Disposable_operator_74",
  );
  await grant(operatorId, [
    "customers.view",
    "licenses.view",
    "licenses.issue.time_limited",
    "licenses.import",
    "licenses.download",
  ]);

  // A second operator may read but never import: used to prove that the replay
  // path is still authorized (OD-LIC-18).
  const viewer = await write("post", "/users", adminCookie).send({
    username: "lifecycle_viewer",
    password: operatorPassword,
    role: "LICENSE_OPERATOR",
  });
  expect(viewer.status).toBe(201);
  viewerCookie = await signIn(
    "lifecycle_viewer",
    operatorPassword,
    "Disposable_viewer_75",
  );
  await grant(viewer.body.id, ["customers.view", "licenses.view"]);

  const key = await write("post", "/signing-keys", adminCookie).send({
    id: signingKeyId,
    label: "CI lifecycle authority",
    notes: "Generated inside the CI job; never committed.",
    evidenceReference: "ci://licensing-lifecycle",
  });
  expect(key.status).toBe(201);

  customerId = await createCustomer(`C-${ulid()}`);
  otherCustomerId = await createCustomer(`C-${ulid()}`);
  installationId = ulid();
}, 60000);

afterAll(async () => {
  if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
  await db.close();
});

describe("installation identity and customer binding (OD-LIC-09)", () => {
  it("requires the identifier to be re-entered and confirmed, not just pasted once", async () => {
    const mismatch = await write(
      "post",
      "/installation-identities",
      operatorCookie,
    ).send({
      customerId,
      installationId,
      source: "CUSTOMER_VARDENA_SCREEN",
      confirmationInstallationId: ulid(),
      confirmed: true,
    });
    expect(mismatch.status).toBe(400);

    const unconfirmed = await write(
      "post",
      "/installation-identities",
      operatorCookie,
    ).send({
      customerId,
      installationId,
      source: "CUSTOMER_VARDENA_SCREEN",
      confirmationInstallationId: installationId,
      confirmed: false,
    });
    expect(unconfirmed.status).toBe(400);
    expect(
      await count("SELECT count(*) AS n FROM owner.installation_identities"),
    ).toBe(0);
  });

  it("records one manual, operator-confirmed identity per customer and installation", async () => {
    identityId = await registerIdentity(customerId, installationId);
    const row = (
      await db.pool.query<{
        source: string;
        status: string;
        confirmed_by: string;
        customer_id: string;
        installation_id: string;
      }>(
        "SELECT source,status,confirmed_by,customer_id,installation_id FROM owner.installation_identities WHERE id=$1",
        [identityId],
      )
    ).rows[0]!;
    expect(row).toMatchObject({
      source: "CUSTOMER_VARDENA_SCREEN",
      status: "ACTIVE",
      confirmed_by: operatorId,
      customer_id: customerId,
      installation_id: installationId,
    });

    const duplicate = await write(
      "post",
      "/installation-identities",
      operatorCookie,
    ).send({
      customerId,
      installationId,
      source: "CUSTOMER_VARDENA_SCREEN",
      confirmationInstallationId: installationId,
      confirmed: true,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("DuplicateInstallationIdentity");
  });

  it("refuses a foreign customer's identity and a retired identity at preparation", async () => {
    const foreign = await prepare({ customerId: otherCustomerId });
    expect(foreign.status).toBe(404);

    const stranger = await registerIdentity(otherCustomerId, ulid());
    // Passing another customer's identity with this customer's id must not bind.
    const crossed = await prepare({ installationIdentityId: stranger });
    expect(crossed.status).toBe(404);
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_issuances WHERE customer_id=$1",
        [customerId],
      ),
    ).toBe(0);

    retiredIdentityId = await registerIdentity(customerId, ulid());
    const retired = await write(
      "post",
      `/installation-identities/${retiredIdentityId}/retire`,
      adminCookie,
    ).send({ reason: "Server replaced after a confirmed hand-over." });
    expect(retired.status).toBe(200);
    const afterRetirement = await prepare({
      installationIdentityId: retiredIdentityId,
    });
    expect(afterRetirement.status).toBe(409);
    expect(afterRetirement.body.code).toBe("InstallationIdentityRetired");

    // Retirement is terminal: the same row cannot be reactivated.
    await expect(
      db.pool.query(
        "UPDATE owner.installation_identities SET status='ACTIVE' WHERE id=$1",
        [retiredIdentityId],
      ),
    ).rejects.toThrow(/may only be retired once/);
  });
});

describe("request preparation and OWNER_ADMIN-only lineage (OD-LIC-16)", () => {
  it("prepares a time-limited request with both digests and no signature", async () => {
    const prepared = await prepare();
    expect(prepared.status).toBe(201);
    expect(prepared.body.unsignedRequest).toBe(true);
    expect(prepared.body.signedArtifactProduced).toBe(false);
    expect(prepared.body.requestPayloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.body.requestBindingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.body.issuance.status).toBe("REQUEST_PREPARED");
    expect(prepared.body.issuance.installationId).toBe(installationId);
    expect(prepared.body.issuance.validUntil).not.toBeNull();
    // Feature entitlements are optional: the Owner form sends [] by default.
    expect(prepared.body.issuance.features).toEqual([]);
  });

  it("refuses duplicated feature codes without writing a request", async () => {
    const before = await count(
      "SELECT count(*) AS n FROM owner.license_issuances WHERE customer_id=$1",
      [customerId],
    );
    // The Owner form sends `features: []` whenever the optional field is left
    // empty (covered by the prepared request above); duplicates are still a
    // validation error caught before any row is written.
    const duplicated = await prepare({ features: ["ledger", "ledger"] });
    expect(duplicated.status).toBe(400);
    expect(duplicated.body.code).toBe("ValidationFailed");
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_issuances WHERE customer_id=$1",
        [customerId],
      ),
    ).toBe(before);
  });

  it("refuses renewal and supersession for an operator before writing anything", async () => {
    const target = (
      await db.pool.query<{ operation_id: string }>(
        "SELECT operation_id FROM owner.license_issuances WHERE customer_id=$1 AND status='REQUEST_PREPARED' ORDER BY requested_at DESC LIMIT 1",
        [customerId],
      )
    ).rows[0]!.operation_id;
    const issuances = await count(
      "SELECT count(*) AS n FROM owner.license_issuances",
    );
    const preparedAudits = await auditCount("LICENSE_REQUEST_PREPARED");
    const deniedBefore = await auditCount("LICENSE_REQUEST_DENIED");

    for (const lineage of [
      { renewsOperationId: target },
      { supersedesOperationId: target },
    ]) {
      const denied = await prepare(lineage);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("PermissionDenied");
    }

    expect(
      await count("SELECT count(*) AS n FROM owner.license_issuances"),
    ).toBe(issuances);
    expect(await auditCount("LICENSE_REQUEST_PREPARED")).toBe(preparedAudits);
    expect(await auditCount("LICENSE_REQUEST_DENIED")).toBe(deniedBefore + 2);
    const reasons = await db.pool.query<{ reason: string }>(
      `SELECT reason FROM owner.audit_events
       WHERE event_type='LICENSE_REQUEST_DENIED' ORDER BY occurred_at DESC LIMIT 2`,
    );
    expect(reasons.rows.map((row) => row.reason)).toEqual([
      "Renewal and supersession are OWNER_ADMIN-only",
      "Renewal and supersession are OWNER_ADMIN-only",
    ]);
  });

  it("refuses perpetual issuance without the perpetual permission", async () => {
    const perpetual = await prepare({ validUntil: null });
    expect(perpetual.status).toBe(403);
    expect(perpetual.body.code).toBe("PermissionDenied");
  });

  it("refuses a renewal target that is not a recorded issuance of this customer", async () => {
    const unknown = await prepare({
      renewsOperationId: ulid(),
    });
    // The operator never reaches lineage validation (OD-LIC-16); an Owner Admin
    // does, and the target must already be a recorded issuance.
    expect(unknown.status).toBe(403);
    const adminAttempt = await write(
      "post",
      "/license-issuances",
      adminCookie,
    ).send({
      customerId,
      installationIdentityId: identityId,
      validUntil: new Date(Date.now() + 180 * 86_400_000).toISOString(),
      modules: ["inventory"],
      signingKeyId,
      renewsOperationId: ulid(),
    });
    expect(adminAttempt.status).toBe(400);
    expect(
      await count("SELECT count(*) AS n FROM owner.license_issuances"),
    ).toBe(1);
  });
});

describe("import, replay and archive (OD-LIC-10, OD-LIC-18, OD-LIC-19)", () => {
  let issuanceId: string;
  let signed: Awaited<ReturnType<typeof signIssuance>>;

  it("records a first artifact once and archives the exact bytes as DURABLE", async () => {
    issuanceId = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM owner.license_issuances WHERE customer_id=$1 ORDER BY requested_at DESC LIMIT 1",
        [customerId],
      )
    ).rows[0]!.id;
    signed = await signIssuance(issuanceId);

    const imported = await write(
      "post",
      `/license-issuances/${issuanceId}/import`,
      operatorCookie,
    ).send({ fileContent: signed.envelope });
    expect(imported.status).toBe(200);
    expect(imported.body.replayed).toBe(false);
    expect(imported.body.issuance.status).toBe("SIGNED_RECORDED");
    expect(imported.body.issuance.artifactAvailable).toBe(true);

    const artifacts = await db.pool.query<{
      status: string;
      sha256: string;
      store_key: string;
      kind: string;
    }>("SELECT status,sha256,store_key,kind FROM owner.license_artifacts");
    expect(artifacts.rows).toHaveLength(1);
    expect(artifacts.rows[0]!.status).toBe("DURABLE");
    expect(artifacts.rows[0]!.kind).toBe("LICENSE");
    expect(artifacts.rows[0]!.sha256).toBe(
      sha256Bytes(Buffer.from(signed.envelope, "utf8")),
    );
    expect(await store.read(artifacts.rows[0]!.store_key)).toEqual(
      Buffer.from(signed.envelope, "utf8"),
    );
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", issuanceId)).toBe(1);
  });

  it("returns the historical result for a byte-identical duplicate and writes nothing", async () => {
    const before = (
      await db.pool.query<{ imported_at: Date; signed_at: Date }>(
        "SELECT imported_at,signed_at FROM owner.license_issuances WHERE id=$1",
        [issuanceId],
      )
    ).rows[0]!;
    const replay = await write(
      "post",
      `/license-issuances/${issuanceId}/import`,
      operatorCookie,
    ).send({ fileContent: signed.envelope });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.historicalResult).toBe(true);
    expect(replay.body.issuance.id).toBe(issuanceId);

    const after = (
      await db.pool.query<{ imported_at: Date; signed_at: Date }>(
        "SELECT imported_at,signed_at FROM owner.license_issuances WHERE id=$1",
        [issuanceId],
      )
    ).rows[0]!;
    expect(after.imported_at.toISOString()).toBe(
      before.imported_at.toISOString(),
    );
    expect(after.signed_at.toISOString()).toBe(before.signed_at.toISOString());
    expect(
      await count("SELECT count(*) AS n FROM owner.license_artifacts"),
    ).toBe(1);
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", issuanceId)).toBe(1);
  });

  it("still authorizes a replay: a session without licenses.import is refused", async () => {
    const denied = await write(
      "post",
      `/license-issuances/${issuanceId}/import`,
      viewerCookie,
    ).send({ fileContent: signed.envelope });
    expect(denied.status).toBe(403);
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", issuanceId)).toBe(1);
    expect(
      await count("SELECT count(*) AS n FROM owner.license_artifacts"),
    ).toBe(1);
  });

  it("refuses a different artifact for an already recorded operation", async () => {
    const conflict = await write(
      "post",
      `/license-issuances/${issuanceId}/import`,
      operatorCookie,
    ).send({
      fileContent: tamperedArtifact(signed.envelope, (payload) => {
        payload.customerName = "مشتری دیگر";
      }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("OperationConflict");
  });

  it("refuses an artifact whose installation binding was altered, and records no signature", async () => {
    const pending = await prepare();
    expect(pending.status).toBe(201);
    const pendingId = pending.body.issuance.id as string;
    const fresh = await signIssuance(pendingId);
    const altered = tamperedArtifact(fresh.envelope, (payload) => {
      payload.installationId = ulid();
    });
    const refused = await write(
      "post",
      `/license-issuances/${pendingId}/import`,
      operatorCookie,
    ).send({ fileContent: altered });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("ArtifactBindingMismatch");
    const row = (
      await db.pool.query<{ status: string }>(
        "SELECT status FROM owner.license_issuances WHERE id=$1",
        [pendingId],
      )
    ).rows[0]!;
    expect(row.status).toBe("REQUEST_PREPARED");
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_artifacts WHERE issuance_id=$1",
        [pendingId],
      ),
    ).toBe(0);
  });

  it("downloads the exact bytes and audits the access", async () => {
    // Collect raw bytes: the endpoint is a file download, not JSON.
    const downloaded = await request(app)
      .get(`/api/v1/license-issuances/${issuanceId}/artifact`)
      .set("Origin", origin)
      .set("Cookie", operatorCookie)
      .buffer(true)
      .parse((response, resolve) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(null, Buffer.concat(chunks)));
      });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toContain(
      "vardena-license-",
    );
    expect((downloaded.body as Buffer).toString("utf8")).toBe(signed.envelope);
    expect(await auditCount("LICENSE_ARTIFACT_DOWNLOADED", issuanceId)).toBe(1);
  });
});

describe("creation-time snapshot (OD-LIC-14)", () => {
  let snapshotId: string;

  it("completes an in-flight request after its profile was retired", async () => {
    const profile = await write(
      "post",
      `/customers/${customerId}/limit-profiles`,
      adminCookie,
    ).send({
      organizationLimit: 3,
      userLimit: 30,
      allowedModules: ["inventory"],
      perpetualAllowed: false,
    });
    expect(profile.status).toBe(201);
    profileId = profile.body.id;

    const prepared = await prepare({ organizationLimit: 3, userLimit: 30 });
    expect(prepared.status).toBe(201);
    snapshotId = prepared.body.issuance.id;
    expect(prepared.body.issuance.limitProfileId).toBe(profileId);

    const retired = await write(
      "post",
      `/limit-profiles/${profileId}/retire`,
      adminCookie,
    ).send({ reason: "Replaced by a reviewed ceiling." });
    expect(retired.status).toBe(200);

    const signed = await signIssuance(snapshotId);
    const imported = await write(
      "post",
      `/license-issuances/${snapshotId}/import`,
      operatorCookie,
    ).send({ fileContent: signed.envelope });
    expect(imported.status).toBe(200);
    expect(imported.body.issuance.status).toBe("SIGNED_RECORDED");
    expect(imported.body.issuance.limitProfileId).toBe(profileId);
    expect(imported.body.issuance.organizationLimit).toBe(3);
    expect(imported.body.issuance.userLimit).toBe(30);
  });

  it("refuses any database rewrite of the snapshot or its digests", async () => {
    for (const statement of [
      "UPDATE owner.license_issuances SET valid_until = valid_until + interval '1 day' WHERE id=$1",
      "UPDATE owner.license_issuances SET organization_limit = 99 WHERE id=$1",
      "UPDATE owner.license_issuances SET limit_profile_id = NULL WHERE id=$1",
      "UPDATE owner.license_issuances SET request_payload_sha256 = repeat('a',64) WHERE id=$1",
      "UPDATE owner.license_issuances SET request_binding_sha256 = repeat('b',64) WHERE id=$1",
      "UPDATE owner.license_issuances SET operation_id = repeat('C',26) WHERE id=$1",
    ])
      await expect(db.pool.query(statement, [snapshotId])).rejects.toThrow(
        /Issuance identity, snapshot and digests are immutable/,
      );
  });

  it("refuses an illegal status transition on the stored row", async () => {
    await expect(
      db.pool.query(
        "UPDATE owner.license_issuances SET status='REQUEST_PREPARED' WHERE id=$1",
        [snapshotId],
      ),
    ).rejects.toThrow(/Illegal issuance status transition/);
    await expect(
      db.pool.query(
        "UPDATE owner.license_issuances SET status='ABANDONED' WHERE id=$1",
        [snapshotId],
      ),
    ).rejects.toThrow(/Illegal issuance status transition/);
  });

  it("keeps the retirement decision and the ceiling history readable", async () => {
    const retirement = await db.pool.query<{ status: string }>(
      "SELECT status FROM owner.customer_limit_profiles WHERE id=$1",
      [profileId],
    );
    expect(retirement.rows[0]!.status).toBe("RETIRED");
    await expect(
      db.pool.query(
        "UPDATE owner.customer_limit_profiles SET organization_limit = 10 WHERE id=$1",
        [profileId],
      ),
    ).rejects.toThrow(/ceiling|immutable/i);
  });
});

describe("prepared-request maximum age (OD-LIC-20)", () => {
  afterEach(() => {
    clockNow = null;
  });

  it("completes a request one minute before the fixed boundary", async () => {
    const requestedAt = new Date("2026-06-01T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = requestedAt.getTime() + PREPARED_REQUEST_MAX_AGE_MS - 60_000;

    const imported = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(imported.status).toBe(200);
    expect(imported.body.issuance.status).toBe("SIGNED_RECORDED");
    expect(imported.body.replayed).toBe(false);

    const facts = await issuanceFacts(seeded.id);
    expect(facts.status).toBe("SIGNED_RECORDED");
    expect(facts.abandonment_reason).toBeNull();
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(0);
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", seeded.id)).toBe(1);
  });

  it("refuses and abandons a request exactly on the boundary, atomically", async () => {
    // 2026-03-28 21:30 UTC is the day before the European DST change: fourteen
    // UTC days later the local calendar has moved 14 days but one hour, which
    // must not move the boundary.
    const requestedAt = new Date("2026-03-28T21:30:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    const before = await issuanceFacts(seeded.id);
    expect(new Date(preparedRequestExpiresAt(requestedAt)).toISOString()).toBe(
      "2026-04-11T21:30:00.000Z",
    );
    clockNow = preparedRequestExpiresAt(requestedAt);

    const refused = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("InvalidTransition");
    expect(refused.body.message).toContain("expired");

    const after = await issuanceFacts(seeded.id);
    expect(after.status).toBe("ABANDONED");
    expect(after.abandonment_reason).toBe(EXPIRED_REQUEST_REASON);
    expect(after.abandoned_at).not.toBeNull();
    expect(after.abandoned_by).toBe(operatorId);
    expect(after.signed_at).toBeNull();
    expect(after.imported_at).toBeNull();
    expect(after.artifact_sha256).toBeNull();
    expect(after.artifact_store_key).toBeNull();

    // OD-LIC-14: the creation-time snapshot is untouched by the expiry.
    expect(snapshotOf(after)).toEqual(snapshotOf(before));

    // The system origin is durable and legible: no actor, expiry in the reason.
    const events = (
      await db.pool.query<{
        actor_id: string | null;
        outcome: string;
        reason: string;
        after_state: { origin?: string; operationId?: string };
      }>(
        `SELECT actor_id,outcome,reason,after_state FROM owner.audit_events
          WHERE event_type='LICENSE_REQUEST_ABANDONED' AND target_id=$1
          ORDER BY sequence`,
        [seeded.id],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_id).toBeNull();
    expect(events[0]!.outcome).toBe("SUCCESS");
    expect(events[0]!.reason).toContain("SYSTEM_EXPIRY");
    expect(events[0]!.reason).toContain(requestedAt.toISOString());
    expect(events[0]!.after_state.origin).toBe("SYSTEM_EXPIRY");

    // No issuance, archive row or success audit may be produced.
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", seeded.id)).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_artifacts WHERE issuance_id=$1",
        [seeded.id],
      ),
    ).toBe(0);
  });

  it("refuses a request one millisecond after the boundary", async () => {
    const requestedAt = new Date("2026-06-03T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt) + 1;

    const refused = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("expired");
    expect((await issuanceFacts(seeded.id)).status).toBe("ABANDONED");
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(1);
  });

  it("cannot be extended by the artifact's own timestamps", async () => {
    const requestedAt = new Date("2026-06-04T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt);
    // A signer that claims the request was issued "now" changes nothing: the
    // server decides from the persisted creation instant, and refuses before it
    // even parses the artifact.
    const fresher = tamperedArtifact(seeded.signed.envelope, (payload) => {
      payload.issuedAt = new Date(clockNow!);
    });
    const refused = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: fresher });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("expired");
    const facts = await issuanceFacts(seeded.id);
    expect(facts.status).toBe("ABANDONED");
    expect(facts.signed_at).toBeNull();
    expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", seeded.id)).toBe(0);
  });

  it("writes no transition and reports no success when the audit cannot be written", async () => {
    const requestedAt = new Date("2026-06-05T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt);
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION owner.test_fail_expiry_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'LICENSE_REQUEST_ABANDONED'
           AND NEW.actor_id IS NULL
           AND NEW.target_id = '${seeded.id}' THEN
          RAISE EXCEPTION 'forced OD-LIC-20 audit failure' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_fail_expiry_audit BEFORE INSERT ON owner.audit_events
        FOR EACH ROW EXECUTE FUNCTION owner.test_fail_expiry_audit();
    `);
    try {
      const failed = await write(
        "post",
        `/license-issuances/${seeded.id}/import`,
        operatorCookie,
      ).send({ fileContent: seeded.signed.envelope });
      // No false success: the transaction rolled the transition back with the
      // audit, so the request is still prepared and nothing was recorded.
      expect(failed.status).toBe(500);
      const facts = await issuanceFacts(seeded.id);
      expect(facts.status).toBe("REQUEST_PREPARED");
      expect(facts.abandonment_reason).toBeNull();
      expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(0);
      expect(await auditCount("LICENSE_ARTIFACT_IMPORTED", seeded.id)).toBe(0);
      expect(
        await count(
          "SELECT count(*) AS n FROM owner.license_artifacts WHERE issuance_id=$1",
          [seeded.id],
        ),
      ).toBe(0);
    } finally {
      await db.pool.query(
        "DROP TRIGGER IF EXISTS test_fail_expiry_audit ON owner.audit_events; DROP FUNCTION IF EXISTS owner.test_fail_expiry_audit()",
      );
    }
  });

  it("produces no duplicate effects under concurrent attempts", async () => {
    const requestedAt = new Date("2026-06-06T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt);

    const attempts = await Promise.all([
      write(
        "post",
        `/license-issuances/${seeded.id}/import`,
        operatorCookie,
      ).send({ fileContent: seeded.signed.envelope }),
      write(
        "post",
        `/license-issuances/${seeded.id}/import`,
        operatorCookie,
      ).send({ fileContent: seeded.signed.envelope }),
    ]);
    for (const attempt of attempts) expect(attempt.status).toBe(409);
    expect(
      attempts.filter((a) => a.body.message.includes("expired")),
    ).toHaveLength(1);
    expect((await issuanceFacts(seeded.id)).status).toBe("ABANDONED");
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_artifacts WHERE issuance_id=$1",
        [seeded.id],
      ),
    ).toBe(0);
  });

  it("authorizes before expiring: a viewer cannot trigger the transition", async () => {
    const requestedAt = new Date("2026-06-07T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt);

    const denied = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      viewerCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(denied.status).toBe(403);
    expect((await issuanceFacts(seeded.id)).status).toBe("REQUEST_PREPARED");
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(0);
  });

  it("keeps an abandoned request terminal and never revives it", async () => {
    const requestedAt = new Date("2026-06-08T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    const before = await issuanceFacts(seeded.id);
    clockNow = preparedRequestExpiresAt(requestedAt);
    const first = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(first.status).toBe(409);

    const again = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("InvalidTransition");
    const after = await issuanceFacts(seeded.id);
    expect(after.status).toBe("ABANDONED");
    expect(snapshotOf(after)).toEqual(snapshotOf(before));
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", seeded.id)).toBe(1);
  });

  it("requires new operation and license identities for a replacement request", async () => {
    const requestedAt = new Date("2026-06-09T08:00:00.000Z");
    const seeded = await seedPreparedRequest(requestedAt);
    clockNow = preparedRequestExpiresAt(requestedAt);
    const refused = await write(
      "post",
      `/license-issuances/${seeded.id}/import`,
      operatorCookie,
    ).send({ fileContent: seeded.signed.envelope });
    expect(refused.status).toBe(409);

    clockNow = null;
    const replacement = await prepare();
    expect(replacement.status).toBe(201);
    expect(replacement.body.issuance.id).not.toBe(seeded.id);
    expect(replacement.body.issuance.operationId).not.toBe(
      seeded.payload.operationId,
    );
    expect(replacement.body.issuance.licenseId).not.toBe(
      seeded.payload.licenseId,
    );
    const old = await issuanceFacts(seeded.id);
    expect(old.status).toBe("ABANDONED");
    expect(old.operation_id).toBe(seeded.payload.operationId);
    expect(old.license_id).toBe(seeded.payload.licenseId);
  });

  it("refuses a human abandonment reason that claims system origin", async () => {
    const pending = await prepare();
    expect(pending.status).toBe(201);
    const id = pending.body.issuance.id as string;
    const refused = await write(
      "post",
      `/license-issuances/${id}/abandon`,
      operatorCookie,
    ).send({ reason: "SYSTEM_EXPIRY: typed by a human" });
    expect(refused.status).toBe(400);
    expect((await issuanceFacts(id)).status).toBe("REQUEST_PREPARED");
    expect(await auditCount("LICENSE_REQUEST_ABANDONED", id)).toBe(0);
  });
});

describe("limit profile lifecycle (OD-LIC-13)", () => {
  it("keeps at most one ACTIVE profile and reactivates the same retired row", async () => {
    // `profileId` was retired by the OD-LIC-14 case above; no profile is active.
    const replacement = await write(
      "post",
      `/customers/${customerId}/limit-profiles`,
      adminCookie,
    ).send({
      organizationLimit: 4,
      userLimit: 40,
      allowedModules: ["inventory"],
      perpetualAllowed: false,
    });
    expect(replacement.status).toBe(201);
    const replacementId = replacement.body.id as string;

    const conflict = await write(
      "post",
      `/limit-profiles/${profileId}/reactivate`,
      adminCookie,
    ).send({ reason: "Restore the reviewed ceiling." });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("ActiveProfileExists");
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.customer_limit_profiles WHERE customer_id=$1 AND status='ACTIVE'",
        [customerId],
      ),
    ).toBe(1);

    const retiredAgain = await write(
      "post",
      `/limit-profiles/${replacementId}/retire`,
      adminCookie,
    ).send({ reason: "Superseded by the original reviewed ceiling." });
    expect(retiredAgain.status).toBe(200);

    const reactivated = await write(
      "post",
      `/limit-profiles/${profileId}/reactivate`,
      adminCookie,
    ).send({ reason: "Restore the reviewed ceiling." });
    expect(reactivated.status).toBe(200);
    const row = (
      await db.pool.query<{ status: string; organization_limit: number }>(
        "SELECT status,organization_limit FROM owner.customer_limit_profiles WHERE id=$1",
        [profileId],
      )
    ).rows[0]!;
    expect(row).toMatchObject({ status: "ACTIVE", organization_limit: 3 });
    // Both rows are retained: reactivation never deletes history.
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.customer_limit_profiles WHERE customer_id=$1",
        [customerId],
      ),
    ).toBe(2);
    expect(await auditCount("LIMIT_PROFILE_REACTIVATED", customerId)).toBe(1);
  });
});

describe("Owner-side revocation artifacts (OD-LIC-17)", () => {
  it("prepares a revocation request without touching the recorded issuance", async () => {
    const issuanceId = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM owner.license_issuances WHERE customer_id=$1 AND status='SIGNED_RECORDED' ORDER BY requested_at LIMIT 1",
        [customerId],
      )
    ).rows[0]!.id;

    const operatorAttempt = await write(
      "post",
      `/license-issuances/${issuanceId}/revocations`,
      operatorCookie,
    ).send({ reason: "NON_PAYMENT", signingKeyId });
    expect(operatorAttempt.status).toBe(403);

    const prepared = await write(
      "post",
      `/license-issuances/${issuanceId}/revocations`,
      adminCookie,
    ).send({ reason: "NON_PAYMENT", signingKeyId });
    expect(prepared.status).toBe(201);
    expect(prepared.body.unsignedRequest).toBe(true);
    expect(prepared.body.revocation.status).toBe("REQUEST_PREPARED");
    expect(prepared.body.requestPayloadSha256).toMatch(/^[0-9a-f]{64}$/);

    const issuance = (
      await db.pool.query<{ status: string }>(
        "SELECT status FROM owner.license_issuances WHERE id=$1",
        [issuanceId],
      )
    ).rows[0]!;
    expect(issuance.status).toBe("SIGNED_RECORDED");
    expect(
      await count(
        "SELECT count(*) AS n FROM owner.license_revocations WHERE issuance_id=$1 AND status='SIGNED_RECORDED'",
        [issuanceId],
      ),
    ).toBe(0);
  });
});

describe("archive backup and restore verification (OD-LIC-19)", () => {
  it("verifies the live archive and copies every DURABLE artifact byte-for-byte", async () => {
    const client = await db.pool.connect();
    try {
      const live = await verifyArtifactStore(client, store);
      expect(live.ok).toBe(true);
      expect(live.rows.length).toBeGreaterThan(0);
      expect(live.rows.every((row) => row.status === "DURABLE")).toBe(true);
      expect(live.orphanFiles).toEqual([]);

      const destination = await mkdtemp(
        path.join(os.tmpdir(), "vardena-owner-backup-"),
      );
      try {
        const { manifest, verification } = await backupArtifacts(
          client,
          store,
          destination,
        );
        expect(verification.ok).toBe(true);
        expect(manifest.artifacts).toHaveLength(live.rows.length);
        // The bundle's manifest names only metadata: no connection string, no
        // customer data, no key material.
        const manifestText = await readFile(
          path.join(destination, ARTIFACT_MANIFEST_FILE),
          "utf8",
        );
        expect(manifestText).not.toMatch(/postgres/i);
        expect(manifestText).not.toMatch(/private/i);
        // Each copied file is the exact original, byte for byte.
        const artifact = (
          await db.pool.query<{ store_key: string; sha256: string }>(
            "SELECT store_key,sha256 FROM owner.license_artifacts ORDER BY store_key LIMIT 1",
          )
        ).rows[0]!;
        const copied = await readFile(
          path.join(destination, artifact.store_key),
        );
        expect(sha256Bytes(copied)).toBe(artifact.sha256);
        expect(copied).toEqual(await store.read(artifact.store_key));

        const bundle = await verifyArtifactBackup(destination);
        expect(bundle.ok).toBe(true);
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    } finally {
      client.release();
    }
  });

  it("fails the restore gate for a database row without its file, and recovers by restoring the original bytes", async () => {
    const artifact = (
      await db.pool.query<{ store_key: string }>(
        "SELECT store_key FROM owner.license_artifacts WHERE status='DURABLE' ORDER BY store_key LIMIT 1",
      )
    ).rows[0]!;
    const original = await store.read(artifact.store_key);
    const target = path.join(artifactDir, artifact.store_key);
    await chmod(target, 0o644);
    await rm(target);
    try {
      const client = await db.pool.connect();
      try {
        const report = await verifyArtifactStore(client, store);
        expect(report.ok).toBe(false);
        expect(
          report.rows.find((row) => row.storeKey === artifact.store_key)!
            .verified,
        ).toBe("MISSING");
      } finally {
        client.release();
      }
      // Recovery is restoring the original bytes, never regenerating them.
      await writeFile(target, original);
      const recovered = await db.pool.connect();
      try {
        const report = await verifyArtifactStore(recovered, store);
        expect(
          report.rows.find((row) => row.storeKey === artifact.store_key)!
            .verified,
        ).toBe("INTACT");
      } finally {
        recovered.release();
      }
    } finally {
      await writeFile(target, original);
    }
  });

  it("refuses a backup whose source bytes no longer match the metadata", async () => {
    const artifact = (
      await db.pool.query<{ store_key: string }>(
        "SELECT store_key FROM owner.license_artifacts WHERE status='DURABLE' ORDER BY store_key LIMIT 1",
      )
    ).rows[0]!;
    const target = path.join(artifactDir, artifact.store_key);
    const original = await store.read(artifact.store_key);
    await chmod(target, 0o644);
    await writeFile(target, "corrupted");
    const destination = await mkdtemp(
      path.join(os.tmpdir(), "vardena-owner-backup-refused-"),
    );
    try {
      const client = await db.pool.connect();
      try {
        await expect(
          backupArtifacts(client, store, destination),
        ).rejects.toThrow(/not verifiable/);
      } finally {
        client.release();
      }
      await expect(
        readFile(path.join(destination, ARTIFACT_MANIFEST_FILE), "utf8"),
      ).rejects.toThrow();
    } finally {
      await writeFile(target, original);
      await rm(destination, { recursive: true, force: true });
    }
  });

  it("reports an unaccounted file and a staged registration, then accepts after reconciliation", async () => {
    // A file with no database row is surfaced, never adopted.
    const orphanKey = licenseArtifactStoreKey("revocations", ulid());
    await store.writeOnce(orphanKey, Buffer.from("orphan", "utf8"));
    const client = await db.pool.connect();
    try {
      const withOrphan = await verifyArtifactStore(client, store);
      expect(withOrphan.ok).toBe(false);
      expect(withOrphan.orphanFiles).toEqual([orphanKey]);
    } finally {
      client.release();
    }
    await store.remove(orphanKey);

    // A crash between the PENDING insert and the DURABLE update is staged, not
    // restored: verification reports it, reconciliation settles it.
    const pendingIssuance = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM owner.license_issuances WHERE status='REQUEST_PREPARED' ORDER BY requested_at DESC LIMIT 1",
      )
    ).rows[0]!.id;
    const pendingId = ulid();
    const pendingKey = licenseArtifactStoreKey("licenses", pendingId);
    const pendingBytes = Buffer.from("staged-after-restore-artifact", "utf8");
    await store.writeOnce(pendingKey, pendingBytes);
    await db.pool.query(
      `INSERT INTO owner.license_artifacts
         (id,kind,issuance_id,sha256,byte_size,store_key,original_file_name,status,created_by)
       VALUES($1,'LICENSE',$2,$3,$4,$5,'staged.json','PENDING',$6)`,
      [
        pendingId,
        pendingIssuance,
        sha256Bytes(pendingBytes),
        pendingBytes.length,
        pendingKey,
        adminId,
      ],
    );
    try {
      const client = await db.pool.connect();
      try {
        const staged = await verifyArtifactStore(client, store);
        expect(staged.ok).toBe(false);
        expect(staged.unsettled).toEqual([pendingKey]);
        expect(
          staged.rows.find((row) => row.storeKey === pendingKey)!.verified,
        ).toBe("INTACT");
      } finally {
        client.release();
      }
      const reconciled = await write(
        "post",
        "/license-artifacts/reconcile",
        adminCookie,
      ).send({});
      expect(reconciled.status).toBe(200);
      const settled = await db.pool.connect();
      try {
        const after = await verifyArtifactStore(settled, store);
        expect(after.ok).toBe(true);
        expect(after.unsettled).toEqual([]);
      } finally {
        settled.release();
      }
    } finally {
      await db.pool.query("DELETE FROM owner.license_artifacts WHERE id=$1", [
        pendingId,
      ]);
      await store.remove(pendingKey);
    }
  });
});

describe("artifact recovery and reconciliation (OD-LIC-19)", () => {
  it("reports every stored artifact intact and repairs an interrupted write", async () => {
    const intact = await write(
      "post",
      "/license-artifacts/reconcile",
      adminCookie,
    ).send({});
    expect(intact.status).toBe(200);
    expect(
      intact.body.outcomes.every(
        (o: { outcome: string }) => o.outcome === "INTACT",
      ),
    ).toBe(true);
    expect(intact.body.orphanFiles).toEqual([]);

    // A crash between the PENDING insert and the DURABLE update leaves a row
    // that reconciliation must repair once the bytes exist and verify.
    // The target is the still-unimported request from the binding case; the
    // table's target constraint requires a real issuance for kind LICENSE.
    const pendingIssuance = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM owner.license_issuances WHERE status='REQUEST_PREPARED' ORDER BY requested_at DESC LIMIT 1",
      )
    ).rows[0]!.id;
    const pendingId = ulid();
    const pendingKey = licenseArtifactStoreKey("licenses", pendingId);
    const pendingBytes = Buffer.from("interrupted-write-artifact", "utf8");
    await store.writeOnce(pendingKey, pendingBytes);
    await db.pool.query(
      `INSERT INTO owner.license_artifacts
         (id,kind,issuance_id,sha256,byte_size,store_key,original_file_name,status,created_by)
       VALUES($1,'LICENSE',$2,$3,$4,$5,'interrupted.json','PENDING',$6)`,
      [
        pendingId,
        pendingIssuance,
        sha256Bytes(pendingBytes),
        pendingBytes.length,
        pendingKey,
        adminId,
      ],
    );
    const repaired = await write(
      "post",
      "/license-artifacts/reconcile",
      adminCookie,
    ).send({});
    expect(repaired.status).toBe(200);
    expect(
      repaired.body.outcomes.find(
        (o: { storeKey: string }) => o.storeKey === pendingKey,
      ).outcome,
    ).toBe("REPAIRED");
    expect(
      (
        await db.pool.query<{ status: string }>(
          "SELECT status FROM owner.license_artifacts WHERE id=$1",
          [pendingId],
        )
      ).rows[0]!.status,
    ).toBe("DURABLE");
  });

  it("quarantines tampered bytes, refuses the download and reports orphan files", async () => {
    const stored = (
      await db.pool.query<{ id: string; store_key: string; sha256: string }>(
        "SELECT id,store_key,sha256 FROM owner.license_artifacts WHERE kind='LICENSE' AND status='DURABLE' ORDER BY created_at LIMIT 1",
      )
    ).rows[0]!;
    const original = await store.read(stored.store_key);
    const target = path.join(artifactDir, stored.store_key);
    await chmod(target, 0o644);
    await writeFile(target, "tampered");

    const quarantined = await write(
      "post",
      "/license-artifacts/reconcile",
      adminCookie,
    ).send({});
    expect(quarantined.status).toBe(200);
    expect(
      quarantined.body.outcomes.find(
        (o: { artifactId: string }) => o.artifactId === stored.id,
      ).outcome,
    ).toBe("QUARANTINED");
    const reason = (
      await db.pool.query<{ quarantine_reason: string }>(
        "SELECT quarantine_reason FROM owner.license_artifacts WHERE id=$1",
        [stored.id],
      )
    ).rows[0]!.quarantine_reason;
    expect(reason).toBe("digest-mismatch");

    const issuance = (
      await db.pool.query<{ issuance_id: string }>(
        "SELECT issuance_id FROM owner.license_artifacts WHERE id=$1",
        [stored.id],
      )
    ).rows[0]!.issuance_id;
    const download = await request(app)
      .get(`/api/v1/license-issuances/${issuance}/artifact`)
      .set("Origin", origin)
      .set("Cookie", operatorCookie);
    expect(download.status).toBe(503);
    expect(download.body.code).toBe("ArtifactIntegrityFailed");

    // A later run must not silently un-quarantine a verified-but-flagged row.
    await chmod(target, 0o644);
    await writeFile(target, original);
    const again = await write(
      "post",
      "/license-artifacts/reconcile",
      adminCookie,
    ).send({});
    expect(again.status).toBe(200);
    expect(
      (
        await db.pool.query<{ status: string }>(
          "SELECT status FROM owner.license_artifacts WHERE id=$1",
          [stored.id],
        )
      ).rows[0]!.status,
    ).toBe("QUARANTINED");

    // A file with no database row is surfaced, never adopted automatically.
    const orphanId = ulid();
    const orphanKey = licenseArtifactStoreKey("revocations", orphanId);
    await store.writeOnce(orphanKey, Buffer.from("orphan", "utf8"));
    const withOrphan = await write(
      "post",
      "/license-artifacts/reconcile",
      adminCookie,
    ).send({});
    expect(withOrphan.body.orphanFiles).toContain(orphanKey);
  });
});
