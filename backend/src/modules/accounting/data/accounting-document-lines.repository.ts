import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  AccountingDocumentLineRow,
  AccountingDocumentLineWhere,
  AccountingTxClient,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.accounting_document_lines` (Task 10.4,
 * contract §12.5, AC-I-09/AC-I-11).
 *
 * Lines are part of the DOCUMENT aggregate: every write to them happens
 * inside a transaction owned by `AccountingDocumentsRepository` (the account's
 * line set is replaced as a whole while the document is editable, §15.2).
 * This repository therefore owns the READS the other accounting aggregates
 * need, and nothing else:
 *
 * - `countForAccount` / `countForAccountInTx` answer AC-I-11's predicate
 *   ("has any document line ever referenced this account?"), which freezes an
 *   account's structural fields (§8.4 rule 4). The in-transaction variant is
 *   the one `AccountsRepository.updateChecked` uses, under the account row's
 *   `FOR UPDATE` lock — that is what makes the freeze race-safe against a
 *   concurrent voucher write taking the same row `FOR SHARE`
 *   (`accounting-locks.ts`).
 *
 * `countForAccountInTx` is a module-level function for the same reason
 * `insertOperationRow` is one in Inventory: it is called from inside ANOTHER
 * repository's transaction, never through a second connection (ADR-0022 §3 —
 * the effect and its evidence commit together).
 */

type Client = {
  accountingDocumentLine: {
    findMany(args: {
      where: AccountingDocumentLineWhere;
      orderBy: OrderBy;
    }): Promise<AccountingDocumentLineRow[]>;
    count(args: { where: AccountingDocumentLineWhere }): Promise<number>;
  };
};

@Injectable()
export class AccountingDocumentLinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  /**
   * How many document lines reference this account, across every document and
   * every phase. Never scoped by organization: the caller resolved the account
   * in scope first (`AccountsService.requireUsableAccountInOrganization`), and
   * an account id is globally unique — adding a scope filter here would only
   * hide a cross-organization reference instead of surfacing it.
   */
  async countForAccount(accountId: string): Promise<number> {
    const { accountingDocumentLine } = await this.client();
    return accountingDocumentLine.count({ where: { accountId } });
  }
}

/**
 * The in-transaction half of AC-I-11's predicate. Must be called while the
 * account row is locked (`lockAccountRow`), so a concurrent line insert either
 * committed before the count or waits on the `FOR SHARE`/`FOR UPDATE`
 * interlock.
 */
export async function countReferencingLinesInTx(
  tx: AccountingTxClient,
  accountId: string,
): Promise<number> {
  return tx.accountingDocumentLine.count({ where: { accountId } });
}
