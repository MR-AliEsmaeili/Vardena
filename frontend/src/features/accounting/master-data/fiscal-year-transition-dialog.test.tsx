import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transitionFiscalYear } from '@/api/accounting.api';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { testFiscalYear, testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { FiscalYearTransitionDialog } from './fiscal-year-transition-dialog';

vi.mock('@/api/accounting.api', () => ({ transitionFiscalYear: vi.fn() }));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(() => testOrganization.id),
}));

describe('FiscalYearTransitionDialog', () => {
  beforeEach(() => {
    vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
    vi.mocked(transitionFiscalYear).mockResolvedValue(testFiscalYear);
  });

  it('does not allow an empty reason and maps a 422 to domain copy', async () => {
    vi.mocked(transitionFiscalYear).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        status: 422,
        message: 'backend internal details',
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <FiscalYearTransitionDialog
          fiscalYear={testFiscalYear}
          action="close"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      { withProviders: false },
    );
    const confirm = screen.getByRole('button', {
      name: t.fiscalYear.transitions.close.confirm,
    });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(t.fiscalYear.reason), 'علت');
    await user.click(confirm);
    expect(
      await screen.findByText(t.fiscalYear.errorCodes.invalidTransition),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('backend internal details'),
    ).not.toBeInTheDocument();
  });
});
