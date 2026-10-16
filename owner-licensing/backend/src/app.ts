import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import type { PoolClient } from "pg";
import type { Config } from "./config.js";
import { listAuditEvents } from "./audit.js";
import { Database, audit } from "./db.js";
import {
  ApiError,
  assertActiveAuthorizedActor,
  customerCode,
  customerResponse,
  digest,
  duplicateConstraintCode,
  fail,
  id,
  invalid,
  isRole,
  object,
  page,
  password,
  permissions,
  role,
  safeUser,
  status,
  text,
  token,
  type Permission,
  type User,
} from "./domain.js";
import {
  denyOperationMutation,
  getOperation,
  listOperations,
  recordActivationObservation,
  recordLicenseObservation,
  recordOldServerObservation,
  recordReplacementObservation,
  recordServerReplacement,
} from "./operations.js";
import {
  authenticate,
  cookieToken,
  hashPassword,
  newSession,
  verifyPassword,
  type Principal,
} from "./security.js";

export type ServiceActor = Pick<
  User,
  "id" | "role" | "is_active" | "must_change_password"
>;

export async function listUsersService(
  tx: PoolClient,
  actor: ServiceActor,
  rawPage: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  const p = page(rawPage);
  const rows = await tx.query<User>(
    "SELECT * FROM owner.users ORDER BY id LIMIT 50 OFFSET $1",
    [(p - 1) * 50],
  );
  return {
    items: rows.rows.map(safeUser),
    page: p,
    pageSize: 50,
  };
}

export async function createUserService(
  tx: PoolClient,
  actor: ServiceActor,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  const input = object(body, ["username", "password", "role"]);
  const username = text(input.username, "username", 1, 64),
    r = role(input.role);
  const hash = await hashPassword(password(input.password)),
    uid = ulid();
  const user = (
    await tx.query<User>(
      "INSERT INTO owner.users(id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
      [uid, username, hash, r],
    )
  ).rows[0]!;
  await audit(tx, {
    actor: actor.id,
    type: "USER_CREATED",
    targetType: "User",
    targetId: uid,
    after: { username, role: r, isActive: true, mustChangePassword: true },
  });
  return safeUser(user);
}

export async function updateUserAccessService(
  tx: PoolClient,
  actor: ServiceActor,
  rawTargetId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  const targetId = id(rawTargetId),
    input = object(body, ["role", "isActive", "reason"]);
  const reason = text(input.reason, "reason", 1, 500);
  const target = (
    await tx.query<User>("SELECT * FROM owner.users WHERE id=$1 FOR UPDATE", [
      targetId,
    ])
  ).rows[0];
  if (!target) fail(404, "EntityNotFound", "User not found.");
  const nextRole = role(input.role === undefined ? target.role : input.role);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean")
    invalid("isActive must be boolean.");
  const active =
    input.isActive === undefined
      ? target.is_active
      : (input.isActive as boolean);
  if (
    target.role === "OWNER_ADMIN" &&
    target.is_active &&
    (nextRole !== "OWNER_ADMIN" || !active)
  ) {
    const count = await tx.query<{ count: string }>(
      "SELECT count(*) FROM owner.users WHERE role='OWNER_ADMIN' AND is_active",
    );
    if (Number(count.rows[0]!.count) <= 1)
      fail(409, "Conflict", "Cannot remove the last active administrator.");
  }
  const updated = (
    await tx.query<User>(
      "UPDATE owner.users SET role=$1,is_active=$2,updated_at=clock_timestamp() WHERE id=$3 RETURNING *",
      [nextRole, active, targetId],
    )
  ).rows[0]!;
  await tx.query(
    "UPDATE owner.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL",
    [targetId],
  );
  await audit(tx, {
    actor: actor.id,
    type: "USER_ACCESS_CHANGED",
    targetType: "User",
    targetId,
    reason,
    before: { role: target.role, isActive: target.is_active },
    after: { role: nextRole, isActive: active },
  });
  return safeUser(updated);
}

export async function resetUserPasswordService(
  tx: PoolClient,
  actor: ServiceActor,
  rawTargetId: unknown,
  body: unknown,
) {
  assertActiveAuthorizedActor(actor, "users.manage");
  const targetId = id(rawTargetId),
    input = object(body, ["password", "reason"]);
  const reason = text(input.reason, "reason", 1, 500),
    hash = await hashPassword(password(input.password));
  await tx.query("SELECT id FROM owner.users WHERE id=$1 FOR UPDATE", [
    targetId,
  ]);
  const updated = (
    await tx.query<User>(
      "UPDATE owner.users SET password_hash=$1,must_change_password=true,updated_at=clock_timestamp() WHERE id=$2 RETURNING *",
      [hash, targetId],
    )
  ).rows[0];
  if (!updated) fail(404, "EntityNotFound", "User not found.");
  await tx.query(
    "UPDATE owner.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL",
    [targetId],
  );
  await audit(tx, {
    actor: actor.id,
    type: "PASSWORD_RESET",
    targetType: "User",
    targetId,
    reason,
    after: { mustChangePassword: true },
  });
  return safeUser(updated);
}

export async function listCustomersService(
  tx: PoolClient,
  actor: ServiceActor,
  query: Record<string, unknown>,
) {
  const actorRole = assertActiveAuthorizedActor(actor, "customers.view");
  const p = page(query.page);
  const search =
    query.search === undefined ? "" : text(query.search, "search", 0, 100);
  // Escape LIKE wildcards: this is literal substring search.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where = "customer_code ILIKE $1 OR display_name ILIKE $1";
  const total = await tx.query<{ count: string }>(
    `SELECT count(*) FROM owner.customers WHERE ${where}`,
    [pattern],
  );
  const rows = await tx.query(
    `SELECT * FROM owner.customers WHERE ${where} ORDER BY id DESC LIMIT 50 OFFSET $2`,
    [pattern, (p - 1) * 50],
  );
  return {
    items: rows.rows.map((c) => customerResponse(c, actorRole)),
    total: Number(total.rows[0]!.count),
    page: p,
    pageSize: 50,
  };
}

export async function getCustomerService(
  tx: PoolClient,
  actor: ServiceActor,
  rawTargetId: unknown,
) {
  const actorRole = assertActiveAuthorizedActor(actor, "customers.view");
  const row = (
    await tx.query("SELECT * FROM owner.customers WHERE id=$1", [
      id(rawTargetId),
    ])
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Customer not found.");
  return customerResponse(row, actorRole);
}

export async function createCustomerService(
  tx: PoolClient,
  actor: ServiceActor,
  body: unknown,
) {
  const actorRole = assertActiveAuthorizedActor(actor, "customers.write");
  const input = object(body, [
    "customerCode",
    "displayName",
    "status",
    "contractReference",
  ]);
  const uid = ulid(),
    code = customerCode(input.customerCode, uid),
    name = text(input.displayName, "displayName", 1, 200);
  const state = status(input.status ?? "ACTIVE");
  const reference =
    input.contractReference === undefined || input.contractReference === ""
      ? ""
      : text(input.contractReference, "contractReference", 1, 200);
  const c = (
    await tx.query(
      `INSERT INTO owner.customers(id,customer_code,display_name,status,contract_reference,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [uid, code, name, state, reference, actor.id],
    )
  ).rows[0];
  await audit(tx, {
    actor: actor.id,
    type: "CUSTOMER_CREATED",
    targetType: "Customer",
    targetId: uid,
    after: {
      customerCode: code,
      displayName: name,
      status: state,
      contractReference: reference,
    },
  });
  return customerResponse(c, actorRole);
}

export async function updateCustomerService(
  tx: PoolClient,
  actor: ServiceActor,
  rawTargetId: unknown,
  body: unknown,
) {
  const actorRole = assertActiveAuthorizedActor(actor, "customers.write");
  const uid = id(rawTargetId),
    input = object(body, [
      "displayName",
      "status",
      "contractReference",
      "reason",
    ]);
  const reason = text(input.reason, "reason", 1, 500);
  const c = (
    await tx.query("SELECT * FROM owner.customers WHERE id=$1 FOR UPDATE", [
      uid,
    ])
  ).rows[0];
  if (!c) fail(404, "EntityNotFound", "Customer not found.");
  const name =
    input.displayName === undefined
      ? c.display_name
      : text(input.displayName, "displayName", 1, 200);
  const state = input.status === undefined ? c.status : status(input.status);
  const reference =
    input.contractReference === undefined
      ? c.contract_reference
      : input.contractReference === ""
        ? ""
        : text(input.contractReference, "contractReference", 1, 200);
  const updated = (
    await tx.query(
      "UPDATE owner.customers SET display_name=$1,status=$2,contract_reference=$3,updated_by=$4,updated_at=clock_timestamp() WHERE id=$5 RETURNING *",
      [name, state, reference, actor.id, uid],
    )
  ).rows[0];
  await audit(tx, {
    actor: actor.id,
    type: "CUSTOMER_UPDATED",
    targetType: "Customer",
    targetId: uid,
    reason,
    before: {
      displayName: c.display_name,
      status: c.status,
      contractReference: c.contract_reference,
    },
    after: {
      displayName: name,
      status: state,
      contractReference: reference,
    },
  });
  return customerResponse(updated, actorRole);
}

export async function createApp(db: Database, cfg: Config) {
  const app = express();
  app.disable("x-powered-by");
  // No CORS; deployment is one browser origin via the Owner reverse proxy.
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.get("x-owner-request") !== "1" ||
        (req.get("origin") && req.get("origin") !== cfg.origin)
      )
        return next(
          new ApiError(403, "PermissionDenied", "Invalid request origin."),
        );
      if (!req.is("application/json"))
        return next(new ApiError(415, "ValidationFailed", "JSON is required."));
    }
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
  const router = express.Router();
  const cookieName = cfg.production ? "__Host-owner_session" : "owner_session";
  const cookieOptions = {
    httpOnly: true,
    secure: cfg.production,
    sameSite: "lax" as const,
    path: "/",
  };
  const dummyHash = await hashPassword(token());
  type Work = (
    tx: PoolClient,
    actor: Principal,
    req: Request,
    res: Response,
  ) => Promise<void>;
  const protectedRoute =
    (
      permission: Permission | undefined,
      ordinary: boolean,
      work: Work,
      usersLock = false,
    ) =>
    async (req: Request, res: Response) => {
      await db.transaction(async (tx) => {
        if (usersLock) await tx.query("SELECT pg_advisory_xact_lock(78153216)");
        const actor = await authenticate(
          tx,
          cookieToken(req, cfg.production),
          ordinary,
          permission,
        );
        // Do not send a success response before audit/mutation COMMIT.
        await work(tx, actor, req, res);
      });
    };
  // Route work stages response in locals; flush only after a successful transaction.
  const route = (
    method: "get" | "post" | "patch",
    path: string,
    permission: Permission | undefined,
    ordinary: boolean,
    work: Work,
    usersLock = false,
  ) => {
    router[method](path, async (req, res) => {
      await protectedRoute(permission, ordinary, work, usersLock)(req, res);
      if (res.locals.clearCookie) res.clearCookie(cookieName, cookieOptions);
      res.status(res.locals.status ?? 200).json(res.locals.body ?? {});
    });
  };
  router.get("/health", async (_req, res) => {
    await db.pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  router.post("/auth/login", async (req, res) => {
    const input = object(req.body, ["username", "password"]);
    const username = text(input.username, "username", 1, 64);
    const rawPassword = text(input.password, "password", 1, 128, false);
    // Shared PostgreSQL bucket per direct-peer IP, bounded in time; no trust in spoofable forwarded headers.
    const bucket = digest(req.ip ?? "unknown");
    const attempts = await db.pool.query<{ attempts: number }>(
      `INSERT INTO owner.login_limits(bucket) VALUES($1)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN owner.login_limits.reset_at<clock_timestamp() THEN 1 ELSE owner.login_limits.attempts+1 END,
      reset_at=CASE WHEN owner.login_limits.reset_at<clock_timestamp() THEN clock_timestamp()+interval '15 minutes' ELSE owner.login_limits.reset_at END RETURNING attempts`,
      [bucket],
    );
    if (attempts.rows[0]!.attempts > 10)
      fail(
        429,
        "RateLimitExceeded",
        "Too many login attempts. Try again later.",
      );
    const found = await db.pool.query<User>(
      "SELECT * FROM owner.users WHERE username=$1",
      [username],
    );
    const snapshot = found.rows[0];
    const verified = await verifyPassword(
      snapshot?.password_hash ?? dummyHash,
      rawPassword,
    );
    const rawToken = token();
    const result = await db.transaction(async (tx) => {
      const current = snapshot
        ? (
            await tx.query<User>(
              "SELECT * FROM owner.users WHERE id=$1 FOR UPDATE",
              [snapshot.id],
            )
          ).rows[0]
        : undefined;
      if (
        !verified ||
        !current?.is_active ||
        !isRole(current.role) ||
        current.password_hash !== snapshot?.password_hash
      ) {
        await audit(tx, {
          actor: current?.id ?? null,
          type: "AUTH_LOGIN_FAILED",
          targetType: "User",
          targetId: current?.id ?? null,
          outcome: "DENIED",
          reason: "Invalid credentials or disabled account",
        });
        return null;
      }
      return newSession(tx, current, digest(rawToken));
    });
    if (!result) fail(401, "Unauthorized", "Invalid username or password.");
    res.cookie(cookieName, rawToken, {
      ...cookieOptions,
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json(result);
  });
  route("get", "/auth/me", undefined, false, async (_tx, a, _req, res) => {
    res.locals.body = safeUser(a.user);
  });
  route(
    "get",
    "/permissions/effective",
    undefined,
    true,
    async (_tx, a, _req, res) => {
      res.locals.body = { permissions: permissions(a.user.role) };
    },
  );
  // Logout is idempotent, including expired/absent sessions. No client actor id is accepted.
  router.post("/auth/logout", async (req, res) => {
    object(req.body, []);
    const raw = cookieToken(req, cfg.production);
    if (raw) {
      await db.transaction(async (tx) => {
        const session = (
          await tx.query<{ id: string; user_id: string }>(
            "SELECT id,user_id FROM owner.sessions WHERE token_hash=$1",
            [digest(raw)],
          )
        ).rows[0];
        if (session) {
          await tx.query("SELECT id FROM owner.users WHERE id=$1 FOR UPDATE", [
            session.user_id,
          ]);
          const revoked = await tx.query(
            "UPDATE owner.sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL RETURNING id",
            [session.id],
          );
          if (revoked.rowCount)
            await audit(tx, {
              actor: session.user_id,
              type: "AUTH_LOGOUT",
              targetType: "User",
              targetId: session.user_id,
            });
        }
      });
    }
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
  });
  route(
    "post",
    "/auth/change-password",
    undefined,
    false,
    async (tx, a, req, res) => {
      const input = object(req.body, ["currentPassword", "newPassword"]);
      const current = text(
        input.currentPassword,
        "currentPassword",
        1,
        128,
        false,
      );
      const next = password(input.newPassword);
      if (current === next) invalid("New password must differ.");
      if (!(await verifyPassword(a.user.password_hash, current)))
        fail(401, "Unauthorized", "Invalid current password.");
      const hash = await hashPassword(next);
      await tx.query(
        "UPDATE owner.users SET password_hash=$1,must_change_password=false,updated_at=clock_timestamp() WHERE id=$2",
        [hash, a.user.id],
      );
      await tx.query(
        "UPDATE owner.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",
        [a.user.id, a.sessionId],
      );
      await audit(tx, {
        actor: a.user.id,
        type: "PASSWORD_CHANGED",
        targetType: "User",
        targetId: a.user.id,
        before: { mustChangePassword: a.user.must_change_password },
        after: { mustChangePassword: false },
      });
      res.locals.body = safeUser({ ...a.user, must_change_password: false });
    },
  );
  route(
    "get",
    "/users",
    "users.manage",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await listUsersService(tx, a.user, req.query.page);
    },
    true,
  );
  route(
    "post",
    "/users",
    "users.manage",
    true,
    async (tx, a, req, res) => {
      res.locals.status = 201;
      res.locals.body = await createUserService(tx, a.user, req.body);
    },
    true,
  );
  route(
    "patch",
    "/users/:id",
    "users.manage",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await updateUserAccessService(
        tx,
        a.user,
        req.params.id,
        req.body,
      );
    },
    true,
  );
  route(
    "post",
    "/users/:id/reset-password",
    "users.manage",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await resetUserPasswordService(
        tx,
        a.user,
        req.params.id,
        req.body,
      );
    },
    true,
  );
  route(
    "get",
    "/customers",
    "customers.view",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await listCustomersService(
        tx,
        a.user,
        req.query as Record<string, unknown>,
      );
    },
  );
  route(
    "get",
    "/customers/:id",
    "customers.view",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await getCustomerService(tx, a.user, req.params.id);
    },
  );
  route(
    "post",
    "/customers",
    "customers.write",
    true,
    async (tx, a, req, res) => {
      res.locals.status = 201;
      res.locals.body = await createCustomerService(tx, a.user, req.body);
    },
  );
  route(
    "patch",
    "/customers/:id",
    "customers.write",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await updateCustomerService(
        tx,
        a.user,
        req.params.id,
        req.body,
      );
    },
  );
  const pathTarget = (value: unknown) =>
    typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
      ? value
      : null;
  const recorded = async (
    tx: PoolClient,
    actor: Principal,
    res: Response,
    targetId: string | null,
    requiredPermission:
      "operations.record" | "replacements.authorize" = "operations.record",
  ) => {
    if (permissions(actor.user.role).includes(requiredPermission)) return true;
    await denyOperationMutation(
      tx,
      actor.user.id,
      targetId,
      requiredPermission,
    );
    res.locals.status = 403;
    res.locals.body = {
      code: "PermissionDenied",
      message: "You do not have permission.",
      correlationId: randomUUID(),
    };
    return false;
  };
  route(
    "get",
    "/operational-records",
    "operations.view",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await listOperations(
        tx,
        a.user.role,
        req.query as Record<string, unknown>,
      );
    },
  );
  route(
    "get",
    "/operational-records/:id",
    "operations.view",
    true,
    async (tx, a, req, res) => {
      res.locals.body = await getOperation(tx, a.user.role, req.params.id);
    },
  );
  route(
    "post",
    "/operational-records/license-observations",
    undefined,
    true,
    async (tx, a, req, res) => {
      if (!(await recorded(tx, a, res, null))) return;
      res.locals.status = 201;
      res.locals.body = await recordLicenseObservation(
        tx,
        a.user.id,
        a.user.role,
        req.body,
      );
    },
  );
  route(
    "post",
    "/operational-records/:id/activation-observations",
    undefined,
    true,
    async (tx, a, req, res) => {
      if (!(await recorded(tx, a, res, pathTarget(req.params.id)))) return;
      res.locals.body = await recordActivationObservation(
        tx,
        a.user.id,
        a.user.role,
        req.params.id,
        req.body,
      );
    },
  );
  route(
    "post",
    "/operational-records/server-replacements",
    undefined,
    true,
    async (tx, a, req, res) => {
      if (!(await recorded(tx, a, res, null, "replacements.authorize"))) return;
      res.locals.status = 201;
      res.locals.body = await recordServerReplacement(
        tx,
        a.user.id,
        a.user.role,
        req.body,
      );
    },
  );
  route(
    "post",
    "/operational-records/:id/old-server-observations",
    undefined,
    true,
    async (tx, a, req, res) => {
      if (!(await recorded(tx, a, res, pathTarget(req.params.id)))) return;
      res.locals.body = await recordOldServerObservation(
        tx,
        a.user.id,
        a.user.role,
        req.params.id,
        req.body,
      );
    },
  );
  route(
    "post",
    "/operational-records/:id/replacement-observations",
    undefined,
    true,
    async (tx, a, req, res) => {
      if (!(await recorded(tx, a, res, pathTarget(req.params.id)))) return;
      res.locals.body = await recordReplacementObservation(
        tx,
        a.user.id,
        a.user.role,
        req.params.id,
        req.body,
      );
    },
  );
  // Read-only explorer. Authorization is the route permission; the query never
  // supplies or changes the authenticated actor.
  route(
    "get",
    "/audit-events",
    "audit.view",
    true,
    async (tx, _a, req, res) => {
      res.locals.body = await listAuditEvents(
        tx,
        req.query as Record<string, unknown>,
      );
    },
  );
  app.use("/api/v1", router);
  app.use((_req, _res, next) =>
    next(new ApiError(404, "EntityNotFound", "Endpoint not found.")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const correlationId = randomUUID();
      if (error instanceof ApiError) {
        res
          .status(error.status)
          .json({ code: error.code, message: error.message, correlationId });
        return;
      }
      const e = error as { code?: string; type?: string; constraint?: string };
      if (e.code === "23505") {
        const code = duplicateConstraintCode(e.constraint);
        res.status(409).json({
          code,
          message:
            code === "DuplicateOperation"
              ? "An operation already exists for this installation."
              : "The unique code or username already exists.",
          correlationId,
        });
        return;
      }
      if (e.code === "23503") {
        res.status(404).json({
          code: "EntityNotFound",
          message: "Related record not found.",
          correlationId,
        });
        return;
      }
      if (
        e.code === "23514" ||
        e.code === "22001" ||
        e.type === "entity.parse.failed" ||
        e.type === "entity.too.large"
      ) {
        res.status(400).json({
          code: "ValidationFailed",
          message: "Invalid input.",
          correlationId,
        });
        return;
      }
      console.error(`Owner request failed (${correlationId}).`); // No raw error/query/body/credentials.
      res.status(500).json({
        code: "InternalError",
        message: "The operation failed. Please retry.",
        correlationId,
      });
    },
  );
  return app;
}
