import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { GeneralLedgerRow } from '@/api/contracts';
import { AmountCell } from '@/features/accounting/shared/amount-cell';
import { formatDateOnly, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * General Ledger column definitions (kept out of the page component).
 *
 * A column id is EXACTLY the backend sort field it maps to, and only the
 * fields of the endpoint's sort allow-list
 * (`documentDate, postingTimestamp, documentId, ledgerLineId, accountCode,
 * accountName, accountId`) are sortable — so the UI can never request a sort
 * the API rejects with 400.
 *
 * Drill-down (FE-UX-08): when the session also holds
 * `Accounting.Document.View`, the voucher number links to the document's own
 * page (`documentId` is part of every ledger row); without that permission
 * it stays plain text — never a dead link.
 */
export function buildGeneralLedgerColumns(
  canOpenDocument: boolean,
): ColumnDef<GeneralLedgerRow, unknown>[] {
  return [
    {
      id: 'documentDate',
      accessorKey: 'documentDate',
      header: t.generalLedger.documentDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="code">
          {formatDateOnly(row.original.documentDate)}
        </span>
      ),
    },
    {
      id: 'voucherNumber',
      accessorKey: 'voucherNumber',
      header: t.generalLedger.voucherNumber,
      enableSorting: false,
      cell: ({ row }) =>
        canOpenDocument ? (
          <Link
            className="code font-semibold text-indigo-700 hover:underline"
            to={`/app/accounting/documents/${encodeURIComponent(
              row.original.documentId,
            )}`}
          >
            {row.original.voucherNumber}
          </Link>
        ) : (
          <span className="code">{row.original.voucherNumber}</span>
        ),
    },
    {
      id: 'lineNo',
      accessorKey: 'lineNo',
      header: t.generalLedger.lineNo,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="num block">{row.original.lineNo}</span>
      ),
    },
    {
      id: 'accountCode',
      accessorKey: 'accountCode',
      header: t.generalLedger.accountCode,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="code">{row.original.accountCode}</span>
      ),
    },
    {
      id: 'accountName',
      accessorKey: 'accountName',
      header: t.generalLedger.accountName,
      enableSorting: true,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t.generalLedger.description,
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="block max-w-xs truncate"
          title={row.original.description ?? ''}
        >
          {row.original.description ?? t.app.none}
        </span>
      ),
    },
    {
      id: 'debit',
      accessorKey: 'debit',
      header: t.generalLedger.debit,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.debit} />,
    },
    {
      id: 'credit',
      accessorKey: 'credit',
      header: t.generalLedger.credit,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.credit} />,
    },
    {
      id: 'net',
      accessorKey: 'net',
      header: t.generalLedger.net,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.net} />,
    },
    {
      id: 'postingTimestamp',
      accessorKey: 'postingTimestamp',
      header: t.generalLedger.postingTimestamp,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="code">
          {formatDateTime(row.original.postingTimestamp)}
        </span>
      ),
    },
  ];
}
