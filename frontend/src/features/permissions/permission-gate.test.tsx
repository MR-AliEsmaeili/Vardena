import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { PermissionGate } from './permission-gate';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
});

function givenPermissions(permissions: string[]): void {
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions,
  });
}

describe('PermissionGate', () => {
  it('renders the children when the effective permission is present', async () => {
    givenPermissions(['Accounting.GeneralLedger.View']);

    renderWithProviders(
      <PermissionGate permission="Accounting.GeneralLedger.View">
        <span>ledger action</span>
      </PermissionGate>,
    );

    expect(await screen.findByText('ledger action')).toBeInTheDocument();
  });

  it('renders nothing (or the fallback) when the permission is missing', async () => {
    givenPermissions(['Accounting.TrialBalance.View']);

    renderWithProviders(
      <PermissionGate
        permission="Accounting.GeneralLedger.View"
        fallback={<span>{t.permissions.forbiddenTitle}</span>}
      >
        <span>ledger action</span>
      </PermissionGate>,
    );

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText('ledger action')).not.toBeInTheDocument();
  });

  it('requires every code when several are given (AND semantics)', async () => {
    givenPermissions(['Accounting.Account.View']);

    renderWithProviders(
      <PermissionGate
        permission={[
          'Accounting.Account.View',
          'Accounting.GeneralLedger.View',
        ]}
      >
        <span>combined action</span>
      </PermissionGate>,
    );

    await waitFor(() => {
      expect(identityApi.getEffectivePermissions).toHaveBeenCalled();
    });
    expect(screen.queryByText('combined action')).not.toBeInTheDocument();
  });

  it('never expands a prefix or wildcard into a permission', async () => {
    givenPermissions(['Accounting.GeneralLedger.ViewExtended', 'Accounting.*']);

    renderWithProviders(
      <PermissionGate permission="Accounting.GeneralLedger.View">
        <span>ledger action</span>
      </PermissionGate>,
    );

    await waitFor(() => {
      expect(identityApi.getEffectivePermissions).toHaveBeenCalled();
    });
    expect(screen.queryByText('ledger action')).not.toBeInTheDocument();
  });

  it('hides gated content while the permissions are still unknown', () => {
    givenPermissions(['Accounting.GeneralLedger.View']);

    renderWithProviders(
      <PermissionGate permission="Accounting.GeneralLedger.View">
        <span>ledger action</span>
      </PermissionGate>,
    );

    // Synchronously, before the permission query resolves.
    expect(screen.queryByText('ledger action')).not.toBeInTheDocument();
  });
});
