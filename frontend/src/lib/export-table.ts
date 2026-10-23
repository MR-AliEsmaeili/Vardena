/**
 * Client-side table export (UTF-8 BOM CSV for Excel) and print helpers.
 *
 * Architectural boundary: dedicated backend Excel/Print modules (ADR-0011,
 * ADR-0012) are not yet implemented in `backend/`. Until server-side batch
 * export endpoints exist, list and form toolbars export the real server-loaded
 * rows as RFC-4180 UTF-8-with-BOM `.csv` (opened directly by Excel with full
 * Persian RTL fidelity) and invoke structured `@media print` printing.
 */

export interface ExportColumn<TRow> {
  header: string;
  value: (row: TRow) => string | number | null | undefined;
}

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escape one CSV cell per RFC-4180 while neutralizing spreadsheet formula
 * injection (`=`, `+`, `-`, `@`) on non-numeric strings.
 */
export function escapeCsvCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let text = String(raw);
  if (
    typeof raw === 'string' &&
    FORMULA_PREFIX.test(text) &&
    !PLAIN_NUMBER.test(text.trim())
  ) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Build a UTF-8 BOM CSV string from columns and rows. */
export function buildCsvContent<TRow>(
  columns: readonly ExportColumn<TRow>[],
  rows: readonly TRow[],
): string {
  const headerLine = columns.map((col) => escapeCsvCell(col.header)).join(',');
  const bodyLines = rows.map((row) =>
    columns.map((col) => escapeCsvCell(col.value(row))).join(','),
  );
  return `\uFEFF${[headerLine, ...bodyLines].join('\r\n')}`;
}

/** Trigger a real file download in the browser for the given rows. */
export function exportRowsToExcelCsv<TRow>(
  filenameBase: string,
  columns: readonly ExportColumn<TRow>[],
  rows: readonly TRow[],
): string {
  const content = buildCsvContent(columns, rows);
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const hasUrlApi =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    if (hasUrlApi) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameBase.endsWith('.csv')
        ? filenameBase
        : `${filenameBase}.csv`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }
  }
  return content;
}

/** Trigger the browser print dialog using `@media print` layout styles. */
export function printCurrentSurface(): void {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
  }
}
