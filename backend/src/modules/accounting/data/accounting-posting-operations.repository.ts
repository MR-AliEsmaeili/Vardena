import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  isAccountingPostingOperationKind,
  parsePostingOperationResult,
  type AccountingPostingOperation,
} from '../domain/accounting-posting-operation.js';
import type {
  AccountingPostingOperationCreate,
  AccountingPostingOperationRow,
  AccountingTxClient,
} from './accounting-rows.js';

/**
 * Data access for `accounting.accounting_posting_operations` — the
 * idempotency ledger (Task 10.4, contract §16.4, AC-I-12; the ADR-0022 §3/§4
 * pattern re-used, not redefined).
 *
 * Rows are insert-only. The insert always happens INSIDE a document
 * transaction owned by `AccountingDocumentsRepository` (via
 * `insertOperationRow`), so a committed effect always has its key and a failed
 * one never does. This repository owns the pre-check read (`findByKey`) that
 * the service's replay-or-reject decision uses both before and after a raced
 * unique violation.
 */

type Client = {
  accountingPostingOperation: {
    findFirst(args: {
      where: { organizationId: string; operationKey: string };
    }): Promise<AccountingPostingOperationRow | null>;
  };
};

@Injectable()
export class AccountingPostingOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findByKey(
    organizationId: string,
    operationKey: string,
  ): Promise<AccountingPostingOperation | null> {
    const { accountingPostingOperation } = await this.client();
    const row = await accountingPostingOperation.findFirst({
      where: { organizationId, operationKey },
    });
    return row === null ? null : toDomain(row);
  }
}

/**
 * Insert the idempotency row as the LAST statement of a document transaction.
 * Last on purpose: a unique violation here aborts the whole transaction, so a
 * lost key race can never leave an accounting effect without its key (the
 * winner's row is what the loser re-reads for replay-or-reject).
 */
export async function insertOperationRow(
  tx: AccountingTxClient,
  create: AccountingPostingOperationCreate,
): Promise<void> {
  await tx.accountingPostingOperation.create({ data: create });
}

function toDomain(
  row: AccountingPostingOperationRow,
): AccountingPostingOperation {
  if (!isAccountingPostingOperationKind(row.operation)) {
    throw new Error(
      `Stored accounting posting operation "${row.id}" has an unknown operation "${row.operation}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    operationKey: row.operationKey,
    operation: row.operation,
    requestHash: row.requestHash,
    result: parsePostingOperationResult(row.result),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
