import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  AccountingReadQueryRepository,
  type AccountStatementLedgerFacts,
  type StatementAccountRef,
  type StatementAreaRef,
  type StatementLedgerWhere,
  type StatementPeriodRef,
  type StatementYearRef,
} from './accounting-read-query.repository.js';

/**
 * Compatibility-named Accounting Statement repository.
 *
 * The implementation is the shared Accounting Read/Query Layer. Keeping this
 * narrow adapter preserves the accepted Task 17B injection/test seam while
 * making the Task 18 report services consume the same query primitives.
 */
@Injectable()
export class AccountStatementsRepository extends AccountingReadQueryRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Preserve the Task 17B class's read-only prototype surface. */
  client() {
    return super.client();
  }

  findAccount(
    ...args: Parameters<AccountingReadQueryRepository['findAccount']>
  ) {
    return super.findAccount(...args);
  }

  findFinancialArea(
    ...args: Parameters<AccountingReadQueryRepository['findFinancialArea']>
  ) {
    return super.findFinancialArea(...args);
  }

  findFiscalYear(
    ...args: Parameters<AccountingReadQueryRepository['findFiscalYear']>
  ) {
    return super.findFiscalYear(...args);
  }

  findPeriod(...args: Parameters<AccountingReadQueryRepository['findPeriod']>) {
    return super.findPeriod(...args);
  }

  listPeriodsOfYear(
    ...args: Parameters<AccountingReadQueryRepository['listPeriodsOfYear']>
  ) {
    return super.listPeriodsOfYear(...args);
  }

  readStatementLedgerFacts(
    ...args: Parameters<
      AccountingReadQueryRepository['readStatementLedgerFacts']
    >
  ) {
    return super.readStatementLedgerFacts(...args);
  }
}

export type {
  AccountStatementLedgerFacts,
  StatementAccountRef,
  StatementAreaRef,
  StatementLedgerWhere,
  StatementPeriodRef,
  StatementYearRef,
};
export { STATEMENT_ORDER } from './accounting-read-query.repository.js';
