import { ulid } from "ulid";
import type { PoolClient } from "pg";
import { audit } from "./db.js";
import {
  evidenceReference,
  fail,
  flag,
  id,
  installationReference,
  licenseActivation,
  licenseObservationCreate,
  object,
  oldServerObservation,
  operationKindFilter,
  operationResponse,
  operationStatusFilter,
  optionalId,
  page,
  queryText,
  reasonText,
  replacementCreate,
  replacementObservation,
  type Role,
} from "./domain.js";

const columns = `r.id, r.customer_id, c.customer_code, c.display_name, r.kind,
  r.observation_category, r.observed_status, r.installation_reference,
  r.old_installation_reference, r.replacement_installation_reference,
  r.old_server_observed_state, r.replacement_observed_state,
  r.emergency_old_server_lost, r.replaces_record_id, r.created_at, r.updated_at,
  r.created_by, r.updated_by`;

async function lockCustomer(tx: PoolClient, customerId: string) {
  const row = (
    await tx.query<{ id: string }>(
      "SELECT id FROM owner.customers WHERE id=$1 FOR UPDATE",
      [customerId],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Customer not found.");
  return row;
}
async function readOperation(tx: PoolClient, recordId: string) {
  const row = (
    await tx.query(
      `SELECT ${columns} FROM owner.operational_records r
      JOIN owner.customers c ON c.id=r.customer_id WHERE r.id=$1`,
      [recordId],
    )
  ).rows[0];
  if (!row) fail(404, "EntityNotFound", "Operational record not found.");
  const transitions = (
    await tx.query(
      `SELECT id, actor_id, occurred_at, prior_status, new_status, reason,
        evidence_reference, confirmation_kind
      FROM owner.operational_transitions
      WHERE record_id=$1 ORDER BY occurred_at, id`,
      [recordId],
    )
  ).rows;
  return { row, transitions };
}
async function lockOperation(tx: PoolClient, recordId: string) {
  const owner = (
    await tx.query<{ customer_id: string }>(
      "SELECT customer_id FROM owner.operational_records WHERE id=$1",
      [recordId],
    )
  ).rows[0];
  if (!owner) fail(404, "EntityNotFound", "Operational record not found.");
  await lockCustomer(tx, owner.customer_id);
  await tx.query(
    "SELECT id FROM owner.operational_records WHERE id=$1 FOR UPDATE",
    [recordId],
  );
  return readOperation(tx, recordId);
}
async function writeTransition(
  tx: PoolClient,
  recordId: string,
  actorId: string,
  prior: string,
  next: string,
  reason: string,
  evidence: string | null,
) {
  await tx.query(
    `INSERT INTO owner.operational_transitions(
      id, record_id, actor_id, prior_status, new_status, reason,
      evidence_reference, confirmation_kind)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'OPERATOR_OBSERVED')`,
    [ulid(), recordId, actorId, prior, next, reason, evidence],
  );
}
function snapshot(row: Record<string, unknown>, evidence: string | null) {
  return {
    customerId: row.customer_id,
    kind: row.kind,
    observedStatus: row.observed_status,
    observationCategory: row.observation_category,
    installationReference: row.installation_reference,
    oldInstallationReference: row.old_installation_reference,
    replacementInstallationReference: row.replacement_installation_reference,
    oldServerObservedState: row.old_server_observed_state,
    replacementObservedState: row.replacement_observed_state,
    emergencyOldServerLost: row.emergency_old_server_lost,
    replacesRecordId: row.replaces_record_id,
    evidenceReference: evidence,
    evidenceBasis: "OPERATOR_OBSERVED",
  };
}
async function resolveReplaces(
  tx: PoolClient,
  customerId: string,
  oldInstallation: string,
  requested: string | null,
) {
  const matches = (
    await tx.query<{ id: string }>(
      `SELECT id FROM owner.operational_records
      WHERE customer_id=$1 AND kind='LICENSE' AND installation_reference=$2`,
      [customerId, oldInstallation],
    )
  ).rows;
  if (matches.length > 1)
    fail(
      409,
      "DuplicateOperation",
      "The old installation has conflicting observations.",
    );
  const linked = matches[0]?.id ?? null;
  if (!requested) return linked;
  const other = (
    await tx.query<{ customer_id: string; kind: string }>(
      "SELECT customer_id, kind FROM owner.operational_records WHERE id=$1",
      [requested],
    )
  ).rows[0];
  if (!other || other.customer_id !== customerId)
    fail(404, "EntityNotFound", "Related record not found.");
  if (linked !== requested)
    fail(
      400,
      "ValidationFailed",
      "Related record does not match the old installation.",
    );
  return requested;
}
async function assertReplacementAvailable(
  tx: PoolClient,
  customerId: string,
  oldInstallation: string,
  newInstallation: string,
) {
  const clash = await tx.query(
    `SELECT id FROM owner.operational_records
    WHERE customer_id=$1 AND kind='SERVER_REPLACEMENT' AND (
      old_installation_reference=$2 OR replacement_installation_reference=$3 OR (
        observed_status<>'REPLACEMENT_RECORDED' AND (
          old_installation_reference=$3 OR replacement_installation_reference=$2)))`,
    [customerId, oldInstallation, newInstallation],
  );
  if (clash.rowCount)
    fail(
      409,
      "DuplicateOperation",
      "An operation already exists for this installation.",
    );
}

export async function denyOperationMutation(
  tx: PoolClient,
  actorId: string,
  targetId: string | null,
  requiredPermission:
    "operations.record" | "replacements.authorize" = "operations.record",
) {
  await audit(tx, {
    actor: actorId,
    type: "OPERATION_MUTATION_DENIED",
    targetType: "OperationalRecord",
    targetId,
    outcome: "DENIED",
    reason: `Missing ${requiredPermission}`,
  });
}

export async function listOperations(
  tx: PoolClient,
  role: Role,
  query: Record<string, unknown>,
) {
  const currentPage = page(query.page);
  const search = queryText(query.search, "search") ?? "";
  const kind = operationKindFilter(query.kind);
  const status = operationStatusFilter(query.status);
  const customerId =
    query.customerId === undefined || query.customerId === ""
      ? null
      : id(query.customerId);
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const values: unknown[] = [pattern];
  const filters = [
    `(c.customer_code ILIKE $1 OR c.display_name ILIKE $1
      OR coalesce(r.installation_reference,'') ILIKE $1
      OR coalesce(r.old_installation_reference,'') ILIKE $1
      OR coalesce(r.replacement_installation_reference,'') ILIKE $1)`,
  ];
  if (kind) {
    values.push(kind);
    filters.push(`r.kind=$${values.length}`);
  }
  if (status) {
    values.push(status);
    filters.push(`r.observed_status=$${values.length}`);
  }
  if (customerId) {
    values.push(customerId);
    filters.push(`r.customer_id=$${values.length}`);
  }
  const where = filters.join(" AND ");
  const total = await tx.query<{ count: string }>(
    `SELECT count(*) FROM owner.operational_records r
    JOIN owner.customers c ON c.id=r.customer_id WHERE ${where}`,
    values,
  );
  const rows = await tx.query(
    `SELECT ${columns} FROM owner.operational_records r
    JOIN owner.customers c ON c.id=r.customer_id
    WHERE ${where} ORDER BY r.id DESC LIMIT 50 OFFSET $${values.length + 1}`,
    [...values, (currentPage - 1) * 50],
  );
  return {
    items: rows.rows.map((row) => operationResponse(row, role)),
    total: Number(total.rows[0]!.count),
    page: currentPage,
    pageSize: 50,
  };
}
export async function getOperation(tx: PoolClient, role: Role, rawId: unknown) {
  const found = await readOperation(tx, id(rawId));
  return operationResponse(found.row, role, found.transitions);
}

export async function recordLicenseObservation(
  tx: PoolClient,
  actorId: string,
  role: Role,
  body: unknown,
) {
  const input = object(body, [
    "customerId",
    "installationReference",
    "reason",
    "evidenceReference",
  ]);
  const customerId = id(input.customerId);
  const installation = installationReference(
    input.installationReference,
    "installationReference",
  );
  const reason = reasonText(input.reason);
  const evidence = evidenceReference(input.evidenceReference);
  const plan = licenseObservationCreate();
  await lockCustomer(tx, customerId);
  const existing = await tx.query(
    `SELECT id FROM owner.operational_records
    WHERE customer_id=$1 AND kind='LICENSE' AND installation_reference=$2`,
    [customerId, installation],
  );
  if (existing.rowCount)
    fail(
      409,
      "DuplicateOperation",
      "An operation already exists for this installation.",
    );
  const recordId = ulid();
  await tx.query(
    `INSERT INTO owner.operational_records(
      id, customer_id, kind, observed_status, observation_category,
      installation_reference, created_by, updated_by)
    VALUES ($1,$2,'LICENSE',$3,$4,$5,$6,$6)`,
    [
      recordId,
      customerId,
      plan.observedStatus,
      plan.observationCategory,
      installation,
      actorId,
    ],
  );
  await writeTransition(
    tx,
    recordId,
    actorId,
    plan.priorStatus,
    plan.observedStatus,
    reason,
    evidence,
  );
  const found = await readOperation(tx, recordId);
  await audit(tx, {
    actor: actorId,
    type: "LICENSE_ISSUANCE_OBSERVED",
    targetType: "OperationalRecord",
    targetId: recordId,
    reason,
    before: { observedStatus: "UNRECORDED" },
    after: snapshot(found.row, evidence),
  });
  return operationResponse(found.row, role, found.transitions);
}

export async function recordActivationObservation(
  tx: PoolClient,
  actorId: string,
  role: Role,
  rawId: unknown,
  body: unknown,
) {
  const input = object(body, ["reason", "evidenceReference"]);
  const reason = reasonText(input.reason);
  const evidence = evidenceReference(input.evidenceReference);
  const current = await lockOperation(tx, id(rawId));
  if (current.row.kind !== "LICENSE")
    fail(404, "EntityNotFound", "Operational record not found.");
  const plan = licenseActivation(String(current.row.observed_status));
  await tx.query(
    `UPDATE owner.operational_records
    SET observed_status=$2, observation_category=$3, updated_by=$4, updated_at=clock_timestamp()
    WHERE id=$1`,
    [current.row.id, plan.observedStatus, plan.observationCategory, actorId],
  );
  await writeTransition(
    tx,
    String(current.row.id),
    actorId,
    plan.priorStatus,
    plan.observedStatus,
    reason,
    evidence,
  );
  const found = await readOperation(tx, String(current.row.id));
  await audit(tx, {
    actor: actorId,
    type: "LICENSE_ACTIVATION_OBSERVED",
    targetType: "OperationalRecord",
    targetId: String(current.row.id),
    reason,
    before: snapshot(current.row, null),
    after: snapshot(found.row, evidence),
  });
  return operationResponse(found.row, role, found.transitions);
}

export async function recordServerReplacement(
  tx: PoolClient,
  actorId: string,
  role: Role,
  body: unknown,
) {
  const input = object(body, [
    "customerId",
    "oldInstallationReference",
    "replacementInstallationReference",
    "reason",
    "evidenceReference",
    "emergencyOldServerLost",
    "replacesRecordId",
  ]);
  const customerId = id(input.customerId);
  const oldInstallation = installationReference(
    input.oldInstallationReference,
    "oldInstallationReference",
  );
  const newInstallation = installationReference(
    input.replacementInstallationReference,
    "replacementInstallationReference",
  );
  if (oldInstallation === newInstallation)
    fail(400, "ValidationFailed", "Installation references must differ.");
  const reason = reasonText(input.reason);
  const evidence = evidenceReference(input.evidenceReference);
  const emergency = flag(
    input.emergencyOldServerLost,
    "emergencyOldServerLost",
  );
  const requested = optionalId(input.replacesRecordId);
  const plan = replacementCreate(emergency);
  await lockCustomer(tx, customerId);
  await assertReplacementAvailable(
    tx,
    customerId,
    oldInstallation,
    newInstallation,
  );
  const replaces = await resolveReplaces(
    tx,
    customerId,
    oldInstallation,
    requested,
  );
  const recordId = ulid();
  await tx.query(
    `INSERT INTO owner.operational_records(
      id, customer_id, kind, observed_status, observation_category,
      old_installation_reference, replacement_installation_reference,
      old_server_observed_state, emergency_old_server_lost, replaces_record_id,
      created_by, updated_by)
    VALUES ($1,$2,'SERVER_REPLACEMENT',$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      recordId,
      customerId,
      plan.insertStatus,
      plan.insertCategory,
      oldInstallation,
      newInstallation,
      plan.oldServerObservedState,
      emergency,
      replaces,
      actorId,
    ],
  );
  for (const step of plan.transitions)
    await writeTransition(
      tx,
      recordId,
      actorId,
      step.prior,
      step.next,
      reason,
      evidence,
    );
  const found = await readOperation(tx, recordId);
  await audit(tx, {
    actor: actorId,
    type: emergency
      ? "SERVER_REPLACEMENT_OLD_STATE_RECORDED"
      : "SERVER_REPLACEMENT_AUTHORIZED",
    targetType: "OperationalRecord",
    targetId: recordId,
    reason,
    before: { observedStatus: "UNRECORDED" },
    after: {
      ...snapshot(found.row, evidence),
      milestones: plan.transitions.map((step) => step.next),
    },
  });
  return operationResponse(found.row, role, found.transitions);
}

export async function recordOldServerObservation(
  tx: PoolClient,
  actorId: string,
  role: Role,
  rawId: unknown,
  body: unknown,
) {
  const input = object(body, [
    "reason",
    "evidenceReference",
    "oldServerObservedState",
  ]);
  const reason = reasonText(input.reason);
  const evidence = evidenceReference(input.evidenceReference);
  const current = await lockOperation(tx, id(rawId));
  if (current.row.kind !== "SERVER_REPLACEMENT")
    fail(404, "EntityNotFound", "Operational record not found.");
  const plan = oldServerObservation(
    {
      observedStatus: String(current.row.observed_status),
      emergency: Boolean(current.row.emergency_old_server_lost),
    },
    input.oldServerObservedState,
  );
  await tx.query(
    `UPDATE owner.operational_records
    SET observed_status=$2, observation_category=$3, old_server_observed_state=$4,
      updated_by=$5, updated_at=clock_timestamp()
    WHERE id=$1`,
    [
      current.row.id,
      plan.observedStatus,
      plan.observationCategory,
      plan.oldServerObservedState,
      actorId,
    ],
  );
  await writeTransition(
    tx,
    String(current.row.id),
    actorId,
    plan.priorStatus,
    plan.observedStatus,
    reason,
    evidence,
  );
  const found = await readOperation(tx, String(current.row.id));
  await audit(tx, {
    actor: actorId,
    type: "SERVER_REPLACEMENT_OLD_STATE_RECORDED",
    targetType: "OperationalRecord",
    targetId: String(current.row.id),
    reason,
    before: snapshot(current.row, null),
    after: snapshot(found.row, evidence),
  });
  return operationResponse(found.row, role, found.transitions);
}

export async function recordReplacementObservation(
  tx: PoolClient,
  actorId: string,
  role: Role,
  rawId: unknown,
  body: unknown,
) {
  const input = object(body, [
    "reason",
    "evidenceReference",
    "replacementObservedState",
  ]);
  const reason = reasonText(input.reason);
  const evidence = evidenceReference(input.evidenceReference);
  const current = await lockOperation(tx, id(rawId));
  if (current.row.kind !== "SERVER_REPLACEMENT")
    fail(404, "EntityNotFound", "Operational record not found.");
  const plan = replacementObservation(
    String(current.row.observed_status),
    input.replacementObservedState,
  );
  await tx.query(
    `UPDATE owner.operational_records
    SET observed_status=$2, observation_category=$3, replacement_observed_state=$4,
      updated_by=$5, updated_at=clock_timestamp()
    WHERE id=$1`,
    [
      current.row.id,
      plan.observedStatus,
      plan.observationCategory,
      plan.replacementObservedState,
      actorId,
    ],
  );
  await writeTransition(
    tx,
    String(current.row.id),
    actorId,
    plan.priorStatus,
    plan.observedStatus,
    reason,
    evidence,
  );
  const found = await readOperation(tx, String(current.row.id));
  await audit(tx, {
    actor: actorId,
    type: "SERVER_REPLACEMENT_RECORDED",
    targetType: "OperationalRecord",
    targetId: String(current.row.id),
    reason,
    before: snapshot(current.row, null),
    after: snapshot(found.row, evidence),
  });
  return operationResponse(found.row, role, found.transitions);
}
