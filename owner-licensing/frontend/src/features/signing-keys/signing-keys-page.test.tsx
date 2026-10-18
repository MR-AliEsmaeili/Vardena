import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as api from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';

/**
 * OQ-74 (Product Owner decision 2026-10-18): signing-key tracking UI tests.
 *
 * These tests pin the contract:
 *   1. Owner Admin sees the signing-keys page in the navigation and can
 *      register a new signing key.
 *   2. The operations list shows the signing-key id and derived safety status
 *      per license observation (SAFE / NEEDS_REVIEW / UNKNOWN).
 *   3. License Operator can read signing keys but cannot mutate them.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', () => ({
  customers: vi.fn(),
  customer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  users: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetPassword: vi.fn(),
  auditEvents: vi.fn(),
  operationalRecords: vi.fn(),
  operationalRecord: vi.fn(),
  recordLicenseObservation: vi.fn(),
  recordActivationObservation: vi.fn(),
  recordServerReplacement: vi.fn(),
  recordOldServerObservation: vi.fn(),
  recordReplacementObservation: vi.fn(),
  signingKeys: vi.fn(),
  signingKey: vi.fn(),
  registerSigningKey: vi.fn(),
  updateSigningKeyStatus: vi.fn(),
  updateSigningKeyNotes: vi.fn(),
}));

const admin = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};

const operator = {
  ...admin,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV_OP',
  username: 'operator',
  role: 'LICENSE_OPERATOR' as const,
};

function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return client;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders client={makeClient()}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identity.getCurrentUser).mockResolvedValue(admin);
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    permissions: [
      'customers.view',
      'customers.write',
      'users.manage',
      'audit.view',
      'operations.view',
      'operations.record',
      'replacements.authorize',
    ],
  });
});

describe('OQ-74 signing-key tracking UI', () => {
  it('shows the signing-keys page link in navigation for Owner Admin', async () => {
    vi.mocked(api.signingKeys).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    renderAt('/app');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: o.signingKeys })).toBeInTheDocument();
    });
  });

  it('Owner Admin can register a new signing key', async () => {
    vi.mocked(api.signingKeys).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.registerSigningKey).mockResolvedValue({
      id: 'authority-2026',
      label: 'Production key 2026',
      status: 'ACTIVE',
      statusDetectedAt: null,
      statusReason: null,
      evidenceRef: null,
      notes: null,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    renderAt('/app/signing-keys');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: o.signingKeyRegister })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/شناسه کلید/), 'authority-2026');
    await user.type(screen.getByLabelText(/برچسب نمایشی/), 'Production key 2026');
    await user.click(screen.getByRole('button', { name: o.signingKeyRegister }));
    await waitFor(() => {
      expect(api.registerSigningKey).toHaveBeenCalledWith({
        id: 'authority-2026',
        label: 'Production key 2026',
      });
    });
  });

  it('operations list shows SAFE safety badge for a license signed with an ACTIVE key', async () => {
    vi.mocked(api.operationalRecords).mockResolvedValue({
      items: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          customerId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          customerCode: 'ACME.01',
          displayName: 'مشتری',
          kind: 'LICENSE',
          observationCategory: 'EXTERNAL_ISSUANCE_OBSERVED',
          observedStatus: 'ISSUED',
          installationReference: 'INST-1',
          oldInstallationReference: null,
          replacementInstallationReference: null,
          oldServerObservedState: null,
          replacementObservedState: null,
          emergencyOldServerLost: false,
          replacesRecordId: null,
          recordedOn: '2026-10-18',
          observedValidityEnd: '2027-10-18',
          evidenceBasis: 'OPERATOR_OBSERVED',
          cryptographicVerification: 'NOT_IMPLEMENTED',
          signedArtifactProduced: false,
          customerServerContacted: false,
          signingKeyId: 'authority-2026',
          signingKeyStatus: 'ACTIVE',
          signingKeySafety: 'SAFE',
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
          createdBy: admin.id,
          updatedBy: admin.id,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderAt('/app/operations');
    await waitFor(() => {
      expect(screen.getByText('authority-2026')).toBeInTheDocument();
    });
    expect(screen.getByText(o.signingKeySafetySafe)).toBeInTheDocument();
  });

  it('operations list shows NEEDS_REVIEW badge for a license signed with a COMPROMISED key', async () => {
    vi.mocked(api.operationalRecords).mockResolvedValue({
      items: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          customerId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          customerCode: 'ACME.01',
          displayName: 'مشتری',
          kind: 'LICENSE',
          observationCategory: 'EXTERNAL_ISSUANCE_OBSERVED',
          observedStatus: 'ISSUED',
          installationReference: 'INST-1',
          oldInstallationReference: null,
          replacementInstallationReference: null,
          oldServerObservedState: null,
          replacementObservedState: null,
          emergencyOldServerLost: false,
          replacesRecordId: null,
          recordedOn: '2026-10-18',
          observedValidityEnd: '2027-10-18',
          evidenceBasis: 'OPERATOR_OBSERVED',
          cryptographicVerification: 'NOT_IMPLEMENTED',
          signedArtifactProduced: false,
          customerServerContacted: false,
          signingKeyId: 'authority-2026',
          signingKeyStatus: 'COMPROMISED',
          signingKeySafety: 'NEEDS_REVIEW',
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
          createdBy: admin.id,
          updatedBy: admin.id,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderAt('/app/operations');
    await waitFor(() => {
      expect(screen.getByText(o.signingKeySafetyNeedsReview)).toBeInTheDocument();
    });
    // The signing-key id is still shown so the Owner can identify which key is affected.
    expect(screen.getByText('authority-2026')).toBeInTheDocument();
  });

  it('License Operator sees the signing-keys page but cannot register new keys', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue(operator);
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    vi.mocked(api.signingKeys).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    renderAt('/app/signing-keys');
    await waitFor(() => {
      expect(screen.getByText(o.signingKeys)).toBeInTheDocument();
    });
    // The register form is gated behind customers.write permission.
    expect(screen.queryByText(o.signingKeyRegister)).not.toBeInTheDocument();
  });
});
