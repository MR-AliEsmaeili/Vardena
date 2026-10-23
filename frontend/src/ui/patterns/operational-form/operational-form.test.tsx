import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { DataTable } from '../data-table';
import {
  CollapsibleHeader,
  DetailGrid,
  DocumentPaginationControl,
  OperationalFooter,
  OperationalSummary,
} from './index';

describe('CollapsibleHeader', () => {
  it('starts open, blocks collapse when required fields are incomplete, and collapses with summary chips once complete', async () => {
    const user = userEvent.setup();
    const onBlocked = vi.fn();

    function Harness() {
      const [desc, setDesc] = useState('');
      return (
        <CollapsibleHeader
          title={t.documents.headerSection}
          canCollapse={desc.trim() !== ''}
          summaryChips={[
            { label: t.documents.number, value: '1001' },
            { label: t.documents.date, value: '۱۴۰۵/۰۷/۱۶' },
          ]}
          onCollapseBlocked={onBlocked}
        >
          <label htmlFor="hdr-desc">{t.documents.fieldDescription}</label>
          <Input
            id="hdr-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </CollapsibleHeader>
      );
    }

    render(<Harness />);

    // Open initially
    expect(
      screen.getByLabelText(t.documents.fieldDescription),
    ).toBeInTheDocument();

    // Attempt to collapse while empty -> stays open and announces hint
    await user.click(screen.getByTestId('collapsible-header-toggle'));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('collapsible-header-blocked-hint'),
    ).toHaveTextContent(t.operationalForm.headerIncompleteHint);
    expect(
      screen.getByLabelText(t.documents.fieldDescription),
    ).toBeInTheDocument();

    // Fill required field -> collapses and displays summary chips
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'خرید ملزومات',
    );
    await user.click(screen.getByTestId('collapsible-header-toggle'));

    expect(
      screen.queryByLabelText(t.documents.fieldDescription),
    ).not.toBeInTheDocument();
    const summary = screen.getByTestId('header-summary');
    expect(summary).toHaveTextContent('1001');
    expect(summary).toHaveTextContent('۱۴۰۵/۰۷/۱۶');

    // Re-open -> editable again with preserved value
    await user.click(screen.getByTestId('collapsible-header-toggle'));
    expect(screen.getByLabelText(t.documents.fieldDescription)).toHaveValue(
      'خرید ملزومات',
    );
  });
});

describe('DetailGrid — keyboard navigation, context menu, read-only and virtualization', () => {
  interface TestRow {
    id: string;
    title: string;
  }

  function GridHarness({
    initialRows,
    readOnly = false,
    onFormSubmit,
  }: {
    initialRows: TestRow[];
    readOnly?: boolean;
    onFormSubmit?: () => void;
  }) {
    const [rows, setRows] = useState<TestRow[]>(initialRows);
    const [nextSeq, setNextSeq] = useState(initialRows.length + 1);

    const makeRow = (title = ''): TestRow => {
      const id = `r-${nextSeq}`;
      setNextSeq((n) => n + 1);
      return { id, title };
    };

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onFormSubmit?.();
        }}
      >
        <DetailGrid
          rows={rows}
          getRowId={(r) => r.id}
          readOnly={readOnly}
          columns={[
            {
              key: 'title',
              header: 'شرح',
              render: (row, idx) => (
                <Input
                  aria-label={`row-input-${idx}`}
                  disabled={readOnly}
                  value={row.title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRows((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, title: val } : item,
                      ),
                    );
                  }}
                />
              ),
            },
          ]}
          onAddRow={() => setRows((prev) => [...prev, makeRow()])}
          onInsertAbove={(idx) =>
            setRows((prev) => [
              ...prev.slice(0, idx),
              makeRow('بالا'),
              ...prev.slice(idx),
            ])
          }
          onInsertBelow={(idx) =>
            setRows((prev) => [
              ...prev.slice(0, idx + 1),
              makeRow('پایین'),
              ...prev.slice(idx + 1),
            ])
          }
          onDuplicateRow={(idx) =>
            setRows((prev) => {
              const src = prev[idx];
              if (!src) return prev;
              return [
                ...prev.slice(0, idx + 1),
                makeRow(src.title),
                ...prev.slice(idx + 1),
              ];
            })
          }
          onRemoveRow={(idx) =>
            setRows((prev) => prev.filter((_, i) => i !== idx))
          }
          canRemoveRow={() => rows.length > 1}
        />
      </form>
    );
  }

  it('moves focus between rows on Enter/ArrowDown and appends a new row at the bottom without submitting the form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GridHarness
        initialRows={[
          { id: 'r-1', title: 'ردیف اول' },
          { id: 'r-2', title: 'ردیف دوم' },
        ]}
        onFormSubmit={onSubmit}
      />,
    );

    const first = screen.getByLabelText('row-input-0');
    const second = screen.getByLabelText('row-input-1');
    first.focus();

    await user.keyboard('{Enter}');
    expect(second).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();

    // Enter on last row appends row 3 and focuses it
    await user.keyboard('{Enter}');
    const third = await screen.findByLabelText('row-input-2');
    expect(third).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();

    // ArrowUp moves back to row 2
    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
  });

  it('supports row Context Menu actions: Insert Above, Insert Below, Duplicate, and Delete', async () => {
    const user = userEvent.setup();
    render(
      <GridHarness
        initialRows={[
          { id: 'r-1', title: 'آیتم الف' },
          { id: 'r-2', title: 'آیتم ب' },
        ]}
      />,
    );

    // Right-click on row 0 opens context menu
    fireEvent.contextMenu(screen.getByTestId('detail-grid-row-0'));
    expect(screen.getByTestId('detail-grid-context-menu')).toBeInTheDocument();

    // Duplicate row 0
    await user.click(screen.getByTestId('context-action-duplicate'));
    expect(screen.getByLabelText('row-input-1')).toHaveValue('آیتم الف');

    // Open via action button and insert above row 0
    await user.click(screen.getByTestId('detail-grid-menu-0'));
    await user.click(screen.getByTestId('context-action-insert-above'));
    expect(screen.getByLabelText('row-input-0')).toHaveValue('بالا');

    // Delete row 0
    await user.click(screen.getByTestId('detail-grid-menu-0'));
    await user.click(screen.getByTestId('context-action-delete'));
    expect(screen.getByLabelText('row-input-0')).toHaveValue('آیتم الف');
  });

  it('hides add button and row context menu in readOnly mode', () => {
    render(
      <GridHarness initialRows={[{ id: 'r-1', title: 'قطعی' }]} readOnly />,
    );
    expect(screen.queryByTestId('detail-grid-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-grid-menu-0')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('detail-grid-row-0'));
    expect(
      screen.queryByTestId('detail-grid-context-menu'),
    ).not.toBeInTheDocument();
  });

  it('activates windowed virtualization automatically for 120+ rows so DOM row count stays bounded', () => {
    const manyRows = Array.from({ length: 120 }, (_, i) => ({
      id: `r-${i + 1}`,
      title: `ردیف ${i + 1}`,
    }));
    render(<GridHarness initialRows={manyRows} />);

    expect(
      screen.getByTestId('detail-grid-virtualized-hint'),
    ).toBeInTheDocument();
    const mountedInputs = screen.getAllByRole('textbox');
    expect(mountedInputs.length).toBeLessThan(30);
  });
});

describe('OperationalSummary, OperationalFooter and DataTable selection', () => {
  it('renders summary rows with server-authority note and 3-zone footer with document pagination', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();

    render(
      <>
        <OperationalSummary
          rows={[
            { label: t.documents.totalDebit, value: '1,000', emphasize: true },
            {
              label: t.operationalForm.balanceStatus,
              value: t.operationalForm.balanced,
              tone: 'ok',
            },
          ]}
        />
        <OperationalFooter
          start={<button type="button">عملیات راست</button>}
          center={
            <DocumentPaginationControl
              currentIndex={1}
              totalCount={5}
              hasPrev
              hasNext
              onPrev={onPrev}
              onNext={onNext}
            />
          }
          end={<button type="button">ذخیره چپ</button>}
        />
      </>,
    );

    expect(screen.getByTestId('operational-summary')).toHaveTextContent(
      t.operationalForm.serverAuthorityHint,
    );
    expect(screen.getByTestId('document-pagination-label')).toHaveTextContent(
      'سند 2 از 5',
    );

    await user.click(screen.getByTestId('document-pagination-prev'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('document-pagination-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('supports row selection, select-all and clear-selection in DataTable', async () => {
    const user = userEvent.setup();
    function SelectableTable() {
      const [selected, setSelected] = useState<Set<string>>(() => new Set());
      return (
        <DataTable
          selectable
          selectedRowIds={selected}
          onSelectedRowIdsChange={setSelected}
          getRowId={(r) => r.id}
          data={[
            { id: 'd-1', code: '1001' },
            { id: 'd-2', code: '1002' },
          ]}
          columns={[{ id: 'code', accessorKey: 'code', header: 'کد' }]}
        />
      );
    }

    render(<SelectableTable />);
    await user.click(screen.getByTestId('data-table-select-d-1'));
    const bar = screen.getByTestId('data-table-selection-bar');
    expect(bar).toHaveTextContent('1');

    await user.click(screen.getByTestId('data-table-select-all'));
    expect(bar).toHaveTextContent('2');

    await user.click(within(bar).getByTestId('data-table-clear-selection'));
    expect(
      screen.queryByTestId('data-table-selection-bar'),
    ).not.toBeInTheDocument();
  });
});
