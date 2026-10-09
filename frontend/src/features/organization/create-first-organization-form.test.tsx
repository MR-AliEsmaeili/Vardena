import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { Organization } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { CreateFirstOrganizationForm } from './create-first-organization-form';

vi.mock('@/api/organization.api', () => ({
  createOrganization: vi.fn(),
  grantMembership: vi.fn(),
}));

const organizationApi = await import('@/api/organization.api');

/**
 * Unit coverage for the task §4/§7 first-organization bootstrap form.
 *
 * Proves the form calls exactly the two existing, unmodified endpoints in
 * the required order (`POST /organizations` then
 * `POST /organizations/:id/members`) with the acting principal's own id, and
 * that it never claims success — never calls `onCreated` — unless BOTH calls
 * the backend requires actually succeeded.
 */
function renderForm(onCreated: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateFirstOrganizationForm userId="usr-1" onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

describe('CreateFirstOrganizationForm', () => {
  it('requires both code and name before submitting', async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderForm(onCreated);

    await user.click(
      screen.getByRole('button', { name: t.organization.createFirstSubmit }),
    );

    expect(
      await screen.findByText(t.organization.createFirstCodeRequired),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.organization.createFirstNameRequired),
    ).toBeInTheDocument();
    expect(organizationApi.createOrganization).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('creates the organization, grants the acting user membership, and only then reports success', async () => {
    const onCreated = vi.fn();
    const createdOrganization: Organization = {
      id: 'org-new',
      code: 'MAIN',
      name: 'سازمان اصلی',
      isActive: true,
      calendarSystem: 'JALALI',
      timeZone: 'Asia/Tehran',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(organizationApi.createOrganization).mockResolvedValue(
      createdOrganization,
    );
    vi.mocked(organizationApi.grantMembership).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderForm(onCreated);

    await user.type(
      screen.getByLabelText(t.organization.createFirstCode),
      'MAIN',
    );
    await user.type(
      screen.getByLabelText(t.organization.createFirstName),
      'سازمان اصلی',
    );
    await user.click(
      screen.getByRole('button', { name: t.organization.createFirstSubmit }),
    );

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect(organizationApi.createOrganization).toHaveBeenCalledWith({
      code: 'MAIN',
      name: 'سازمان اصلی',
    });
    expect(organizationApi.grantMembership).toHaveBeenCalledWith('org-new', {
      userId: 'usr-1',
    });
    // Grant only ever runs after creation succeeded — the mock resolution
    // order above already proves the awaited sequence, and `onCreated`
    // firing proves neither call was skipped.
  });

  it('does not report success when organization creation is refused (e.g. a pinned deployment)', async () => {
    const onCreated = vi.fn();
    vi.mocked(organizationApi.createOrganization).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'This deployment is pinned to a single organization.',
        status: 422,
        correlationId: 'corr-1',
      }),
    );
    const user = userEvent.setup();
    renderForm(onCreated);

    await user.type(
      screen.getByLabelText(t.organization.createFirstCode),
      'MAIN',
    );
    await user.type(
      screen.getByLabelText(t.organization.createFirstName),
      'سازمان اصلی',
    );
    await user.click(
      screen.getByRole('button', { name: t.organization.createFirstSubmit }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(organizationApi.grantMembership).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does not report success when the membership grant is refused after creation', async () => {
    const onCreated = vi.fn();
    vi.mocked(organizationApi.createOrganization).mockResolvedValue({
      id: 'org-new',
      code: 'MAIN',
      name: 'سازمان اصلی',
      isActive: true,
      calendarSystem: 'JALALI',
      timeZone: 'Asia/Tehran',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies Organization);
    vi.mocked(organizationApi.grantMembership).mockRejectedValue(
      new ApiError({
        code: 'PermissionDenied',
        message: 'Missing permission.',
        status: 403,
        correlationId: 'corr-2',
      }),
    );
    const user = userEvent.setup();
    renderForm(onCreated);

    await user.type(
      screen.getByLabelText(t.organization.createFirstCode),
      'MAIN',
    );
    await user.type(
      screen.getByLabelText(t.organization.createFirstName),
      'سازمان اصلی',
    );
    await user.click(
      screen.getByRole('button', { name: t.organization.createFirstSubmit }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
