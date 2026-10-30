import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { MaterialRequest, MaterialRequestStatus } from '@/api/contracts';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

/** Status → badge tone (presentation only; the label comes from i18n). */
const STATUS_VARIANT: Record<
  MaterialRequestStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  draft: 'neutral',
  submitted: 'info',
  returned: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** Server-sorted list columns; every sortable id is backend allow-listed. */
export function materialRequestsColumns(): ColumnDef<
  MaterialRequest,
  unknown
>[] {
  return [
    {
      id: 'number',
      accessorKey: 'number',
      enableSorting: true,
      header: t.materialRequests.number,
      cell: ({ row }) =>
        row.original.number === null ? (
          <span className="text-ink-subtle">
            {t.materialRequests.draftNumber}
          </span>
        ) : (
          <span className="code" dir="ltr">
            {row.original.number}
          </span>
        ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      enableSorting: true,
      header: t.materialRequests.status,
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {t.materialRequests.statuses[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'description',
      accessorKey: 'description',
      enableSorting: false,
      header: t.materialRequests.description,
      cell: ({ row }) => {
        const description = row.original.description;
        if (description === null) return t.app.none;
        return (
          <span className="block max-w-[28rem] truncate" title={description}>
            {description}
          </span>
        );
      },
    },
    {
      id: 'requestedBy',
      accessorKey: 'requestedBy',
      enableSorting: false,
      header: t.materialRequests.requestedBy,
      cell: ({ row }) => (
        <span className="code" dir="ltr">
          {row.original.requestedBy}
        </span>
      ),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      enableSorting: true,
      header: t.materialRequests.createdAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.createdAt}>
          {formatDateTimeWithZone(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: t.materialRequests.openDetails,
      cell: ({ row }) => (
        <Button asChild size="sm" variant="ghost">
          <Link to={`/app/inventory/material-requests/${row.original.id}`}>
            {t.materialRequests.openDetails}
          </Link>
        </Button>
      ),
    },
  ];
}
