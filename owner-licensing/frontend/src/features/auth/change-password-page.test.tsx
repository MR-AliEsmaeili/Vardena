import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

const firstLogin = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: true,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const unauthorized = (message: string) =>
  new ApiError({ code: 'Unauthorized', message, status: 401 });

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={['/change-password']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

async function attemptChange(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText(t.auth.currentPassword),
    'mistyped-current',
  );
  await user.type(screen.getByLabelText(t.auth.newPassword), 'Fresh_secret_52');
  await user.type(
    screen.getByLabelText(t.auth.confirmPassword),
    'Fresh_secret_52',
  );
  await user.click(
    screen.getByRole('button', { name: t.auth.submitChangePassword }),
  );
}

beforeEach(() => {
  vi.mocked(identity.changePassword).mockReset();
  vi.mocked(identity.getCurrentUser).mockReset();
  vi.mocked(identity.getCurrentUser).mockResolvedValue(firstLogin);
});

describe('mandatory first-login password change (mocked API boundary, CI)', () => {
  it('reports a rejected current password as a credential error, not an expired session', async () => {
    vi.mocked(identity.changePassword).mockRejectedValue(
      unauthorized('Invalid current password.'),
    );
    // The session is still valid: the server rejected the credential only.
    vi.mocked(identity.getCurrentUser).mockResolvedValue(firstLogin);
    mount();
    const user = userEvent.setup();
    await attemptChange(user);
    expect(
      await screen.findAllByText(t.auth.currentPasswordInvalid),
    ).not.toHaveLength(0);
    expect(screen.getByLabelText(t.auth.currentPassword)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // The page asked the session, stayed on the form, and claimed no expiry.
    expect(identity.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t.auth.changePasswordSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(t.auth.sessionExpired)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.auth.username)).not.toBeInTheDocument();
  });

  it('signs the operator in again with the expiry notice when the session really ended', async () => {
    vi.mocked(identity.changePassword).mockRejectedValue(
      unauthorized('Authentication is required.'),
    );
    vi.mocked(identity.getCurrentUser)
      .mockResolvedValueOnce(firstLogin)
      .mockRejectedValue(unauthorized('Authentication is required.'));
    mount();
    const user = userEvent.setup();
    await attemptChange(user);
    expect(await screen.findByText(t.auth.sessionExpired)).toBeInTheDocument();
    expect(screen.getByLabelText(t.auth.username)).toBeInTheDocument();
    expect(
      screen.queryByText(t.auth.changePasswordSubtitle),
    ).not.toBeInTheDocument();
  });

  it('claims no cause when the session probe cannot answer', async () => {
    vi.mocked(identity.changePassword).mockRejectedValue(
      unauthorized('Invalid current password.'),
    );
    vi.mocked(identity.getCurrentUser)
      .mockResolvedValueOnce(firstLogin)
      .mockRejectedValue(
        new ApiError({
          code: 'InternalError',
          message: 'probe failed',
          status: 500,
        }),
      );
    mount();
    const user = userEvent.setup();
    await attemptChange(user);
    expect(await screen.findByText(t.errors.unauthorized)).toBeInTheDocument();
    expect(
      screen.queryByText(t.auth.currentPasswordInvalid),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(t.auth.sessionExpired)).not.toBeInTheDocument();
    expect(screen.getByText(t.auth.changePasswordSubtitle)).toBeInTheDocument();
  });
});
