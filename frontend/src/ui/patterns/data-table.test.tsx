import type { ColumnDef } from '@tanstack/react-table';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from './data-table';

/**
 * Section-level behavior of the one table primitive:
 * - the first load is a page-shaped skeleton with the Thinking Orb;
 * - a refresh keeps the rows usable and adds only the LOCAL label;
 * - a failure replaces the table with the persistent error, never with a
 *   loading state.
 */

interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'نام' },
];
const rows: Row[] = [{ id: 'row-1', name: 'ردیف یک' }];

function renderTable(overrides: {
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
}) {
  return render(
    <DataTable<Row>
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DataTable loading surfaces', () => {
  it('renders the local loading state with an orb before the first page', () => {
    renderTable({ isLoading: true });

    const loading = screen.getByTestId('loading-state');
    expect(loading).toHaveTextContent(t.table.loading);
    expect(loading.querySelector('canvas')).not.toBeNull();
    expect(screen.queryByText('ردیف یک')).toBeNull();
  });

  it('keeps rows usable and shows only the local refresh label', () => {
    vi.useFakeTimers();
    const { container } = renderTable({ isFetching: true });

    expect(screen.getByText('ردیف یک')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const indicator = screen.getByTestId('local-fetching-indicator');
    expect(indicator).toHaveAttribute('data-visible', 'true');
    expect(indicator).toHaveTextContent(t.table.refreshing);
  });

  it('renders a failure separately and never as loading', () => {
    renderTable({
      isLoading: true,
      isFetching: true,
      error: new ApiError({
        code: 'InternalError',
        message: 'boom',
        correlationId: 'corr-table',
      }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent(t.errors.title);
    expect(screen.queryByTestId('loading-state')).toBeNull();
    expect(screen.queryByTestId('local-fetching-indicator')).toBeNull();
  });

  it('keeps exactly one local indicator when server pagination is present', () => {
    renderTable({
      isFetching: true,
      pagination: {
        page: 1,
        pageSize: 25,
        total: 1,
        onPageChange: vi.fn(),
      },
    });

    expect(screen.getAllByTestId('local-fetching-indicator')).toHaveLength(1);
    expect(screen.getByRole('button', { name: t.table.next })).toBeDisabled();
  });
});

describe('DataTable empty result', () => {
  it('renders the labelled empty block instead of a bare header row', () => {
    render(
      <DataTable<Row> columns={columns} data={[]} getRowId={(row) => row.id} />,
    );

    const empty = screen.getByTestId('data-table-empty');
    expect(empty).toHaveTextContent(t.table.emptyTitle);
    expect(empty).toHaveTextContent(t.table.emptyBody);
    expect(screen.queryByText('ردیف یک')).toBeNull();
  });

  it('renders the caller recovery action only in the empty state', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const { rerender } = render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        emptyAction={
          <Button size="sm" onClick={onCreate}>
            ساخت اولین ردیف
          </Button>
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ساخت اولین ردیف' }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    rerender(
      <DataTable<Row>
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        emptyAction={
          <Button size="sm" onClick={onCreate}>
            ساخت اولین ردیف
          </Button>
        }
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'ساخت اولین ردیف' }),
    ).not.toBeInTheDocument();
  });
});

describe('DataTable server-side sorting affordance', () => {
  it('marks the sortable header with aria-sort and an icon per state', async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn();
    const { rerender } = render(
      <DataTable<Row>
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );

    const header = screen.getByRole('columnheader');
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByTestId('sort-icon-none')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'نام' }));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);

    rerender(
      <DataTable<Row>
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={[{ id: 'name', desc: false }]}
        onSortingChange={onSortingChange}
      />,
    );

    expect(screen.getByRole('columnheader')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByTestId('sort-icon-asc')).toBeInTheDocument();

    rerender(
      <DataTable<Row>
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={[{ id: 'name', desc: true }]}
        onSortingChange={onSortingChange}
      />,
    );

    expect(screen.getByRole('columnheader')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByTestId('sort-icon-desc')).toBeInTheDocument();
  });

  it('leaves an unsortable table without a header button or sort state', () => {
    renderTable({});

    expect(screen.queryByRole('button', { name: 'نام' })).toBeNull();
    expect(screen.getByRole('columnheader')).not.toHaveAttribute('aria-sort');
    expect(screen.queryByTestId('sort-icon-none')).toBeNull();
  });
});
