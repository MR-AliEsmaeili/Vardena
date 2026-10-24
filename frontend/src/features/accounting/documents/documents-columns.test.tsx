import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { testAccountingDocument, testFinancialArea } from '@/test/fixtures';
import { DataTable } from '@/ui/patterns/data-table';
import { documentStatePresentation } from './document-lifecycle';
import { buildDocumentsColumns } from './documents-columns';

/**
 * The documents grid's presentation rules, pinned as behaviour.
 *
 * The owner rejected a row where one cell carried two visual halves
 * (`FIN — حوزه مالی اصلی`). The rule is now: ONE cell = ONE value; the code is
 * still available for scanning/verification, but as the cell's title, never as
 * a second block inside the row.
 */

function renderGrid() {
  return render(
    <MemoryRouter>
      <DataTable
        columns={buildDocumentsColumns([testFinancialArea])}
        data={[testAccountingDocument]}
        getRowId={(row) => row.id}
        caption={t.documents.title}
      />
    </MemoryRouter>,
  );
}

describe('documents grid columns', () => {
  it('renders the financial area as ONE value, keeping the code in the cell title', () => {
    const { container } = renderGrid();
    const areaCell = screen.getByText(testFinancialArea.title);

    expect(areaCell.textContent).toBe(testFinancialArea.title);
    expect(areaCell.textContent).not.toContain('—');
    expect(areaCell).toHaveAttribute(
      'title',
      `${testFinancialArea.code} — ${testFinancialArea.title}`,
    );
    // The code is not silently dropped from the DOM: it is the hover title.
    expect(container.innerHTML).toContain(testFinancialArea.code);
  });

  it('truncates the description in its own cell instead of wrapping the row', () => {
    renderGrid();
    const description = screen.getByText(testAccountingDocument.description);

    expect(description.className).toContain('truncate');
    expect(description).toHaveAttribute(
      'title',
      testAccountingDocument.description,
    );
  });

  it('keeps the document number a real, encodable link to the document view', () => {
    renderGrid();
    const link = screen.getByRole('link', {
      name: testAccountingDocument.documentNumber ?? '',
    });

    expect(link).toHaveAttribute(
      'href',
      `/app/accounting/documents/${encodeURIComponent(testAccountingDocument.id)}`,
    );
  });

  it('renders the API state through the shared presentation, not a guessed label', () => {
    renderGrid();

    const badge = screen.getByText(documentStatePresentation.final.label);
    expect(badge).toBeInTheDocument();
    // The raw API code stays in the DOM for verification/debugging parity.
    expect(screen.queryByText('final')).toBeNull();
  });

  it('gives the amount its own end-aligned column', () => {
    const { container } = renderGrid();
    const table = within(container).getByRole('table');
    const amountHeader = within(table).getByRole('columnheader', {
      name: t.documents.colTotal,
    });

    expect(amountHeader.className).toContain('text-end');
  });
});
