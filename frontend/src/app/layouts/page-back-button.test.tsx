import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { PageBackButton } from './page-back-button';

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

describe('PageBackButton', () => {
  it('offers a previous-step action on forms with a safe parent fallback', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/accounting/accounts/new']}>
        <PageBackButton />
        <CurrentPath />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole('button', { name: t.app.backToPrevious }),
    );
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/app/accounting/accounts',
    );
  });

  it('returns to the actual previous page when router history exists', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          '/app/accounting/accounts',
          '/app/accounting/accounts/01/edit',
        ]}
        initialIndex={1}
      >
        <PageBackButton />
        <CurrentPath />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole('button', { name: t.app.backToPrevious }),
    );
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/app/accounting/accounts',
    );
  });
});
