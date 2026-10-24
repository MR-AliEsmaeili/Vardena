import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AccountingDocument, FinancialArea } from '@/api/contracts';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { AmountCell } from '@/ui/patterns/amount-cell';
import {
  documentOriginLabel,
  documentStatePresentation,
  parseDocumentState,
} from './document-lifecycle';

/**
 * Documents list columns.
 *
 * A sortable column's id is EXACTLY a field of the endpoint's sort allow-list
 * (`documentDate, documentNumber, createdAt, updatedAt`); only the two
 * meaningful to the workspace are offered as sortable. The state cell renders
 * the API's own phase vocabulary; an unknown value (a newer backend) renders
 * the raw code honestly instead of a guessed label.
 */
export function buildDocumentsColumns(
  areas: readonly FinancialArea[],
): ColumnDef<AccountingDocument, unknown>[] {
  const areaById = new Map(areas.map((area) => [area.id, area]));

  return [
    {
      id: 'documentNumber',
      accessorKey: 'documentNumber',
      header: t.documents.colNumber,
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          className="code font-semibold text-brand hover:underline"
          to={`/app/accounting/documents/${encodeURIComponent(row.original.id)}`}
        >
          {row.original.documentNumber ?? t.app.none}
        </Link>
      ),
    },
    {
      id: 'documentDate',
      accessorKey: 'documentDate',
      header: t.documents.colDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className="code"
          title={formatDateOnlyCanonical(row.original.documentDate)}
        >
          {formatDateOnly(row.original.documentDate)}
        </span>
      ),
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t.documents.colDescription,
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="block max-w-72 truncate"
          title={row.original.description}
        >
          {row.original.description}
        </span>
      ),
    },
    {
      id: 'financialArea',
      accessorKey: 'financialAreaId',
      header: t.documents.colArea,
      enableSorting: false,
      cell: ({ row }) => {
        const area = areaById.get(row.original.financialAreaId);
        // One cell = one line of content. The area title is the value a user
        // scans for; its code stays available as the hover title instead of
        // splitting the cell into two visual halves.
        return area === undefined ? (
          <span className="text-ink-subtle">{t.app.none}</span>
        ) : (
          <span
            className="block max-w-40 truncate text-ink-muted"
            title={`${area.code} — ${area.title}`}
          >
            {area.title}
          </span>
        );
      },
    },
    {
      id: 'totalDebit',
      accessorKey: 'totalDebit',
      header: t.documents.colTotal,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.totalDebit} />,
    },
    {
      id: 'state',
      accessorKey: 'state',
      header: t.documents.colState,
      enableSorting: false,
      cell: ({ row }) => {
        const state = parseDocumentState(row.original.state);
        if (state === null) {
          return (
            <span className="code text-xs text-ink-subtle">
              {row.original.state}
            </span>
          );
        }
        const presentation = documentStatePresentation[state];
        return (
          <Badge variant={presentation.variant}>{presentation.label}</Badge>
        );
      },
    },
    {
      id: 'origin',
      accessorKey: 'origin',
      header: t.documents.colOrigin,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-xs text-ink-muted">
          {documentOriginLabel(row.original.origin)}
        </span>
      ),
    },
    {
      id: 'action',
      header: t.documents.colAction,
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          className="text-sm font-medium text-brand hover:underline"
          to={`/app/accounting/documents/${encodeURIComponent(row.original.id)}`}
        >
          {t.documents.view}
        </Link>
      ),
    },
  ];
}
