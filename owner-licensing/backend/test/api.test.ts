// CI-only. Requires an explicit disposable Owner PostgreSQL database; never skips.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import type { Express } from "express";
import { Database } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { bootstrap } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";

const url = process.env.OWNER_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "OWNER_TEST_DATABASE_URL is required; run this suite only in CI.",
  );
const db = new Database(url);
let app: Express, adminCookie: string, adminId: string;
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
async function customer(cookie = adminCookie, code = `C-${ulid()}`) {
  return write("post", "/customers", cookie).send({
    customerCode: code,
    displayName: "مشتری آزمایشی",
  });
}

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

beforeAll(async () => {
  await migrate(db);
  await migrate(db); // idempotent checksummed fresh deployment
  expect(await bootstrap(db, "owner", initial)).toBe(true);
  expect(await bootstrap(db, "owner", "Another_initial_44")).toBe(false);
  app = await createApp(db, {
    databaseUrl: url!,
    origin,
    production: false,
    port: 3001,
  });
}, 30000);
afterAll(async () => {
  await db.close();
});

describe("Owner PostgreSQL HTTP vertical slice", () => {
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
  it.each(["READ_ONLY_OBSERVER", "LICENSE_ISSUANCE", "SUPPORT_SPECIALIST"])(
    "enforces %s on direct API requests",
    async (role) => {
      const uid = ulid(),
        pw = "Disposable_role_45";
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)",
        [uid, uid, await hashPassword(pw), role],
      );
      const { cookie } = await login(uid, pw);
      expect((await customer(cookie)).status).toBe(403);
      const code = `Support-${ulid()}`;
      const created = await write("post", "/customers", adminCookie).send({
        customerCode: code,
        displayName: "Support-safe name",
        contractReference: "CONFIDENTIAL-CONTRACT-REFERENCE",
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
      expect(effective.body.permissions).toEqual(
        role === "SUPPORT_SPECIALIST"
          ? ["customers.view"]
          : role === "READ_ONLY_OBSERVER"
            ? ["customers.view", "audit.view", "operations.view"]
            : [
                "customers.view",
                "audit.view",
                "operations.view",
                "operations.record",
              ],
      );
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
        if (role === "SUPPORT_SPECIALIST") {
          expect(Object.keys(record).sort()).toEqual(
            ["id", "customerCode", "displayName", "status"].sort(),
          );
          expect(JSON.stringify(record)).not.toContain(
            "CONFIDENTIAL-CONTRACT-REFERENCE",
          );
        } else
          expect(record.contractReference).toBe(
            "CONFIDENTIAL-CONTRACT-REFERENCE",
          );
      }
      if (role === "SUPPORT_SPECIALIST") {
        const byContract = await request(app)
          .get("/api/v1/customers")
          .query({ search: "CONFIDENTIAL-CONTRACT-REFERENCE" })
          .set("Cookie", cookie);
        expect(byContract.status).toBe(200);
        expect(byContract.body.items).toEqual([]);
      }
      expect(
        (await request(app).get("/api/v1/audit-events").set("Cookie", cookie))
          .status,
      ).toBe(role === "SUPPORT_SPECIALIST" ? 403 : 200);
      await expectUnavailableOperations(cookie);
      expect(
        (await request(app).get("/api/v1/users").set("Cookie", cookie)).status,
      ).toBe(403);
      expect(
        (
          await write("post", "/users", cookie).send({
            username: "attack",
            password: pw,
            role: "SYSTEM_ADMIN",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await write("patch", `/users/${adminId}`, cookie).send({
            role: "SUPPORT_SPECIALIST",
            reason: "attack",
          })
        ).status,
      ).toBe(403);
      expect(
        (await write("delete", "/audit-events", cookie).send({})).status,
      ).toBe(404);
      expect(
        (await write("post", "/auth/logout", cookie).send({})).status,
      ).toBe(204);
      expect(
        (await request(app).get("/api/v1/auth/me").set("Cookie", cookie))
          .status,
      ).toBe(401);
    },
  );
  it("keeps audit/lifecycle mutations unavailable even to Administrators", async () => {
    await expectUnavailableOperations(adminCookie);
  });
  it("administers roles, disables and resets with session invalidation and safe audit output", async () => {
    const created = await write("post", "/users", adminCookie).send({
      username: "managed",
      password: initial,
      role: "READ_ONLY_OBSERVER",
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
          role: "SUPPORT_SPECIALIST",
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
    ).toEqual(["001-foundation.sql", "002-manual-operations.sql"]);
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
  it("authorizes manual operations for all four roles on the direct API", async () => {
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
    for (const role of [
      "SYSTEM_ADMIN",
      "LICENSE_ISSUANCE",
      "READ_ONLY_OBSERVER",
      "SUPPORT_SPECIALIST",
    ] as const) {
      const uid = ulid();
      const pw = "Disposable_role_45";
      await db.pool.query(
        "INSERT INTO owner.users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)",
        [uid, uid, await hashPassword(pw), role],
      );
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
      if (role === "SUPPORT_SPECIALIST") {
        expect(list.status).toBe(403);
        expect(detail.status).toBe(403);
        expect(mutation.status).toBe(403);
        expect(JSON.stringify(list.body)).not.toContain(installation);
        expect(JSON.stringify(detail.body)).not.toContain("CASE");
      } else if (role === "READ_ONLY_OBSERVER") {
        expect(list.status).toBe(200);
        expect(detail.status).toBe(200);
        expect(detail.body.customerCode).toBe(created.body.customerCode);
        expect(detail.body).not.toHaveProperty("contractReference");
        expect(mutation.status).toBe(403);
        expect(mutation.body.code).toBe("PermissionDenied");
      } else {
        expect(list.status).toBe(200);
        expect(detail.status).toBe(200);
        expect(mutation.status).toBe(201);
        expect(mutation.body.signedArtifactProduced).toBe(false);
      }
      if (role !== "SYSTEM_ADMIN" && role !== "LICENSE_ISSUANCE") {
        const denied = await db.pool.query(
          "SELECT outcome, reason FROM owner.audit_events WHERE actor_id=$1 AND event_type='OPERATION_MUTATION_DENIED'",
          [uid],
        );
        expect(denied.rowCount).toBe(1);
        expect(denied.rows[0].outcome).toBe("DENIED");
        expect(JSON.stringify(denied.rows[0])).not.toContain("direct mutation");
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
      "operations.view",
      "operations.record",
    ]);
  });
});
