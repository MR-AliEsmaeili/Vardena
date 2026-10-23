import {
  ArrowDown,
  ArrowUp,
  Copy,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useVirtualWindow } from '@/lib/use-virtual-window';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';

export interface DetailGridColumn<TRow> {
  key: string;
  header: string;
  minWidthClass?: string;
  align?: 'start' | 'end' | 'center';
  render: (row: TRow, index: number) => ReactNode;
}

export interface DetailGridContextAction<TRow> {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: (row: TRow, index: number) => boolean;
  onSelect: (row: TRow, index: number) => void;
}

export interface DetailGridProps<TRow> {
  columns: readonly DetailGridColumn<TRow>[];
  rows: readonly TRow[];
  /** Stable row identity — never array index (standards.md §3). */
  getRowId: (row: TRow, index: number) => string;
  onAddRow?: () => void;
  onInsertAbove?: (index: number) => void;
  onInsertBelow?: (index: number) => void;
  onDuplicateRow?: (index: number) => void;
  onRemoveRow?: (index: number) => void;
  canRemoveRow?: (row: TRow, index: number) => boolean;
  canDuplicateRow?: (row: TRow, index: number) => boolean;
  extraContextActions?: readonly DetailGridContextAction<TRow>[];
  addLabel?: string;
  emptyText?: string;
  readOnly?: boolean;
  ariaLabel?: string;
}

interface ActiveContextMenu {
  rowIndex: number;
  top: number;
  inlineStart: number;
}

/**
 * High-density operational Detail Grid (Mission §7, standards.md §8/§9).
 *
 * - Keyboard navigation: `Enter` advances to the next row (or appends a row at
 *   the end without submitting the parent form); `ArrowUp`/`ArrowDown` on text
 *   inputs move vertically in the same column.
 * - Context Menu (right-click on row or row `⋮` action button): Insert Above,
 *   Insert Below, Duplicate Row, Delete Row — suppressed when `readOnly`.
 * - Windowed virtualization activates automatically at 80+ rows.
 */
export function DetailGrid<TRow>({
  columns,
  rows,
  getRowId,
  onAddRow,
  onInsertAbove,
  onInsertBelow,
  onDuplicateRow,
  onRemoveRow,
  canRemoveRow,
  canDuplicateRow,
  extraContextActions,
  addLabel = t.operationalForm.addRow,
  emptyText = t.operationalForm.emptyRows,
  readOnly = false,
  ariaLabel,
}: DetailGridProps<TRow>) {
  const [contextMenu, setContextMenu] = useState<ActiveContextMenu | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const pendingFocusRef = useRef<{ rowIndex: number; colIndex: number } | null>(
    null,
  );

  const virtual = useVirtualWindow({
    totalCount: rows.length,
    rowHeight: 52,
    viewportHeight: 520,
    threshold: 80,
  });

  const hasRowMenu =
    !readOnly &&
    (onInsertAbove !== undefined ||
      onInsertBelow !== undefined ||
      onDuplicateRow !== undefined ||
      onRemoveRow !== undefined ||
      (extraContextActions !== undefined && extraContextActions.length > 0));

  useEffect(() => {
    if (contextMenu === null) return;
    function onPointerDown(event: MouseEvent) {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    }
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [contextMenu]);

  const focusRowCell = useCallback(
    (rowIndex: number, colIndex = 0) => {
      virtual.scrollToRow(rowIndex, scrollContainerRef.current);
      const rowElement = rowRefs.current.get(rowIndex);
      if (rowElement === undefined) return false;
      const controls = rowElement.querySelectorAll<HTMLElement>(
        'select:not([disabled]), input:not([disabled]):not([type="search"]):not([type="checkbox"])',
      );
      if (controls.length === 0) return false;
      const target =
        controls[Math.min(colIndex, controls.length - 1)] ?? controls[0];
      target?.focus();
      return true;
    },
    [virtual],
  );

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    if (focusRowCell(pending.rowIndex, pending.colIndex)) {
      pendingFocusRef.current = null;
    }
  });

  const handleAddAtEnd = useCallback(() => {
    if (readOnly || onAddRow === undefined) return;
    pendingFocusRef.current = { rowIndex: rows.length, colIndex: 0 };
    onAddRow();
  }, [onAddRow, readOnly, rows.length]);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (readOnly) return;
      const target = event.target as HTMLElement;
      const rowElement = rowRefs.current.get(rowIndex);
      const controls = rowElement
        ? Array.from(
            rowElement.querySelectorAll<HTMLElement>(
              'select:not([disabled]), input:not([disabled]):not([type="search"]):not([type="checkbox"])',
            ),
          )
        : [];
      const colIndex = Math.max(0, controls.indexOf(target));

      if (event.key === 'Enter') {
        event.preventDefault();
        if (rowIndex + 1 < rows.length) {
          if (!focusRowCell(rowIndex + 1, colIndex)) {
            pendingFocusRef.current = { rowIndex: rowIndex + 1, colIndex };
          }
        } else if (onAddRow !== undefined) {
          pendingFocusRef.current = { rowIndex: rows.length, colIndex: 0 };
          onAddRow();
        }
        return;
      }

      if (
        target.tagName === 'INPUT' &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      ) {
        const nextRow = event.key === 'ArrowDown' ? rowIndex + 1 : rowIndex - 1;
        if (nextRow >= 0 && nextRow < rows.length) {
          event.preventDefault();
          if (!focusRowCell(nextRow, colIndex)) {
            pendingFocusRef.current = { rowIndex: nextRow, colIndex };
          }
        }
      }
    },
    [focusRowCell, onAddRow, readOnly, rows.length],
  );

  const openMenuAt = useCallback(
    (rowIndex: number, clientX: number, clientY: number) => {
      if (!hasRowMenu) return;
      const viewportW =
        typeof window !== 'undefined' ? window.innerWidth : 1024;
      const viewportH =
        typeof window !== 'undefined' ? window.innerHeight : 768;
      const clampedX = Math.max(8, Math.min(clientX, viewportW - 210));
      const clampedY = Math.max(8, Math.min(clientY, viewportH - 180));
      setContextMenu({ rowIndex, top: clampedY, inlineStart: clampedX });
    },
    [hasRowMenu],
  );

  const handleRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (!hasRowMenu) return;
      event.preventDefault();
      openMenuAt(rowIndex, event.clientX, event.clientY);
    },
    [hasRowMenu, openMenuAt],
  );

  const totalColSpan = columns.length + 1 + (hasRowMenu ? 1 : 0);
  const visibleSlice = virtual.isVirtualized
    ? rows.slice(virtual.startIndex, virtual.endIndex)
    : rows;

  const activeRow =
    contextMenu !== null ? rows[contextMenu.rowIndex] : undefined;
  const activeIndex = contextMenu?.rowIndex ?? -1;

  return (
    <section
      aria-label={ariaLabel}
      className="space-y-2"
      data-testid="detail-grid"
    >
      {virtual.isVirtualized && (
        <p
          className="text-[0.6875rem] text-ink-subtle"
          data-testid="detail-grid-virtualized-hint"
        >
          {t.operationalForm.virtualizedHint
            .replace(
              '{visible}',
              formatCount(virtual.endIndex - virtual.startIndex),
            )
            .replace('{total}', formatCount(rows.length))}
        </p>
      )}

      <TableWrapper className="scroll-thin">
        <div
          ref={scrollContainerRef}
          onScroll={virtual.isVirtualized ? virtual.onScroll : undefined}
          className={cn(
            virtual.isVirtualized &&
              'scroll-thin max-h-[32.5rem] overflow-y-auto',
          )}
        >
          <Table>
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell className="w-11 text-center">
                  {t.operationalForm.rowNumber}
                </TableHeaderCell>
                {columns.map((col) => (
                  <TableHeaderCell
                    key={col.key}
                    className={cn(
                      col.minWidthClass,
                      col.align === 'end' && 'text-end',
                      col.align === 'center' && 'text-center',
                    )}
                  >
                    {col.header}
                  </TableHeaderCell>
                ))}
                {hasRowMenu && (
                  <TableHeaderCell className="w-12 text-center">
                    <span className="sr-only">
                      {t.operationalForm.rowActions}
                    </span>
                  </TableHeaderCell>
                )}
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={totalColSpan}
                    className="py-8 text-center text-sm text-ink-muted"
                  >
                    {emptyText}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {virtual.isVirtualized && virtual.topSpacerHeight > 0 && (
                    <tr aria-hidden style={{ height: virtual.topSpacerHeight }}>
                      <TableCell
                        colSpan={totalColSpan}
                        className="border-0 p-0"
                      />
                    </tr>
                  )}
                  {visibleSlice.map((row, sliceOffset) => {
                    const rowIndex = virtual.startIndex + sliceOffset;
                    const rowId = getRowId(row, rowIndex);
                    return (
                      <TableRow
                        key={rowId}
                        ref={(element) => {
                          if (element === null) {
                            rowRefs.current.delete(rowIndex);
                          } else {
                            rowRefs.current.set(rowIndex, element);
                          }
                        }}
                        onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                        onContextMenu={(event) =>
                          handleRowContextMenu(event, rowIndex)
                        }
                        data-testid={`detail-grid-row-${rowIndex}`}
                      >
                        <TableCell className="text-center text-xs text-ink-subtle tabular-nums">
                          {rowIndex + 1}
                        </TableCell>
                        {columns.map((col) => (
                          <TableCell
                            key={col.key}
                            className={cn(
                              col.align === 'end' && 'text-end',
                              col.align === 'center' && 'text-center',
                            )}
                          >
                            {col.render(row, rowIndex)}
                          </TableCell>
                        ))}
                        {hasRowMenu && (
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t.operationalForm.rowActions}
                              aria-haspopup="menu"
                              onClick={(event) => {
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                openMenuAt(
                                  rowIndex,
                                  rect.left,
                                  rect.bottom + 4,
                                );
                              }}
                              data-testid={`detail-grid-menu-${rowIndex}`}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {virtual.isVirtualized && virtual.bottomSpacerHeight > 0 && (
                    <tr
                      aria-hidden
                      style={{ height: virtual.bottomSpacerHeight }}
                    >
                      <TableCell
                        colSpan={totalColSpan}
                        className="border-0 p-0"
                      />
                    </tr>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </TableWrapper>

      {!readOnly && onAddRow !== undefined && (
        <div className="no-print flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddAtEnd}
            data-testid="detail-grid-add"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {addLabel}
          </Button>
        </div>
      )}

      {contextMenu !== null && activeRow !== undefined && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={t.operationalForm.rowActions}
          style={{ top: contextMenu.top, left: contextMenu.inlineStart }}
          data-testid="detail-grid-context-menu"
          className="fixed z-50 min-w-48 rounded-card border border-line bg-surface p-1 text-ink shadow-raised"
        >
          {onInsertAbove !== undefined && (
            <button
              type="button"
              role="menuitem"
              data-testid="context-action-insert-above"
              className="flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-start text-xs text-ink-muted hover:bg-sunken hover:text-ink"
              onClick={() => {
                pendingFocusRef.current = {
                  rowIndex: activeIndex,
                  colIndex: 0,
                };
                onInsertAbove(activeIndex);
                setContextMenu(null);
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              {t.operationalForm.insertRowAbove}
            </button>
          )}
          {onInsertBelow !== undefined && (
            <button
              type="button"
              role="menuitem"
              data-testid="context-action-insert-below"
              className="flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-start text-xs text-ink-muted hover:bg-sunken hover:text-ink"
              onClick={() => {
                pendingFocusRef.current = {
                  rowIndex: activeIndex + 1,
                  colIndex: 0,
                };
                onInsertBelow(activeIndex);
                setContextMenu(null);
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              {t.operationalForm.insertRowBelow}
            </button>
          )}
          {onDuplicateRow !== undefined && (
            <button
              type="button"
              role="menuitem"
              disabled={
                canDuplicateRow !== undefined &&
                !canDuplicateRow(activeRow, activeIndex)
              }
              data-testid="context-action-duplicate"
              className="flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-start text-xs text-ink-muted hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                pendingFocusRef.current = {
                  rowIndex: activeIndex + 1,
                  colIndex: 0,
                };
                onDuplicateRow(activeIndex);
                setContextMenu(null);
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t.operationalForm.duplicateRow}
            </button>
          )}
          {extraContextActions?.map((action) => {
            const disabled = action.disabled?.(activeRow, activeIndex) ?? false;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={disabled}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-start text-xs disabled:pointer-events-none disabled:opacity-50',
                  action.danger
                    ? 'text-danger-ink hover:bg-danger-soft'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
                onClick={() => {
                  action.onSelect(activeRow, activeIndex);
                  setContextMenu(null);
                }}
              >
                {action.icon}
                {action.label}
              </button>
            );
          })}
          {onRemoveRow !== undefined && (
            <button
              type="button"
              role="menuitem"
              disabled={
                canRemoveRow !== undefined &&
                !canRemoveRow(activeRow, activeIndex)
              }
              data-testid="context-action-delete"
              className="flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-start text-xs text-danger-ink hover:bg-danger-soft disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                onRemoveRow(activeIndex);
                setContextMenu(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t.operationalForm.deleteRow}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
