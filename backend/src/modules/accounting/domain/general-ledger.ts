import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { formatDateOnly } from './date-range.js';
import { canonicalizeAmount, subtractAmounts } from './money.js';
import type { GeneralLedgerReadRow } from '../data/accounting-read-query.repository.js';

/**
 * General Ledger row contract. It is deliberately ledger-native: document and
 * ledger-line ids are stable drill-down references, while document type and
 * the current account labels are joined from Accounting-owned authoritative
 * rows by id. `reference` is the existing voucher-line source reference; the
 * repository has no generic reference field, so null is returned when it is
 * unavailable rather than fabricating one.
 */
export interface GeneralLedgerRow {
  organizationId: string;
  documentDate: BusinessDate;
  postingTimestamp: string;
  documentType: string;
  documentId: string;
  /** Own immutable `ledger_entries.id`. */
  ledgerEntryId: string;
  /** Compatibility label for the source ledger line identity. */
  ledgerLineId: string;
  /** Immutable 1:1 voucher-line traceability identity. */
  voucherLineId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  reference: string | null;
  description: string | null;
  debit: string;
  credit: string;
  net: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  voucherNumber: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  lineNo: number;
  origin: string;
}

export function toGeneralLedgerRow(
  row: GeneralLedgerReadRow,
): GeneralLedgerRow {
  const debit = canonicalizeAmount(row.debit);
  const credit = canonicalizeAmount(row.credit);
  return {
    organizationId: row.organizationId,
    documentDate: row.documentDate,
    postingTimestamp: row.postingTimestamp,
    documentType: row.documentType,
    documentId: row.documentId,
    ledgerEntryId: row.id,
    ledgerLineId: row.ledgerLineId,
    voucherLineId: row.voucherLineId,
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    reference: row.reference,
    description: row.description,
    debit,
    credit,
    net: subtractAmounts(debit, credit),
    financialAreaId: row.financialAreaId,
    fiscalYearId: row.fiscalYearId,
    accountingPeriodId: row.accountingPeriodId,
    voucherNumber: row.voucherNumber,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    sourceOperation: row.sourceOperation,
    lineNo: row.lineNo,
    origin: row.origin,
  };
}

/** Framework-free date rendering helper for scope-aware tests and adapters. */
export function renderGeneralLedgerDate(date: BusinessDate): string {
  return formatDateOnly(date);
}
