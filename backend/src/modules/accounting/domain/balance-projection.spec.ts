import { describe, expect, it } from 'vitest';
import {
  aggregateLedgerTurnovers,
  balanceProjectionKey,
  checkBalanceProjection,
  classifyMismatch,
  deriveBalances,
  periodNetAmount,
  reconcileBalances,
} from './balance-projection.js';
import type { AccountBalanceProjection } from './balance-projection.js';

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const P1 = '01H0000000000000000000004';
const P2 = '01H0000000000000000000005';
const P3 = '01H0000000000000000000006';
const ACC_A = '01H0000000000000000000007';
const ACC_B = '01H0000000000000000000008';

function proj(
  overrides: Partial<AccountBalanceProjection> & {
    periodDebitAmount: string;
    periodCreditAmount: string;
  },
): AccountBalanceProjection {
  return {
    id: 'test-id',
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: P1,
    accountId: ACC_A,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  } as AccountBalanceProjection;
}

describe('balance-projection domain (Task 12, ADR-0031)', () => {
  describe('checkBalanceProjection', () => {
    it('accepts a valid turnover row', () => {
      expect(
        checkBalanceProjection(
          proj({ periodDebitAmount: '100.00', periodCreditAmount: '0' }),
        ),
      ).toEqual([]);
    });
    it('rejects zero turnover row (absence = zero)', () => {
      expect(
        checkBalanceProjection(
          proj({ periodDebitAmount: '0', periodCreditAmount: '0' }),
        ),
      ).toContain('zero_turnover_row');
    });
    it('rejects negative via malformed pattern', () => {
      expect(
        checkBalanceProjection(
          proj({ periodDebitAmount: '-10.00', periodCreditAmount: '0' }),
        ),
      ).toContain('invalid_period_debit');
    });
    it('rejects malformed with 3 decimals', () => {
      expect(
        checkBalanceProjection(
          proj({ periodDebitAmount: '10.001', periodCreditAmount: '0' }),
        ),
      ).toContain('invalid_period_debit');
    });
    it('rejects missing organization', () => {
      expect(
        checkBalanceProjection(
          proj({
            organizationId: '',
            periodDebitAmount: '10',
            periodCreditAmount: '0',
          }),
        ),
      ).toContain('missing_organization');
    });
  });

  describe('periodNetAmount', () => {
    it('debit - credit exact', () => {
      expect(periodNetAmount('100.50', '20.25')).toBe('80.25');
      expect(periodNetAmount('0', '50')).toBe('-50');
      expect(periodNetAmount('0.01', '0.01')).toBe('0');
    });
  });

  describe('aggregateLedgerTurnovers', () => {
    it('groups by projection key and sums exact', () => {
      const entries = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          debitAmount: '100.00',
          creditAmount: '0',
        },
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          debitAmount: '50.00',
          creditAmount: '0',
        },
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_B,
          debitAmount: '0',
          creditAmount: '30.00',
        },
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P2,
          accountId: ACC_A,
          debitAmount: '0',
          creditAmount: '20.00',
        },
      ];
      const out = aggregateLedgerTurnovers(entries);
      expect(out).toHaveLength(3);
      const byKey = new Map(out.map((r) => [balanceProjectionKey(r), r]));
      expect(byKey.get(`${ORG}|${AREA}|${YEAR}|${P1}|${ACC_A}`)).toMatchObject({
        periodDebitAmount: '150',
        periodCreditAmount: '0',
      });
      expect(byKey.get(`${ORG}|${AREA}|${YEAR}|${P1}|${ACC_B}`)).toMatchObject({
        periodDebitAmount: '0',
        periodCreditAmount: '30',
      });
      expect(byKey.get(`${ORG}|${AREA}|${YEAR}|${P2}|${ACC_A}`)).toMatchObject({
        periodDebitAmount: '0',
        periodCreditAmount: '20',
      });
    });
    it('omits zero-sum groups (absence = zero)', () => {
      const entries = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          debitAmount: '0',
          creditAmount: '0',
        },
      ];
      expect(aggregateLedgerTurnovers(entries)).toHaveLength(0);
    });
    it('is deterministic order', () => {
      const entries = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P2,
          accountId: ACC_A,
          debitAmount: '10',
          creditAmount: '0',
        },
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          debitAmount: '5',
          creditAmount: '0',
        },
      ];
      const out = aggregateLedgerTurnovers(entries);
      expect(out[0]!.accountingPeriodId).toBe(P1); // sorted by key
    });
  });

  describe('deriveBalances', () => {
    it('computes opening/closing per partition ordered by sequence, never crossing year', () => {
      const projections: AccountBalanceProjection[] = [
        proj({
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '100',
          periodCreditAmount: '0',
        }),
        proj({
          accountingPeriodId: P2,
          accountId: ACC_A,
          periodDebitAmount: '0',
          periodCreditAmount: '30',
        }),
        proj({
          accountingPeriodId: P3,
          accountId: ACC_A,
          periodDebitAmount: '20',
          periodCreditAmount: '0',
        }),
      ];
      const periodsByYear = new Map([
        [
          YEAR,
          [
            { id: P1, sequence: 1 },
            { id: P2, sequence: 2 },
            { id: P3, sequence: 3 },
          ],
        ],
      ]);
      const derived = deriveBalances(projections, periodsByYear);
      expect(derived).toHaveLength(3);
      expect(derived[0]).toMatchObject({
        accountingPeriodId: P1,
        periodDebitAmount: '100',
        periodCreditAmount: '0',
        periodNetAmount: '100',
        openingBalanceAmount: '0',
        closingBalanceAmount: '100',
      });
      expect(derived[1]).toMatchObject({
        accountingPeriodId: P2,
        periodDebitAmount: '0',
        periodCreditAmount: '30',
        periodNetAmount: '-30',
        openingBalanceAmount: '100',
        closingBalanceAmount: '70',
      });
      expect(derived[2]).toMatchObject({
        accountingPeriodId: P3,
        periodDebitAmount: '20',
        periodCreditAmount: '0',
        periodNetAmount: '20',
        openingBalanceAmount: '70',
        closingBalanceAmount: '90',
      });
    });
    it('excludes periods with no turnover (absence ≠ zero row)', () => {
      const projections: AccountBalanceProjection[] = [
        proj({
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '50',
          periodCreditAmount: '0',
        }),
        // P2 missing — no row
        proj({
          accountingPeriodId: P3,
          accountId: ACC_A,
          periodDebitAmount: '10',
          periodCreditAmount: '0',
        }),
      ];
      const periodsByYear = new Map([
        [
          YEAR,
          [
            { id: P1, sequence: 1 },
            { id: P2, sequence: 2 },
            { id: P3, sequence: 3 },
          ],
        ],
      ]);
      const derived = deriveBalances(projections, periodsByYear);
      expect(derived).toHaveLength(2);
      // Opening for P3 is closing of P1 (since P2 absent => 0 turnover, not a 0 row) — correct per "absence = zero turnover, NOT a zero-balance row"
      // Our derive sums only present periods: opening for P3 = 50
      expect(
        derived.find((d) => d.accountingPeriodId === P3)!.openingBalanceAmount,
      ).toBe('50');
    });
    it('each (org, area, year, account) partition restarts opening at 0', () => {
      const y2 = '01H0000000000000000000009';
      const projections: AccountBalanceProjection[] = [
        proj({
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '100',
          periodCreditAmount: '0',
        }),
        proj({
          fiscalYearId: y2,
          accountingPeriodId: P2,
          accountId: ACC_A,
          periodDebitAmount: '200',
          periodCreditAmount: '0',
        }),
      ];
      const periodsByYear = new Map([
        [YEAR, [{ id: P1, sequence: 1 }]],
        [y2, [{ id: P2, sequence: 1 }]],
      ]);
      const derived = deriveBalances(projections, periodsByYear);
      expect(
        derived.find((d) => d.fiscalYearId === YEAR)!.openingBalanceAmount,
      ).toBe('0');
      expect(
        derived.find((d) => d.fiscalYearId === y2)!.openingBalanceAmount,
      ).toBe('0');
    });
  });

  describe('classifyMismatch', () => {
    it('classifies missing/extra/both/debit/credit/matched', () => {
      expect(
        classifyMismatch({
          ledgerDebit: '10',
          ledgerCredit: '0',
          projectionDebit: null,
          projectionCredit: null,
        }),
      ).toBe('missing_projection');
      expect(
        classifyMismatch({
          ledgerDebit: null,
          ledgerCredit: null,
          projectionDebit: '10',
          projectionCredit: '0',
        }),
      ).toBe('extra_projection');
      expect(
        classifyMismatch({
          ledgerDebit: '10',
          ledgerCredit: '0',
          projectionDebit: '10',
          projectionCredit: '0',
        }),
      ).toBe('matched');
      expect(
        classifyMismatch({
          ledgerDebit: '11',
          ledgerCredit: '0',
          projectionDebit: '10',
          projectionCredit: '0',
        }),
      ).toBe('debit_mismatch');
      expect(
        classifyMismatch({
          ledgerDebit: '10',
          ledgerCredit: '5',
          projectionDebit: '10',
          projectionCredit: '6',
        }),
      ).toBe('credit_mismatch');
      expect(
        classifyMismatch({
          ledgerDebit: '11',
          ledgerCredit: '5',
          projectionDebit: '10',
          projectionCredit: '6',
        }),
      ).toBe('both_mismatch');
    });
  });

  describe('reconcileBalances', () => {
    it('returns only mismatches, excludes matched', () => {
      const ledger = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '100',
          periodCreditAmount: '0',
        },
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P2,
          accountId: ACC_A,
          periodDebitAmount: '50',
          periodCreditAmount: '0',
        },
      ];
      const projs = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '100',
          periodCreditAmount: '0',
        }, // matched
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P2,
          accountId: ACC_A,
          periodDebitAmount: '51',
          periodCreditAmount: '0',
        }, // debit mismatch
      ];
      const mism = reconcileBalances({
        ledgerAggregates: ledger,
        projections: projs,
      });
      expect(mism).toHaveLength(1);
      expect(mism[0]).toMatchObject({
        accountingPeriodId: P2,
        mismatchKind: 'debit_mismatch',
      });
    });
    it('detects missing and extra', () => {
      const ledger = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P1,
          accountId: ACC_A,
          periodDebitAmount: '10',
          periodCreditAmount: '0',
        },
      ];
      const projs = [
        {
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: P2,
          accountId: ACC_A,
          periodDebitAmount: '10',
          periodCreditAmount: '0',
        },
      ];
      const mism = reconcileBalances({
        ledgerAggregates: ledger,
        projections: projs,
      });
      expect(mism.map((m) => m.mismatchKind).sort()).toEqual([
        'extra_projection',
        'missing_projection',
      ]);
    });
  });
});
