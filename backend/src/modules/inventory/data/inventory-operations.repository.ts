import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  isInventoryOperationKind,
  resultKindFor,
  type InventoryOperation,
  type InventoryOperationResult,
} from '../domain/inventory-operation.js';
import type {
  CoreClient,
  CoreTxClient,
  OperationCreate,
  OperationRow,
} from './inventory-core-rows.js';

/**
 * Data access for `inventory_operations` — the idempotency ledger (ADR-0022).
 *
 * Rows are insert-only. The insert always happens INSIDE a posting
 * transaction owned by one of the sibling repositories (via
 * `insertOperationRow`), so a committed ledger effect always has its key and
 * a failed one never does. This repository owns the pre-check read
 * (`findByKey`) both outside and inside service-level retry handling.
 */
@Injectable()
export class InventoryOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  async findByKey(
    organizationId: string,
    operationKey: string,
  ): Promise<InventoryOperation | null> {
    const { inventoryOperation } = await this.client();
    const row = await inventoryOperation.findFirst({
      where: { organizationId, operationKey },
    });
    return row === null ? null : toDomain(row);
  }
}

/**
 * Insert the idempotency row as the LAST statement of a posting transaction.
 * Last on purpose: a unique violation here aborts the whole transaction, so a
 * lost key race can never leave a ledger effect without its key (the winner's
 * row is what the loser re-reads for replay-or-reject).
 */
export async function insertOperationRow(
  tx: CoreTxClient,
  create: OperationCreate,
): Promise<void> {
  await tx.inventoryOperation.create({ data: create });
}

function toDomain(row: OperationRow): InventoryOperation {
  if (!isInventoryOperationKind(row.operation)) {
    throw new Error(
      `Stored inventory operation "${row.id}" has an unknown operation "${row.operation}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    operationKey: row.operationKey,
    operation: row.operation,
    requestHash: row.requestHash,
    result: toResult(row.operation, row.result),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The result envelope is written by this module only, so a malformed envelope
 * means a hand-edited database — fail loudly rather than replaying garbage.
 */
function toResult(
  operation: Parameters<typeof resultKindFor>[0],
  value: unknown,
): InventoryOperationResult {
  const kind = resultKindFor(operation);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored inventory operation has a malformed result.');
  }
  const record = value as Record<string, unknown>;
  if (kind === 'valuation') {
    const runId = record['runId'];
    const movementId = record['movementId'];
    if (
      !(runId === null || typeof runId === 'string') ||
      !(movementId === null || typeof movementId === 'string')
    ) {
      throw new Error('Stored inventory operation has a malformed result.');
    }
    return { kind, runId, movementId };
  }
  if (kind === 'reservation') {
    if (typeof record['reservationId'] !== 'string') {
      throw new Error('Stored inventory operation has a malformed result.');
    }
    return { kind, reservationId: record['reservationId'] };
  }
  if (kind === 'pricing') {
    if (typeof record['pricingRunId'] !== 'string') {
      throw new Error('Stored inventory operation has a malformed result.');
    }
    return { kind, pricingRunId: record['pricingRunId'] };
  }
  const movementIds = record['movementIds'];
  if (
    !Array.isArray(movementIds) ||
    movementIds.length === 0 ||
    movementIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('Stored inventory operation has a malformed result.');
  }
  if (kind === 'transfer') {
    if (movementIds.length !== 2) {
      throw new Error('Stored inventory operation has a malformed result.');
    }
    const [outId, inId] = movementIds as [string, string];
    return { kind, movementIds: [outId, inId] };
  }
  return { kind: 'movement', movementIds: movementIds as string[] };
}
