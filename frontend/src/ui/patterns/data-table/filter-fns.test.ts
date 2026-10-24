import type { ColumnDef, Row } from '@tanstack/react-table';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  dateRangeFilter,
  equalsStringFilter,
  globalTextFilter,
  includesStringFilter,
  multiSelectFilter,
  numberRangeFilter,
} from './filter-fns';

/**
 * The matching contract of the shared grid, tested without the DOM.
 *
 * A real TanStack row is built with `useReactTable` + `getCoreRowModel` so the
 * `filterFn` receives the exact `Row` shape it will receive in the grid — no
 * hand-rolled stub and no cast.
 */

interface Person {
  id: string;
  name: string;
  status: boolean;
  joined: string; // BusinessDate: YYYY-MM-DD
  balance: string; // exact decimal string
}

const personColumns: ColumnDef<Person, unknown>[] = [
  { accessorKey: 'name' },
  { accessorKey: 'status' },
  { accessorKey: 'joined' },
  { accessorKey: 'balance' },
];

function makeRows(rows: Person[]): Row<Person>[] {
  const { result } = renderHook(() =>
    useReactTable({
      data: rows,
      columns: personColumns,
      getCoreRowModel: getCoreRowModel(),
    }),
  );
  return result.current.getRowModel().rows;
}

const people: Person[] = [
  {
    id: 'p1',
    name: 'علی رضایی',
    status: true,
    joined: '2026-01-10',
    balance: '1250.50',
  },
  {
    id: 'p2',
    name: 'مریم كريمي',
    status: false,
    joined: '2026-03-01',
    balance: '-20.00',
  },
];

describe('includesStringFilter (Persian-aware "includes")', () => {
  it('matches the same Persian word written with Arabic ي/ك and with ZWNJ', () => {
    const rows = makeRows(people);

    expect(
      includesStringFilter(rows[1] as Row<Person>, 'name', 'مریم کریمی'),
    ).toBe(true);
    expect(includesStringFilter(rows[1] as Row<Person>, 'name', 'كريمي')).toBe(
      true,
    );
    expect(includesStringFilter(rows[0] as Row<Person>, 'name', 'رضایی')).toBe(
      true,
    );
  });

  it('matches Persian digits against canonical ASCII digits', () => {
    const rows = makeRows([{ ...people[0]!, name: 'حساب ۱۴۰۵' }]);

    expect(includesStringFilter(rows[0] as Row<Person>, 'name', '1405')).toBe(
      true,
    );
  });

  it('treats a blank filter as "no filter" and a mismatch as hidden', () => {
    const rows = makeRows(people);

    expect(includesStringFilter(rows[0] as Row<Person>, 'name', '')).toBe(true);
    expect(includesStringFilter(rows[0] as Row<Person>, 'name', '  ')).toBe(
      true,
    );
    expect(includesStringFilter(rows[0] as Row<Person>, 'name', 'انبار')).toBe(
      false,
    );
  });
});

describe('equalsStringFilter', () => {
  it('compares normalized strings, including boolean cell values', () => {
    const rows = makeRows(people);

    expect(equalsStringFilter(rows[0] as Row<Person>, 'status', 'true')).toBe(
      true,
    );
    expect(equalsStringFilter(rows[1] as Row<Person>, 'status', 'true')).toBe(
      false,
    );
    expect(equalsStringFilter(rows[0] as Row<Person>, 'status', '')).toBe(true);
  });
});

describe('multiSelectFilter', () => {
  it('keeps rows whose value is one of the selected options', () => {
    const rows = makeRows(people);

    expect(
      multiSelectFilter(rows[0] as Row<Person>, 'status', ['true', 'false']),
    ).toBe(true);
    expect(multiSelectFilter(rows[1] as Row<Person>, 'status', ['true'])).toBe(
      false,
    );
    expect(multiSelectFilter(rows[1] as Row<Person>, 'status', [])).toBe(true);
  });
});

describe('dateRangeFilter (canonical BusinessDate)', () => {
  let rows: Row<Person>[];
  beforeEach(() => {
    rows = makeRows(people);
  });

  it('applies inclusive from/to bounds over YYYY-MM-DD strings', () => {
    expect(
      dateRangeFilter(rows[0] as Row<Person>, 'joined', {
        from: '2026-01-10',
        to: '2026-01-10',
      }),
    ).toBe(true);
    expect(
      dateRangeFilter(rows[0] as Row<Person>, 'joined', { from: '2026-02-01' }),
    ).toBe(false);
    expect(
      dateRangeFilter(rows[1] as Row<Person>, 'joined', { to: '2026-12-31' }),
    ).toBe(true);
  });

  it('is a no-op when both bounds are empty', () => {
    expect(
      dateRangeFilter(rows[0] as Row<Person>, 'joined', { from: '', to: '' }),
    ).toBe(true);
    expect(dateRangeFilter(rows[0] as Row<Person>, 'joined', undefined)).toBe(
      true,
    );
  });
});

describe('numberRangeFilter (exact decimals)', () => {
  let rows: Row<Person>[];
  beforeEach(() => {
    rows = makeRows(people);
  });

  it('compares amounts as exact decimal strings, not floats', () => {
    expect(
      numberRangeFilter(rows[0] as Row<Person>, 'balance', {
        min: '1250.49',
        max: '1250.51',
      }),
    ).toBe(true);
    expect(
      numberRangeFilter(rows[0] as Row<Person>, 'balance', { max: '1250.50' }),
    ).toBe(true);
    expect(
      numberRangeFilter(rows[0] as Row<Person>, 'balance', { min: '1250.51' }),
    ).toBe(false);
  });

  it('handles negative values and empty bounds', () => {
    expect(
      numberRangeFilter(rows[1] as Row<Person>, 'balance', { max: '-10' }),
    ).toBe(true);
    expect(
      numberRangeFilter(rows[1] as Row<Person>, 'balance', { min: '0' }),
    ).toBe(false);
    expect(
      numberRangeFilter(rows[1] as Row<Person>, 'balance', {
        min: '',
        max: '',
      }),
    ).toBe(true);
  });
});

describe('globalTextFilter', () => {
  interface SearchRow {
    id: string;
    name: string;
    active: boolean;
  }

  const columns: ColumnDef<SearchRow, unknown>[] = [
    { accessorKey: 'name' },
    {
      accessorKey: 'active',
      meta: {
        filter: {
          kind: 'select',
          label: 'وضعیت',
          options: [],
          searchValue: (row) => (row.active ? 'فعال' : 'غیرفعال'),
        },
      },
    },
    {
      id: 'secret',
      accessorFn: () => 'hidden-token',
      meta: { excludeFromGlobalSearch: true },
    },
  ];

  function buildRow(): Row<SearchRow> {
    const { result } = renderHook(() =>
      useReactTable({
        data: [{ id: 's1', name: 'علی', active: true }],
        columns,
        getCoreRowModel: getCoreRowModel(),
      }),
    );
    return result.current.getRowModel().rows[0] as Row<SearchRow>;
  }

  it('searches every searchable column with normalization', () => {
    expect(globalTextFilter(buildRow(), '', 'علي')).toBe(true);
    expect(globalTextFilter(buildRow(), '', 'فعال')).toBe(true);
    expect(globalTextFilter(buildRow(), '', '')).toBe(true);
  });

  it('honours excluded columns', () => {
    expect(globalTextFilter(buildRow(), '', 'hidden-token')).toBe(false);
  });
});
