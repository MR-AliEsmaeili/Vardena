// CI-only. Requires an explicit disposable Owner PostgreSQL database; never skips.
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import type { Express } from "express";
import type { PoolClient } from "pg";
import { Database } from "../src/db.js";
import {
  FilesystemAuditArchiveStore,
  createAuditArchiveBatch,
  verifyExportedArchiveBundle,
} from "../src/archive.js";
import { digest, token } from "../src/domain.js";
import {
  RoleUpgradeError,
  migrate,
  preflightRoleUpgrade,
  remediateLegacyRolesAndMigrate,
  runMigrateCli,
} from "../src/migrate.js";
import { bootstrap } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";

const url = process.env.OWNER_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "OWNER_TEST_DATABASE_URL is required; run this suite only in CI.",
  );
const db = new Database(url);
let app: Express, adminCookie: string, adminId: string, testArchiveDir: string;
const initial = "Disposable_initial_42";
const changed = "Disposable_changed_43";
const origin = "https://owner.test";
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
/**
 * OD-LIC-12 (R-1): a newly created LICENSE_OPERATOR has no effective
 * permission until an Owner Admin grants it. Tests that exercise an
 * operator-eligible capability must grant it explicitly; tests that expect
 * default-deny grant nothing.
 */
const operatorGrants = [
  "customers.view",
  "audit.view",
  "operations.view",
  "operations.record",
] as const;
async function grant(userId: string, permissions: readonly string[]) {
  for (const permission of permissions)
    await db.pool.query(
      `INSERT INTO owner.user_permission_grants(user_id, permission, granted_by)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, permission, adminId],
    );
}
/** A unique, installation-reference-safe token for one test. */
const uniq = (prefix: string) => `${prefix}-${ulid()}`;
async function customer(cookie = adminCookie, code = `C-${ulid()}`) {
  return write("post", "/customers", cookie).send({
    customerCode: code,
    displayName: "مشتری آزمایشی",
  });
}

async function transitionChain(recordId: string) {
  const found = await db.pool.query<{
    prior_status: string;
    new_status: string;
  }>(
    `SELECT prior_status, new_status
     FROM owner.operational_transitions
     WHERE record_id = $1
     ORDER BY occurred_at, id`,
    [recordId],
  );
  return found.rows.map((row) => `${row.prior_status}->${row.new_status}`);
}
async function observedStatus(recordId: string) {
  const found = await db.pool.query<{ observed_status: string }>(
    "SELECT observed_status FROM owner.operational_records WHERE id = $1",
    [recordId],
  );
  return found.rows[0]?.observed_status ?? null;
}
async function insertTransition(
  tx: PoolClient,
  recordId: string,
  actorId: string,
  prior: string,
  next: string,
  reason: string,
  occurredAt?: string,
) {
  await tx.query(
    `INSERT INTO owner.operational_transitions(
      id, record_id, actor_id, occurred_at, prior_status, new_status, reason,
      confirmation_kind)
    VALUES ($1,$2,$3,COALESCE($4::timestamptz, clock_timestamp()),$5,$6,$7,'OPERATOR_OBSERVED')`,
    [ulid(), recordId, actorId, occurredAt ?? null, prior, next, reason],
  );
}

/** Direct audit-row insert for explorer fixtures (the append-only trigger rejects only UPDATE/DELETE). */
async function insertAudit(row: {
  actor: string | null;
  type: string;
  targetType: string;
  targetId: string | null;
  occurredAt: string;
  outcome?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<string> {
  const id = ulid();
  await db.pool.query(
    `INSERT INTO owner.audit_events(id,actor_id,event_type,target_type,target_id,occurred_at,outcome,reason,before_state,after_state)
     VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7,NULL,$8,$9)`,
    [
      id,
      row.actor,
      row.type,
      row.targetType,
      row.targetId,
      row.occurredAt,
      row.outcome ?? "SUCCESS",
      row.before ?? null,
      row.after ?? null,
    ],
  );
  return id;
}
const explorer = (cookie: string, query: Record<string, string>) =>
  request(app).get("/api/v1/audit-events").query(query).set("Cookie", cookie);

async function expectUnavailableOperations(cookie: string) {
  // No audit mutation or fabricated lifecycle endpoint is available to ANY role.
  for (const method of ["post", "patch", "delete"] as const)
    expect((await write(method, "/audit-events", cookie).send({})).status).toBe(
      404,
    );
  for (const path of [
    "/licenses/issue",
    "/licenses/activate",
    "/licenses/deactivate",
    "/server-replacement",
    "/device-replacement",
    "/licenses/revoke",
    "/licenses/recover",
  ])
    expect((await write("post", path, cookie).send({})).status).toBe(404);
}

afterAll(async () => {
  if (testArchiveDir) {
    await rm(testArchiveDir, { recursive: true, force: true }).catch(() => {});
  }
  await db.close();
});

const migrationsFolder = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
async function resetToMigration002() {
  await db.pool.query(
    "DROP SCHEMA IF EXISTS owner_audit_archive CASCADE; DROP SCHEMA IF EXISTS owner CASCADE; DROP TABLE IF EXISTS public.owner_migrations",
  );
  await db.transaction(async (tx) => {
    await tx.query(
      "CREATE TABLE public.owner_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    for (const name of ["001-foundation.sql", "002-manual-operations.sql"]) {
      const sql = await readFile(`${migrationsFolder}/${name}`, "utf8");
      await tx.query(sql);
      await tx.query(
        "INSERT INTO public.owner_migrations(name,checksum) VALUES($1,$2)",
        [name, digest(sql)],
      );
    }
  });
  app = await createApp(db, {
    databaseUrl: url!,
    origin,
    production: false,
    port: 3001,
  });
}

describe("Owner migration 003 existing-database compatibility, rollback, and retry", () => {
  it("fails closed and rolls back cleanly for each populated legacy role while denying runtime login/session access", async () => {
    const pw = "Disposable_legacy_45";
    const hash = await hashPassword(pw);
    for (const legacyRole of [
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ] as const) {
      await resetToMigration002();
      const uid = ulid();
      const cid = ulid();
      const rawSession = token();
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,is_active,must_change_password) VALUES($1,$2,$3,$4,true,false)",
        [uid, `legacy_${legacyRole.toLowerCase()}`, hash, legacyRole],
      );
      await db.pool.query(
        "INSERT INTO owner.sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
        [ulid(), uid, digest(rawSession)],
      );
      await db.pool.query(
        "INSERT INTO owner.customers(id,customer_code,display_name,status,contract_reference,created_by,updated_by) VALUES($1,$2,'مشتری میراث','ACTIVE','REF-1',$3,$3)",
        [cid, `L-${ulid()}`, uid],
      );
      await insertAudit({
        actor: uid,
        type: "USER_BOOTSTRAPPED",
        targetType: "User",
        targetId: uid,
        occurredAt: "2026-10-15T00:00:00.000Z",
      });

      await expect(migrate(db)).rejects.toThrow(
        new RegExp(
          `Refusing to apply two-role constraint while superseded four-role user rows exist \\(${legacyRole}\\)`,
        ),
      );

      // Verify clean rollback of migration ledger, schema constraint, and existing rows.
      const ledger = await db.pool.query<{ name: string }>(
        "SELECT name FROM public.owner_migrations ORDER BY name",
      );
      expect(ledger.rows.map((r) => r.name)).toEqual([
        "001-foundation.sql",
        "002-manual-operations.sql",
      ]);
      const checkDef = await db.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'owner' AND t.relname = 'users' AND c.conname = 'users_role_check'`,
      );
      expect(checkDef.rows[0]?.def).toContain("SYSTEM_ADMIN");
      expect(checkDef.rows[0]?.def).not.toContain("OWNER_ADMIN");
      expect(
        (
          await db.pool.query<{ role: string }>(
            "SELECT role FROM owner.users WHERE id=$1",
            [uid],
          )
        ).rows[0]?.role,
      ).toBe(legacyRole);
      expect(
        (
          await db.pool.query("SELECT id FROM owner.customers WHERE id=$1", [
            cid,
          ])
        ).rowCount,
      ).toBe(1);

      // Runtime defense-in-depth: even against an unmigrated 002 database,
      // superseded role rows cannot log in or use an existing session.
      const loginAttempt = await login(
        `legacy_${legacyRole.toLowerCase()}`,
        pw,
      );
      expect(loginAttempt.r.status).toBe(401);
      const legacyCookie = `owner_session=${rawSession}`;
      expect(
        (await request(app).get("/api/v1/auth/me").set("Cookie", legacyCookie))
          .status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/v1/permissions/effective")
            .set("Cookie", legacyCookie)
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/v1/customers")
            .set("Cookie", legacyCookie)
        ).status,
      ).toBe(401);
      expect(
        (
          await write("post", "/auth/change-password", legacyCookie).send({
            currentPassword: pw,
            newPassword: "Disposable_new_46",
          })
        ).status,
      ).toBe(401);
    }
  });

  it("verifies preflight, missing/invalid/elevation rejections, mid-operation rollback, transactional remediation, and safe idempotent re-run on mixed legacy and current-role data", async () => {
    await resetToMigration002();
    const pw = "Disposable_mixed_45";
    const hash = await hashPassword(pw);
    const sysAdminId = ulid();
    const issuanceId = ulid();
    const observerId = ulid();
    const supportId = ulid();
    const existingOperatorId = ulid();
    const preUpgradeSession = token();
    for (const [uid, username, legacyRole] of [
      [sysAdminId, "mix_admin", "SYSTEM_ADMIN"],
      [issuanceId, "mix_issuance", "LICENSE_ISSUANCE"],
      [observerId, "mix_observer", "READ_ONLY_OBSERVER"],
      [supportId, "mix_support", "SUPPORT_SPECIALIST"],
    ] as const) {
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,is_active,must_change_password) VALUES($1,$2,$3,$4,true,false)",
        [uid, username, hash, legacyRole],
      );
    }
    await db.pool.query(
      "INSERT INTO owner.sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
      [ulid(), issuanceId, digest(preUpgradeSession)],
    );
    // Widen constraint temporarily to seed a mixed database with both legacy and current-role rows, then restore 001's check on legacy rows.
    await db.pool.query(
      `ALTER TABLE owner.users DROP CONSTRAINT users_role_check,
       ADD CONSTRAINT users_role_check CHECK (role IN ('SYSTEM_ADMIN','LICENSE_ISSUANCE','READ_ONLY_OBSERVER','SUPPORT_SPECIALIST','OWNER_ADMIN','LICENSE_OPERATOR'))`,
    );
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,is_active,must_change_password) VALUES($1,'mix_current_op',$2,'LICENSE_OPERATOR',true,false)",
      [existingOperatorId, hash],
    );
    const custId = ulid();
    const opId = ulid();
    await db.pool.query(
      "INSERT INTO owner.customers(id,customer_code,display_name,status,contract_reference,created_by,updated_by) VALUES($1,'MIX-01','مشتری ترکیبی','ACTIVE','CONTRACT-MIX',$2,$2)",
      [custId, sysAdminId],
    );
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          installation_reference, created_by, updated_by)
        VALUES ($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED','INST-MIX-1',$3,$3)`,
        [opId, custId, issuanceId],
      );
      await insertTransition(
        tx,
        opId,
        issuanceId,
        "UNRECORDED",
        "ISSUED",
        "pre-003 issuance observation",
      );
    });

    // Automatic migrate fails closed without modifying the ledger or existing rows.
    await expect(migrate(db)).rejects.toThrow(
      "Refusing to apply two-role constraint while superseded four-role user rows exist (LICENSE_ISSUANCE, READ_ONLY_OBSERVER, SUPPORT_SPECIALIST, SYSTEM_ADMIN)",
    );
    expect(
      (
        await db.pool.query<{ name: string }>(
          "SELECT name FROM public.owner_migrations ORDER BY name",
        )
      ).rows.map((r) => r.name),
    ).toEqual(["001-foundation.sql", "002-manual-operations.sql"]);

    // Preflight report identifies affected legacy accounts and existing current-role accounts without leaking secrets.
    const preflight = await preflightRoleUpgrade(db);
    const cliPreflightJson = await runMigrateCli(db, ["--preflight"]);
    expect(cliPreflightJson).not.toContain(hash);
    expect(cliPreflightJson).not.toContain(preUpgradeSession);
    expect(cliPreflightJson).not.toContain(digest(preUpgradeSession));
    expect(preflight.migration003Applied).toBe(false);
    expect(preflight.requiresRemediation).toBe(true);
    expect(preflight.canRunAutomaticMigrate).toBe(false);
    expect(preflight.currentRoleAccounts.map((u) => u.username)).toEqual([
      "mix_current_op",
    ]);
    expect(
      preflight.legacyAccounts
        .map((u) => `${u.username}:${u.legacyRole}`)
        .sort(),
    ).toEqual([
      "mix_admin:SYSTEM_ADMIN",
      "mix_issuance:LICENSE_ISSUANCE",
      "mix_observer:READ_ONLY_OBSERVER",
      "mix_support:SUPPORT_SPECIALIST",
    ]);

    // Missing disposition, targeting current-role user, or unauthorized privilege elevation fails closed.
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        authorizedByUserId: sysAdminId,
        reason: "Incomplete and unapproved elevation attempt",
        dispositions: [
          {
            userId: sysAdminId,
            username: "mix_admin",
            fromRole: "SYSTEM_ADMIN",
            disposition: "MAP_EQUIVALENT",
            targetRole: "OWNER_ADMIN",
            isActive: true,
            reason: "ok",
          },
          {
            userId: observerId,
            username: "mix_observer",
            fromRole: "READ_ONLY_OBSERVER",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason: "unauthorized write elevation",
          },
          {
            userId: existingOperatorId,
            username: "mix_current_op",
            fromRole: "LICENSE_ISSUANCE",
            disposition: "RETAIN_REDUCED",
            targetRole: "LICENSE_OPERATOR",
            isActive: true,
            reason: "already current role",
          },
        ],
      }),
    ).rejects.toThrow(RoleUpgradeError);

    const approvedPlan = {
      authorizedByUserId: sysAdminId,
      reason: "Deployment-owner approved Phase 1.3 legacy role dispositions",
      dispositions: [
        {
          userId: sysAdminId,
          username: "mix_admin",
          fromRole: "SYSTEM_ADMIN" as const,
          disposition: "MAP_EQUIVALENT" as const,
          targetRole: "OWNER_ADMIN" as const,
          isActive: true,
          reason: "Preserve SYSTEM_ADMIN as active OWNER_ADMIN",
        },
        {
          userId: issuanceId,
          username: "mix_issuance",
          fromRole: "LICENSE_ISSUANCE" as const,
          disposition: "RETAIN_REDUCED" as const,
          targetRole: "LICENSE_OPERATOR" as const,
          isActive: true,
          reason:
            "Retain issuance specialist as LICENSE_OPERATOR without replacement authority",
        },
        {
          userId: observerId,
          username: "mix_observer",
          fromRole: "READ_ONLY_OBSERVER" as const,
          disposition: "DEACTIVATE" as const,
          targetRole: "LICENSE_OPERATOR" as const,
          isActive: false,
          reason: "Deactivate read-only observer to preserve least privilege",
        },
        {
          userId: supportId,
          username: "mix_support",
          fromRole: "SUPPORT_SPECIALIST" as const,
          disposition: "ELEVATE_PRIVILEGE" as const,
          targetRole: "LICENSE_OPERATOR" as const,
          isActive: true,
          allowPrivilegeElevation: true,
          reason:
            "Explicitly approved transition of support specialist to active LICENSE_OPERATOR",
        },
      ],
    };

    // Failure halfway through the operation (after user updates and audit writes, before migration 003 commits)
    // rolls back the entire transaction cleanly.
    await expect(
      remediateLegacyRolesAndMigrate(db, approvedPlan, {
        beforeMigration003Hook: () => {
          throw new Error("Injected failure halfway through remediation");
        },
      }),
    ).rejects.toThrow("Injected failure halfway through remediation");

    expect(
      (
        await db.pool.query<{ name: string }>(
          "SELECT name FROM public.owner_migrations ORDER BY name",
        )
      ).rows.map((r) => r.name),
    ).toEqual(["001-foundation.sql", "002-manual-operations.sql"]);
    expect(
      (
        await db.pool.query<{ role: string }>(
          "SELECT role FROM owner.users WHERE id=$1",
          [sysAdminId],
        )
      ).rows[0]?.role,
    ).toBe("SYSTEM_ADMIN");
    expect(
      (
        await db.pool.query(
          "SELECT 1 FROM owner.audit_events WHERE event_type='USER_LEGACY_ROLE_REMEDIATED'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query<{ revoked_at: Date | null }>(
          "SELECT revoked_at FROM owner.sessions WHERE token_hash=$1",
          [digest(preUpgradeSession)],
        )
      ).rows[0]?.revoked_at,
    ).toBeNull();

    // Retry with the approved disposition plan succeeds transactionally.
    // Missing or non-admin authorizedByUserId is rejected before any changes apply.
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        reason: approvedPlan.reason,
        dispositions: approvedPlan.dispositions,
      }),
    ).rejects.toThrow(/authorizedByUserId is required/);
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        ...approvedPlan,
        authorizedByUserId: issuanceId,
      }),
    ).rejects.toThrow(/is not an active administrator/);

    const applied = await remediateLegacyRolesAndMigrate(db, approvedPlan);
    expect(applied).toEqual({
      status: "APPLIED",
      remediatedCount: 4,
      migrationApplied: true,
    });

    // Re-running the remediation procedure with the exact same valid plan is a safe idempotent no-op,
    // while incomplete plans, plans with unknown fields, or contradictory plans are rejected.
    const rerun = await remediateLegacyRolesAndMigrate(db, approvedPlan);
    expect(rerun).toEqual({
      status: "ALREADY_APPLIED",
      remediatedCount: 0,
      migrationApplied: false,
    });
    // Incomplete plan (missing one of the remediated accounts) is rejected on repeated run.
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        ...approvedPlan,
        dispositions: approvedPlan.dispositions.slice(0, 3),
      }),
    ).rejects.toThrow(/Missing disposition for legacy account/);
    // Unknown field is rejected on repeated run.
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        ...approvedPlan,
        extraUnknownField: true,
      }),
    ).rejects.toThrow(/Unknown top-level field/);
    // Contradictory target state or mismatched authorizedByUserId is rejected on repeated run.
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        ...approvedPlan,
        dispositions: approvedPlan.dispositions.map((d) =>
          d.userId === observerId ? { ...d, isActive: true } : d,
        ),
      }),
    ).rejects.toThrow(RoleUpgradeError);
    await expect(
      remediateLegacyRolesAndMigrate(db, {
        ...approvedPlan,
        authorizedByUserId: issuanceId,
      }),
    ).rejects.toThrow(RoleUpgradeError);
    await migrate(db);

    expect(
      (
        await db.pool.query<{ name: string }>(
          "SELECT name FROM public.owner_migrations ORDER BY name",
        )
      ).rows.map((r) => r.name),
    ).toEqual([
      "001-foundation.sql",
      "002-manual-operations.sql",
      "003-two-role-authorization.sql",
      "004-audit-retention-archive.sql",
      "005-contract-and-activation-dates.sql",
      "006-signing-key-tracking.sql",
      "007-license-lifecycle.sql",
    ]);
    await expect(
      db.pool.query("UPDATE owner.users SET role='SYSTEM_ADMIN' WHERE id=$1", [
        sysAdminId,
      ]),
    ).rejects.toThrow();

    // Pre-existing session of remediated user was revoked during remediation.
    expect(
      (
        await db.pool.query<{ revoked_at: Date | null }>(
          "SELECT revoked_at FROM owner.sessions WHERE token_hash=$1",
          [digest(preUpgradeSession)],
        )
      ).rows[0]?.revoked_at,
    ).not.toBeNull();

    // Verify remediated accounts, preserved existing current-role account, customer/operational records, and audit trail.
    const adminLogin = await login("mix_admin", pw);
    expect(adminLogin.r.status).toBe(200);
    expect(adminLogin.r.body.id).toBe(sysAdminId);
    expect(adminLogin.r.body.role).toBe("OWNER_ADMIN");
    const operatorLogin = await login("mix_issuance", pw);
    expect(operatorLogin.r.status).toBe(200);
    expect(operatorLogin.r.body.id).toBe(issuanceId);
    expect(operatorLogin.r.body.role).toBe("LICENSE_OPERATOR");
    const elevatedSupportLogin = await login("mix_support", pw);
    expect(elevatedSupportLogin.r.status).toBe(200);
    expect(elevatedSupportLogin.r.body.id).toBe(supportId);
    expect(elevatedSupportLogin.r.body.role).toBe("LICENSE_OPERATOR");
    const existingOpLogin = await login("mix_current_op", pw);
    expect(existingOpLogin.r.status).toBe(200);
    expect(existingOpLogin.r.body.id).toBe(existingOperatorId);
    expect((await login("mix_observer", pw)).r.status).toBe(401);

    await grant(issuanceId, operatorGrants);
    const preservedOp = await request(app)
      .get(`/api/v1/operational-records/${opId}`)
      .set("Cookie", operatorLogin.cookie);
    expect(preservedOp.status).toBe(200);
    expect(preservedOp.body.customerCode).toBe("MIX-01");

    const remediationAudits = await explorer(adminLogin.cookie, {
      eventType: "USER_LEGACY_ROLE_REMEDIATED",
    });
    expect(remediationAudits.status).toBe(200);
    expect(remediationAudits.body.items).toHaveLength(4);
    for (const item of remediationAudits.body.items as { actorId: string }[]) {
      expect(item.actorId).toBe(sysAdminId);
    }
    expect(
      remediationAudits.body.items
        .map(
          (item: {
            beforeState: { role: string };
            afterState: { role: string; isActive: boolean };
          }) =>
            `${item.beforeState.role}->${item.afterState.role}:${String(item.afterState.isActive)}`,
        )
        .sort(),
    ).toEqual([
      "LICENSE_ISSUANCE->LICENSE_OPERATOR:true",
      "READ_ONLY_OBSERVER->LICENSE_OPERATOR:false",
      "SUPPORT_SPECIALIST->LICENSE_OPERATOR:true",
      "SYSTEM_ADMIN->OWNER_ADMIN:true",
    ]);
  });
});

describe("OQ-74 populated migration 005 upgrade", () => {
  it("preserves existing observed facts and leaves unknown associations null; runner retries safely", async () => {
    await resetToMigration002();
    await db.transaction(async (tx) => {
      for (const name of [
        "003-two-role-authorization.sql",
        "004-audit-retention-archive.sql",
        "005-contract-and-activation-dates.sql",
      ]) {
        const sql = await readFile(`${migrationsFolder}/${name}`, "utf8");
        await tx.query(sql);
        await tx.query(
          "INSERT INTO public.owner_migrations(name,checksum) VALUES($1,$2)",
          [name, digest(sql)],
        );
      }
    });
    await bootstrap(db, "migration74", initial);
    const actor = (await db.pool.query("SELECT id FROM owner.users LIMIT 1"))
      .rows[0].id;
    const customerId = ulid(),
      recordId = ulid();
    await db.pool.query(
      "INSERT INTO owner.customers(id,customer_code,display_name,created_by,updated_by) VALUES($1,'MIG74','Historical',$2,$2)",
      [customerId, actor],
    );
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO owner.operational_records(id,customer_id,kind,observed_status,observation_category,installation_reference,observed_validity_end,created_by,updated_by)
      VALUES($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED','MIG74','2020-01-01',$3,$3)`,
        [recordId, customerId, actor],
      );
      await insertTransition(
        tx,
        recordId,
        actor,
        "UNRECORDED",
        "ISSUED",
        "Historical observation",
      );
    });
    const before = (
      await db.pool.query(
        "SELECT * FROM owner.operational_records WHERE id=$1",
        [recordId],
      )
    ).rows[0];
    const ledger = (
      await db.pool.query(
        "SELECT name,checksum FROM public.owner_migrations ORDER BY name",
      )
    ).rows;
    await migrate(db);
    await migrate(db);
    const after = (
      await db.pool.query(
        "SELECT * FROM owner.operational_records WHERE id=$1",
        [recordId],
      )
    ).rows[0];
    expect(after).toEqual({ ...before, signing_key_id: null });
    expect(
      (
        await db.pool.query(
          "SELECT name,checksum FROM public.owner_migrations ORDER BY name LIMIT 5",
        )
      ).rows,
    ).toEqual(ledger);
    expect(
      (await db.pool.query("SELECT * FROM owner.signing_keys")).rows,
    ).toEqual([]);
  });
});

describe("Owner PostgreSQL HTTP vertical slice", () => {
  beforeAll(async () => {
    await db.pool.query(
      "DROP SCHEMA IF EXISTS owner_audit_archive CASCADE; DROP SCHEMA IF EXISTS owner CASCADE; DROP TABLE IF EXISTS public.owner_migrations",
    );
    await migrate(db);
    await migrate(db); // idempotent checksummed fresh deployment
    expect(await bootstrap(db, "owner", initial)).toBe(true);
    expect(await bootstrap(db, "owner", "Another_initial_44")).toBe(false);
    testArchiveDir = await mkdtemp(
      path.join(os.tmpdir(), "vardena-owner-api-archive-"),
    );
    app = await createApp(db, {
      databaseUrl: url!,
      origin,
      production: false,
      port: 3001,
      archiveDir: testArchiveDir,
    });
  }, 30000);
  it("requires authentication, JSON, custom anti-CSRF header and same origin", async () => {
    expect((await request(app).get("/api/v1/customers")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ username: "owner", password: initial })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set("x-owner-request", "1")
          .set("Origin", "https://evil.test")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await write("post", "/auth/login").send({
          username: "owner",
          password: "wrong",
        })
      ).status,
    ).toBe(401);
    const unknown = await write("post", "/auth/login").send({
      username: "not-a-user",
      password: "wrong",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe("Invalid username or password.");
  });
  it("forces first-login change, rejects same/short passwords and revokes other initial sessions atomically", async () => {
    const first = await login("owner", initial),
      second = await login("owner", initial);
    expect(first.r.status).toBe(200);
    expect(first.r.body.mustChangePassword).toBe(true);
    adminId = first.r.body.id;
    adminCookie = first.cookie;
    expect(first.r.headers["set-cookie"]![0]).toContain("HttpOnly");
    expect(first.r.headers["set-cookie"]![0]).toContain("SameSite=Lax");
    expect((await customer(adminCookie)).status).toBe(403);
    expect(
      (
        await write(
          "post",
          "/operational-records/license-observations",
          adminCookie,
        ).send({
          customerId: ulid(),
          installationReference: "INST-1",
          reason: "must not run before password change",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/v1/audit-events")
          .set("Cookie", adminCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await write("post", "/auth/change-password", adminCookie).send({
          currentPassword: initial,
          newPassword: initial,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("post", "/auth/change-password", adminCookie).send({
          currentPassword: initial,
          newPassword: "short",
        })
      ).status,
    ).toBe(400);
    // Real session-write fault proves no partially cleared first-login state.
    await db.pool
      .query(`CREATE FUNCTION owner.test_fail_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$;
      CREATE TRIGGER test_fault BEFORE UPDATE OF revoked_at ON owner.sessions FOR EACH ROW EXECUTE FUNCTION owner.test_fail_revocation()`);
    try {
      expect(
        (
          await write("post", "/auth/change-password", adminCookie).send({
            currentPassword: initial,
            newPassword: changed,
          })
        ).status,
      ).toBe(500);
    } finally {
      await db.pool.query(
        "DROP TRIGGER test_fault ON owner.sessions; DROP FUNCTION owner.test_fail_revocation()",
      );
    }
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", adminCookie))
        .body.mustChangePassword,
    ).toBe(true);
    const results = await Promise.all(
      [adminCookie, second.cookie].map((c) =>
        write("post", "/auth/change-password", c).send({
          currentPassword: initial,
          newPassword: changed,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const winner = results[0]!.status === 200 ? adminCookie : second.cookie;
    const loser = winner === adminCookie ? second.cookie : adminCookie;
    adminCookie = winner;
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", loser)).status,
    ).toBe(401);
    expect((await login("owner", initial)).r.status).toBe(401);
    const row = (
      await db.pool.query("SELECT password_hash FROM owner.users WHERE id=$1", [
        adminId,
      ])
    ).rows[0];
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(changed);
    const session = (
      await db.pool.query("SELECT token_hash FROM owner.sessions LIMIT 1")
    ).rows[0];
    expect(session.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("persists customers, exact code grammar, immutable identity, bounded search and durable attributable audit", async () => {
    const code = `a.b_${ulid()}`;
    const created = await customer(adminCookie, code);
    expect(created.status).toBe(201);
    expect(created.body.customerCode).toBe(code);
    expect(created.body.createdBy).toBe(adminId);
    const cid = created.body.id;
    expect((await customer(adminCookie, code)).status).toBe(409);
    expect((await customer(adminCookie, "bad code")).status).toBe(400);
    const duplicate = await Promise.all([
      customer(),
      customer(adminCookie, "Concurrent-C"),
      customer(adminCookie, "Concurrent-C"),
    ]);
    expect(
      duplicate
        .slice(1)
        .map((r) => r.status)
        .sort(),
    ).toEqual([201, 409]);
    expect(
      (
        await write("patch", `/customers/${cid}`, adminCookie).send({
          customerCode: "new-code",
          reason: "test",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("patch", `/customers/${cid}`, adminCookie).send({
          displayName: "rename",
          actorId: "fake",
          reason: "test",
        })
      ).status,
    ).toBe(400);
    const updated = await write("patch", `/customers/${cid}`, adminCookie).send(
      {
        displayName: "نام جدید",
        status: "INACTIVE",
        reason: "Operator correction",
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.customerCode).toBe(code);
    const list = await request(app)
      .get("/api/v1/customers")
      .query({ search: code, page: 1 })
      .set("Cookie", adminCookie);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(cid);
    expect(
      (
        await request(app)
          .get("/api/v1/customers")
          .query({ page: -1 })
          .set("Cookie", adminCookie)
      ).status,
    ).toBe(400);
    const history = await request(app)
      .get("/api/v1/audit-events")
      .query({ targetId: cid })
      .set("Cookie", adminCookie);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items[0].beforeState.displayName).toBe("مشتری آزمایشی");
    expect(history.body.items[0].afterState.displayName).toBe("نام جدید");
    expect(history.body.items[0].actorId).toBe(adminId);
    expect(
      new Date(history.body.items[0].occurredAt).getTime(),
    ).toBeGreaterThan(Date.now() - 60000);
    await expect(
      db.pool.query("UPDATE owner.customers SET customer_code=$1 WHERE id=$2", [
        "new-code",
        cid,
      ]),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        "INSERT INTO owner.customers(id,customer_code,display_name,created_by,updated_by) VALUES($1,$2,'name',$3,$3)",
        [ulid(), "bad code", adminId],
      ),
    ).rejects.toThrow();
  });
  it("rolls back a customer mutation if durable audit fails", async () => {
    await db.pool
      .query(`CREATE FUNCTION owner.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit fault'; END $$;
      CREATE TRIGGER test_fault BEFORE INSERT ON owner.audit_events FOR EACH ROW EXECUTE FUNCTION owner.test_fail_audit()`);
    try {
      expect((await customer(adminCookie, "Audit-rollback")).status).toBe(500);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM owner.customers WHERE customer_code='Audit-rollback'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await db.pool.query(
        "DROP TRIGGER test_fault ON owner.audit_events; DROP FUNCTION owner.test_fail_audit()",
      );
    }
  });
  it("enforces LICENSE_OPERATOR boundaries and rejects superseded four-role values in API and SQL", async () => {
    for (const legacyRole of [
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ]) {
      expect(
        (
          await write("post", "/users", adminCookie).send({
            username: `legacy-${legacyRole}`,
            password: initial,
            role: legacyRole,
          })
        ).status,
      ).toBe(400);
      await expect(
        db.pool.query(
          "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)",
          [ulid(), ulid(), await hashPassword(initial), legacyRole],
        ),
      ).rejects.toThrow();
    }
    const uid = ulid(),
      pw = "Disposable_role_45";
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'LICENSE_OPERATOR',false)",
      [uid, uid, await hashPassword(pw)],
    );
    // Default deny first: no grant means no access, even for an
    // operator-eligible capability (OD-LIC-12, R-1).
    const denied = await request(app)
      .get("/api/v1/customers")
      .set("Cookie", (await login(uid, pw)).cookie);
    expect(denied.status).toBe(403);
    await grant(uid, [...operatorGrants, "licenses.view"]);
    const { cookie } = await login(uid, pw);
    expect((await customer(cookie)).status).toBe(403);
    const code = `Operator-${ulid()}`;
    const created = await write("post", "/customers", adminCookie).send({
      customerCode: code,
      displayName: "Operator-visible customer",
      contractReference: "OPERATIONAL-CONTRACT-REFERENCE",
    });
    expect(created.status).toBe(201);
    const cid = created.body.id;
    expect(
      (
        await write("patch", `/customers/${cid}`, cookie).send({
          displayName: "attack",
          reason: "test",
        })
      ).status,
    ).toBe(403);
    const effective = await request(app)
      .get("/api/v1/permissions/effective")
      .set("Cookie", cookie);
    expect(effective.status).toBe(200);
    expect(effective.body.permissions).toEqual([
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
      "licenses.view",
    ]);
    const list = await request(app)
      .get("/api/v1/customers")
      .query({ search: code })
      .set("Cookie", cookie);
    const detail = await request(app)
      .get(`/api/v1/customers/${cid}`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    for (const record of [list.body.items[0], detail.body]) {
      expect(record.id).toBe(cid);
      expect(record.customerCode).toBe(code);
      expect(record.contractReference).toBe("OPERATIONAL-CONTRACT-REFERENCE");
    }
    expect(
      (await request(app).get("/api/v1/audit-events").set("Cookie", cookie))
        .status,
    ).toBe(200);
    await expectUnavailableOperations(cookie);
    expect(
      (await request(app).get("/api/v1/users").set("Cookie", cookie)).status,
    ).toBe(403);
    expect(
      (
        await write("post", "/users", cookie).send({
          username: "attack",
          password: pw,
          role: "OWNER_ADMIN",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await write("patch", `/users/${adminId}`, cookie).send({
          role: "LICENSE_OPERATOR",
          reason: "attack",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await write("post", `/users/${adminId}/reset-password`, cookie).send({
          password: changed,
          reason: "attack",
        })
      ).status,
    ).toBe(403);
    expect(
      (await write("delete", "/audit-events", cookie).send({})).status,
    ).toBe(404);
    expect((await write("post", "/auth/logout", cookie).send({})).status).toBe(
      204,
    );
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });
  it("keeps audit/lifecycle mutations unavailable even to Administrators", async () => {
    await expectUnavailableOperations(adminCookie);
  });
  it("administers roles, disables and resets with session invalidation and safe audit output", async () => {
    const created = await write("post", "/users", adminCookie).send({
      username: "managed",
      password: initial,
      role: "LICENSE_OPERATOR",
    });
    expect(created.status).toBe(201);
    expect(created.body.mustChangePassword).toBe(true);
    const uid = created.body.id;
    const { cookie } = await login("managed", initial);
    expect(
      (
        await write("patch", `/users/${uid}`, adminCookie).send({
          isActive: false,
          reason: "Disabled test account",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
    expect((await login("managed", initial)).r.status).toBe(401);
    expect(
      (
        await write("patch", `/users/${uid}`, adminCookie).send({
          isActive: true,
          role: "OWNER_ADMIN",
          reason: "Scope elevation",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await write("patch", `/users/${uid}`, adminCookie).send({
          isActive: true,
          role: "LICENSE_OPERATOR",
          reason: "Scope correction",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await write("post", `/users/${uid}/reset-password`, adminCookie).send({
          password: changed,
          reason: "Reset test account",
        })
      ).status,
    ).toBe(200);
    expect((await login("managed", initial)).r.status).toBe(401);
    expect((await login("managed", changed)).r.body.mustChangePassword).toBe(
      true,
    );
    expect(
      (
        await write("patch", `/users/${adminId}`, adminCookie).send({
          isActive: false,
          reason: "test",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await write("patch", `/users/${adminId}`, adminCookie).send({
          role: "LICENSE_OPERATOR",
          reason: "cannot demote last active Owner Admin",
        })
      ).status,
    ).toBe(409);
    const audit = await request(app)
      .get("/api/v1/audit-events")
      .set("Cookie", adminCookie);
    const body = JSON.stringify(audit.body);
    for (const secret of [
      initial,
      changed,
      "password_hash",
      "token_hash",
      "$argon2",
      adminCookie.split("=")[1]!,
    ])
      expect(body).not.toContain(secret);
    await expect(
      db.pool.query("DELETE FROM owner.audit_events"),
    ).rejects.toThrow();
    await expect(
      db.pool.query("UPDATE owner.audit_events SET reason='attack'"),
    ).rejects.toThrow();
  });
  it("requires fresh migration ledger and separate database schemas, and rate-limits login", async () => {
    expect(
      (
        await db.pool.query(
          "SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('licensing','users','identity')",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query("SELECT name FROM public.owner_migrations")
      ).rows.map((r) => r.name),
    ).toEqual([
      "001-foundation.sql",
      "002-manual-operations.sql",
      "003-two-role-authorization.sql",
      "004-audit-retention-archive.sql",
      "005-contract-and-activation-dates.sql",
      "006-signing-key-tracking.sql",
      "007-license-lifecycle.sql",
    ]);
    await db.pool.query("TRUNCATE owner.login_limits");
    for (let n = 0; n < 10; n++)
      expect(
        (
          await write("post", "/auth/login").send({
            username: "absent",
            password: "wrong",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await write("post", "/auth/login").send({
          username: "absent",
          password: "wrong",
        })
      ).status,
    ).toBe(429);
  });
  it("records manual activation observations without issuing or verifying a license", async () => {
    expect((await request(app).get("/api/v1/operational-records")).status).toBe(
      401,
    );
    const created = await customer(adminCookie, `Obs-${ulid()}`);
    const installation = `INST-${ulid()}`;
    const observed = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: created.body.id,
      customerCode: created.body.customerCode,
      installationReference: installation,
      reason: "External issuance observed outside this application",
      evidenceReference: "CASE-14",
    });
    expect(observed.status).toBe(400);
    const issued = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: created.body.id,
      installationReference: installation,
      reason: "External issuance observed outside this application",
      evidenceReference: "CASE-14",
    });
    expect(issued.status).toBe(201);
    expect(issued.body.customerCode).toBe(created.body.customerCode);
    expect(issued.body.observedStatus).toBe("ISSUED");
    expect(issued.body.evidenceBasis).toBe("OPERATOR_OBSERVED");
    expect(issued.body.cryptographicVerification).toBe("NOT_IMPLEMENTED");
    expect(issued.body.signedArtifactProduced).toBe(false);
    expect(issued.body.customerServerContacted).toBe(false);
    expect(issued.body.transitions).toHaveLength(1);
    expect(issued.body.transitions[0].confirmationKind).toBe(
      "OPERATOR_OBSERVED",
    );
    expect(issued.body.createdBy).toBe(adminId);
    expect(JSON.stringify(issued.body)).not.toContain("contractReference");
    expect(
      (
        await write(
          "post",
          "/operational-records/license-observations",
          adminCookie,
        ).send({
          customerId: created.body.id,
          installationReference: installation,
          reason: "duplicate observation",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await write(
          "post",
          "/operational-records/license-observations",
          adminCookie,
        ).send({
          customerId: created.body.id,
          installationReference: `KEY-${ulid()}`,
          reason: ["contains", "-----BEGIN", "PRIVATE KEY-----"].join(" "),
        })
      ).status,
    ).toBe(400);
    const activated = await write(
      "post",
      `/operational-records/${issued.body.id}/activation-observations`,
      adminCookie,
    ).send({
      reason: "Operator observed activation on site",
      evidenceReference: "VISIT-2",
    });
    expect(activated.status).toBe(200);
    expect(activated.body.observedStatus).toBe("ACTIVATED");
    expect(activated.body.observationCategory).toBe("ACTIVATION_OBSERVED");
    expect(activated.body.transitions).toHaveLength(2);
    expect(activated.body.transitions[0].newStatus).toBe("ISSUED");
    const again = await write(
      "post",
      `/operational-records/${issued.body.id}/activation-observations`,
      adminCookie,
    ).send({ reason: "duplicate confirmation" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("InvalidTransition");
    const history = await request(app)
      .get("/api/v1/audit-events")
      .query({ targetId: issued.body.id })
      .set("Cookie", adminCookie);
    expect(
      history.body.items.map((item: { eventType: string }) => item.eventType),
    ).toEqual(
      expect.arrayContaining([
        "LICENSE_ACTIVATION_OBSERVED",
        "LICENSE_ISSUANCE_OBSERVED",
      ]),
    );
    expect(JSON.stringify(history.body)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(history.body)).not.toContain("password_hash");
  });
  it("PDR-18 §1: keeps commercial contract dates separate from Owner-side observation metadata", async () => {
    const code = (prefix: string) => `${prefix}-${ulid()}`;
    // Contract dates are commercial and administrative: they may precede
    // issuance and are never validated as technical validity dates.
    const past = await write("post", "/customers", adminCookie).send({
      customerCode: code("PDR18-PAST"),
      displayName:
        "\u0645\u0634\u062a\u0631\u06cc \u0642\u0631\u0627\u0631\u062f\u0627\u062f",
      contractStartDate: "2020-03-20",
      contractEndDate: "2021-03-21",
    });
    expect(past.status).toBe(201);
    expect(past.body.contractStartDate).toBe("2020-03-20");
    expect(past.body.contractEndDate).toBe("2021-03-21");
    expect(
      (
        await write("post", "/customers", adminCookie).send({
          customerCode: code("PDR18-OPEN"),
          displayName: "Open contract",
          contractStartDate: "2027-01-01",
        })
      ).body.contractEndDate,
    ).toBeNull();
    // A single-day contract is valid; an inverted pair is refused.
    expect(
      (
        await write("post", "/customers", adminCookie).send({
          customerCode: code("PDR18-SAME"),
          displayName: "Single day",
          contractStartDate: "2027-05-05",
          contractEndDate: "2027-05-05",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await write("post", "/customers", adminCookie).send({
          customerCode: code("PDR18-INV"),
          displayName: "Inverted",
          contractStartDate: "2027-01-02",
          contractEndDate: "2027-01-01",
        })
      ).status,
    ).toBe(400);
    for (const contractStartDate of ["2027-13-01", "2027-02-30", "not-a-day"])
      expect(
        (
          await write("post", "/customers", adminCookie).send({
            customerCode: code("PDR18-BAD"),
            displayName: "Malformed",
            contractStartDate,
          })
        ).status,
      ).toBe(400);
    // A partial update keeps the recorded pair and still refuses an inversion.
    expect(
      (
        await write("patch", `/customers/${past.body.id}`, adminCookie).send({
          contractEndDate: "2020-03-19",
          reason: "Inverted partial update",
        })
      ).status,
    ).toBe(400);
    const moved = await write(
      "patch",
      `/customers/${past.body.id}`,
      adminCookie,
    ).send({ contractEndDate: "2022-03-21", reason: "Extended contract" });
    expect(moved.status).toBe(200);
    expect(moved.body.contractStartDate).toBe("2020-03-20");
    expect(moved.body.contractEndDate).toBe("2022-03-21");

    // Owner-side observation metadata: the recording day is derived from the
    // server instant, and the end is what the operator recorded having seen.
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + 365);
    const endDay = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
    const issued = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: past.body.id,
      installationReference: code("PDR18-INST"),
      reason: "External issuance observed outside this application",
      observedValidityEnd: endDay,
    });
    expect(issued.status).toBe(201);
    expect(issued.body.observedValidityEnd).toBe(endDay);
    // The recording day is the UTC calendar day of the immutable created_at.
    const stored = await db.pool.query<{
      recorded_on: string;
      observed_validity_end: string;
    }>(
      "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS recorded_on, to_char(observed_validity_end,'YYYY-MM-DD') AS observed_validity_end FROM owner.operational_records WHERE id=$1",
      [issued.body.id],
    );
    expect(stored.rows[0]!.recorded_on).toBe(issued.body.recordedOn);
    expect(stored.rows[0]!.observed_validity_end).toBe(endDay);
    // The response states its own epistemic status (PDR-17).
    expect(issued.body.evidenceBasis).toBe("OPERATOR_OBSERVED");
    expect(issued.body.cryptographicVerification).toBe("NOT_IMPLEMENTED");

    // The operator cannot select, backdate or future-date the recording day.
    const withRecordedOn = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: past.body.id,
      installationReference: code("PDR18-INST"),
      reason: "Operator must not choose the recording day",
      recordedOn: "2020-01-01",
    });
    expect(withRecordedOn.status).toBe(400);
    // The recorded end is NEVER compared with the recording day, so an
    // observation of an ALREADY-EXPIRED license can be recorded.
    const expired = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: past.body.id,
      installationReference: code("PDR18-INST"),
      reason: "Observation of an already-expired license",
      observedValidityEnd: "2020-01-01",
    });
    expect(expired.status).toBe(201);
    expect(expired.body.observedValidityEnd).toBe("2020-01-01");
    expect(expired.body.observedValidityEnd < expired.body.recordedOn).toBe(
      true,
    );
    // An end exactly ON the recording day is also legal.
    const sameDay = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: past.body.id,
      installationReference: code("PDR18-INST"),
      reason: "End equal to the recording day",
      observedValidityEnd: expired.body.recordedOn,
    });
    expect(sameDay.status).toBe(201);
    expect(sameDay.body.observedValidityEnd).toBe(sameDay.body.recordedOn);
    // A malformed end is refused, never silently normalized.
    for (const observedValidityEnd of ["2027-13-45", "tomorrow", "1405/07/23"])
      expect(
        (
          await write(
            "post",
            "/operational-records/license-observations",
            adminCookie,
          ).send({
            customerId: past.body.id,
            installationReference: code("PDR18-INST"),
            reason: "Malformed observed validity end",
            observedValidityEnd,
          })
        ).status,
      ).toBe(400);
    // The two extra observations above were persisted; only the malformed ones
    // were refused.
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM owner.operational_records WHERE installation_reference LIKE 'PDR18-INST-%'",
        )
      ).rows[0]!.n,
    ).toBe(3);
  });
  it("PDR-18 §1: a server-replacement record records no license validity end", async () => {
    const made = await customer(adminCookie, uniq("PDR18-REP"));
    const replacement = await write(
      "post",
      "/operational-records/server-replacements",
      adminCookie,
    ).send({
      customerId: made.body.id,
      oldInstallationReference: uniq("PDR18-OLD"),
      replacementInstallationReference: uniq("PDR18-NEW"),
      emergencyOldServerLost: false,
      reason: "Owner authorized replacement",
    });
    expect(replacement.status).toBe(201);
    expect(replacement.body.observedValidityEnd).toBeNull();
    // The recording day is still reported; it is metadata about the recording.
    expect(replacement.body.recordedOn).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });
  it("PDR-18 §1 migration 005: no historical issuance or activation date is fabricated", async () => {
    // The corrected model stores no issuance/activation date at all: the
    // recording day is derived from the immutable `created_at` instant, so
    // there is nothing to backfill and nothing to invent.
    const columns = (
      await db.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema='owner' AND table_name='operational_records'
          AND column_name LIKE ANY (ARRAY['%valid%','%issuan%','%activat%'])`,
      )
    ).rows.map((r) => r.column_name);
    expect(columns).toContain("observed_validity_end");
    expect(columns).not.toContain("activation_valid_from");
    expect(columns).not.toContain("activation_valid_until");

    const made = await customer(adminCookie, uniq("PDR18-MIG"));

    // A row recorded before this migration (simulated by an explicit, older
    // `created_at`) keeps that instant as its recording day and gains NO
    // recorded end: the migration backfills nothing and invents no issuance or
    // activation date for existing data.
    const legacy = ulid();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          installation_reference, created_at, updated_at, created_by, updated_by)
        VALUES ($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED',$3,
          '2026-01-01T00:00:00.000Z'::timestamptz,
          '2026-01-01T00:00:00.000Z'::timestamptz,$4,$4)`,
        [legacy, made.body.id, uniq("PDR18-MIG-LEGACY"), adminId],
      );
      // The append-only history guard requires the legal transition chain.
      await insertTransition(
        tx,
        legacy,
        adminId,
        "UNRECORDED",
        "ISSUED",
        "row recorded before migration 005",
        "2026-01-01T00:00:00.000Z",
      );
    });
    const legacyRow = await db.pool.query<{
      recorded_on: string;
      observed_validity_end: string | null;
    }>(
      "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS recorded_on, observed_validity_end FROM owner.operational_records WHERE id=$1",
      [legacy],
    );
    expect(legacyRow.rows[0]!.recorded_on).toBe("2026-01-01");
    expect(legacyRow.rows[0]!.observed_validity_end).toBeNull();
    // The API reports the same separation: a recording day derived from the
    // stored instant, and no recorded end.
    const legacyRead = await request(app)
      .get(`/api/v1/operational-records/${legacy}`)
      .set("Cookie", adminCookie);
    expect(legacyRead.status).toBe(200);
    expect(legacyRead.body.recordedOn).toBe("2026-01-01");
    expect(legacyRead.body.observedValidityEnd).toBeNull();

    // The database no longer requires the recorded end to be later than the
    // recording day: an operator must be able to record an observation of an
    // ALREADY-EXPIRED license. A direct SQL insert on the recording day is
    // accepted, and the API and the database agree on that rule.
    const expiredRow = ulid();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          installation_reference, observed_validity_end, created_by, updated_by)
        VALUES ($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED',$3,
          '2020-01-01'::date, $4,$4)`,
        [expiredRow, made.body.id, uniq("PDR18-MIG-EXPIRED"), adminId],
      );
      await insertTransition(
        tx,
        expiredRow,
        adminId,
        "UNRECORDED",
        "ISSUED",
        "observation of an already-expired license",
      );
    });
    const expiredRead = await request(app)
      .get(`/api/v1/operational-records/${expiredRow}`)
      .set("Cookie", adminCookie);
    expect(expiredRead.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(expiredRead.body.observedValidityEnd).toBe("2020-01-01");
    expect(expiredRead.body.recordedOn).toBe(today);
    // The recorded end precedes the recording day, which is now legal.
    expect(
      expiredRead.body.observedValidityEnd < expiredRead.body.recordedOn,
    ).toBe(true);

    // Only a license observation may carry a recorded validity end.
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          old_installation_reference, replacement_installation_reference,
          observed_validity_end, created_by, updated_by)
        VALUES ($1,$2,'SERVER_REPLACEMENT','REPLACEMENT_AUTHORIZED',
          'REPLACEMENT_AUTHORIZED',$3,$4,'2027-01-01'::date,$5,$5)`,
        [
          ulid(),
          made.body.id,
          uniq("PDR18-MIG-OLD"),
          uniq("PDR18-MIG-NEW"),
          adminId,
        ],
      ),
    ).rejects.toThrow(/observed_validity_end_license_only/);

    // A contract's end may not precede its start.
    await expect(
      db.pool.query(
        `INSERT INTO owner.customers(
          id, customer_code, display_name, status, contract_start_date,
          contract_end_date, created_by, updated_by)
        VALUES ($1,$2,'Inverted','ACTIVE','2027-01-02'::date,'2027-01-01'::date,$3,$3)`,
        [ulid(), uniq("PDR18-MIG-INV"), adminId],
      ),
    ).rejects.toThrow(/contract_date_order/);
  });
  it("enforces the manual server-replacement sequence, same customer, and concurrency", async () => {
    const first = await customer(adminCookie, `Rep-A-${ulid()}`);
    const second = await customer(adminCookie, `Rep-B-${ulid()}`);
    const oldInstallation = `OLD-${ulid()}`;
    const nextInstallation = `NEW-${ulid()}`;
    const license = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: first.body.id,
      installationReference: oldInstallation,
      reason: "Observed before replacement",
    });
    expect(license.status).toBe(201);
    const cross = await write(
      "post",
      "/operational-records/server-replacements",
      adminCookie,
    ).send({
      customerId: second.body.id,
      oldInstallationReference: oldInstallation,
      replacementInstallationReference: nextInstallation,
      emergencyOldServerLost: false,
      replacesRecordId: license.body.id,
      reason: "Must not transfer across customers",
    });
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe("EntityNotFound");
    expect(
      (
        await db.pool.query(
          "SELECT id FROM owner.operational_records WHERE customer_id=$1 AND kind='SERVER_REPLACEMENT'",
          [second.body.id],
        )
      ).rowCount,
    ).toBe(0);
    const skipped = await write(
      "post",
      "/operational-records/server-replacements",
      adminCookie,
    ).send({
      customerId: first.body.id,
      oldInstallationReference: oldInstallation,
      replacementInstallationReference: nextInstallation,
      emergencyOldServerLost: false,
      reason: "Authorized replacement for the same customer",
    });
    expect(skipped.status).toBe(201);
    expect(skipped.body.customerId).toBe(first.body.id);
    expect(skipped.body.replacesRecordId).toBe(license.body.id);
    expect(skipped.body.observedStatus).toBe("REPLACEMENT_AUTHORIZED");
    expect(skipped.body.emergencyOldServerLost).toBe(false);
    const tooSoon = await write(
      "post",
      `/operational-records/${skipped.body.id}/replacement-observations`,
      adminCookie,
    ).send({
      reason: "Cannot skip the old-server observation",
      replacementObservedState: "INSTALLATION_OBSERVED",
    });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.code).toBe("InvalidTransition");
    const oldState = await write(
      "post",
      `/operational-records/${skipped.body.id}/old-server-observations`,
      adminCookie,
    ).send({
      reason:
        "Operator observed manual deactivation; this is not cryptographic proof",
      oldServerObservedState: "DEACTIVATION_OBSERVED",
      evidenceReference: "WORK-9",
    });
    expect(oldState.status).toBe(200);
    expect(oldState.body.oldServerObservedState).toBe("DEACTIVATION_OBSERVED");
    expect(oldState.body.evidenceBasis).toBe("OPERATOR_OBSERVED");
    const done = await write(
      "post",
      `/operational-records/${skipped.body.id}/replacement-observations`,
      adminCookie,
    ).send({
      reason: "Replacement installation observed",
      replacementObservedState: "INSTALLATION_OBSERVED",
    });
    expect(done.status).toBe(200);
    expect(done.body.observedStatus).toBe("REPLACEMENT_RECORDED");
    expect(
      done.body.transitions.map(
        (item: { newStatus: string }) => item.newStatus,
      ),
    ).toEqual([
      "REPLACEMENT_AUTHORIZED",
      "OLD_SERVER_STATE_RECORDED",
      "REPLACEMENT_RECORDED",
    ]);
    expect(
      (
        await write(
          "post",
          `/operational-records/${skipped.body.id}/replacement-observations`,
          adminCookie,
        ).send({
          reason: "terminal repeat",
          replacementObservedState: "INSTALLATION_OBSERVED",
        })
      ).body.code,
    ).toBe("InvalidTransition");
    const lostOld = `LOST-${ulid()}`;
    const lostNew = `LOST-NEW-${ulid()}`;
    const emergency = await write(
      "post",
      "/operational-records/server-replacements",
      adminCookie,
    ).send({
      customerId: first.body.id,
      oldInstallationReference: lostOld,
      replacementInstallationReference: lostNew,
      emergencyOldServerLost: true,
      reason: "Old server destroyed; no response is available",
    });
    expect(emergency.status).toBe(201);
    expect(emergency.body.emergencyOldServerLost).toBe(true);
    expect(emergency.body.oldServerObservedState).toBe(
      "UNAVAILABLE_EMERGENCY_LOSS",
    );
    expect(emergency.body.transitions).toHaveLength(2);
    expect(
      (
        await write(
          "post",
          `/operational-records/${emergency.body.id}/old-server-observations`,
          adminCookie,
        ).send({
          reason: "cannot claim a response from a lost server",
          oldServerObservedState: "DEACTIVATION_OBSERVED",
        })
      ).body.code,
    ).toBe("InvalidTransition");
    const emergencyDone = await write(
      "post",
      `/operational-records/${emergency.body.id}/replacement-observations`,
      adminCookie,
    ).send({
      reason: "Replacement installed without an old-server response",
      replacementObservedState: "INSTALLATION_OBSERVED",
    });
    expect(emergencyDone.status).toBe(200);
    const raceOld = `RACE-${ulid()}`;
    const raceNew = `RACE-NEW-${ulid()}`;
    const raced = await Promise.all([
      write(
        "post",
        "/operational-records/server-replacements",
        adminCookie,
      ).send({
        customerId: second.body.id,
        oldInstallationReference: raceOld,
        replacementInstallationReference: raceNew,
        emergencyOldServerLost: false,
        reason: "concurrent decision",
      }),
      write(
        "post",
        "/operational-records/server-replacements",
        adminCookie,
      ).send({
        customerId: second.body.id,
        oldInstallationReference: raceOld,
        replacementInstallationReference: raceNew,
        emergencyOldServerLost: false,
        reason: "concurrent decision",
      }),
    ]);
    expect(raced.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(raced.find((item) => item.status === 409)!.body.code).toBe(
      "DuplicateOperation",
    );
    expect(
      (
        await db.pool.query(
          "SELECT id FROM owner.operational_records WHERE old_installation_reference=$1",
          [raceOld],
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      db.pool.query(
        "UPDATE owner.operational_transitions SET reason='rewritten' WHERE record_id=$1",
        [done.body.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        "DELETE FROM owner.operational_transitions WHERE record_id=$1",
        [done.body.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          old_installation_reference, replacement_installation_reference,
          emergency_old_server_lost, replaces_record_id, created_by, updated_by)
        VALUES ($1,$2,'SERVER_REPLACEMENT','REPLACEMENT_AUTHORIZED','REPLACEMENT_AUTHORIZED',$3,$4,false,$5,$6,$6)`,
        [
          ulid(),
          second.body.id,
          `X-${ulid()}`,
          `Y-${ulid()}`,
          license.body.id,
          adminId,
        ],
      ),
    ).rejects.toThrow();
  });
  it("allows a completed replacement chain and rejects unfinished overlap in SQL", async () => {
    const created = await customer(adminCookie, `Chain-${ulid()}`);
    const authorize = async (
      oldInstallation: string,
      nextInstallation: string,
    ) =>
      write(
        "post",
        "/operational-records/server-replacements",
        adminCookie,
      ).send({
        customerId: created.body.id,
        oldInstallationReference: oldInstallation,
        replacementInstallationReference: nextInstallation,
        emergencyOldServerLost: false,
        reason: "Authorized same-customer replacement",
      });
    const first = await authorize("A-chain", "B-chain");
    expect(first.status).toBe(201);
    const overlap = await authorize("B-chain", "C-chain");
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe("DuplicateOperation");
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          old_installation_reference, replacement_installation_reference,
          emergency_old_server_lost, created_by, updated_by)
        VALUES ($1,$2,'SERVER_REPLACEMENT','REPLACEMENT_AUTHORIZED','REPLACEMENT_AUTHORIZED',$3,$4,false,$5,$5)`,
        [ulid(), created.body.id, "B-chain", "C-chain", adminId],
      ),
    ).rejects.toThrow();
    const observed = await write(
      "post",
      `/operational-records/${first.body.id}/old-server-observations`,
      adminCookie,
    ).send({
      reason: "Old server deactivation observed",
      oldServerObservedState: "DEACTIVATION_OBSERVED",
    });
    expect(observed.status).toBe(200);
    const recorded = await write(
      "post",
      `/operational-records/${first.body.id}/replacement-observations`,
      adminCookie,
    ).send({
      reason: "Replacement installation observed",
      replacementObservedState: "INSTALLATION_OBSERVED",
    });
    expect(recorded.status).toBe(200);
    const chained = await authorize("B-chain", "C-chain");
    expect(chained.status).toBe(201);
    expect(chained.body.observedStatus).toBe("REPLACEMENT_AUTHORIZED");
    const other = ulid();
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'LICENSE_OPERATOR',false)",
      [other, other, await hashPassword("Disposable_chain_45")],
    );
    await expect(
      db.pool.query(
        "UPDATE owner.operational_records SET updated_by=$2 WHERE id=$1",
        [chained.body.id, other],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          installation_reference, emergency_old_server_lost, created_by, updated_by)
        VALUES ($1,$2,'LICENSE','ACTIVATED','ACTIVATION_OBSERVED',$3,false,$4,$4)`,
        [ulid(), created.body.id, `SKIP-${ulid()}`, adminId],
      ),
    ).rejects.toThrow();
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_transitions(
          id, record_id, actor_id, prior_status, new_status, reason,
          confirmation_kind)
        VALUES ($1,$2,$3,'UNRECORDED','REPLACEMENT_AUTHORIZED','forged history','OPERATOR_OBSERVED')`,
        [ulid(), chained.body.id, adminId],
      ),
    ).rejects.toThrow();
  });
  it("rejects discontinuous direct-SQL history and accepts legal chains", async () => {
    const created = await customer(adminCookie, `Hist-${ulid()}`);
    const customerId = created.body.id as string;
    const historian = ulid();
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'LICENSE_OPERATOR',false)",
      [historian, historian, await hashPassword("Disposable_hist_45")],
    );
    const insertLicense = (tx: PoolClient, id: string, reference: string) =>
      tx.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          installation_reference, emergency_old_server_lost, created_by, updated_by)
        VALUES ($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED',$3,false,$4,$4)`,
        [id, customerId, reference, adminId],
      );
    const activate = (tx: PoolClient, id: string) =>
      tx.query(
        `UPDATE owner.operational_records
        SET observed_status='ACTIVATED', observation_category='ACTIVATION_OBSERVED',
          updated_by=$2, updated_at=clock_timestamp()
        WHERE id=$1`,
        [id, adminId],
      );
    const insertReplacement = (
      tx: PoolClient,
      id: string,
      oldInstallation: string,
      nextInstallation: string,
      emergency: boolean,
    ) =>
      tx.query(
        `INSERT INTO owner.operational_records(
          id, customer_id, kind, observed_status, observation_category,
          old_installation_reference, replacement_installation_reference,
          old_server_observed_state, emergency_old_server_lost, created_by, updated_by)
        VALUES ($1,$2,'SERVER_REPLACEMENT',$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          customerId,
          emergency ? "OLD_SERVER_STATE_RECORDED" : "REPLACEMENT_AUTHORIZED",
          emergency ? "OLD_SERVER_STATE_OBSERVED" : "REPLACEMENT_AUTHORIZED",
          oldInstallation,
          nextInstallation,
          emergency ? "UNAVAILABLE_EMERGENCY_LOSS" : null,
          emergency,
          adminId,
        ],
      );
    const recordOldServer = (tx: PoolClient, id: string) =>
      tx.query(
        `UPDATE owner.operational_records
        SET observed_status='OLD_SERVER_STATE_RECORDED',
          observation_category='OLD_SERVER_STATE_OBSERVED',
          old_server_observed_state='DEACTIVATION_OBSERVED',
          updated_by=$2, updated_at=clock_timestamp()
        WHERE id=$1`,
        [id, adminId],
      );
    const recordReplacement = (tx: PoolClient, id: string) =>
      tx.query(
        `UPDATE owner.operational_records
        SET observed_status='REPLACEMENT_RECORDED',
          observation_category='REPLACEMENT_INSTALLATION_OBSERVED',
          replacement_observed_state='INSTALLATION_OBSERVED',
          updated_by=$2, updated_at=clock_timestamp()
        WHERE id=$1`,
        [id, adminId],
      );

    const licenseId = ulid();
    await db.transaction(async (tx) => {
      await insertLicense(tx, licenseId, `H${ulid()}`);
      await insertTransition(
        tx,
        licenseId,
        adminId,
        "UNRECORDED",
        "ISSUED",
        "external issuance observed",
      );
    });
    expect(await observedStatus(licenseId)).toBe("ISSUED");
    expect(await transitionChain(licenseId)).toEqual(["UNRECORDED->ISSUED"]);

    const badStart = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertLicense(tx, badStart, `B${ulid()}`);
        await insertTransition(
          tx,
          badStart,
          adminId,
          "ISSUED",
          "ACTIVATED",
          "does not start at UNRECORDED",
        );
      }),
    ).rejects.toThrow(/must start from UNRECORDED/);
    expect(await observedStatus(badStart)).toBeNull();

    const forgedFinal = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertLicense(tx, forgedFinal, `F${ulid()}`);
        await activate(tx, forgedFinal);
        await insertTransition(
          tx,
          forgedFinal,
          adminId,
          "UNRECORDED",
          "ACTIVATED",
          "forged final status",
        );
      }),
    ).rejects.toThrow(/not the next permitted state/);
    expect(await observedStatus(forgedFinal)).toBeNull();

    await expect(
      db.transaction(async (tx) => {
        await activate(tx, licenseId);
        await insertTransition(
          tx,
          licenseId,
          adminId,
          "UNRECORDED",
          "ACTIVATED",
          "forged prior on a valid final status",
        );
      }),
    ).rejects.toThrow(/prior status is not continuous/);
    expect(await observedStatus(licenseId)).toBe("ISSUED");
    expect(await transitionChain(licenseId)).toEqual(["UNRECORDED->ISSUED"]);

    await expect(
      db.transaction(async (tx) => {
        await activate(tx, licenseId);
        await insertTransition(
          tx,
          licenseId,
          adminId,
          "ISSUED",
          "ACTIVATED",
          "out of order activation",
          "2000-01-01T00:00:00Z",
        );
      }),
    ).rejects.toThrow(/appended in order/);
    expect(await observedStatus(licenseId)).toBe("ISSUED");
    expect(await transitionChain(licenseId)).toEqual(["UNRECORDED->ISSUED"]);

    const inconsistent = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertLicense(tx, inconsistent, `C${ulid()}`);
        await insertTransition(
          tx,
          inconsistent,
          adminId,
          "UNRECORDED",
          "REPLACEMENT_AUTHORIZED",
          "record inconsistent",
        );
      }),
    ).rejects.toThrow(/not the next permitted state/);
    expect(await observedStatus(inconsistent)).toBeNull();

    await db.transaction(async (tx) => {
      await activate(tx, licenseId);
      await insertTransition(
        tx,
        licenseId,
        adminId,
        "ISSUED",
        "ACTIVATED",
        "activation observed",
      );
    });
    expect(await observedStatus(licenseId)).toBe("ACTIVATED");
    expect(await transitionChain(licenseId)).toEqual([
      "UNRECORDED->ISSUED",
      "ISSUED->ACTIVATED",
    ]);
    await expect(
      db.pool.query(
        `INSERT INTO owner.operational_transitions(
          id, record_id, actor_id, prior_status, new_status, reason,
          confirmation_kind)
        VALUES ($1,$2,$3,'ACTIVATED','REPLACEMENT_RECORDED','extra transition','OPERATOR_OBSERVED')`,
        [ulid(), licenseId, adminId],
      ),
    ).rejects.toThrow(/already recorded/);
    await expect(
      db.pool.query(
        "UPDATE owner.operational_transitions SET reason='rewritten' WHERE record_id=$1",
        [licenseId],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pool.query(
        "DELETE FROM owner.operational_transitions WHERE record_id=$1",
        [licenseId],
      ),
    ).rejects.toThrow(/append-only/);
    expect(await transitionChain(licenseId)).toEqual([
      "UNRECORDED->ISSUED",
      "ISSUED->ACTIVATED",
    ]);

    const replacementId = ulid();
    await db.transaction(async (tx) => {
      await insertReplacement(
        tx,
        replacementId,
        `O${ulid()}`,
        `N${ulid()}`,
        false,
      );
      await insertTransition(
        tx,
        replacementId,
        adminId,
        "UNRECORDED",
        "REPLACEMENT_AUTHORIZED",
        "replacement authorized",
      );
    });
    await db.transaction(async (tx) => {
      await recordOldServer(tx, replacementId);
      await insertTransition(
        tx,
        replacementId,
        adminId,
        "REPLACEMENT_AUTHORIZED",
        "OLD_SERVER_STATE_RECORDED",
        "old server observed",
      );
    });
    await db.transaction(async (tx) => {
      await recordReplacement(tx, replacementId);
      await insertTransition(
        tx,
        replacementId,
        adminId,
        "OLD_SERVER_STATE_RECORDED",
        "REPLACEMENT_RECORDED",
        "replacement observed",
      );
    });
    expect(await observedStatus(replacementId)).toBe("REPLACEMENT_RECORDED");
    expect(await transitionChain(replacementId)).toEqual([
      "UNRECORDED->REPLACEMENT_AUTHORIZED",
      "REPLACEMENT_AUTHORIZED->OLD_SERVER_STATE_RECORDED",
      "OLD_SERVER_STATE_RECORDED->REPLACEMENT_RECORDED",
    ]);

    const gapId = ulid();
    await db.transaction(async (tx) => {
      await insertReplacement(tx, gapId, `G${ulid()}`, `H${ulid()}`, false);
      await insertTransition(
        tx,
        gapId,
        adminId,
        "UNRECORDED",
        "REPLACEMENT_AUTHORIZED",
        "authorized before a gap",
      );
    });
    await expect(
      db.transaction(async (tx) => {
        await recordOldServer(tx, gapId);
        await insertTransition(
          tx,
          gapId,
          adminId,
          "ISSUED",
          "OLD_SERVER_STATE_RECORDED",
          "discontinuous history",
        );
      }),
    ).rejects.toThrow(/not continuous/);
    expect(await observedStatus(gapId)).toBe("REPLACEMENT_AUTHORIZED");
    expect(await transitionChain(gapId)).toEqual([
      "UNRECORDED->REPLACEMENT_AUTHORIZED",
    ]);

    const emergencyId = ulid();
    await db.transaction(async (tx) => {
      await insertReplacement(
        tx,
        emergencyId,
        `E${ulid()}`,
        `R${ulid()}`,
        true,
      );
      await insertTransition(
        tx,
        emergencyId,
        historian,
        "UNRECORDED",
        "REPLACEMENT_AUTHORIZED",
        "authorized decision",
      );
      await insertTransition(
        tx,
        emergencyId,
        adminId,
        "REPLACEMENT_AUTHORIZED",
        "OLD_SERVER_STATE_RECORDED",
        "old server lost",
      );
    });
    expect(await observedStatus(emergencyId)).toBe("OLD_SERVER_STATE_RECORDED");
    expect(await transitionChain(emergencyId)).toEqual([
      "UNRECORDED->REPLACEMENT_AUTHORIZED",
      "REPLACEMENT_AUTHORIZED->OLD_SERVER_STATE_RECORDED",
    ]);
    const actors = await db.pool.query<{ actor_id: string }>(
      `SELECT actor_id FROM owner.operational_transitions
      WHERE record_id=$1 ORDER BY occurred_at, id`,
      [emergencyId],
    );
    expect(actors.rows.map((row) => row.actor_id)).toEqual([
      historian,
      adminId,
    ]);

    const incomplete = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertReplacement(
          tx,
          incomplete,
          `I${ulid()}`,
          `J${ulid()}`,
          true,
        );
        await insertTransition(
          tx,
          incomplete,
          adminId,
          "UNRECORDED",
          "REPLACEMENT_AUTHORIZED",
          "prefix only",
        );
      }),
    ).rejects.toThrow(/does not match the recorded state/);
    expect(await observedStatus(incomplete)).toBeNull();

    const jumped = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertReplacement(tx, jumped, `K${ulid()}`, `L${ulid()}`, true);
        await insertTransition(
          tx,
          jumped,
          adminId,
          "UNRECORDED",
          "OLD_SERVER_STATE_RECORDED",
          "skipped authorization",
        );
      }),
    ).rejects.toThrow(/not the next permitted state/);
    expect(await observedStatus(jumped)).toBeNull();

    const forgedEmergency = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertReplacement(
          tx,
          forgedEmergency,
          `M${ulid()}`,
          `P${ulid()}`,
          true,
        );
        await insertTransition(
          tx,
          forgedEmergency,
          adminId,
          "UNRECORDED",
          "REPLACEMENT_AUTHORIZED",
          "authorized decision",
        );
        await insertTransition(
          tx,
          forgedEmergency,
          adminId,
          "UNRECORDED",
          "OLD_SERVER_STATE_RECORDED",
          "forged emergency prior",
        );
      }),
    ).rejects.toThrow(/not continuous/);
    expect(await observedStatus(forgedEmergency)).toBeNull();

    const mismatched = ulid();
    await expect(
      db.transaction(async (tx) => {
        await insertReplacement(
          tx,
          mismatched,
          `Q${ulid()}`,
          `S${ulid()}`,
          true,
        );
        await insertTransition(
          tx,
          mismatched,
          adminId,
          "UNRECORDED",
          "REPLACEMENT_AUTHORIZED",
          "authorized decision",
        );
        await insertTransition(
          tx,
          mismatched,
          historian,
          "REPLACEMENT_AUTHORIZED",
          "OLD_SERVER_STATE_RECORDED",
          "wrong completing actor",
        );
      }),
    ).rejects.toThrow(/actor must match/);
    expect(await observedStatus(mismatched)).toBeNull();
  });
  it("rolls back an operation when durable audit insertion fails", async () => {
    const created = await customer(adminCookie, `Audit-op-${ulid()}`);
    await db.pool.query(
      `CREATE FUNCTION owner.test_fail_operation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit fault'; END $$;
      CREATE TRIGGER test_operation_audit BEFORE INSERT ON owner.audit_events FOR EACH ROW EXECUTE FUNCTION owner.test_fail_operation_audit()`,
    );
    try {
      expect(
        (
          await write(
            "post",
            "/operational-records/license-observations",
            adminCookie,
          ).send({
            customerId: created.body.id,
            installationReference: `AUD-${ulid()}`,
            reason: "must roll back with the audit write",
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM owner.operational_records WHERE customer_id=$1 AND kind='LICENSE'",
            [created.body.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await db.pool.query(
        "DROP TRIGGER test_operation_audit ON owner.audit_events; DROP FUNCTION owner.test_fail_operation_audit()",
      );
    }
  });
  it("authorizes manual operations for Owner Admin and License Operator on the direct API", async () => {
    const created = await customer(adminCookie, `Role-op-${ulid()}`);
    const installation = `ROLE-${ulid()}`;
    const issued = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: created.body.id,
      installationReference: installation,
      reason: "role matrix observation",
    });
    expect(issued.status).toBe(201);
    for (const role of ["OWNER_ADMIN", "LICENSE_OPERATOR"] as const) {
      const uid = ulid();
      const pw = "Disposable_role_45";
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)",
        [uid, uid, await hashPassword(pw), role],
      );
      if (role === "LICENSE_OPERATOR") await grant(uid, operatorGrants);
      const { cookie } = await login(uid, pw);
      const list = await request(app)
        .get("/api/v1/operational-records")
        .query({ customerId: created.body.id })
        .set("Cookie", cookie);
      const detail = await request(app)
        .get(`/api/v1/operational-records/${issued.body.id}`)
        .set("Cookie", cookie);
      const mutation = await write(
        "post",
        "/operational-records/license-observations",
        cookie,
      ).send({
        customerId: created.body.id,
        installationReference: `MUT-${ulid()}`,
        reason: "direct mutation attempt",
      });
      expect(list.status).toBe(200);
      expect(detail.status).toBe(200);
      expect(detail.body.customerCode).toBe(created.body.customerCode);
      expect(detail.body).not.toHaveProperty("contractReference");
      expect(mutation.status).toBe(201);
      expect(mutation.body.signedArtifactProduced).toBe(false);

      const activatedByRole = await write(
        "post",
        `/operational-records/${mutation.body.id}/activation-observations`,
        cookie,
      ).send({
        reason: "activation confirmation observed by authorized role",
      });
      expect(activatedByRole.status).toBe(200);
      expect(activatedByRole.body.observedStatus).toBe("ACTIVATED");

      const replacementAttempt = await write(
        "post",
        "/operational-records/server-replacements",
        cookie,
      ).send({
        customerId: created.body.id,
        oldInstallationReference: `OLD-ROLE-${ulid()}`,
        replacementInstallationReference: `NEW-ROLE-${ulid()}`,
        emergencyOldServerLost: false,
        reason: "replacement authorization attempt",
      });
      if (role === "OWNER_ADMIN") {
        expect(replacementAttempt.status).toBe(201);
        expect(replacementAttempt.body.observedStatus).toBe(
          "REPLACEMENT_AUTHORIZED",
        );
      } else {
        expect(replacementAttempt.status).toBe(403);
        expect(replacementAttempt.body.code).toBe("PermissionDenied");
        const emergencyAttempt = await write(
          "post",
          "/operational-records/server-replacements",
          cookie,
        ).send({
          customerId: created.body.id,
          oldInstallationReference: `OLD-EMG-${ulid()}`,
          replacementInstallationReference: `NEW-EMG-${ulid()}`,
          emergencyOldServerLost: true,
          reason: "emergency replacement authorization attempt",
        });
        expect(emergencyAttempt.status).toBe(403);
        expect(emergencyAttempt.body.code).toBe("PermissionDenied");
        const denied = await db.pool.query(
          "SELECT outcome, reason FROM owner.audit_events WHERE actor_id=$1 AND event_type='OPERATION_MUTATION_DENIED' ORDER BY sequence",
          [uid],
        );
        expect(denied.rowCount).toBe(2);
        expect(denied.rows[0]!.outcome).toBe("DENIED");
        expect(denied.rows[0]!.reason).toBe("Missing replacements.authorize");
        expect(JSON.stringify(denied.rows[0])).not.toContain(
          "replacement authorization attempt",
        );

        // Once Owner Admin authorizes a replacement, License Operator may record the observed states.
        const adminAuthorized = await write(
          "post",
          "/operational-records/server-replacements",
          adminCookie,
        ).send({
          customerId: created.body.id,
          oldInstallationReference: `OLD-OP-${ulid()}`,
          replacementInstallationReference: `NEW-OP-${ulid()}`,
          emergencyOldServerLost: false,
          reason: "Owner Admin authorized replacement",
        });
        expect(adminAuthorized.status).toBe(201);
        const opOld = await write(
          "post",
          `/operational-records/${adminAuthorized.body.id}/old-server-observations`,
          cookie,
        ).send({
          reason: "Operator observed old-server deactivation",
          oldServerObservedState: "DEACTIVATION_OBSERVED",
        });
        expect(opOld.status).toBe(200);
        const opNew = await write(
          "post",
          `/operational-records/${adminAuthorized.body.id}/replacement-observations`,
          cookie,
        ).send({
          reason: "Operator observed replacement installation",
          replacementObservedState: "INSTALLATION_OBSERVED",
        });
        expect(opNew.status).toBe(200);
        expect(opNew.body.observedStatus).toBe("REPLACEMENT_RECORDED");
      }
      await expectUnavailableOperations(cookie);
    }
    const effective = await request(app)
      .get("/api/v1/permissions/effective")
      .set("Cookie", adminCookie);
    expect(effective.body.permissions).toEqual([
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "audit.archive",
      "operations.view",
      "operations.record",
      "replacements.authorize",
      "licenses.issue.time_limited",
      "licenses.issue.perpetual",
      "licenses.import",
      "licenses.view",
      "licenses.download",
      "limit_profiles.manage",
    ]);
  });
  it("filters audit events in PostgreSQL with exact AND semantics, half-open UTC windows and stable bounded pages", async () => {
    const eventType = `EXPLORER_${ulid()}`;
    const other = `EXPLORER_${ulid()}`;
    const target = ulid();
    const ids: string[] = [];
    for (let i = 0; i < 52; i++)
      ids.push(
        await insertAudit({
          actor: adminId,
          type: eventType,
          targetType: "OperationalRecord",
          targetId: target,
          // Pairs share an occurred_at, so only the sequence tie-breaker orders them.
          occurredAt: new Date(
            Date.UTC(2001, 5, 1, 0, 0, Math.floor(i / 2)),
          ).toISOString(),
        }),
      );
    const denied = await insertAudit({
      actor: adminId,
      type: other,
      targetType: "User",
      targetId: adminId,
      occurredAt: "2001-06-01T00:00:00.000Z",
      outcome: "DENIED",
    });

    const first = await explorer(adminCookie, {
      eventType,
      targetId: target,
      page: "1",
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 50, hasNext: true });
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].id).toBe(ids[51]);
    expect(first.body.items[1].id).toBe(ids[50]);
    expect(first.body.items[0].occurredAt).toBe(first.body.items[1].occurredAt);
    const second = await explorer(adminCookie, {
      eventType,
      targetId: target,
      page: "2",
    });
    expect(second.body).toMatchObject({ page: 2, hasNext: false });
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[1],
      ids[0],
    ]);

    // [from, before): 10s is included, 20s is excluded.
    const windowed = await explorer(adminCookie, {
      eventType,
      occurredFrom: "2001-06-01T00:00:10.000Z",
      occurredBefore: "2001-06-01T00:00:20.000Z",
    });
    const windowIds = windowed.body.items.map(
      (item: { id: string }) => item.id,
    );
    expect(windowed.status).toBe(200);
    expect(windowIds).toHaveLength(20);
    expect(windowIds).toEqual(expect.arrayContaining([ids[20], ids[39]]));
    expect(windowIds).not.toContain(ids[19]);
    expect(windowIds).not.toContain(ids[40]);

    // Every criterion narrows the result; none widens it.
    const narrowings: Record<string, string>[] = [
      { outcome: "DENIED" },
      { targetType: "User" },
      { actorId: ulid() },
      { targetId: ulid() },
    ];
    for (const narrowing of narrowings)
      expect(
        (await explorer(adminCookie, { eventType, ...narrowing })).body.items,
      ).toEqual([]);
    const deniedOnly = await explorer(adminCookie, {
      eventType: other,
      outcome: "DENIED",
      targetType: "User",
    });
    expect(
      deniedOnly.body.items.map((item: { id: string }) => item.id),
    ).toEqual([denied]);

    // Filters are literal equality: `_` is an ordinary character, never a LIKE wildcard.
    expect(
      (await explorer(adminCookie, { eventType: "EXPLORER_" })).body.items,
    ).toEqual([]);
    const hostiles: Record<string, string>[] = [
      { eventType: "EXPLORER%" },
      { eventType: "_" },
      { eventType: "x' OR '1'='1" },
      { targetType: "Customer' OR '1'='1" },
      { actorId: "%" },
      { actorId: `${adminId}' OR 1=1 --` },
      { occurredFrom: "2001-06-01" },
      { occurredFrom: "2001-06-01T00:00:00+01:00" },
      { occurredFrom: "2001-06-01T00:00:00Z' OR '1'='1" },
      {
        occurredFrom: "2001-06-02T00:00:00Z",
        occurredBefore: "2001-06-01T00:00:00Z",
      },
      { outcome: "SUCCESS%" },
      { actor: adminId },
      { page: "0" },
      { page: "1000000" },
    ];
    for (const hostile of hostiles)
      expect(
        (await explorer(adminCookie, hostile)).status,
        JSON.stringify(hostile),
      ).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/v1/audit-events?eventType=${eventType}&eventType=${other}`)
          .set("Cookie", adminCookie)
      ).status,
    ).toBe(400);
  });
  it("returns only allowlisted audit state even when stored JSON contains secret-like keys", async () => {
    const eventType = `PROJECT_${ulid()}`;
    await insertAudit({
      actor: adminId,
      type: eventType,
      targetType: "Customer",
      targetId: ulid(),
      occurredAt: "2001-07-01T00:00:00.000Z",
      before: { displayName: "old", password_hash: "$argon2id$SECRET-HASH" },
      after: {
        displayName: "new",
        evidenceReference: "CASE-42",
        token_hash: "SECRET-TOKEN-HASH",
        sessionToken: "SECRET-SESSION",
        nested: { password_hash: "$argon2id$NESTED" },
      },
    });
    const res = await explorer(adminCookie, { eventType });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].beforeState).toEqual({ displayName: "old" });
    expect(res.body.items[0].afterState).toEqual({
      displayName: "new",
      evidenceReference: "CASE-42",
    });
    const raw = JSON.stringify(res.body);
    for (const secret of [
      "SECRET-HASH",
      "SECRET-TOKEN-HASH",
      "SECRET-SESSION",
      "NESTED",
      "$argon2id",
    ])
      expect(raw).not.toContain(secret);
  });
  it("applies the audit.view grant to every explorer filter on direct API requests", async () => {
    const eventType = `ROLES_${ulid()}`;
    const target = ulid();
    const eventId = await insertAudit({
      actor: adminId,
      type: eventType,
      targetType: "Customer",
      targetId: target,
      occurredAt: "2001-08-01T00:00:00.000Z",
    });
    const filters = {
      eventType,
      targetType: "Customer",
      targetId: target,
      actorId: adminId,
      outcome: "SUCCESS",
      occurredFrom: "2001-08-01T00:00:00Z",
      occurredBefore: "2001-08-02T00:00:00Z",
    };
    for (const role of ["OWNER_ADMIN", "LICENSE_OPERATOR"] as const) {
      const uid = ulid(),
        pw = "Disposable_role_45";
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)",
        [uid, uid, await hashPassword(pw), role],
      );
      if (role === "LICENSE_OPERATOR") await grant(uid, ["audit.view"]);
      const { cookie } = await login(uid, pw);
      const res = await explorer(cookie, filters);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        eventId,
      ]);
      expect(
        (await explorer(cookie, { eventType: "bad%", actor: "x" })).status,
      ).toBe(400);
      // No identifier lookup exists for any role.
      expect(
        (
          await request(app)
            .get(`/api/v1/audit-events/${eventId}`)
            .set("Cookie", cookie)
        ).status,
      ).toBe(404);
    }
    // Unauthenticated callers are denied before query validation.
    expect(
      (
        await request(app)
          .get("/api/v1/audit-events")
          .query({ actorId: adminId })
      ).status,
    ).toBe(401);
    // A password-change-pending credential is denied even though the query is valid.
    const pending = ulid(),
      pendingPw = "Disposable_role_45";
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,true)",
      [pending, pending, await hashPassword(pendingPw), "OWNER_ADMIN"],
    );
    const pendingLogin = await login(pending, pendingPw);
    expect((await explorer(pendingLogin.cookie, filters)).status).toBe(403);
  });
  it("lets an operator reach the audit trail of an operational record and of a customer", async () => {
    const created = await customer(adminCookie, `Trail-${ulid()}`);
    expect(created.status).toBe(201);
    const cid = created.body.id;
    const issued = await write(
      "post",
      "/operational-records/license-observations",
      adminCookie,
    ).send({
      customerId: cid,
      installationReference: `TRAIL-${ulid()}`,
      reason: "trail observation",
    });
    expect(issued.status).toBe(201);
    const recordTrail = await explorer(adminCookie, {
      targetType: "OperationalRecord",
      targetId: issued.body.id,
    });
    expect(recordTrail.status).toBe(200);
    const observed = recordTrail.body.items.find(
      (item: { eventType: string }) =>
        item.eventType === "LICENSE_ISSUANCE_OBSERVED",
    );
    expect(observed).toBeDefined();
    expect(observed.afterState).toMatchObject({
      observedStatus: "ISSUED",
      evidenceBasis: "OPERATOR_OBSERVED",
    });
    const customerTrail = await explorer(adminCookie, {
      targetType: "Customer",
      targetId: cid,
      eventType: "CUSTOMER_CREATED",
      actorId: adminId,
    });
    expect(customerTrail.body.items).toHaveLength(1);
    expect(customerTrail.body.items[0].afterState).toMatchObject({
      customerCode: created.body.customerCode,
    });
  });

  it("OQ-74 tracks opaque IDs, role boundaries, live safety joins, constraints and attributable audits", async () => {
    const keyId = "authority-2026";
    const get = (path: string, cookie = adminCookie) =>
      request(app).get(`/api/v1${path}`).set("Cookie", cookie);
    expect((await request(app).get("/api/v1/signing-keys")).status).toBe(401);
    expect(
      (
        await write("post", "/signing-keys").send({
          id: keyId,
          label: "Authority",
        })
      ).status,
    ).toBe(401);
    const registered = await write("post", "/signing-keys", adminCookie).send({
      id: keyId,
      label: "Authority",
    });
    expect(registered.status).toBe(201);
    expect((await get(`/signing-keys/${keyId}`)).body).toEqual(registered.body);
    expect((await get("/signing-keys/missing")).status).toBe(404);
    expect((await get("/signing-keys")).body.items).toEqual(
      expect.arrayContaining([registered.body]),
    );
    const retries = await Promise.all(
      [1, 2].map(() =>
        write("post", "/signing-keys", adminCookie).send({
          id: keyId,
          label: "Authority",
        }),
      ),
    );
    expect(retries.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (
        await write("post", "/signing-keys", adminCookie).send({
          id: keyId,
          label: "conflict",
        })
      ).status,
    ).toBe(409);
    const uid = ulid(),
      pw = "Disposable_oq74_47";
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$1,$2,'LICENSE_OPERATOR',false)",
      [uid, await hashPassword(pw)],
    );
    await grant(uid, operatorGrants);
    const operator = (await login(uid, pw)).cookie;
    expect((await get(`/signing-keys/${keyId}`, operator)).status).toBe(200);
    for (const [method, path, body] of [
      ["post", "/signing-keys", { id: "denied-key", label: "Denied" }],
      [
        "post",
        `/signing-keys/${keyId}/status`,
        { status: "COMPROMISED", reason: "denied" },
      ],
      ["patch", `/signing-keys/${keyId}/notes`, { notes: "denied" }],
    ] as const)
      expect((await write(method, path, operator).send(body)).status).toBe(403);
    for (const id of [" x", "x y", "VLIC2.payload", "x".repeat(121)]) {
      expect(
        (
          await write("post", "/signing-keys", adminCookie).send({
            id,
            label: "Invalid",
          })
        ).status,
      ).toBe(400);
      expect(
        (await get(`/signing-keys/${encodeURIComponent(id)}`)).status,
      ).toBe(400);
      expect(
        (
          await write(
            "post",
            `/signing-keys/${encodeURIComponent(id)}/status`,
            adminCookie,
          ).send({ status: "REVOKED", reason: "invalid" })
        ).status,
      ).toBe(400);
      expect(
        (
          await write(
            "patch",
            `/signing-keys/${encodeURIComponent(id)}/notes`,
            adminCookie,
          ).send({ notes: "invalid" })
        ).status,
      ).toBe(400);
    }
    // Max-length identifiers survive both the audit source and independent archive.
    const maxId = "k".repeat(120);
    expect(
      (
        await write("post", "/signing-keys", adminCookie).send({
          id: maxId,
          label: "Boundary",
        })
      ).status,
    ).toBe(201);
    expect((await get(`/signing-keys/${maxId}`)).status).toBe(200);
    const made = await customer();
    const observe = (signingKeyId?: string) =>
      write("post", "/operational-records/license-observations", operator).send(
        {
          customerId: made.body.id,
          installationReference: uniq("OQ74"),
          reason: "Observed externally",
          ...(signingKeyId ? { signingKeyId } : {}),
        },
      );
    const observed = await observe(keyId);
    expect(observed.status).toBe(201);
    expect(observed.body).toMatchObject({
      signingKeyId: keyId,
      signingKeyStatus: "ACTIVE",
      signingKeySafety: "SAFE",
      cryptographicVerification: "NOT_IMPLEMENTED",
    });
    expect((await observe()).body.signingKeySafety).toBe("UNKNOWN");
    expect((await observe("missing")).status).toBe(404);
    expect((await observe(" invalid ")).status).toBe(400);
    const status = await write(
      "post",
      `/signing-keys/${keyId}/status`,
      adminCookie,
    ).send({
      status: "COMPROMISED",
      reason: "Incident review",
      evidenceReference: "CASE-74",
    });
    expect(status.status).toBe(200);
    expect(status.body.statusDetectedAt).toMatch(/Z$/);
    const detail = await get(`/operational-records/${observed.body.id}`);
    const list = await get(`/operational-records?customerId=${made.body.id}`);
    expect(detail.body).toMatchObject({
      signingKeyId: keyId,
      signingKeySafety: "NEEDS_REVIEW",
      observedStatus: "ISSUED",
    });
    expect(
      list.body.items.find((r: { id: string }) => r.id === observed.body.id)
        .signingKeySafety,
    ).toBe("NEEDS_REVIEW");
    expect((await observe(keyId)).body.signingKeySafety).toBe("NEEDS_REVIEW"); // explicit historical association is permitted
    const activated = await write(
      "post",
      `/operational-records/${observed.body.id}/activation-observations`,
      operator,
    ).send({ reason: "Activation observed" });
    expect(activated.body).toMatchObject({
      signingKeyId: keyId,
      signingKeySafety: "NEEDS_REVIEW",
      observedStatus: "ACTIVATED",
    });
    expect(
      (
        await write("post", `/signing-keys/${keyId}/status`, adminCookie).send({
          status: "REVOKED",
          reason: "Reviewed disposition",
        })
      ).status,
    ).toBe(200);
    expect(
      (await get(`/operational-records/${observed.body.id}`)).body
        .signingKeySafety,
    ).toBe("NEEDS_REVIEW");
    expect(
      (
        await write("patch", `/signing-keys/${keyId}/notes`, adminCookie).send({
          notes: "Reviewed CASE-74",
        })
      ).body.notes,
    ).toBe("Reviewed CASE-74");
    const events = await explorer(adminCookie, {
      targetType: "SigningKey",
      targetId: keyId,
    });
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(4);
    expect(events.body.items[0]).toMatchObject({
      actorId: adminId,
      eventType: "SIGNING_KEY_NOTES_UPDATED",
      afterState: { notes: "Reviewed CASE-74" },
    });
    const auditObservation = await explorer(adminCookie, {
      targetType: "OperationalRecord",
      targetId: observed.body.id,
      eventType: "LICENSE_ISSUANCE_OBSERVED",
    });
    expect(auditObservation.body.items[0].afterState.signingKeyId).toBe(keyId);
    await expect(
      db.pool.query(
        "UPDATE owner.operational_records SET signing_key_id=NULL WHERE id=$1",
        [observed.body.id],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.pool.query("DELETE FROM owner.signing_keys WHERE id=$1", [keyId]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(
        "INSERT INTO owner.signing_keys(id,label,created_by,updated_by) VALUES('invalid id','Bad',$1,$1)",
        [adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const replacement = await write(
      "post",
      "/operational-records/server-replacements",
      adminCookie,
    ).send({
      customerId: made.body.id,
      oldInstallationReference: uniq("OLD74"),
      replacementInstallationReference: uniq("NEW74"),
      emergencyOldServerLost: false,
      reason: "Authorized",
    });
    await expect(
      db.pool.query(
        "UPDATE owner.operational_records SET signing_key_id=$2 WHERE id=$1",
        [replacement.body.id, keyId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Direct inserts test the FK independently of API existence validation.
    await expect(
      db.transaction(async (tx) => {
        const recordId = ulid();
        await tx.query(
          `INSERT INTO owner.operational_records(id,customer_id,kind,observed_status,observation_category,installation_reference,signing_key_id,created_by,updated_by)
      VALUES($1,$2,'LICENSE','ISSUED','EXTERNAL_ISSUANCE_OBSERVED',$3,'missing',$4,$4)`,
          [recordId, made.body.id, uniq("FK74"), adminId],
        );
        await insertTransition(
          tx,
          recordId,
          adminId,
          "UNRECORDED",
          "ISSUED",
          "FK probe",
        );
      }),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool
      .query(`CREATE FUNCTION owner.test_fail_key_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit fault'; END $$;
    CREATE TRIGGER test_key_audit BEFORE INSERT ON owner.audit_events FOR EACH ROW EXECUTE FUNCTION owner.test_fail_key_audit()`);
    try {
      expect(
        (
          await write(
            "post",
            `/signing-keys/${keyId}/status`,
            adminCookie,
          ).send({ status: "ACTIVE", reason: "Must roll back" })
        ).status,
      ).toBe(500);
      expect(
        (
          await write(
            "patch",
            `/signing-keys/${keyId}/notes`,
            adminCookie,
          ).send({ notes: "Must roll back" })
        ).status,
      ).toBe(500);
      expect(
        (
          await write("post", "/signing-keys", adminCookie).send({
            id: "rollback74",
            label: "Must roll back",
          })
        ).status,
      ).toBe(500);
    } finally {
      await db.pool.query(
        "DROP TRIGGER test_key_audit ON owner.audit_events; DROP FUNCTION owner.test_fail_key_audit()",
      );
    }
    expect((await get(`/signing-keys/${keyId}`)).body).toMatchObject({
      status: "REVOKED",
      notes: "Reviewed CASE-74",
    });
    expect((await get("/signing-keys/rollback74")).status).toBe(404);
  });

  it("enforces OQ-77 3-year retention boundaries, unresolved security-incident holds, independent durable archive persistence, rollback safety, crash retry reconciliation, tamper detection, and DB restore recovery", async () => {
    const asOf = "2026-10-17T12:00:00.000Z";
    const youngerEventId = await insertAudit({
      actor: adminId,
      type: "CUSTOMER_UPDATED",
      targetType: "Customer",
      targetId: ulid(),
      occurredAt: "2023-10-17T12:00:00.001Z",
      before: { displayName: "before", password_hash: "$argon2id$secret" },
      after: { displayName: "after", token_hash: "a".repeat(64) },
    });
    const exactBoundaryEventId = await insertAudit({
      actor: adminId,
      type: "CUSTOMER_CREATED",
      targetType: "Customer",
      targetId: ulid(),
      occurredAt: "2023-10-17T12:00:00.000Z",
    });
    const pastFloorIncidentId = await insertAudit({
      actor: adminId,
      type: "AUTH_LOGIN_FAILED",
      targetType: "User",
      targetId: adminId,
      occurredAt: "2021-01-15T08:30:00.000Z",
      outcome: "DENIED",
    });

    // Verify SQL trigger rejects inconsistent incident metadata on insert
    await expect(
      db.pool.query(
        `INSERT INTO owner.audit_events(id, actor_id, event_type, target_type, target_id, occurred_at, outcome, security_incident, incident_status)
         VALUES($1, $2, 'AUTH_LOGIN_FAILED', 'User', $2, NOW(), 'DENIED', false, 'NONE')`,
        [ulid(), adminId],
      ),
    ).rejects.toThrow(/must have security_incident = true/);
    await expect(
      db.pool.query(
        `INSERT INTO owner.audit_events(id, actor_id, event_type, target_type, target_id, occurred_at, outcome, security_incident, incident_status)
         VALUES($1, $2, 'AUTH_LOGIN_FAILED', 'User', $2, NOW(), 'DENIED', true, 'RESOLVED')`,
        [ulid(), adminId],
      ),
    ).rejects.toThrow(/unresolved security incidents are protected/);

    // 1. Verify an app instance without OWNER_AUDIT_ARCHIVE_DIR fails closed (503 ArchiveStorageUnavailable)
    const appWithoutStore = await createApp(db, {
      databaseUrl: url!,
      origin,
      production: false,
      port: 3001,
    });
    const unconfStatus = await request(appWithoutStore)
      .get("/api/v1/audit-archive/status")
      .set("Cookie", adminCookie);
    expect(unconfStatus.status).toBe(200);
    expect(unconfStatus.body.integrity.durableStoreConfigured).toBe(false);
    expect(unconfStatus.body.integrity.verified).toBe(false);
    expect(unconfStatus.body.integrity.issueCode).toBe(
      "ArchiveStorageUnavailable",
    );
    for (const unconfRes of [
      await request(appWithoutStore)
        .post("/api/v1/audit-archive/batches")
        .set("Origin", origin)
        .set("x-owner-request", "1")
        .set("Cookie", adminCookie)
        .send({ reason: "No durable store configured" }),
      await request(appWithoutStore)
        .post("/api/v1/audit-archive/verify")
        .set("Origin", origin)
        .set("x-owner-request", "1")
        .set("Cookie", adminCookie)
        .send({ reason: "No durable store configured" }),
      await request(appWithoutStore)
        .post("/api/v1/audit-archive/recover")
        .set("Origin", origin)
        .set("x-owner-request", "1")
        .set("Cookie", adminCookie)
        .send({ reason: "No durable store configured" }),
    ]) {
      expect(unconfRes.status).toBe(503);
      expect(unconfRes.body.code).toBe("ArchiveStorageUnavailable");
    }

    // 2. Verify unauthenticated and must_change_password callers are denied archive access
    expect(
      (await request(app).get("/api/v1/audit-archive/status")).status,
    ).toBe(401);
    const pendingUser = ulid();
    const pendingPw = "Disposable_pending_47";
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'OWNER_ADMIN',true)",
      [pendingUser, pendingUser, await hashPassword(pendingPw)],
    );
    const pendingSession = await login(pendingUser, pendingPw);
    expect(
      (
        await request(app)
          .get("/api/v1/audit-archive/status")
          .set("Cookie", pendingSession.cookie)
      ).status,
    ).toBe(403);

    // 3. Verify LICENSE_OPERATOR is denied all 6 archive-management routes and generates AUDIT_ARCHIVE_ACCESS_DENIED security incidents
    const opUser = ulid();
    const opPw = "Disposable_operator_47";
    await db.pool.query(
      "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'LICENSE_OPERATOR',false)",
      [opUser, opUser, await hashPassword(opPw)],
    );
    const opSession = await login(opUser, opPw);
    for (const deniedRes of [
      await request(app)
        .get("/api/v1/audit-archive/status")
        .set("Cookie", opSession.cookie),
      await request(app)
        .get("/api/v1/audit-archive/batches")
        .set("Cookie", opSession.cookie),
      await request(app)
        .get(`/api/v1/audit-archive/batches/${ulid()}`)
        .set("Cookie", opSession.cookie),
      await write("post", "/audit-archive/batches", opSession.cookie).send({
        reason: "Operator must not archive",
      }),
      await write("post", "/audit-archive/verify", opSession.cookie).send({
        reason: "Operator must not verify archive",
      }),
      await write("post", "/audit-archive/recover", opSession.cookie).send({
        reason: "Operator must not recover archive",
      }),
    ]) {
      expect(deniedRes.status).toBe(403);
      expect(deniedRes.body.code).toBe("PermissionDenied");
    }

    const deniedArchiveAudits = await explorer(adminCookie, {
      actorId: opUser,
      eventType: "AUDIT_ARCHIVE_ACCESS_DENIED",
    });
    expect(deniedArchiveAudits.status).toBe(200);
    expect(deniedArchiveAudits.body.items).toHaveLength(6);
    for (const item of deniedArchiveAudits.body.items) {
      expect(item.securityIncident).toBe(true);
      expect(item.incidentStatus).toBe("UNRESOLVED");
      expect(item.outcome).toBe("DENIED");
    }

    const store = new FilesystemAuditArchiveStore(testArchiveDir);
    const adminRow = (
      await db.pool.query<{
        id: string;
        role: string;
        is_active: boolean;
        must_change_password: boolean;
      }>(
        "SELECT id, role, is_active, must_change_password FROM owner.users WHERE id = $1",
        [adminId],
      )
    ).rows[0]!;

    // 4. Verify archive failure after disk write rolls back both DB transaction and disk store cleanly
    const countBeforeFailedArchive = Number(
      (
        await db.pool.query<{ c: string }>(
          "SELECT COUNT(*)::text AS c FROM owner.audit_events",
        )
      ).rows[0]!.c,
    );
    await expect(
      db.transaction((tx) =>
        createAuditArchiveBatch(
          tx,
          adminRow,
          { reason: "Simulated archive failure", maxEvents: 10 },
          {
            store,
            afterInsertHook: () => {
              throw new Error("Simulated archive storage failure");
            },
          },
        ),
      ),
    ).rejects.toThrow("Simulated archive storage failure");

    expect(
      (await db.pool.query("SELECT 1 FROM owner_audit_archive.archive_batches"))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT 1 FROM owner_audit_archive.archived_audit_events",
        )
      ).rowCount,
    ).toBe(0);
    expect((await store.verifyStore()).manifest.batches).toHaveLength(0);
    expect(
      Number(
        (
          await db.pool.query<{ c: string }>(
            "SELECT COUNT(*)::text AS c FROM owner.audit_events",
          )
        ).rows[0]!.c,
      ),
    ).toBe(countBeforeFailedArchive);

    // 5. Simulate hard crash between durable disk commit and PostgreSQL transaction commit:
    //    - durable store has Batch #1, PostgreSQL has 0 batches
    //    - events are NOT marked archived in GET /api/v1/audit-events or status
    //    - retry of POST /api/v1/audit-archive/batches reconciles Batch #1 without duplicating on disk
    await expect(
      db.transaction((tx) =>
        createAuditArchiveBatch(
          tx,
          adminRow,
          { reason: "Crash between disk commit and DB commit", maxEvents: 15 },
          {
            store,
            skipDiskRollbackOnError: true,
            afterInsertHook: () => {
              throw new Error("Simulated DB crash after durable disk commit");
            },
          },
        ),
      ),
    ).rejects.toThrow("Simulated DB crash after durable disk commit");

    const diskAfterCrash = await store.verifyStore();
    expect(diskAfterCrash.manifest.batches).toHaveLength(1);
    const crashedBatchId = diskAfterCrash.manifest.batches[0]!.id;
    expect(
      (await db.pool.query("SELECT 1 FROM owner_audit_archive.archive_batches"))
        .rowCount,
    ).toBe(0);

    const statusDuringCrash = await request(app)
      .get("/api/v1/audit-archive/status")
      .query({ asOf })
      .set("Cookie", adminCookie);
    expect(statusDuringCrash.status).toBe(200);
    expect(statusDuringCrash.body.counts.archivedEventCount).toBe(0);
    expect(statusDuringCrash.body.counts.archiveBatchCount).toBe(0);
    expect(statusDuringCrash.body.counts.durableStoreBatchCount).toBe(1);
    expect(statusDuringCrash.body.counts.durableStoreEventCount).toBe(15);
    expect(statusDuringCrash.body.integrity.verified).toBe(false);
    expect(statusDuringCrash.body.integrity.recoveryRequired).toBe(true);

    // Audit explorer does NOT report any event as archived while DB ledger is uncommitted
    const explorerDuringCrash = await explorer(adminCookie, {});
    expect(
      explorerDuringCrash.body.items.every(
        (item: { archived: boolean }) => item.archived === false,
      ),
    ).toBe(true);

    // Retry via POST /api/v1/audit-archive/batches reconciles Batch #1 and archives remaining events
    const createdBatches: string[] = [crashedBatchId];
    while (true) {
      const batchRes = await write(
        "post",
        "/audit-archive/batches",
        adminCookie,
      ).send({
        reason: "OQ-77 separate archive batch capture",
        maxEvents: 500,
      });
      if (batchRes.body.status === "NO_ELIGIBLE_EVENTS") {
        expect(batchRes.status).toBe(200);
        expect(batchRes.body.archivedCount).toBe(0);
        expect(batchRes.body.batch).toBeNull();
        break;
      }
      expect(batchRes.status).toBe(201);
      expect(batchRes.body.status).toBe("ARCHIVED");
      expect(batchRes.body.batch.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      if (!createdBatches.includes(batchRes.body.batch.id)) {
        createdBatches.push(batchRes.body.batch.id);
      }
    }
    expect(createdBatches.length).toBeGreaterThanOrEqual(2);

    // Verify on-disk durable store matches createdBatches 1-to-1 with 0o444 permissions
    const verifiedDisk = await store.verifyStore();
    expect(verifiedDisk.manifest.batches.map((b) => b.id)).toEqual(
      createdBatches,
    );
    for (const entry of verifiedDisk.manifest.batches) {
      const fStat = await stat(
        path.join(testArchiveDir, "batches", entry.fileName),
      );
      expect(fStat.mode & 0o777).toBe(0o444);
    }

    // Immediate retry produces no duplicate archive state and no recursive AUDIT_ARCHIVE_BATCH_CREATED event
    const batchCreatedEventsBeforeRetry = (
      await db.pool.query(
        "SELECT id FROM owner.audit_events WHERE event_type = 'AUDIT_ARCHIVE_BATCH_CREATED'",
      )
    ).rowCount;
    const retryRes = await write(
      "post",
      "/audit-archive/batches",
      adminCookie,
    ).send({
      reason: "Idempotent retry after archiving",
    });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body).toEqual({
      status: "NO_ELIGIBLE_EVENTS",
      archivedCount: 0,
      batch: null,
    });
    expect(
      (
        await db.pool.query(
          "SELECT id FROM owner.audit_events WHERE event_type = 'AUDIT_ARCHIVE_BATCH_CREATED'",
        )
      ).rowCount,
    ).toBe(batchCreatedEventsBeforeRetry);

    // 6. Verify status report at exact boundary timestamp asOf = 2026-10-17T12:00:00.000Z
    const statusRes = await request(app)
      .get("/api/v1/audit-archive/status")
      .query({ asOf })
      .set("Cookie", adminCookie);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.asOf).toBe(asOf);
    expect(statusRes.body.policy.appendOnly).toBe(true);
    expect(statusRes.body.policy.minimumRetentionYears).toBe(3);
    expect(statusRes.body.policy.threeYearMinimumIsPurgeDate).toBe(false);
    expect(
      statusRes.body.policy.unresolvedSecurityIncidentsExcludedFromCleanup,
    ).toBe(true);
    expect(statusRes.body.policy.permanentSeparateArchiveInForce).toBe(true);
    expect(statusRes.body.policy.archiveStorageBoundary).toBe(
      "INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER",
    );
    expect(statusRes.body.counts.cleanupEligibleEventCount).toBe(0);
    expect(statusRes.body.counts.unarchivedEligibleEventCount).toBe(0);
    expect(statusRes.body.counts.durableStoreBatchCount).toBe(
      createdBatches.length,
    );
    expect(statusRes.body.counts.archiveBatchCount).toBe(createdBatches.length);
    expect(
      statusRes.body.counts.pastFloorUnresolvedIncidentHoldCount,
    ).toBeGreaterThanOrEqual(1);
    expect(statusRes.body.integrity.verified).toBe(true);
    expect(statusRes.body.integrity.durableStoreConfigured).toBe(true);
    expect(statusRes.body.integrity.durableStoreVerified).toBe(true);
    expect(statusRes.body.integrity.dbLedgerVerified).toBe(true);
    expect(statusRes.body.integrity.crossStoreConsistent).toBe(true);
    expect(statusRes.body.integrity.recoveryRequired).toBe(false);

    // Inspect durable batch bundle via GET /api/v1/audit-archive/batches/:id
    const firstBatchId = createdBatches[0]!;
    const bundleRes = await request(app)
      .get(`/api/v1/audit-archive/batches/${firstBatchId}`)
      .set("Cookie", adminCookie);
    expect(bundleRes.status).toBe(200);
    expect(verifyExportedArchiveBundle(bundleRes.body).verified).toBe(true);
    expect(bundleRes.body.durableStorage).toMatchObject({
      persisted: true,
      verified: true,
      presentInDbLedger: true,
    });
    const bundleJson = JSON.stringify(bundleRes.body);
    expect(bundleJson).not.toContain("password_hash");
    expect(bundleJson).not.toContain("token_hash");
    expect(bundleJson).not.toContain("$argon2id");

    // 7. Verify tamper detection on durable batch file
    const firstFileName = verifiedDisk.manifest.batches[0]!.fileName;
    const firstFilePath = path.join(testArchiveDir, "batches", firstFileName);
    const untamperedContent = await readFile(firstFilePath, "utf8");
    await chmod(firstFilePath, 0o600);
    await writeFile(
      firstFilePath,
      untamperedContent.replace(
        `"batchNumber":1`,
        `"batchNumber":1,"reason":"tampered"`,
      ),
      "utf8",
    );
    const tamperedVerifyRes = await write(
      "post",
      "/audit-archive/verify",
      adminCookie,
    ).send({
      reason: "Detect tampered durable batch file",
    });
    expect(tamperedVerifyRes.status).toBe(409);
    expect(tamperedVerifyRes.body.code).toBe("ArchiveIntegrityViolation");

    const tamperedStatusRes = await request(app)
      .get("/api/v1/audit-archive/status")
      .set("Cookie", adminCookie);
    expect(tamperedStatusRes.status).toBe(200);
    expect(tamperedStatusRes.body.integrity.verified).toBe(false);
    expect(tamperedStatusRes.body.integrity.durableStoreVerified).toBe(false);
    expect(tamperedStatusRes.body.counts.archivedEventCount).toBe(0);

    // Restore untampered file on disk
    await writeFile(firstFilePath, untamperedContent, "utf8");
    await chmod(firstFilePath, 0o444);

    // Verify explicit integrity check endpoint records AUDIT_ARCHIVE_VERIFIED
    const verifyRes = await write(
      "post",
      "/audit-archive/verify",
      adminCookie,
    ).send({
      reason: "Scheduled OQ-77 archive integrity verification",
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);

    // 8. Verify independent durable archive survival and recovery after PostgreSQL
    //    archive ledger loss AND source audit_events rollback (simulating DB restore from older backup)
    const migration004Sql = await readFile(
      `${migrationsFolder}/004-audit-retention-archive.sql`,
      "utf8",
    );
    await db.transaction(async (tx) => {
      await tx.query("DROP SCHEMA owner_audit_archive CASCADE");
      // Simulate PostgreSQL backup restore that lost the 3 fixture source events from owner.audit_events
      await tx.query(
        "ALTER TABLE owner.audit_events DISABLE TRIGGER retain_audit",
      );
      await tx.query(
        "DELETE FROM owner.audit_events WHERE id = ANY($1::char(26)[])",
        [[youngerEventId, exactBoundaryEventId, pastFloorIncidentId]],
      );
      await tx.query(
        "ALTER TABLE owner.audit_events ENABLE TRIGGER retain_audit",
      );
      await tx.query(migration004Sql);
    });

    // While DB ledger is empty and 3 source events are missing from PostgreSQL:
    // - GET /api/v1/audit-archive/batches/:id still serves the verified bundle from the independent durable store!
    const bundleDuringDbLoss = await request(app)
      .get(`/api/v1/audit-archive/batches/${firstBatchId}`)
      .set("Cookie", adminCookie);
    expect(bundleDuringDbLoss.status).toBe(200);
    expect(bundleDuringDbLoss.body.durableStorage).toMatchObject({
      persisted: true,
      verified: true,
      presentInDbLedger: false,
    });

    const statusBeforeRecovery = await request(app)
      .get("/api/v1/audit-archive/status")
      .set("Cookie", adminCookie);
    expect(statusBeforeRecovery.status).toBe(200);
    expect(statusBeforeRecovery.body.counts.archiveBatchCount).toBe(0);
    expect(statusBeforeRecovery.body.counts.durableStoreBatchCount).toBe(
      createdBatches.length,
    );
    expect(statusBeforeRecovery.body.integrity.verified).toBe(false);
    expect(statusBeforeRecovery.body.integrity.recoveryRequired).toBe(true);

    // 8a. Conflicting source event detection during recovery:
    //     If an existing source row at an archived id/sequence has divergent content,
    //     POST /api/v1/audit-archive/recover rejects with 409 ArchiveIntegrityViolation and rolls back
    await db.transaction(async (tx) => {
      await tx.query(
        "ALTER TABLE owner.audit_events DISABLE TRIGGER retain_audit",
      );
      await tx.query(
        `INSERT INTO owner.audit_events (
           id, actor_id, event_type, target_type, target_id,
           occurred_at, outcome, reason, before_state, after_state
         )
         VALUES (
           $1, $2, 'CUSTOMER_CREATED', 'Customer', '01ARZ3NDEKTSV4RRFFQ69G5FAA',
           '2025-10-17T12:00:00.001Z'::timestamptz, 'SUCCESS',
           'CONFLICTING_DIVERGENT_RESTORE_EVENT', NULL, '{"customerCode":"CUST-CONFLICT"}'::jsonb
         )`,
        [youngerEventId, adminId],
      );
      await tx.query(
        "ALTER TABLE owner.audit_events ENABLE TRIGGER retain_audit",
      );
    });

    const conflictingRecoverRes = await write(
      "post",
      "/audit-archive/recover",
      adminCookie,
    ).send({
      reason: "Attempt recovery while conflicting source event exists",
    });
    expect(conflictingRecoverRes.status).toBe(409);
    expect(conflictingRecoverRes.body.code).toBe("ArchiveIntegrityViolation");

    // Clean up the injected conflicting row and also rewind the audit_events identity sequence to 1
    // to verify that recovery synchronizes the sequence before emitting new audit events
    await db.transaction(async (tx) => {
      await tx.query(
        "ALTER TABLE owner.audit_events DISABLE TRIGGER retain_audit",
      );
      await tx.query("DELETE FROM owner.audit_events WHERE id = $1", [
        youngerEventId,
      ]);
      await tx.query(
        "ALTER TABLE owner.audit_events ENABLE TRIGGER retain_audit",
      );
      await tx.query(
        "SELECT setval(pg_get_serial_sequence('owner.audit_events', 'sequence'), 1, true)",
      );
    });

    // Execute POST /api/v1/audit-archive/recover to restore missing source events and DB archive ledger from the independent durable store
    const recoverRes = await write(
      "post",
      "/audit-archive/recover",
      adminCookie,
    ).send({
      reason:
        "Restore missing source audit events and archive ledger from independent durable store after DB restore",
    });
    expect(recoverRes.status).toBe(200);
    expect(recoverRes.body).toMatchObject({
      verified: true,
      recoveredBatchCount: createdBatches.length,
      recoveredSourceEventCount: 3,
      rehydratedDurableBatchCount: 0,
      batchCount: createdBatches.length,
    });
    expect(recoverRes.body.recoveredLedgerEventCount).toBeGreaterThanOrEqual(
      15,
    );

    // Verify sequence synchronization allows subsequent normal audit writes without collision
    const postRecoverCustomerRes = await write(
      "post",
      "/customers",
      adminCookie,
    ).send({
      customerCode: "CUST-POST-RECOVER",
      displayName: "Post Recover Verification Clinic",
      status: "ACTIVE",
      contractReference: "REF-POST-RECOVER",
    });
    expect(postRecoverCustomerRes.status).toBe(201);

    const statusAfterRecovery = await request(app)
      .get("/api/v1/audit-archive/status")
      .query({ asOf })
      .set("Cookie", adminCookie);
    expect(statusAfterRecovery.status).toBe(200);
    expect(statusAfterRecovery.body.integrity.verified).toBe(true);
    expect(statusAfterRecovery.body.integrity.crossStoreConsistent).toBe(true);
    expect(statusAfterRecovery.body.integrity.recoveryRequired).toBe(false);

    // Verify younger, exact-boundary, and past-floor incident events were restored into owner.audit_events with exact retention metadata
    const checkRow = await db.pool.query<{
      id: string;
      minimum_retained_until: Date;
      security_incident: boolean;
      incident_status: string;
    }>(
      "SELECT id, minimum_retained_until, security_incident, incident_status FROM owner.audit_events WHERE id = ANY($1::char(26)[])",
      [[youngerEventId, exactBoundaryEventId, pastFloorIncidentId]],
    );
    const byId = new Map(checkRow.rows.map((r) => [r.id, r]));
    expect(byId.get(youngerEventId)?.minimum_retained_until.toISOString()).toBe(
      "2026-10-17T12:00:00.001Z",
    );
    expect(
      byId.get(exactBoundaryEventId)?.minimum_retained_until.toISOString(),
    ).toBe("2026-10-17T12:00:00.000Z");
    expect(
      byId.get(pastFloorIncidentId)?.minimum_retained_until.toISOString(),
    ).toBe("2024-01-15T08:30:00.000Z");
    expect(byId.get(pastFloorIncidentId)?.security_incident).toBe(true);
    expect(byId.get(pastFloorIncidentId)?.incident_status).toBe("UNRESOLVED");

    // Verify owner_audit_archive tables are strictly append-only and reject UPDATE, DELETE, and mismatched source inserts
    await expect(
      db.pool.query("DELETE FROM owner_audit_archive.archived_audit_events"),
    ).rejects.toThrow(/owner_audit_archive is append-only/);
    await expect(
      db.pool.query(
        "UPDATE owner_audit_archive.archived_audit_events SET reason = 'tampered'",
      ),
    ).rejects.toThrow(/owner_audit_archive is append-only/);
    await expect(
      db.pool.query("DELETE FROM owner_audit_archive.archive_batches"),
    ).rejects.toThrow(/owner_audit_archive is append-only/);
    await expect(
      db.pool.query(
        "UPDATE owner_audit_archive.archive_batches SET reason = 'tampered'",
      ),
    ).rejects.toThrow(/owner_audit_archive is append-only/);
  });
});
