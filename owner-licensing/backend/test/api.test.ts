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
      const cid = (await customer()).body.id;
      expect(
        (
          await write("patch", `/customers/${cid}`, cookie).send({
            displayName: "attack",
            reason: "test",
          })
        ).status,
      ).toBe(403);
      expect(
        (await request(app).get("/api/v1/customers").set("Cookie", cookie))
          .status,
      ).toBe(role === "READ_ONLY_OBSERVER" ? 200 : 403);
      expect(
        (await request(app).get("/api/v1/audit-events").set("Cookie", cookie))
          .status,
      ).toBe(role === "READ_ONLY_OBSERVER" ? 200 : 403);
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
    ).toEqual(["001-foundation.sql"]);
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
});
