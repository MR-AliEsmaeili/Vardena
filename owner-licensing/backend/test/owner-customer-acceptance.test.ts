// Required combined acceptance. This is deliberately not an optional live-DB
// probe: absent, unavailable, non-disposable or aliased database targets fail.
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import type { Express } from "express";
import { Pool } from "pg";

import { Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import { migrate as migrateOwner } from "../src/migrate.js";
import { sha256Bytes } from "../src/artifact-store.js";
import {
  decodeLicenseRequest,
  projectLicensePayload,
} from "../src/protocol.js";

import { createTestApp } from "../../../backend/test/support/test-app.js";
import {
  APP_CONFIG,
  loadAppConfig,
} from "../../../backend/src/kernel/config/app-config.js";
import { PrismaService } from "../../../backend/src/kernel/prisma/prisma.service.js";
import { UsersService } from "../../../backend/src/modules/users/application/users.service.js";
import { RolesService } from "../../../backend/src/modules/rbac/application/roles.service.js";
import { UserRolesService } from "../../../backend/src/modules/rbac/application/user-roles.service.js";
import { PermissionRegistry } from "../../../backend/src/modules/rbac/application/permission-registry.js";

class OfflineAcceptanceSigner {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly input: ReturnType<typeof createInterface>;
  private readonly messages: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<(value: Record<string, unknown>) => void> =
    [];
  readonly ready: Promise<{ keyId: string; publicMaterial: string }>;
  keyId = "";
  publicMaterial = "";

  private constructor() {
    this.child = spawn(
      process.execPath,
      ["--import", "tsx", "test/support/offline-acceptance-signer.ts"],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
        stdio: "pipe",
      },
    );
    this.input = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.ready = new Promise((resolve, reject) => {
      let isReady = false;
      this.child.once("error", reject);
      this.input.on("line", (line) => {
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          if (!isReady) {
            if (
              message.type !== "ready" ||
              typeof message.keyId !== "string" ||
              typeof message.publicMaterial !== "string"
            ) {
              reject(
                new Error(
                  "The isolated acceptance signer did not provide a valid public key.",
                ),
              );
              return;
            }
            isReady = true;
            this.keyId = message.keyId;
            this.publicMaterial = message.publicMaterial;
            resolve({ keyId: this.keyId, publicMaterial: this.publicMaterial });
            return;
          }
          const waiter = this.waiters.shift();
          if (waiter) waiter(message);
          else this.messages.push(message);
        } catch (error) {
          const waiter = this.waiters.shift();
          if (waiter)
            waiter({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Invalid signer response.",
            });
          else reject(error);
        }
      });
      this.child.once("exit", (code) => {
        if (code !== 0) {
          const waiter = this.waiters.shift();
          waiter?.({
            ok: false,
            error: `The isolated signer exited with code ${String(code)}.`,
          });
        }
      });
    });
  }

  static async start() {
    const signer = new OfflineAcceptanceSigner();
    await signer.ready;
    return signer;
  }

  async signLicense(requestContent: string, expectedDigest: string) {
    return await this.call("license", { requestContent, expectedDigest });
  }

  async signRevocation(requestContent: string, expectedDigest: string) {
    return await this.call("revocation", { requestContent, expectedDigest });
  }

  async signPayload(payload: unknown) {
    return await this.call("payload", { payload });
  }

  async signRoguePayload(payload: unknown) {
    return await this.call("rogue-payload", { payload });
  }

  async close() {
    this.input.close();
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) resolve();
      else this.child.once("exit", () => resolve());
    });
  }

  private async call(
    action: string,
    data: Record<string, unknown>,
  ): Promise<any> {
    const responsePromise = new Promise<Record<string, unknown>>((resolve) => {
      const queued = this.messages.shift();
      if (queued) resolve(queued);
      else this.waiters.push(resolve);
    });
    this.child.stdin.write(`${JSON.stringify({ action, ...data })}\n`);
    const response = await responsePromise;
    if (response.ok !== true) {
      throw new Error(
        typeof response.error === "string"
          ? response.error
          : "Offline acceptance signing failed.",
      );
    }
    return response.result ?? response.envelope;
  }
}

const ownerUrl = process.env.OWNER_ACCEPTANCE_DATABASE_URL;
const customerUrl = process.env.CUSTOMER_ACCEPTANCE_DATABASE_URL;
if (!ownerUrl) {
  throw new Error(
    "OWNER_ACCEPTANCE_DATABASE_URL is required; the combined Owner/customer acceptance suite does not skip.",
  );
}
if (!customerUrl) {
  throw new Error(
    "CUSTOMER_ACCEPTANCE_DATABASE_URL is required; the combined Owner/customer acceptance suite does not skip.",
  );
}

const FIXED_NOW = new Date("2030-10-22T12:00:00.000Z");
const ownerOrigin = "https://owner.acceptance.test";
const ownerInitialPassword = "Disposable_acceptance_initial_91";
const ownerPassword = "Disposable_acceptance_password_92";
const customerUser = {
  username: "owner_customer_acceptance",
  password: "Disposable_customer_acceptance_93",
};
const ownerDb = new Database(ownerUrl);
let customerPool: Pool;
let customerPoolClosed = false;
let ownerApp: Express;
let ownerCookie: string;
let customerApp: Awaited<ReturnType<typeof createTestApp>>["app"];
let customerAgent: ReturnType<typeof request.agent>;
let prisma: PrismaService;
let artifactDir: string;
let signer: OfflineAcceptanceSigner;
let publicMaterial: string;
let signingKeyId: string;
let ownerCustomerId: string;
let installationIdentityId: string;
let installationId: string;
let customerId: string;
let customerCode: string;
let baseIssuanceId: string;
let baseOperationId: string;
let baseLicenseId: string;
let baseValidUntil: Date;

const ownerWrite = (url: string) =>
  request(ownerApp)
    .post(`/api/v1${url}`)
    .set("Origin", ownerOrigin)
    .set("x-owner-request", "1")
    .set("Cookie", ownerCookie)
    .set("Content-Type", "application/json");
const ownerGet = (url: string) =>
  request(ownerApp).get(`/api/v1${url}`).set("Cookie", ownerCookie);
const customerPost = (url: string) => customerAgent.post(url);
const customerGet = (url: string) => customerAgent.get(url);

async function refreshOwnerSession() {
  const response = await request(ownerApp)
    .post("/api/v1/auth/login")
    .set("Origin", ownerOrigin)
    .set("x-owner-request", "1")
    .send({ username: "owner", password: ownerPassword });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  ownerCookie = response.headers["set-cookie"]?.[0]?.split(";")[0] as string;
  expect(ownerCookie).toBeTruthy();
}

async function refreshCustomerSession() {
  const response = await customerAgent
    .post("/api/v1/auth/login")
    .send(customerUser);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

function assertDisposableDatabaseName(connectionString: string, label: string) {
  let name: string;
  try {
    name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL connection URL.`);
  }
  if (!/(^|[_-])acceptance([_-]|$)/i.test(name)) {
    throw new Error(
      `${label} must target a disposable database whose name contains the acceptance marker; got ${JSON.stringify(name)}.`,
    );
  }
}

async function customerQuery<T>(sql: string, ...params: unknown[]): Promise<T> {
  const client = await prisma.getClient<{
    $queryRawUnsafe<R>(query: string, ...values: unknown[]): Promise<R>;
  }>();
  return client.$queryRawUnsafe<T>(sql, ...params);
}

async function snapshotCustomerState() {
  const [counts, versions, entitlements, revocations, installationBinding] =
    await Promise.all([
      customerQuery<
        Array<{
          customers: bigint;
          licenses: bigint;
          versions: bigint;
          entitlements: bigint;
          audits: bigint;
          organizations: bigint;
          revocations: bigint;
        }>
      >(`
      SELECT
        (SELECT count(*) FROM licensing.customers) AS customers,
        (SELECT count(*) FROM licensing.licenses) AS licenses,
        (SELECT count(*) FROM licensing.license_versions) AS versions,
        (SELECT count(*) FROM licensing.license_version_entitlements) AS entitlements,
        (SELECT count(*) FROM licensing.license_audit_events) AS audits,
        (SELECT count(*) FROM organization.organizations) AS organizations,
        (SELECT count(*) FROM licensing.license_revocations) AS revocations
    `),
      customerQuery<Array<Record<string, unknown>>>(`
      SELECT id AS version_id, license_id, operation_id, status::text AS status, document_version,
             document_hash, key_id, valid_from, valid_until, organization_limit,
             user_limit, device_limit, device_limit_specified, governs_from,
             governs_until, superseded_by_version_id, supersedes_version_id
        FROM licensing.license_versions
       ORDER BY imported_at, operation_id
    `),
      customerQuery<Array<Record<string, unknown>>>(`
      SELECT version_id, kind::text AS kind, code
        FROM licensing.license_version_entitlements ORDER BY kind, code
    `),
      customerQuery<Array<Record<string, unknown>>>(`
      SELECT revocation_id, license_id, target_operation_id, issuer_key_id,
             artifact_sha256, canonical_payload_sha256
        FROM licensing.license_revocations ORDER BY imported_at
    `),
      customerQuery<Array<Record<string, unknown>>>(`
      SELECT i.id AS installation_id, i.customer_id, c.customer_code, c.display_name
        FROM licensing.installations i
        LEFT JOIN licensing.customers c ON c.id=i.customer_id
       WHERE i.is_self
    `),
    ]);
  return {
    counts: counts[0],
    versions,
    entitlements,
    revocations,
    installationBinding,
  };
}

async function customerCurrent() {
  const response = await customerGet("/api/v1/license/current");
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Record<string, any>;
}

async function issue(overrides: Record<string, unknown> = {}) {
  const response = await ownerWrite("/license-issuances").send({
    customerId: ownerCustomerId,
    installationIdentityId,
    validUntil: new Date(FIXED_NOW.getTime() + 30 * 86_400_000).toISOString(),
    organizationLimit: 3,
    userLimit: 2,
    modules: ["organization", "users"],
    features: [],
    signingKeyId,
    ...overrides,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.issuance as Record<string, any>;
}

async function ownerSign(issuanceId: string) {
  const fetched = await ownerGet(`/license-issuances/${issuanceId}/request`);
  expect(fetched.status, JSON.stringify(fetched.body)).toBe(200);
  const signed = await signer.signLicense(
    fetched.body.fileContent as string,
    fetched.body.requestPayloadSha256 as string,
  );
  return { fetched, signed };
}

async function ownerRecord(issuanceId: string, fileContent: string) {
  return ownerWrite(`/license-issuances/${issuanceId}/import`).send({
    fileContent,
  });
}

async function ownerArchivedBytes(issuanceId: string) {
  const response = await request(ownerApp)
    .get(`/api/v1/license-issuances/${issuanceId}/artifact`)
    .set("Cookie", ownerCookie)
    .buffer(true)
    .parse((incoming, resolve) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => resolve(null, Buffer.concat(chunks)));
    });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return Buffer.from(response.body as Buffer);
}

async function importCustomer(bytes: Buffer) {
  return customerPost("/api/v1/license/import").send({
    document: bytes.toString("utf8"),
  });
}

function customerErrorReason(response: { body: Record<string, any> }) {
  return (
    response.body?.details?.reason ?? response.body?.error?.details?.reason
  );
}

function ownerErrorCode(response: { body: Record<string, any> }) {
  return response.body?.error?.code ?? response.body?.code;
}

async function assertUnchanged(
  before: Awaited<ReturnType<typeof snapshotCustomerState>>,
) {
  const after = await snapshotCustomerState();
  // Rejections are intentionally audited; all licensing and business state
  // must remain byte-for-byte / row-for-row unchanged apart from that event.
  expect({
    ...after,
    counts: { ...after.counts, audits: before.counts?.audits },
  }).toEqual(before);
  expect(after.counts?.audits).toBeGreaterThanOrEqual(
    before.counts?.audits ?? 0n,
  );
}

async function countOwner(sql: string, params: unknown[] = []) {
  const result = await ownerDb.pool.query<{ count: string }>(sql, params);
  return Number(result.rows[0]!.count);
}

async function createTestEntitlementUse() {
  const organizations = ["acceptance_one", "acceptance_two"];
  for (const code of organizations) {
    const response = await customerPost("/api/v1/organizations").send({
      code,
      name: `Acceptance ${code}`,
      timeZone: "Asia/Tehran",
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  }
  expect((await customerGet("/api/v1/organizations")).body.total).toBe(2);
}

beforeAll(async () => {
  assertDisposableDatabaseName(ownerUrl, "OWNER_ACCEPTANCE_DATABASE_URL");
  assertDisposableDatabaseName(customerUrl, "CUSTOMER_ACCEPTANCE_DATABASE_URL");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);

  const ownerProbe = new Pool({ connectionString: ownerUrl, max: 1 });
  customerPool = new Pool({ connectionString: customerUrl, max: 1 });
  let ownerIdentity: Record<string, unknown>;
  let customerIdentity: Record<string, unknown>;
  try {
    [ownerIdentity, customerIdentity] = await Promise.all([
      ownerProbe
        .query(
          `SELECT current_database() AS database_name,
        COALESCE(inet_server_addr()::text, 'local-socket') AS server_address,
        inet_server_port() AS server_port`,
        )
        .then((result) => result.rows[0]!),
      customerPool
        .query(
          `SELECT current_database() AS database_name,
        COALESCE(inet_server_addr()::text, 'local-socket') AS server_address,
        inet_server_port() AS server_port`,
        )
        .then((result) => result.rows[0]!),
    ]);
  } catch (error) {
    await ownerProbe.end();
    await customerPool.end();
    customerPoolClosed = true;
    throw new Error(
      `Both disposable PostgreSQL databases must be reachable before acceptance; connection probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const ownerIdentityKey = JSON.stringify(ownerIdentity);
  const customerIdentityKey = JSON.stringify(customerIdentity);
  if (ownerIdentityKey === customerIdentityKey) {
    await ownerProbe.end();
    await customerPool.end();
    customerPoolClosed = true;
    throw new Error(
      "OWNER_ACCEPTANCE_DATABASE_URL and CUSTOMER_ACCEPTANCE_DATABASE_URL resolve to the same PostgreSQL database; two distinct databases are required.",
    );
  }
  await ownerProbe.end();

  // Fail closed on any pre-existing application rows: CI provisions both
  // databases from scratch; the suite never truncates or reuses real state.
  const ownerTables = await ownerDb.pool.query<{ exists: boolean }>(
    `SELECT to_regclass('owner.users') IS NOT NULL OR to_regclass('public.owner_migrations') IS NOT NULL AS exists`,
  );
  if (ownerTables.rows[0]!.exists) {
    throw new Error(
      "Owner acceptance database is not fresh; refusing to reuse it.",
    );
  }
  const customerTables = await customerPool.query<{ count: string }>(
    `SELECT count(*) AS count FROM information_schema.tables
      WHERE table_schema='licensing' AND table_name='license_versions'`,
  );
  if (Number(customerTables.rows[0]!.count) !== 1) {
    throw new Error(
      "Customer acceptance database must have the production migrations applied before the suite runs.",
    );
  }
  const customerRows = await customerPool.query<{ rows: string }>(`
    SELECT (SELECT count(*) FROM licensing.license_versions) +
           (SELECT count(*) FROM licensing.license_revocations) AS rows
  `);
  if (Number(customerRows.rows[0]!.rows) !== 0) {
    throw new Error(
      "Customer acceptance database contains licensing rows; refusing to reuse it.",
    );
  }

  signer = await OfflineAcceptanceSigner.start();
  signingKeyId = signer.keyId;
  publicMaterial = signer.publicMaterial;
  artifactDir = await mkdtemp(
    path.join(os.tmpdir(), "vardena-combined-acceptance-"),
  );

  await migrateOwner(ownerDb);
  expect(await bootstrap(ownerDb, "owner", ownerInitialPassword)).toBe(true);
  ownerApp = await createApp(
    ownerDb,
    {
      databaseUrl: ownerUrl,
      origin: ownerOrigin,
      production: false,
      port: 3011,
      artifactDir,
      trustedPublicKeys: [`${signingKeyId}:${publicMaterial}`],
    },
    { now: () => FIXED_NOW.getTime() },
  );
  const firstLogin = await request(ownerApp)
    .post("/api/v1/auth/login")
    .set("Origin", ownerOrigin)
    .set("x-owner-request", "1")
    .send({ username: "owner", password: ownerInitialPassword });
  expect(firstLogin.status, JSON.stringify(firstLogin.body)).toBe(200);
  ownerCookie = firstLogin.headers["set-cookie"]?.[0]?.split(";")[0] as string;
  expect(ownerCookie).toBeTruthy();
  const passwordChange = await request(ownerApp)
    .post("/api/v1/auth/change-password")
    .set("Origin", ownerOrigin)
    .set("x-owner-request", "1")
    .set("Cookie", ownerCookie)
    .send({
      currentPassword: ownerInitialPassword,
      newPassword: ownerPassword,
    });
  expect(passwordChange.status, JSON.stringify(passwordChange.body)).toBe(200);

  const key = await ownerWrite("/signing-keys").send({
    id: signingKeyId,
    label: "Ephemeral combined-acceptance authority",
    notes: "Public key only; private key remains in the test runner memory.",
    evidenceReference: "ci://owner-customer-acceptance",
  });
  expect(key.status, JSON.stringify(key.body)).toBe(201);

  const config = loadAppConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: customerUrl,
    LICENSE_PROVIDER: "persistent",
    LICENSE_SIGNING_PUBLIC_KEYS: `${signingKeyId}:${publicMaterial}`,
    COOKIE_SECURE: "false",
  });
  const built = await createTestApp({
    override: (builder) =>
      builder.overrideProvider(APP_CONFIG).useValue(config),
  });
  customerApp = built.app;
  prisma = customerApp.get(PrismaService);
  const allPermissions = customerApp
    .get(PermissionRegistry)
    .all()
    .map((entry) => entry.code);
  const user = await customerApp.get(UsersService).createUser(customerUser);
  const role = await customerApp.get(RolesService).createRole({
    name: "OwnerCustomerAcceptanceAdmin",
    description: "Isolated acceptance user",
    permissionCodes: allPermissions,
  });
  await customerApp.get(UserRolesService).assignRoleToUser(role.id, user.id);
  customerAgent = request.agent(customerApp.getHttpServer());
  const customerLogin = await customerAgent
    .post("/api/v1/auth/login")
    .send(customerUser);
  expect(customerLogin.status, JSON.stringify(customerLogin.body)).toBe(200);
  const initialCurrent = await customerCurrent();
  expect(initialCurrent).toMatchObject({
    licensed: false,
    accessMode: "BLOCKED",
  });
  const customerInstallationId = initialCurrent.installationId as string;
  installationId = customerInstallationId;

  const customer = await ownerWrite("/customers").send({
    customerCode: `C-${ulid()}`,
    displayName: "مشتری پذیرش یکپارچه",
  });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  ownerCustomerId = customer.body.id as string;
  customerId = customer.body.id as string;
  customerCode = customer.body.customerCode as string;

  const identity = await ownerWrite("/installation-identities").send({
    customerId: ownerCustomerId,
    installationId,
    source: "CUSTOMER_VARDENA_SCREEN",
    sourceDetail:
      "Acceptance fixture confirmed the customer installation identifier.",
    confirmationInstallationId: installationId,
    confirmed: true,
  });
  expect(identity.status, JSON.stringify(identity.body)).toBe(201);
  installationIdentityId = identity.body.items[0].id as string;

  const profile = await ownerWrite(
    `/customers/${ownerCustomerId}/limit-profiles`,
  ).send({
    organizationLimit: 3,
    userLimit: 2,
    allowedModules: ["organization", "users"],
    perpetualAllowed: false,
  });
  expect(profile.status, JSON.stringify(profile.body)).toBe(201);

  // Owner's manual confirmation binds precisely the installation id the real
  // customer API discovered; the IDs must agree before issuance is prepared.
  expect(customerInstallationId).toBe(installationId);
}, 120_000);

afterAll(async () => {
  if (customerApp) await customerApp.close();
  if (customerPool && !customerPoolClosed) await customerPool.end();
  if (signer) await signer.close();
  await ownerDb.close();
  if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("persisted Owner → offline signer → Owner archive → authenticated customer activation", () => {
  it("proves byte identity, persisted bindings, lifecycle and retained-state refusals", async () => {
    // One persisted Owner issuance snapshot is the source of the signed artifact.
    const base = await issue();
    baseIssuanceId = base.id as string;
    baseOperationId = base.operationId as string;
    baseLicenseId = base.licenseId as string;
    const persistedOwner = await Promise.all([
      ownerDb.pool.query<{
        customer_code: string;
        display_name: string;
        status: string;
      }>(
        "SELECT customer_code,display_name,status FROM owner.customers WHERE id=$1",
        [ownerCustomerId],
      ),
      ownerDb.pool.query<{
        customer_id: string;
        installation_id: string;
        status: string;
        source: string;
      }>(
        "SELECT customer_id,installation_id,status,source FROM owner.installation_identities WHERE id=$1",
        [installationIdentityId],
      ),
      ownerDb.pool.query<{
        id: string;
        organization_limit: number;
        user_limit: number;
        allowed_modules: string[];
        status: string;
      }>(
        "SELECT id,organization_limit,user_limit,allowed_modules,status FROM owner.customer_limit_profiles WHERE customer_id=$1",
        [ownerCustomerId],
      ),
      ownerDb.pool.query<{ id: string; status: string }>(
        "SELECT id,status FROM owner.signing_keys WHERE id=$1",
        [signingKeyId],
      ),
      ownerDb.pool.query<{
        status: string;
        signing_key_id: string;
        request_payload_sha256: string;
        request_binding_sha256: string;
        limit_profile_id: string;
        operation_id: string;
        license_id: string;
        organization_limit: number;
        user_limit: number;
        module_entitlements: string[];
      }>(
        "SELECT status,signing_key_id,request_payload_sha256,request_binding_sha256,limit_profile_id,operation_id,license_id,organization_limit,user_limit,module_entitlements FROM owner.license_issuances WHERE id=$1",
        [baseIssuanceId],
      ),
    ]);
    expect(persistedOwner[0].rows[0]).toMatchObject({
      customer_code: customerCode,
      status: "ACTIVE",
    });
    expect(persistedOwner[1].rows[0]).toMatchObject({
      customer_id: ownerCustomerId,
      installation_id: installationId,
      status: "ACTIVE",
      source: "CUSTOMER_VARDENA_SCREEN",
    });
    const ownerProfileId = persistedOwner[2].rows[0]!.id;
    expect(persistedOwner[2].rows[0]).toMatchObject({
      organization_limit: 3,
      user_limit: 2,
      allowed_modules: ["organization", "users"],
      status: "ACTIVE",
    });
    expect(persistedOwner[3].rows[0]).toEqual({
      id: signingKeyId,
      status: "ACTIVE",
    });
    expect(persistedOwner[4].rows[0]).toMatchObject({
      status: "REQUEST_PREPARED",
      signing_key_id: signingKeyId,
      limit_profile_id: ownerProfileId,
      operation_id: baseOperationId,
      license_id: baseLicenseId,
      organization_limit: 3,
      user_limit: 2,
      module_entitlements: ["organization", "users"],
    });
    expect(persistedOwner[4].rows[0]!.request_payload_sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(persistedOwner[4].rows[0]!.request_binding_sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    const preparedRequest = await ownerGet(
      `/license-issuances/${baseIssuanceId}/request`,
    );
    expect(preparedRequest.status).toBe(200);
    const decodedRequest = decodeLicenseRequest(
      preparedRequest.body.fileContent,
    );
    const projectedPayload = projectLicensePayload(decodedRequest.request);
    expect(decodedRequest.request.operationId).toBe(baseOperationId);
    expect(decodedRequest.request.licenseId).toBe(baseLicenseId);
    expect(decodedRequest.request.customerId).toBe(customerId);
    expect(decodedRequest.request.customerCode).toBe(customerCode);
    expect(decodedRequest.request.installationId).toBe(installationId);
    if (decodedRequest.request.validUntil === null) {
      throw new Error("Owner acceptance issuance unexpectedly has no expiry.");
    }
    expect(decodedRequest.request.validUntil.toISOString()).toBe(
      new Date(base.validUntil).toISOString(),
    );

    const beforeOwnerReject = await countOwner(
      "SELECT count(*)::text AS count FROM owner.license_artifacts WHERE issuance_id=$1",
      [baseIssuanceId],
    );
    const { signed } = await ownerSign(baseIssuanceId);
    const tamperedObject = JSON.parse(signed.envelope) as {
      document: string;
      keyId: string;
    };
    const [prefix, bodyPart, signaturePart] =
      tamperedObject.document.split(".");
    expect(signaturePart).toBeTruthy();
    const firstSignatureCharacter = signaturePart![0] === "A" ? "B" : "A";
    tamperedObject.document = `${prefix}.${bodyPart}.${firstSignatureCharacter}${signaturePart!.slice(1)}`;
    const tampered = JSON.stringify(tamperedObject);
    const tamperReject = await ownerRecord(baseIssuanceId, tampered);
    expect(tamperReject.status).toBe(409);
    expect(ownerErrorCode(tamperReject)).toBe("ArtifactRejected:signature");
    expect(
      await countOwner(
        "SELECT count(*)::text AS count FROM owner.license_artifacts WHERE issuance_id=$1",
        [baseIssuanceId],
      ),
    ).toBe(beforeOwnerReject);
    const ownerAfterTamper = await ownerDb.pool.query<{ status: string }>(
      "SELECT status FROM owner.license_issuances WHERE id=$1",
      [baseIssuanceId],
    );
    expect(ownerAfterTamper.rows[0]!.status).toBe("REQUEST_PREPARED");

    // A correctly signed but request-mismatched installation is rejected by
    // Owner's persisted binding, with no archive; the private key is never
    // supplied to the Owner process.
    const wrongBindingPayload = { ...projectedPayload, installationId: ulid() };
    const wrongBindingEnvelope = await signer.signPayload(wrongBindingPayload);
    const wrongBinding = await ownerRecord(
      baseIssuanceId,
      wrongBindingEnvelope,
    );
    expect(wrongBinding.status).toBe(409);
    expect(ownerErrorCode(wrongBinding)).toBe("ArtifactBindingMismatch");
    expect(
      (
        await ownerDb.pool.query<{ status: string }>(
          "SELECT status FROM owner.license_issuances WHERE id=$1",
          [baseIssuanceId],
        )
      ).rows[0]!.status,
    ).toBe("REQUEST_PREPARED");

    // Different signer, falsely bearing the trusted key id: the customer
    // runtime has only the ephemeral test PUBLIC key and refuses it.
    const rogueEnvelope = await signer.signRoguePayload(projectedPayload);
    const customerBeforeRogue = await snapshotCustomerState();
    const rogueResponse = await importCustomer(Buffer.from(rogueEnvelope));
    expect(rogueResponse.status).toBe(422);
    expect(customerErrorReason(rogueResponse)).toBe("signature");
    await assertUnchanged(customerBeforeRogue);

    // Tampering the signed bytes and changing the signed installation binding
    // both fail at the real authenticated customer import endpoint.
    const customerTamper = await importCustomer(Buffer.from(tampered));
    expect(customerTamper.status).toBe(422);
    expect(customerErrorReason(customerTamper)).toBe("signature");
    await assertUnchanged(customerBeforeRogue);
    const ownerAccepted = await ownerRecord(baseIssuanceId, signed.envelope);
    expect(ownerAccepted.status, JSON.stringify(ownerAccepted.body)).toBe(200);
    expect(ownerAccepted.body.replayed).toBe(false);
    const ownerReplay = await ownerRecord(baseIssuanceId, signed.envelope);
    expect(ownerReplay.status).toBe(200);
    expect(ownerReplay.body.replayed).toBe(true);
    const ownerConflict = await ownerRecord(
      baseIssuanceId,
      wrongBindingEnvelope,
    );
    expect(ownerConflict.status).toBe(409);
    expect(ownerErrorCode(ownerConflict)).toBe("OperationConflict");
    const archived = await ownerArchivedBytes(baseIssuanceId);
    expect(archived.toString("utf8")).toBe(signed.envelope);
    const ownerArtifactRow = await ownerDb.pool.query<{
      sha256: string;
      status: string;
      byte_size: string;
    }>(
      `SELECT sha256,status,byte_size FROM owner.license_artifacts WHERE issuance_id=$1`,
      [baseIssuanceId],
    );
    expect(ownerArtifactRow.rows).toHaveLength(1);
    expect(ownerArtifactRow.rows[0]!.status).toBe("DURABLE");
    expect(ownerArtifactRow.rows[0]!.byte_size).toBe(
      String(archived.byteLength),
    );
    expect(ownerArtifactRow.rows[0]!.sha256).toBe(sha256Bytes(archived));

    // Owner has durably archived the bytes, but only its API import occurred.
    const stillUnlicensed = await customerCurrent();
    expect(stillUnlicensed).toMatchObject({
      licensed: false,
      accessMode: "BLOCKED",
    });
    expect((await snapshotCustomerState()).counts?.versions).toBe(0n);

    const activated = await importCustomer(archived);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body).toMatchObject({
      licensed: true,
      active: true,
      accessMode: "ACTIVE",
      customerId,
      customerCode,
      installationId,
      licenseId: baseLicenseId,
      organizationLimit: 3,
      userLimit: 2,
      outcome: "APPLIED",
    });
    expect(activated.body.entitlements).toEqual([
      { kind: "MODULE", code: "organization" },
      { kind: "MODULE", code: "users" },
    ]);
    baseValidUntil = new Date(activated.body.validUntil);
    const currentAfter = await customerCurrent();
    expect(currentAfter).toMatchObject({
      licensed: true,
      status: "ACTIVE",
      active: true,
      accessMode: "ACTIVE",
      customerId,
      customerCode,
      installationId,
      licenseId: baseLicenseId,
      organizationLimit: 3,
      userLimit: 2,
    });
    expect(new Date(currentAfter.validUntil).toISOString()).toBe(
      baseValidUntil.toISOString(),
    );

    const persistedAfterBase = await snapshotCustomerState();
    expect(persistedAfterBase.counts).toMatchObject({
      customers: 1n,
      licenses: 1n,
      versions: 1n,
      entitlements: 2n,
      revocations: 0n,
      organizations: 0n,
    });
    expect(persistedAfterBase.installationBinding).toEqual([
      expect.objectContaining({
        installation_id: installationId,
        customer_id: customerId,
        customer_code: customerCode,
      }),
    ]);
    expect(
      persistedAfterBase.entitlements.map(({ kind, code }) => ({ kind, code })),
    ).toEqual([
      { kind: "MODULE", code: "organization" },
      { kind: "MODULE", code: "users" },
    ]);
    expect(persistedAfterBase.versions[0]).toMatchObject({
      license_id: baseLicenseId,
      operation_id: baseOperationId,
      status: "ACTIVE",
      document_version: 2,
      key_id: signingKeyId,
      organization_limit: 3,
      user_limit: 2,
      device_limit: null,
      device_limit_specified: false,
      supersedes_version_id: null,
    });
    expect(persistedAfterBase.versions[0]!.document_hash).toBe(
      sha256Bytes(archived),
    );
    const beforeBindingNegatives = await snapshotCustomerState();
    const wrongCustomerPayload = {
      ...projectedPayload,
      customerId: ulid(),
      customerCode: `C-${ulid()}`,
    };
    const wrongCustomerArtifact =
      await signer.signPayload(wrongCustomerPayload);
    const wrongCustomer = await importCustomer(
      Buffer.from(wrongCustomerArtifact),
    );
    expect(wrongCustomer.status).toBe(409);
    expect(customerErrorReason(wrongCustomer)).toBe(
      "installation-customer-mismatch",
    );
    await assertUnchanged(beforeBindingNegatives);
    const wrongInstallationPayload = {
      ...projectedPayload,
      operationId: ulid(),
      licenseId: ulid(),
      installationId: ulid(),
    };
    const wrongInstallationArtifact = await signer.signPayload(
      wrongInstallationPayload,
    );
    const wrongInstallation = await importCustomer(
      Buffer.from(wrongInstallationArtifact),
    );
    expect(wrongInstallation.status).toBe(422);
    expect(customerErrorReason(wrongInstallation)).toBe(
      "installation-mismatch",
    );
    await assertUnchanged(beforeBindingNegatives);
    expect(persistedAfterBase.counts?.audits).toBeGreaterThanOrEqual(4n);
    const appliedAudits = await customerQuery<Array<{ count: bigint }>>(
      `
      SELECT count(*) AS count FROM licensing.license_audit_events
       WHERE event_type='license.import.applied' AND operation_id=$1
    `,
      baseOperationId,
    );
    expect(appliedAudits[0]!.count).toBe(1n);
    const ownerAudits = await countOwner(
      "SELECT count(*)::text AS count FROM owner.audit_events WHERE target_id=$1 AND event_type='LICENSE_ARTIFACT_IMPORTED'",
      [baseIssuanceId],
    );
    expect(ownerAudits).toBe(1);
    await createTestEntitlementUse();

    const beforeDuplicate = await snapshotCustomerState();
    const duplicate = await importCustomer(archived);
    expect(duplicate.status).toBe(409);
    expect(customerErrorReason(duplicate)).toBe("duplicate-operation");
    await assertUnchanged(beforeDuplicate);

    // Fixed-clock lifecycle: expiry starts Grace for exactly 14x24 hours.
    // Grace keeps permitted mutations; signed organization capacity still
    // applies. Read-only keeps status and view routes but denies writes.
    const atGrace = new Date(baseValidUntil.getTime() + 1);
    vi.setSystemTime(atGrace);
    await refreshCustomerSession();
    const grace = await customerCurrent();
    expect(grace.accessMode).toBe("GRACE");
    expect(grace.active).toBe(false);
    expect(grace.graceEndsAt).toBe(
      new Date(baseValidUntil.getTime() + 14 * 86_400_000).toISOString(),
    );
    expect((await customerGet("/api/v1/organizations")).status).toBe(200);
    const graceAllowedWrite = await customerPost("/api/v1/organizations").send({
      code: "acceptance_three",
      name: "Grace preserves entitled writes",
      timeZone: "Asia/Tehran",
    });
    expect(
      graceAllowedWrite.status,
      JSON.stringify(graceAllowedWrite.body),
    ).toBe(201);
    const graceOverLimit = await customerPost("/api/v1/organizations").send({
      code: "acceptance_four",
      name: "Grace still enforces the signed limit",
      timeZone: "Asia/Tehran",
    });
    expect(graceOverLimit.status).toBe(422);
    expect(graceOverLimit.body.message).toBe(
      "The installation license organization limit has been reached.",
    );
    expect((await customerGet("/api/v1/organizations")).body.total).toBe(3);

    vi.setSystemTime(new Date(baseValidUntil.getTime() + 14 * 86_400_000));
    await refreshCustomerSession();
    const readOnly = await customerCurrent();
    expect(readOnly.accessMode).toBe("READ_ONLY");
    expect((await customerGet("/api/v1/license/current")).status).toBe(200);
    expect((await customerGet("/api/v1/organizations")).status).toBe(200);
    const beforeReadOnlyWrite = await snapshotCustomerState();
    const readOnlyWrite = await customerPost("/api/v1/organizations").send({
      code: "readonly_write_refused",
      name: "Read-only write must fail",
      timeZone: "Asia/Tehran",
    });
    expect(readOnlyWrite.status).toBe(403);
    expect(readOnlyWrite.body.details?.reason).toBe("license_read_only");
    await assertUnchanged(beforeReadOnlyWrite);

    // Rewind the injected acceptance clock to the signing day for an independent
    // early-renewal proof. This is a deterministic fixture timeline, not a
    // production clock change; the Owner request is still the source of terms.
    vi.setSystemTime(FIXED_NOW);
    const renewal = await issue({
      validUntil: new Date(
        FIXED_NOW.getTime() + 120 * 86_400_000,
      ).toISOString(),
      organizationLimit: 3,
      renewsOperationId: baseOperationId,
    });
    const renewalSigned = await ownerSign(renewal.id as string);
    const renewalRecorded = await ownerRecord(
      renewal.id as string,
      renewalSigned.signed.envelope,
    );
    expect(renewalRecorded.status).toBe(200);
    const renewalBytes = await ownerArchivedBytes(renewal.id as string);
    const beforeRenewal = await customerCurrent();
    const renewalApplied = await importCustomer(renewalBytes);
    expect(renewalApplied.status, JSON.stringify(renewalApplied.body)).toBe(
      200,
    );
    expect(renewalApplied.body).toMatchObject({
      licenseId: baseLicenseId,
      validUntil: baseValidUntil.toISOString(),
      accessMode: "ACTIVE",
      coverageEnd: new Date(renewal.validUntil).toISOString(),
    });
    expect(renewalApplied.body.scheduledVersion).toMatchObject({
      operationId: renewal.operationId,
      effective: false,
      effectiveFrom: baseValidUntil.toISOString(),
    });
    expect(beforeRenewal.licenseId).toBe(baseLicenseId);
    expect((await customerCurrent()).licenseId).toBe(baseLicenseId);
    const renewalRow = (
      await customerQuery<Array<Record<string, unknown>>>(
        `
      SELECT id,operation_id,license_id,valid_from,valid_until,governs_from,supersedes_version_id
        FROM licensing.license_versions WHERE operation_id=$1
    `,
        renewal.operationId,
      )
    )[0]!;
    const baseVersion = persistedAfterBase.versions[0]!;
    expect(renewalRow.supersedes_version_id).toBe(baseVersion.version_id);
    expect(new Date(renewalRow.governs_from as Date).toISOString()).toBe(
      baseValidUntil.toISOString(),
    );
    expect(new Date(renewalRow.valid_from as Date).toISOString()).toBe(
      new Date(renewal.validFrom).toISOString(),
    );
    const renewalAudit = (
      await customerQuery<Array<Record<string, unknown>>>(
        `
      SELECT event_type, renewed_version_id, renewed_from, renewed_until
        FROM licensing.license_audit_events
       WHERE event_type='license.import.renewed' AND operation_id=$1
    `,
        renewal.operationId,
      )
    )[0]!;
    expect(renewalAudit).toMatchObject({
      event_type: "license.import.renewed",
      renewed_version_id: baseVersion.version_id,
    });
    expect(new Date(renewalAudit.renewed_from as Date).toISOString()).toBe(
      baseValidUntil.toISOString(),
    );
    expect(new Date(renewalAudit.renewed_until as Date).toISOString()).toBe(
      new Date(renewal.validUntil).toISOString(),
    );

    // At the exact hand-over, the customer API selects the scheduled renewal.
    vi.setSystemTime(new Date(baseValidUntil.getTime() + 1));
    await refreshCustomerSession();
    await refreshOwnerSession();
    const effectiveRenewal = await customerCurrent();
    const renewalLicenseId = renewal.licenseId as string;
    expect(effectiveRenewal).toMatchObject({
      licenseId: renewalLicenseId,
      active: true,
      accessMode: "ACTIVE",
      validUntil: new Date(renewal.validUntil).toISOString(),
    });

    // Owner revocation is only archival; the customer changes state only after
    // its authenticated API imports those exact archived bytes.
    const revokePrepared = await ownerWrite(
      `/license-issuances/${renewal.id}/revocations`,
    ).send({
      reason: "NON_PAYMENT",
      signingKeyId,
    });
    expect(revokePrepared.status, JSON.stringify(revokePrepared.body)).toBe(
      201,
    );
    const revocationId = revokePrepared.body.revocation.revocationId as string;
    const revokeRequest = await ownerGet(
      `/license-revocations/${revocationId}/request`,
    );
    expect(revokeRequest.status).toBe(200);
    const signedRevocation = await signer.signRevocation(
      revokeRequest.body.fileContent as string,
      revokeRequest.body.requestPayloadSha256 as string,
    );
    const revokeRecorded = await ownerWrite(
      `/license-revocations/${revocationId}/import`,
    ).send({
      fileContent: signedRevocation.envelope,
    });
    expect(revokeRecorded.status).toBe(200);
    expect(revokeRecorded.body.replayed).toBe(false);
    const revokeReplay = await ownerWrite(
      `/license-revocations/${revocationId}/import`,
    ).send({
      fileContent: signedRevocation.envelope,
    });
    expect(revokeReplay.status).toBe(200);
    expect(revokeReplay.body.replayed).toBe(true);
    const archivedRevocation = await request(ownerApp)
      .get(`/api/v1/license-revocations/${revocationId}/artifact`)
      .set("Cookie", ownerCookie)
      .buffer(true)
      .parse((incoming, resolve) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        incoming.on("end", () => resolve(null, Buffer.concat(chunks)));
      });
    expect(archivedRevocation.status).toBe(200);
    const revocationBytes = Buffer.from(archivedRevocation.body as Buffer);
    expect(revocationBytes.toString("utf8")).toBe(signedRevocation.envelope);
    const ownerRevocationRow = await ownerDb.pool.query<{
      status: string;
      artifact_sha256: string;
    }>(
      "SELECT status,artifact_sha256 FROM owner.license_revocations WHERE id=$1",
      [revocationId],
    );
    expect(ownerRevocationRow.rows[0]).toMatchObject({
      status: "SIGNED_RECORDED",
      artifact_sha256: sha256Bytes(revocationBytes),
    });
    expect(
      await countOwner(
        "SELECT count(*)::text AS count FROM owner.audit_events WHERE target_id=$1 AND event_type='LICENSE_REVOCATION_ARTIFACT_IMPORTED'",
        [revocationId],
      ),
    ).toBe(1);
    const beforeCustomerRevocation = await snapshotCustomerState();
    expect((await customerCurrent()).revokedAt).toBeNull();
    const appliedRevocation = await customerPost(
      "/api/v1/license/revocations/import",
    ).send({
      document: revocationBytes.toString("utf8"),
    });
    expect(
      appliedRevocation.status,
      JSON.stringify(appliedRevocation.body),
    ).toBe(200);
    expect(appliedRevocation.body).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      alreadyApplied: false,
    });
    const revoked = await customerCurrent();
    expect(revoked).toMatchObject({
      licensed: true,
      active: false,
      accessMode: "BLOCKED",
      licenseId: renewalLicenseId,
    });
    expect(revoked.revokedAt).toBeTruthy();
    const revokedState = await snapshotCustomerState();
    expect(revokedState.counts?.versions).toBe(
      beforeCustomerRevocation.counts?.versions,
    );
    expect(revokedState.counts?.revocations).toBe(1n);
    expect(revokedState.revocations[0]).toMatchObject({
      license_id: renewalLicenseId,
      target_operation_id: renewal.operationId,
      issuer_key_id: signingKeyId,
    });
    const revocationAudit = await customerQuery<Array<Record<string, unknown>>>(
      `
      SELECT event_type, outcome, revocation_id, license_id, operation_id, document_hash
        FROM licensing.license_audit_events
       WHERE event_type='license.revocation.imported' AND revocation_id=$1
    `,
      revokePrepared.body.revocation.revocationId as string,
    );
    expect(revocationAudit).toHaveLength(1);
    expect(revocationAudit[0]).toMatchObject({
      event_type: "license.revocation.imported",
      outcome: "APPLIED",
      revocation_id: revokePrepared.body.revocation.revocationId,
      license_id: renewalLicenseId,
      operation_id: renewal.operationId,
      document_hash: sha256Bytes(revocationBytes),
    });
    const revocationReplay = await customerPost(
      "/api/v1/license/revocations/import",
    ).send({
      document: revocationBytes.toString("utf8"),
    });
    expect(revocationReplay.status).toBe(200);
    expect(revocationReplay.body).toMatchObject({
      changed: false,
      outcome: "UNCHANGED",
      alreadyApplied: true,
    });
    expect(await snapshotCustomerState()).toEqual(revokedState);

    const oldRenewalReplay = await importCustomer(renewalBytes);
    expect(oldRenewalReplay.status).toBe(409);
    expect(customerErrorReason(oldRenewalReplay)).toBe("license-revoked");
    await assertUnchanged(revokedState);
  }, 60_000);
});
