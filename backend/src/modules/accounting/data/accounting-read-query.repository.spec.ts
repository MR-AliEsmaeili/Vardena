import { describe, expect, it } from 'vitest';
import { parseDateOnly } from '../domain/date-range.js';
import { AccountingReadQueryRepository } from './accounting-read-query.repository.js';

type QueryCall = { text: string; values: unknown[] };

type FakeRawClient = {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    callback: (tx: FakeRawClient) => Promise<T>,
    options?: unknown,
  ): Promise<T>;
};

function makeRepository(responses: readonly unknown[]): {
  repository: AccountingReadQueryRepository;
  calls: QueryCall[];
  transactionOptions: () => unknown;
} {
  const calls: QueryCall[] = [];
  let responseIndex = 0;
  let transactionOptions: unknown;
  const client: FakeRawClient = {
    async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]) {
      calls.push({ text: Array.from(strings).join('?'), values });
      return responses[responseIndex++] as T;
    },
    async $transaction<T>(
      callback: (tx: FakeRawClient) => Promise<T>,
      options?: unknown,
    ) {
      transactionOptions = options;
      return callback(client);
    },
  };
  const prisma = {
    getClient: async () => client,
  };
  return {
    repository: new AccountingReadQueryRepository(prisma as never),
    calls,
    transactionOptions: () => transactionOptions,
  };
}

const scope = {
  organizationId: '01H0000000000000000000001',
  financialAreaId: '01H0000000000000000000002',
  fiscalYearId: '01H0000000000000000000003',
};

describe('AccountingReadQueryRepository raw report reads', () => {
  it('maps General Ledger source identity/origin and keeps the read transaction bounded', async () => {
    const { repository, calls, transactionOptions } = makeRepository([
      [
        {
          id: '01H0000000000000000000004',
          organizationId: scope.organizationId,
          financialAreaId: scope.financialAreaId,
          fiscalYearId: scope.fiscalYearId,
          accountingPeriodId: '01H0000000000000000000005',
          documentDate: new Date('2026-03-21T00:00:00.000Z'),
          postingTimestamp: new Date('2026-03-21T10:00:00.000Z'),
          documentType: 'accounting_voucher',
          documentId: '01H0000000000000000000006',
          ledgerLineId: '01H0000000000000000000007',
          voucherLineId: '01H0000000000000000000007',
          lineNo: 1,
          origin: 'manual',
          accountId: '01H0000000000000000000008',
          accountCode: '1101',
          accountName: 'Cash',
          reference: 'line-ref',
          description: 'Cash movement',
          debit: '1234567890123456.78',
          credit: '0.01',
          voucherNumber: '00001',
          sourceModule: null,
          sourceEntityType: null,
          sourceEntityId: null,
          sourceOperation: null,
        },
      ],
      [{ total: 1n }],
    ]);

    const result = await repository.readGeneralLedger(
      {
        ...scope,
        dateFrom: parseDateOnly('2026-03-21')!,
        dateFromExplicit: true,
      },
      [{ field: 'documentDate', direction: 'asc' }],
      0,
      100,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      documentType: 'accounting_voucher',
      ledgerLineId: '01H0000000000000000000007',
      voucherLineId: '01H0000000000000000000007',
      lineNo: 1,
      origin: 'manual',
      reference: 'line-ref',
      debit: '1234567890123456.78',
      credit: '0.01',
      net: '1234567890123456.77',
    });
    expect(transactionOptions()).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 5000,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('builds Trial Balance hierarchy and period-opening reads without report persistence', async () => {
    const { repository, calls, transactionOptions } = makeRepository([
      [],
      [{ total: 0n }],
    ]);

    const result = await repository.readTrialBalance(
      {
        ...scope,
        accountingPeriodId: '01H0000000000000000000005',
      },
      [{ field: 'closing', direction: 'desc' }],
      0,
      100,
    );

    expect(result).toEqual({ items: [], total: 0 });
    expect(calls[0]?.text).toContain('period_opening');
    expect(calls[0]?.text).toContain('account_rollup');
    expect(calls[0]?.text).toContain('is_postable');
    expect(calls[0]?.text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(calls[0]?.text).not.toContain('account_balance_projections');
    expect(transactionOptions()).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 5000,
    });
  });
});
