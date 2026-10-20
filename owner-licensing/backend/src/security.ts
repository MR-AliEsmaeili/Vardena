import argon2 from "argon2";
import { ulid } from "ulid";
import type { PoolClient } from "pg";
import type { Request } from "express";
import { audit } from "./db.js";
import {
  digest,
  effectivePermissions,
  fail,
  isRole,
  safeUser,
  type AuthenticatedActor,
  type User,
  type Permission,
} from "./domain.js";
export const hashPassword = (raw: string) =>
  argon2.hash(raw, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
export const verifyPassword = (hash: string, raw: string) =>
  argon2.verify(hash, raw);
export interface Principal {
  /** The authenticated user plus the effective permission set of this request. */
  user: AuthenticatedActor;
  sessionId: string;
}
export function cookieToken(req: Request, production: boolean): string | null {
  const name = production ? "__Host-owner_session" : "owner_session";
  const raw = (req.headers.cookie ?? "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}
export async function authenticate(
  tx: PoolClient,
  raw: string | null,
  ordinary = true,
  permission?: Permission,
): Promise<Principal> {
  if (!raw) fail(401, "Unauthorized", "Authentication is required.");
  // Discover id without a session lock; lock user BEFORE session on all paths.
  const found = await tx.query<{ user_id: string }>(
    "SELECT user_id FROM owner.sessions WHERE token_hash=$1",
    [digest(raw)],
  );
  const uid = found.rows[0]?.user_id;
  if (!uid) fail(401, "Unauthorized", "Authentication is required.");
  const users = await tx.query<User>(
    "SELECT * FROM owner.users WHERE id=$1 FOR UPDATE",
    [uid],
  );
  const user = users.rows[0]!;
  const sessions = await tx.query<{ id: string }>(
    `SELECT id FROM owner.sessions WHERE token_hash=$1 AND revoked_at IS NULL
    AND expires_at>clock_timestamp() AND absolute_expires_at>clock_timestamp() FOR UPDATE`,
    [digest(raw)],
  );
  const sessionId = sessions.rows[0]?.id;
  if (!user?.is_active || !isRole(user.role) || !sessionId)
    fail(401, "Unauthorized", "Authentication is required.");
  if (ordinary && user.must_change_password)
    fail(403, "PermissionDenied", "Password change is required.");
  // OD-LIC-12 (R-1): an operator's effective set is role eligibility ∩ active
  // grants, resolved under the same lock as the request. OWNER_ADMIN is not
  // under the grant model and keeps its static set.
  const grants = await tx.query<{ permission: string }>(
    "SELECT permission FROM owner.user_permission_grants WHERE user_id=$1 AND revoked_at IS NULL",
    [user.id],
  );
  const actor: AuthenticatedActor = {
    ...user,
    permissions: effectivePermissions(
      user.role,
      grants.rows.map((row) => row.permission),
    ),
  };
  if (permission && !actor.permissions.includes(permission))
    fail(403, "PermissionDenied", "You do not have permission.");
  await tx.query(
    "UPDATE owner.sessions SET expires_at=LEAST(absolute_expires_at,clock_timestamp()+interval '30 minutes') WHERE id=$1",
    [sessionId],
  );
  return { user: actor, sessionId };
}
export async function newSession(tx: PoolClient, user: User, hash: string) {
  const sessionId = ulid();
  await tx.query(
    "INSERT INTO owner.sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, user.id, hash],
  );
  await audit(tx, {
    actor: user.id,
    type: "AUTH_LOGIN",
    targetType: "User",
    targetId: user.id,
  });
  return safeUser(user);
}
