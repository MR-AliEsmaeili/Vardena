/**
 * The coupled two-key transfer replay's in-transaction orchestration
 * (C-59C, OD-TRF-01…09).
 *
 * WHAT THIS FILE DOES
 *
 * Given the two legs a transfer command is about to write, it replays BOTH
 * keys' histories together — with the new pair inserted at its own business
 * date — and persists exactly what the replay implies:
 *
 *   1. every stored movement whose value the replay changed, on both keys;
 *   2. one `inventory_valuation_runs` row per key (trigger
 *      `backdated_document`), so the restatement is auditable and the
 *      movements it valued point at it;
 *   3. both valuation-state rows, through the same `writeValuationState` seam
 *      a recalculation uses (staleness is re-established, never guessed).
 *
 * The caller — `InventoryMovementsRepository.postTransfer` — then inserts the
 * two movement rows and adjusts both balances, all inside the SAME
 * transaction that already holds both balance locks and both valuation-state
 * locks. Nothing here opens a transaction of its own and nothing here commits
 * separately, so a failure anywhere aborts the whole command: there is no
 * observable intermediate state and no source-only or destination-only
 * valuation can survive.
 *
 * THE ORDER OF OPERATIONS, AND WHY
 *
 * Both keys' movement histories are read (bounded), the pure driver
 * (`domain/transfer-replay.ts`) folds them in ONE pass, and only then is
 * anything written — source key first, destination second. The value the
 * destination leg receives is produced by that pass; it is never re-derived
 * and never recomputed from the destination's own average, so OD-TRF-01
 * ("the destination derives the source value") is structural rather than a
 * sequencing convention.
 *
 * WHAT IT DOES NOT DO
 *
 * It never changes a quantity, never touches a document's lifecycle, never
 * creates or reverses an accounting document, never invents a value (no
 * manual cost exists on a transfer, OD-TRF-06) and never deletes or rewrites
 * a run row. The replay horizon is each key's whole history, bounded by
 * `RECALCULATION_MOVEMENT_LIMIT` — the same bound, and the same
 * refuse-rather-than-truncate rule, the recalculation command uses
 * (OD-VAL-12).
 */

import { generateId } from '../../../kernel/ids/ulid.js';
import {
  MOVEMENT_VALUATION_STATUSES,
  resolveValuationStatus,
  VALUATION_SOURCES,
  type InventoryValuationState,
  type MovementValuationStatus,
  type ValuationSource,
} from '../domain/inventory-valuation.js';
import type {
  MovementValuation,
  ValuationPosition,
} from '../domain/moving-weighted-average.js';
import type {
  CoupledReplayEntry,
  CoupledReplaySide,
} from '../domain/transfer-replay.js';
import { replayCoupledTransfer } from '../domain/transfer-replay.js';
import type {
  ReplayFact,
  ReplayedMovement,
} from '../domain/valuation-replay.js';
import { valuationChanged } from '../domain/valuation-replay.js';
import type { ValuationMethod } from '../domain/valuation-method.js';
import type {
  BalanceKey,
  CoreTxClient,
  MovementRow,
} from './inventory-core-rows.js';
import { decimalToString } from './inventory-core-rows.js';
import {
  buildReplayFacts,
  readKeyMovements,
  readMethodVersions,
} from './inventory-valuation.repository.js';
import type { MovementValuationColumns } from './inventory-valuation-writes.js';
import { writeValuationState } from './inventory-valuation-writes.js';

/**
 * The run trigger a coupled transfer replay records: `backdated_document`,
 * the existing vocabulary member for exactly this event (a backdated posting
 * that restated a key's existing values under an explicit operator
 * decision). Adding a new trigger would make the transfer replay look like a
 * command of its own; it is not one — it is how a backdated transfer is
 * valued.
 */
export const TRANSFER_REPLAY_TRIGGER = 'backdated_document';

export interface CoupledTransferLegInput {
  id: string;
  key: BalanceKey;
  /** Both legs share the transfer's business date. */
  movementDate: Date;
  /** Both legs share the command's creation instant. */
  createdAt: Date;
  /** SIGNED base-unit effect (`transfer_out` is negative). */
  baseQuantity: string;
}

export interface CoupledTransferReplayInput {
  outLeg: CoupledTransferLegInput;
  inLeg: CoupledTransferLegInput;
  /** The source key's valuation state — LOCKED by the caller. */
  sourceState: InventoryValuationState;
  /** The destination key's valuation state — LOCKED by the caller. */
  destinationState: InventoryValuationState;
  /** The method both keys are valued under from now on. */
  method: ValuationMethod;
  /** The command's instant; every write of this replay is stamped with it. */
  at: Date;
  actorId: string | null;
  /** Echoed onto both run rows (uniqueness lives in `inventory_operations`). */
  operationKey: string;
  reason: string | null;
}

export interface CoupledTransferReplayOutcome {
  /** Valuation columns for the two new leg rows. */
  out: MovementValuationColumns;
  in: MovementValuationColumns;
  sourceRunId: string;
  destinationRunId: string;
}

/**
 * Replay both keys of a transfer and persist the result.
 *
 * @throws RecalculationTooLargeError when either key holds more movements
 *   than the bounded replay allows (OD-VAL-12) — refused, never truncated.
 * @throws UnvaluedTransferReplayError when a STORED leg of some other
 *   transfer would have to be valued on one key alone (see the driver).
 * @throws UnsupportedValuationMethodError when a replayed period's configured
 *   method is not implemented in this build (OD-VAL-18).
 */
export async function replayTransferPairWithin(
  tx: CoreTxClient,
  input: CoupledTransferReplayInput,
): Promise<CoupledTransferReplayOutcome> {
  const sourceRows = await readKeyMovements(tx, input.outLeg.key);
  const destinationRows = await readKeyMovements(tx, input.inLeg.key);
  const entries = [
    ...(await toEntries(tx, 'source', input.outLeg.key, sourceRows)),
    ...(await toEntries(tx, 'destination', input.inLeg.key, destinationRows)),
  ];
  const result = replayCoupledTransfer({
    entries,
    transfer: {
      movementDate: input.outLeg.movementDate,
      createdAt: input.outLeg.createdAt,
      id: input.outLeg.id,
      quantity: magnitudeOf(input.outLeg.baseQuantity),
    },
  });

  const sourceRunId = generateId();
  const destinationRunId = generateId();
  await persistSide(tx, {
    key: input.outLeg.key,
    state: input.sourceState,
    rows: sourceRows,
    replayed: result.sourceValuations,
    position: result.sourcePosition,
    method: input.method,
    provisional: result.provisional.source,
    runId: sourceRunId,
    input,
  });
  await persistSide(tx, {
    key: input.inLeg.key,
    state: input.destinationState,
    rows: destinationRows,
    replayed: result.destinationValuations,
    position: result.destinationPosition,
    method: input.method,
    provisional: result.provisional.destination,
    runId: destinationRunId,
    input,
  });

  return {
    out: legColumns(result.out, input.at, sourceRunId),
    in: legColumns(result.in, input.at, destinationRunId),
    sourceRunId,
    destinationRunId,
  };
}

/** The stored movements of one key as positioned replay entries. */
async function toEntries(
  tx: CoreTxClient,
  side: CoupledReplaySide,
  key: BalanceKey,
  rows: readonly MovementRow[],
): Promise<CoupledReplayEntry[]> {
  // Method resolution per distinct movement date — the C-57 bounded read
  // (bounded by movements, never by configuration density).
  const versions = await readMethodVersions(
    tx,
    key,
    rows.map((row) => row.movementDate),
  );
  const facts = buildReplayFacts(rows, versions);
  return rows.map((row, index) => ({
    side,
    movementDate: row.movementDate,
    createdAt: row.createdAt,
    id: row.id,
    fact: facts[index] as ReplayFact,
    // Read, never re-derived: a refusal can name the transfer to price.
    transferId: row.transferId,
  }));
}

/**
 * Persist one key's replay: the changed movement rows, the run record, then
 * the state. A replay that changed no row still records its run — the audit
 * trail answers "which command examined this key", not only "which command
 * changed it".
 */
async function persistSide(
  tx: CoreTxClient,
  side: {
    key: BalanceKey;
    state: InventoryValuationState;
    rows: readonly MovementRow[];
    replayed: readonly ReplayedMovement[];
    position: ValuationPosition;
    method: ValuationMethod;
    provisional: boolean;
    runId: string;
    input: CoupledTransferReplayInput;
  },
): Promise<void> {
  const { input } = side;
  const changes = side.rows.flatMap((row, index) => {
    const next = side.replayed[index];
    if (next === undefined) return [];
    const before = {
      status: storedStatus(row.id, row.valuationStatus),
      totalCost: row.totalCost === null ? null : decimalToString(row.totalCost),
      source: storedSource(row.id, row.valuationSource),
    };
    return valuationChanged(before, next.valuation)
      ? [{ id: row.id, valuation: next.valuation }]
      : [];
  });

  // The RUN row is written FIRST, exactly as `applyReplay` does: every
  // restated movement points at it (`valuationRunId` is a foreign key), so
  // patching a movement before the run exists is a constraint violation on
  // real PostgreSQL. The in-memory mirror enforces the same order.
  await tx.inventoryValuationRun.create({
    data: {
      id: side.runId,
      organizationId: side.key.organizationId,
      branchId: side.key.branchId,
      warehouseId: side.key.warehouseId,
      itemId: side.key.itemId,
      method: side.method,
      trigger: TRANSFER_REPLAY_TRIGGER,
      // Informational lower bound: the transfer's business date is what the
      // operator asked to value; the replay itself always covers the key.
      fromDate: input.outLeg.movementDate,
      movementsExamined: side.rows.length,
      movementsRevalued: changes.length,
      resultingValuedQuantity: side.position.valuedQuantity,
      resultingUncostedQuantity: side.position.uncostedQuantity,
      resultingTotalValue: side.position.totalValue,
      resultingStatus: resolveValuationStatus({
        uncostedQuantity: side.position.uncostedQuantity,
        staleSince: side.provisional ? input.at : null,
      }),
      operationKey: input.operationKey,
      reason: input.reason,
      executedAt: input.at,
      createdAt: input.at,
      updatedAt: input.at,
      createdBy: input.actorId,
    },
  });

  for (const change of changes) {
    await tx.inventoryMovement.update({
      where: { id: change.id },
      data: {
        totalCost: change.valuation.totalCost,
        valuationStatus: change.valuation.status,
        valuationSource: change.valuation.source,
        valuedAt: change.valuation.status === 'unvalued' ? null : input.at,
        valuationRunId: side.runId,
        updatedAt: input.at,
        updatedBy: input.actorId,
      },
    });
  }

  await writeValuationState(tx, {
    state: side.state,
    position: side.position,
    method: side.method,
    marksStale: side.provisional,
    at: input.at,
    actorId: input.actorId,
    recalculationId: side.runId,
    // A replay re-establishes consistency; it can only stay inconsistent if
    // the facts themselves are still provisional.
    clearStale: true,
  });
}

/** The columns the caller writes onto a new leg row. */
function legColumns(
  valuation: MovementValuation,
  at: Date,
  runId: string,
): MovementValuationColumns {
  return {
    totalCost: valuation.totalCost,
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuedAt: valuation.status === 'unvalued' ? null : at,
    valuationRunId: runId,
  };
}

/** `|baseQuantity|` — the magnitude the pair moves. */
function magnitudeOf(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

function storedStatus(id: string, value: string): MovementValuationStatus {
  if (!(MOVEMENT_VALUATION_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `Stored movement "${id}" has an unknown valuation status "${value}".`,
    );
  }
  return value as MovementValuationStatus;
}

function storedSource(
  id: string,
  value: string | null,
): ValuationSource | null {
  if (value === null) return null;
  if (!(VALUATION_SOURCES as readonly string[]).includes(value)) {
    throw new Error(
      `Stored movement "${id}" has an unknown valuation source "${value}".`,
    );
  }
  return value as ValuationSource;
}
