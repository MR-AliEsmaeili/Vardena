import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { ActiveWindowsBar } from './active-windows-bar';

describe('ActiveWindowsBar', () => {
  it('collects visited destinations as compact, closable, module-tinted windows', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/accounting/documents']}>
        <Link to="/app/accounting/trial-balance">go report</Link>
        <ActiveWindowsBar />
      </MemoryRouter>,
    );

    const bar = await screen.findByRole('region', {
      name: t.nav.activeWindows,
    });
    expect(
      within(bar).getByRole('button', {
        name: t.nav.openWindow.replace('{window}', t.nav.documents),
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'go report' }));
    await waitFor(() => {
      expect(
        within(bar).getByRole('button', {
          name: t.nav.openWindow.replace('{window}', t.nav.trialBalance),
        }),
      ).toBeInTheDocument();
    });
    expect(bar.querySelector('[data-tone="accounting"]')).not.toBeNull();
    expect(bar.firstElementChild?.className).toContain('grid');
    expect(bar.firstElementChild?.className).not.toContain('overflow-x-auto');

    await user.click(
      within(bar).getByRole('button', {
        name: t.nav.closeWindow.replace('{window}', t.nav.documents),
      }),
    );
    expect(
      within(bar).queryByRole('button', {
        name: t.nav.openWindow.replace('{window}', t.nav.documents),
      }),
    ).not.toBeInTheDocument();
  });
});
