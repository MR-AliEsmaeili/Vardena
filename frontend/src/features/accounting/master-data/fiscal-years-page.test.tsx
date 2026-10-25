import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transitionFiscalYear } from '@/api/accounting.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testFiscalYear, testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { FiscalYearRowActions } from './fiscal-year-row-actions';

vi.mock('@/api/accounting.api', () => ({
  transitionFiscalYear: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(() => testOrganization.id),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

const permissionsWithAll = [
  PERMISSIONS.accounting.fiscalYearEdit,
  PERMISSIONS.accounting.fiscalYearClose,
  PERMISSIONS.accounting.fiscalYearReopen,
  PERMISSIONS.accounting.fiscalYearSeal,
  PERMISSIONS.accounting.fiscalYearUnseal,
];
let granted: string[];

function renderRow(status: 'open' | 'closed' | 'sealed') {
  return renderWithProviders(
    <ToastProvider>
      <FiscalYearRowActions fiscalYear={{ ...testFiscalYear, status }} />
    </ToastProvider>,
    { withProviders: false },
  );
}

beforeEach(() => {
  granted = permissionsWithAll;
  vi.mocked(usePermissions).mockReturnValue({
    codes: granted,
    loaded: true,
    has: (code) => granted.includes(code),
    hasAll: (codes) => codes.every((code) => granted.includes(code)),
    hasAny: (codes) => codes.some((code) => granted.includes(code)),
  });
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(transitionFiscalYear).mockResolvedValue(testFiscalYear);
});

describe('fiscal-year lifecycle actions', () => {
  it('shows only open-year edit and close actions', () => {
    renderRow('open');
    expect(
      screen.getByRole('link', { name: t.fiscalYear.edit }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: t.fiscalYear.transitions.close.label,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.seal.label,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.reopen.label,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.unseal.label,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows edit, seal and reopen for closed years', () => {
    renderRow('closed');
    expect(
      screen.getByRole('link', { name: t.fiscalYear.edit }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.fiscalYear.transitions.seal.label }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: t.fiscalYear.transitions.reopen.label,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.close.label,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows only unseal for sealed years and hides actions without permissions', () => {
    const { rerender } = renderRow('sealed');
    expect(
      screen.queryByRole('link', { name: t.fiscalYear.edit }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: t.fiscalYear.transitions.unseal.label,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.reopen.label,
      }),
    ).not.toBeInTheDocument();

    granted = [];
    rerender(
      <ToastProvider>
        <FiscalYearRowActions
          fiscalYear={{ ...testFiscalYear, status: 'open' }}
        />
      </ToastProvider>,
    );
    expect(
      screen.queryByRole('link', { name: t.fiscalYear.edit }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.fiscalYear.transitions.close.label,
      }),
    ).not.toBeInTheDocument();
  });

  it('requires a reason and posts it with close; confirmation warns about periods', async () => {
    const user = userEvent.setup();
    renderRow('open');
    await user.click(
      screen.getByRole('button', {
        name: t.fiscalYear.transitions.close.label,
      }),
    );

    expect(screen.getByText(/دوره‌های باز همین سال نیز/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', {
      name: t.fiscalYear.transitions.close.confirm,
    });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText(t.fiscalYear.reason),
      'بستن پایان سال',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(transitionFiscalYear).toHaveBeenCalledWith(
        testOrganization.id,
        testFiscalYear.id,
        'close',
        { reason: 'بستن پایان سال' },
      ),
    );
  });
});
