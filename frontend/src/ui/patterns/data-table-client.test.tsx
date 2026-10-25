import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { DataTable } from './data-table';

/**
 * Client-mode contract of the shared grid (`docs/frontend/data-table.md`):
 * the toolbar renders one control per declared filter, the global search is
 * debounced, the Persian text/number/date filters narrow the rows, the
 * no-match empty state is distinct from "no records", and the grid pages the
 * filtered result itself.
 */

interface AccountRow {
  id: string;
  code: string;
  title: string;
  nature: 'DEBIT' | 'CREDIT';
  openedOn: string;
  balance: string;
}

const rows: AccountRow[] = [
  {
    id: 'a1',
    code: '1010',
    title: 'موجودی نقد',
    nature: 'DEBIT',
    openedOn: '2026-01-05',
    balance: '1500.00',
  },
  {
    id: 'a2',
    code: '2010',
    title: 'حساب‌های پرداختنی',
    nature: 'CREDIT',
    openedOn: '2026-02-10',
    balance: '900.50',
  },
  {
    id: 'a3',
    code: '5010',
    title: 'هزینه اجاره',
    nature: 'DEBIT',
    openedOn: '2026-03-20',
    balance: '250.25',
  },
];

const columns: ColumnDef<AccountRow, unknown>[] = [
  {
    accessorKey: 'code',
    header: 'کد حساب',
    meta: { filter: { kind: 'text', label: 'کد حساب' } },
  },
  {
    accessorKey: 'title',
    header: 'نام حساب',
    meta: { filter: { kind: 'text', label: 'نام حساب' } },
  },
  {
    accessorKey: 'nature',
    header: 'ماهیت',
    meta: {
      filter: {
        kind: 'select',
        label: 'ماهیت',
        options: [
          { value: 'DEBIT', label: 'بدهکار' },
          { value: 'CREDIT', label: 'بستانکار' },
        ],
        searchValue: (row) => (row.nature === 'DEBIT' ? 'بدهکار' : 'بستانکار'),
      },
    },
  },
  {
    accessorKey: 'openedOn',
    header: 'تاریخ افتتاح',
    meta: { filter: { kind: 'date-range', label: 'تاریخ افتتاح' } },
  },
  {
    accessorKey: 'balance',
    header: 'مانده',
    meta: {
      align: 'end',
      filter: { kind: 'number-range', label: 'مانده' },
    },
  },
];

function renderGrid(overrides: { initialPageSize?: number } = {}) {
  return render(
    <DataTable<AccountRow>
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      caption="فهرست حساب‌ها"
      filtering={{
        initialPageSize: overrides.initialPageSize ?? 25,
        pageSizeOptions: [2, 25],
      }}
    />,
  );
}

describe('DataTable client mode — toolbar and rows', () => {
  it('renders the toolbar controls and every row of a short page', () => {
    renderGrid();

    expect(screen.getByTestId('data-table-toolbar')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: t.table.filters.searchLabel }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('کد حساب')).toBeInTheDocument();
    expect(screen.getByLabelText('نام حساب')).toBeInTheDocument();
    expect(screen.getByLabelText('ماهیت')).toBeInTheDocument();
    expect(screen.getByText('موجودی نقد')).toBeInTheDocument();
    expect(screen.getByText('هزینه اجاره')).toBeInTheDocument();
    expect(screen.getByTestId('data-table-filter-summary')).toHaveTextContent(
      'نمایش',
    );
  });
});

describe('DataTable client mode — global search', () => {
  it('filters after the debounce and matches Persian text and digits', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(
      screen.getByRole('searchbox', { name: t.table.filters.searchLabel }),
      'اجاره',
    );

    await waitFor(() => {
      expect(screen.queryByText('موجودی نقد')).not.toBeInTheDocument();
      expect(screen.getByText('هزینه اجاره')).toBeInTheDocument();
    });

    await user.clear(
      screen.getByRole('searchbox', { name: t.table.filters.searchLabel }),
    );
    await user.type(
      screen.getByRole('searchbox', { name: t.table.filters.searchLabel }),
      '۲۰۱۰',
    );

    await waitFor(() => {
      expect(screen.getByText('حساب‌های پرداختنی')).toBeInTheDocument();
      expect(screen.queryByText('هزینه اجاره')).not.toBeInTheDocument();
    });
  });

  it('searches the Persian label of a select column, not only its code', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(
      screen.getByRole('searchbox', { name: t.table.filters.searchLabel }),
      'بستانکار',
    );

    await waitFor(() => {
      expect(screen.getByText('حساب‌های پرداختنی')).toBeInTheDocument();
      expect(screen.queryByText('موجودی نقد')).not.toBeInTheDocument();
    });
  });
});

describe('DataTable client mode — column filters', () => {
  it('narrows rows with the text and select filters', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(screen.getByLabelText('نام حساب'), 'پرداختنی');
    await waitFor(() => {
      expect(screen.getByText('حساب‌های پرداختنی')).toBeInTheDocument();
      expect(screen.queryByText('موجودی نقد')).not.toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText('نام حساب'));
    await waitFor(() => {
      expect(screen.getByText('موجودی نقد')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('ماهیت'), 'DEBIT');
    await waitFor(() => {
      expect(screen.getByText('موجودی نقد')).toBeInTheDocument();
      expect(screen.queryByText('حساب‌های پرداختنی')).not.toBeInTheDocument();
    });
  });

  it('filters an exact decimal amount with the number-range filter', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(screen.getByLabelText('مانده — حداکثر'), '900.50');

    await waitFor(() => {
      expect(screen.getByText('حساب‌های پرداختنی')).toBeInTheDocument();
      expect(screen.queryByText('موجودی نقد')).not.toBeInTheDocument();
      expect(screen.getByText('هزینه اجاره')).toBeInTheDocument();
    });
  });
});

describe('DataTable client mode — empty and reset', () => {
  it('shows the distinct no-match state and restores rows on reset', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(screen.getByLabelText('نام حساب'), 'یافت‌نشدنی');

    await waitFor(() => {
      const empty = screen.getByTestId('data-table-empty');
      expect(empty).toHaveTextContent(t.table.filters.noMatchTitle);
      expect(empty).toHaveTextContent(t.table.filters.noMatchBody);
    });

    await user.click(screen.getByTestId('data-table-clear-filters'));

    await waitFor(() => {
      expect(screen.getByText('موجودی نقد')).toBeInTheDocument();
      expect(screen.queryByTestId('data-table-empty')).not.toBeInTheDocument();
    });
  });

  it('keeps the "no records yet" empty state when the dataset is empty', () => {
    render(
      <DataTable<AccountRow>
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        filtering={{}}
        emptyTitle="اولین حساب را بسازید"
        emptyDescription="هنوز حسابی ثبت نشده است."
      />,
    );

    const empty = screen.getByTestId('data-table-empty');
    expect(empty).toHaveTextContent('اولین حساب را بسازید');
    expect(empty).toHaveTextContent('هنوز حسابی ثبت نشده است.');
  });
});

describe('DataTable client mode — pagination', () => {
  it('pages the filtered result and changes the page size', async () => {
    const user = userEvent.setup();
    renderGrid({ initialPageSize: 2 });

    expect(screen.getByText('موجودی نقد')).toBeInTheDocument();
    expect(screen.getByText('حساب‌های پرداختنی')).toBeInTheDocument();
    expect(screen.queryByText('هزینه اجاره')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.table.next }));

    expect(screen.getByText('هزینه اجاره')).toBeInTheDocument();
    expect(screen.queryByText('موجودی نقد')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(t.table.pageSize), '25');

    const table = screen.getByRole('table');
    expect(within(table).getByText('موجودی نقد')).toBeInTheDocument();
    expect(within(table).getByText('هزینه اجاره')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.table.next })).toBeDisabled();
  });
});
