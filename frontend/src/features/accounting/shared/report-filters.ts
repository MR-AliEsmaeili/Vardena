import { z } from 'zod';
import { t } from '@/lib/i18n';
import { createReportUrlCodec } from './use-report-query-state';

/**
 * Filter schemas for the accounting report screens.
 *
 * Only filters the endpoints actually declare are modelled here — the global
 * validation pipe rejects unknown query parameters with 400, so an invented
 * filter would be a runtime error, not a feature. The date pattern is the
 * backend's own date-only contract
 * (`backend/src/modules/accounting/domain/date-range.ts`:
 * `/^\d{4}-\d{2}-\d{2}$/`); no calendar conversion happens in the UI.
 */

/** `YYYY-MM-DD`, exactly as the API accepts it. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || DATE_ONLY_PATTERN.test(value), {
    message: t.filters.invalidDate,
  });

/** Ledger-style scope shared by General Ledger and Trial Balance. */
export const ledgerScopeSchema = z.object({
  financialAreaId: z.string().min(1, t.filters.requiredField),
  fiscalYearId: z.string().min(1, t.filters.requiredField),
  accountingPeriodId: z.string(),
  accountId: z.string(),
  accountCode: z.string().trim(),
  accountName: z.string().trim(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export type LedgerScopeValues = z.infer<typeof ledgerScopeSchema>;

export const emptyLedgerScope: LedgerScopeValues = {
  financialAreaId: '',
  fiscalYearId: '',
  accountingPeriodId: '',
  accountId: '',
  accountCode: '',
  accountName: '',
  dateFrom: '',
  dateTo: '',
};

export const ledgerUrlCodec = createReportUrlCodec<LedgerScopeValues>(
  [
    'financialAreaId',
    'fiscalYearId',
    'accountingPeriodId',
    'accountId',
    'accountCode',
    'accountName',
    'dateFrom',
    'dateTo',
  ],
  emptyLedgerScope,
  ['financialAreaId', 'fiscalYearId'],
);

/** Account statement scope: one account inside one fiscal year. */
export const statementScopeSchema = z.object({
  financialAreaId: z.string(),
  fiscalYearId: z.string().min(1, t.filters.requiredField),
  accountingPeriodId: z.string(),
  accountId: z.string().min(1, t.filters.requiredField),
});

export type StatementScopeValues = z.infer<typeof statementScopeSchema>;

export const emptyStatementScope: StatementScopeValues = {
  financialAreaId: '',
  fiscalYearId: '',
  accountingPeriodId: '',
  accountId: '',
};

export const statementUrlCodec = createReportUrlCodec<StatementScopeValues>(
  ['financialAreaId', 'fiscalYearId', 'accountingPeriodId', 'accountId'],
  emptyStatementScope,
  ['fiscalYearId', 'accountId'],
);

/** `''` means "filter not set" in the form; the API must not receive it. */
export function optionalParam(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
