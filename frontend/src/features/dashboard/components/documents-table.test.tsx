import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingDocument } from '@/api/contracts';
import type { SortingState } from '@tanstack/react-table';
import { t } from '@/lib/i18n';
import { testAccountingDocument } from '@/test/fixtures';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { DocumentsTable } from './documents-table';

// BusinessDate presentation is fixed Jalali-first; only the organization's
// IANA time zone is supplied by the test arrangement.
beforeEach(() => {
  setDateTimeSettings({ timeZone: 'UTC' });
});

afterEach(() => {
  resetDateTimeSettings();
});

const baseProps = {
  documents: [testAccountingDocument] as AccountingDocument[],
  total: 1,
  page: 1,
  pageSize: 9,
  sorting: [] as SortingState,
  isLoading: false,
  isFetching: false,
  error: undefined,
  onRetry: () => undefined,
  onPageChange: () => undefined,
  onPageSizeChange: () => undefined,
  onSortingChange: () => undefined,
  hasFilter: false,
};

describe('dashboard documents table', () => {
  it('renders the exact decimal amounts and localized state badge', () => {
    render(<DocumentsTable {...baseProps} />);

    // The exact string the API returned — separators only, never recomputed.
    expect(screen.getByText('1,250,000.00')).toBeInTheDocument();
    expect(screen.getByText(t.dashboard.stateFinal)).toBeInTheDocument();
    expect(screen.getByText('1001')).toBeInTheDocument();
    expect(screen.getByText('۱۴۰۵/۰۱/۱۶')).toBeInTheDocument();
  });

  it('delegates pagination to the callback instead of slicing local data', () => {
    const onPageChange = vi.fn();
    render(
      <DocumentsTable {...baseProps} total={20} onPageChange={onPageChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: t.table.next }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('reports a sort toggle on the sortable date column', () => {
    const onSortingChange = vi.fn();
    render(
      <DocumentsTable
        {...baseProps}
        sorting={[{ id: 'documentDate', desc: true }]}
        onSortingChange={onSortingChange}
      />,
    );

    // The header button's accessible name carries the sort glyph as well.
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`^${t.dashboard.colDocumentDate}`),
      }),
    );
    expect(onSortingChange).toHaveBeenCalledTimes(1);
  });

  it('renders the dedicated empty state when the page has no rows', () => {
    render(<DocumentsTable {...baseProps} documents={[]} total={0} />);
    expect(
      screen.getByText(t.dashboard.documentsEmptyTitle),
    ).toBeInTheDocument();
  });
});
