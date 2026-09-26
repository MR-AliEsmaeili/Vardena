import type { ColumnDef } from '@tanstack/react-table';
import type { TrialBalanceRow } from '@/api/contracts';
import { AmountCell } from '@/features/accounting/shared/amount-cell';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';

/**
 * Trial Balance column definitions.
 *
 * Column ids match the endpoint's sort allow-list
 * (`accountCode, accountName, accountId, opening, debit, credit, periodNet,
 * closing`); the amount columns are sortable because the BACKEND sorts them.
 * No total row is rendered: the contract returns none and the frontend must
 * not compute accounting figures.
 */
export const trialBalanceColumns: ColumnDef<TrialBalanceRow, unknown>[] = [
  {
    id: 'accountCode',
    accessorKey: 'accountCode',
    header: t.trialBalance.accountCode,
    enableSorting: true,
    cell: ({ row }) => <span className="code">{row.original.accountCode}</span>,
  },
  {
    id: 'accountName',
    accessorKey: 'accountName',
    header: t.trialBalance.accountName,
    enableSorting: true,
  },
  {
    id: 'role',
    accessorKey: 'role',
    header: t.trialBalance.role,
    enableSorting: false,
    cell: ({ row }) => (
      <Badge variant={row.original.role === 'POSTING' ? 'success' : 'neutral'}>
        {row.original.role === 'POSTING'
          ? t.trialBalance.rolePosting
          : t.trialBalance.roleAggregation}
      </Badge>
    ),
  },
  {
    id: 'opening',
    accessorKey: 'opening',
    header: t.trialBalance.opening,
    enableSorting: true,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.opening} />,
  },
  {
    id: 'debit',
    accessorKey: 'debitTurnover',
    header: t.trialBalance.debitTurnover,
    enableSorting: true,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.debitTurnover} />,
  },
  {
    id: 'credit',
    accessorKey: 'creditTurnover',
    header: t.trialBalance.creditTurnover,
    enableSorting: true,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.creditTurnover} />,
  },
  {
    id: 'periodNet',
    accessorKey: 'periodNet',
    header: t.trialBalance.periodNet,
    enableSorting: true,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.periodNet} />,
  },
  {
    id: 'closing',
    accessorKey: 'closing',
    header: t.trialBalance.closing,
    enableSorting: true,
    meta: { align: 'end' },
    cell: ({ row }) => <AmountCell value={row.original.closing} />,
  },
];
