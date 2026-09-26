import type { ColumnDef } from '@tanstack/react-table';
import type { AccountStatementEntry } from '@/api/contracts';
import { AmountCell } from '@/features/accounting/shared/amount-cell';
import { formatDateOnly, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Account statement movement columns.
 *
 * Nothing here is sortable: the endpoint returns a FIXED order
 * (`documentDate, voucherNumber, lineNo, id`) — the same order the running
 * balance is computed in server-side — and rejects an explicit sort with 400.
 * `runningBalanceAmount` is displayed exactly as returned; it is never
 * recomputed client-side.
 */
export const accountStatementColumns: ColumnDef<
  AccountStatementEntry,
  unknown
>[] = [
  {
    id: 'documentDate',
    accessorKey: 'documentDate',
    header: t.statement.documentDate,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="code">{formatDateOnly(row.original.documentDate)}</span>
    ),
  },
  {
    id: 'voucherNumber',
    accessorKey: 'voucherNumber',
    header: t.statement.voucherNumber,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="code">{row.original.voucherNumber}</span>
    ),
  },
  {
    id: 'lineNo',
    accessorKey: 'lineNo',
    header: t.statement.lineNo,
    enableSorting: false,
    cell: ({ row }) => <span className="num block">{row.original.lineNo}</span>,
  },
  {
    id: 'description',
    accessorKey: 'description',
    header: t.statement.description,
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
    id: 'debitAmount',
    accessorKey: 'debitAmount',
    header: t.statement.debit,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.debitAmount} />,
  },
  {
    id: 'creditAmount',
    accessorKey: 'creditAmount',
    header: t.statement.credit,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.creditAmount} />,
  },
  {
    id: 'netAmount',
    accessorKey: 'netAmount',
    header: t.statement.net,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.netAmount} />,
  },
  {
    id: 'runningBalanceAmount',
    accessorKey: 'runningBalanceAmount',
    header: t.statement.runningBalance,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <AmountCell
        value={row.original.runningBalanceAmount}
        className="font-medium"
      />
    ),
  },
  {
    id: 'postingTimestamp',
    accessorKey: 'postingTimestamp',
    header: t.statement.postingTimestamp,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="code">
        {formatDateTime(row.original.postingTimestamp)}
      </span>
    ),
  },
];
