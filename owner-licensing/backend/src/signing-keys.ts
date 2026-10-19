import type { PoolClient } from "pg";
import { audit } from "./db.js";
import {
  assertPermission,
  fail,
  object,
  page,
  queryText,
  signingKeyEvidenceRef,
  signingKeyId,
  signingKeyLabel,
  signingKeyNotes,
  signingKeyResponse,
  signingKeyStatus,
  signingKeyStatuses,
  signingKeyMetadata,
  type Role,
  type SigningKeyStatus,
} from "./domain.js";

/**
 * Signing-key tracking (OQ-74, Product Owner decision 2026-10-18).
 *
 * The Owner app is observational (PDR-17: cryptographic issuance is "not
 * implemented" here). This service manages the administrative record of which
 * signing keys exist and their current status (ACTIVE/COMPROMISED/REVOKED).
 * The customer runtime remains the authority for actual signature
 * verification — this service only records what the Owner observed and
 * decided.
 *
 * Key compromise response (per the Product Owner decision):
 *   1. Replacement generation and trusted-key rollout are separate Owner-controlled
 *      processes. This service executes neither and never claims rollout occurred.
 *   2. Marking a key as COMPROMISED here does NOT automatically invalidate any
 *      already-issued license. The Owner reviews affected licenses case by
 *      case (the UI surfaces them with safety status NEEDS_REVIEW).
 *   3. REVOKED is for explicit administrative revocation separate from
 *      compromise (e.g. routine rotation). It surfaces licenses as
 *      NEEDS_REVIEW too, but the operational meaning is different.
 *
 * Status transitions:
 *   ACTIVE → COMPROMISED | REVOKED  (Owner Admin marks the key)
 *   COMPROMISED → ACTIVE            (Owner Admin clears the key after investigation)
 *   REVOKED → ACTIVE                (Owner Admin restores the key, rare)
 *   COMPROMISED ↔ REVOKED           (Owner Admin reclassifies after investigation)
 *
 * Every transition is audited with the actor, reason and optional evidence
 * reference. The `status_detected_at` timestamp is set to `clock_timestamp()`
 * on every status change, so the UI can show "this key has been compromised
 * since 2026-10-18".
 */

const columns = `id, label, status, status_detected_at, status_reason,
  evidence_ref, notes, created_at, updated_at, created_by, updated_by`;

async function lockSigningKey(tx: PoolClient, keyId: string) {
  const row = (
    await tx.query(
      `SELECT ${columns} FROM owner.signing_keys WHERE id=$1 FOR UPDATE`,
      [keyId],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Signing key not found.");
  return row;
}

function assertSigningKeyPermission(role: Role) {
  // Both Owner Admin and License Operator can view signing keys (they need to
  // see safety status while recording license observations). Only Owner Admin
  // can mutate.
  assertPermission(role, "customers.view");
}

function assertSigningKeyWritePermission(role: Role) {
  // Marking a key compromised/revoked is a privileged operation: it changes
  // the safety status of every license signed with that key. Owner Admin only.
  assertPermission(role, "customers.write");
}

export async function listSigningKeys(
  tx: PoolClient,
  role: Role,
  query: Record<string, unknown>,
) {
  assertSigningKeyPermission(role);
  const currentPage = page(query.page);
  const search = queryText(query.search, "search") ?? "";
  const statusFilter = queryText(query.status, "status");
  if (
    statusFilter !== undefined &&
    !signingKeyStatuses.includes(statusFilter as SigningKeyStatus)
  )
    fail(400, "ValidationFailed", "Invalid status filter.");
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const values: unknown[] = [pattern];
  const filters = [`(id ILIKE $1 OR label ILIKE $1)`];
  if (statusFilter) {
    values.push(statusFilter);
    filters.push(`status=$${values.length}`);
  }
  const where = filters.join(" AND ");
  const total = await tx.query<{ count: string }>(
    `SELECT count(*) FROM owner.signing_keys WHERE ${where}`,
    values,
  );
  const rows = await tx.query(
    `SELECT ${columns} FROM owner.signing_keys
    WHERE ${where} ORDER BY status, id DESC LIMIT 50 OFFSET $${values.length + 1}`,
    [...values, (currentPage - 1) * 50],
  );
  return {
    items: rows.rows.map((row) => signingKeyResponse(row, role)),
    total: Number(total.rows[0]!.count),
    page: currentPage,
    pageSize: 50,
  };
}

export async function getSigningKey(
  tx: PoolClient,
  role: Role,
  rawId: unknown,
) {
  assertSigningKeyPermission(role);
  const keyId = signingKeyId(rawId);
  const row = (
    await tx.query(`SELECT ${columns} FROM owner.signing_keys WHERE id=$1`, [
      keyId,
    ])
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Signing key not found.");
  return signingKeyResponse(row, role);
}

export async function registerSigningKey(
  tx: PoolClient,
  actorId: string,
  role: Role,
  body: unknown,
) {
  assertSigningKeyWritePermission(role);
  const input = object(body, ["id", "label", "notes", "evidenceReference"]);
  const keyId = signingKeyId(input.id);
  const label = signingKeyLabel(input.label);
  const notes = signingKeyNotes(input.notes);
  const evidence = signingKeyEvidenceRef(input.evidenceReference);
  // INSERT handles concurrent retries without overwriting metadata or aborting the transaction.
  const inserted = await tx.query(
    `INSERT INTO owner.signing_keys(id,label,status,notes,evidence_ref,created_by,updated_by)
     VALUES ($1,$2,'ACTIVE',$3,$4,$5,$5) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [keyId, label, notes, evidence, actorId],
  );
  if (!inserted.rowCount) {
    const existing = await lockSigningKey(tx, keyId);
    if (
      existing.label !== label ||
      existing.notes !== notes ||
      existing.evidence_ref !== evidence
    )
      fail(
        409,
        "Conflict",
        "Signing-key metadata conflicts with the registered record.",
      );
    return signingKeyResponse(existing, role);
  }
  const row = await lockSigningKey(tx, keyId);
  await audit(tx, {
    actor: actorId,
    type: "SIGNING_KEY_REGISTERED",
    targetType: "SigningKey",
    targetId: keyId,
    reason: `Registered signing key "${label}"`,
    after: {
      signingKeyId: keyId,
      label,
      status: "ACTIVE",
      notes,
      evidenceRef: evidence,
    },
  });
  return signingKeyResponse(row, role);
}

export async function updateSigningKeyStatus(
  tx: PoolClient,
  actorId: string,
  role: Role,
  rawId: unknown,
  body: unknown,
) {
  assertSigningKeyWritePermission(role);
  const input = object(body, ["status", "reason", "evidenceReference"]);
  const newStatus = signingKeyStatus(input.status);
  const reason = signingKeyMetadata(input.reason, "reason", 1, 500);
  const evidence = signingKeyEvidenceRef(input.evidenceReference);
  const keyId = signingKeyId(rawId);
  const current = await lockSigningKey(tx, keyId);
  if (current.status === newStatus)
    fail(409, "InvalidTransition", `Signing key is already ${newStatus}.`);
  await tx.query(
    `UPDATE owner.signing_keys
    SET status=$2, status_detected_at=clock_timestamp(),
        status_reason=$3, evidence_ref=$4,
        updated_by=$5, updated_at=clock_timestamp()
    WHERE id=$1`,
    [keyId, newStatus, reason, evidence, actorId],
  );
  const updated = await lockSigningKey(tx, keyId);
  await audit(tx, {
    actor: actorId,
    type: "SIGNING_KEY_STATUS_CHANGED",
    targetType: "SigningKey",
    targetId: keyId,
    reason,
    before: { status: current.status },
    after: { status: newStatus, evidenceRef: evidence },
  });
  return signingKeyResponse(updated, role);
}

export async function updateSigningKeyNotes(
  tx: PoolClient,
  actorId: string,
  role: Role,
  rawId: unknown,
  body: unknown,
) {
  assertSigningKeyWritePermission(role);
  const input = object(body, ["notes"]);
  const notes = signingKeyNotes(input.notes);
  const keyId = signingKeyId(rawId);
  const current = await lockSigningKey(tx, keyId);
  await tx.query(
    `UPDATE owner.signing_keys
    SET notes=$2, updated_by=$3, updated_at=clock_timestamp()
    WHERE id=$1`,
    [keyId, notes, actorId],
  );
  const updated = await lockSigningKey(tx, keyId);
  await audit(tx, {
    actor: actorId,
    type: "SIGNING_KEY_NOTES_UPDATED",
    targetType: "SigningKey",
    targetId: keyId,
    reason: notes === null ? "Notes cleared" : "Notes updated",
    before: { notes: current.notes },
    after: { notes },
  });
  return signingKeyResponse(updated, role);
}
