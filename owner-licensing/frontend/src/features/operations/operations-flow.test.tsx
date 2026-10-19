import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as api from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', () => ({
  signingKeys: vi.fn(),
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
}));

const admin = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const customer = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  customerCode: 'Acme.01',
  displayName: 'مشتری',
  status: 'ACTIVE' as const,
  contractReference: 'HIDDEN',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  createdBy: admin.id,
  updatedBy: admin.id,
};
function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}
beforeEach(() => {
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
  vi.mocked(api.signingKeys).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.customers).mockResolvedValue({
    items: [customer],
    total: 1,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.operationalRecords).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.recordLicenseObservation).mockResolvedValue({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    customerId: customer.id,
    customerCode: customer.customerCode,
    displayName: customer.displayName,
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
    recordedOn: '2026-10-15',
    observedValidityEnd: '2027-10-15',
    evidenceBasis: 'OPERATOR_OBSERVED',
    cryptographicVerification: 'NOT_IMPLEMENTED',
    signedArtifactProduced: false,
    customerServerContacted: false,
    signingKeyId: null,
    signingKeyStatus: null,
    signingKeySafety: 'UNKNOWN',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    createdBy: admin.id,
    updatedBy: admin.id,
    transitions: [],
  });
});

describe('manual operations UI', () => {
  it('allows License Operator routine license observation while hiding server-replacement authorization', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'LICENSE_OPERATOR',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    mount('/app/operations');
    expect(await screen.findByText(o.emptyOperations)).toBeInTheDocument();
    expect(screen.getByText(o.manualBanner)).toBeInTheDocument();
    expect(screen.getByText(o.notReceipt)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: o.recordIssuance }),
    ).toHaveAttribute('href', '/app/operations/activation/new');
    expect(
      screen.queryByRole('link', { name: o.recordReplacement }),
    ).not.toBeInTheDocument();
    expect(api.recordServerReplacement).not.toHaveBeenCalled();
  });
  it('denies License Operator direct navigation to server-replacement authorization form', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'LICENSE_OPERATOR',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    mount('/app/operations/replacement/new');
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(api.recordServerReplacement).not.toHaveBeenCalled();
  });
  it('renders manual license and replacement history Instants through the same Tehran formatter', async () => {
    const record = await api.recordLicenseObservation(
      {} as Parameters<typeof api.recordLicenseObservation>[0],
    );
    vi.mocked(api.operationalRecord).mockResolvedValue({
      ...record,
      transitions: [
        {
          id: admin.id,
          actorId: admin.id,
          occurredAt: '2026-10-08T21:00:00.000Z',
          priorStatus: 'UNRECORDED',
          newStatus: 'ISSUED',
          reason: 'observed',
          evidenceReference: null,
          confirmationKind: 'OPERATOR_OBSERVED',
        },
      ],
    });
    vi.mocked(api.recordLicenseObservation).mockClear();
    mount(`/app/operations/${record.id}`);
    expect(
      await screen.findByText('۱۴۰۵/۰۷/۱۷ ۰۰:۳۰:۰۰ Asia/Tehran (UTC+03:30)'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('۱۴۰۵/۰۷/۲۳ ۰۳:۳۰:۰۰ Asia/Tehran (UTC+03:30)'),
    ).toHaveLength(2);
    expect(api.recordLicenseObservation).not.toHaveBeenCalled();
  });
  // PDR-18 §1 + PDR-17: Owner-side observation metadata is displayed as its
  // own pair, separate from the customer's commercial contract dates and from
  // a signed license's technical validity. The recording day is server-derived
  // and the UI never offers a control for it.
  it('renders Owner-side observation metadata as a distinct pair on a license record', async () => {
    const record = await api.recordLicenseObservation(
      {} as Parameters<typeof api.recordLicenseObservation>[0],
    );
    vi.mocked(api.operationalRecord).mockResolvedValue({
      ...record,
      recordedOn: '2026-10-15',
      observedValidityEnd: '2027-10-15',
    });
    vi.mocked(api.recordLicenseObservation).mockClear();
    mount(`/app/operations/${record.id}`);
    expect(await screen.findByText(o.recordedOn)).toBeInTheDocument();
    expect(screen.getByText('۱۴۰۵/۰۷/۲۳ (2026-10-15)')).toBeInTheDocument();
    expect(screen.getByText('۱۴۰۶/۰۷/۲۳ (2027-10-15)')).toBeInTheDocument();
    // The recording day is never editable; only the recorded end has a control.
    expect(screen.queryByLabelText(o.recordedOn)).not.toBeInTheDocument();
  });
  it('never labels an Owner-side recording day as a signed issuance or activation date', async () => {
    const record = await api.recordLicenseObservation(
      {} as Parameters<typeof api.recordLicenseObservation>[0],
    );
    mount(`/app/operations/${record.id}`);
    // No label may claim a verified issuance date (PDR-17).
    expect(
      screen.queryByText(/تاریخ صدور معتبر|صدور واقعی|فعال‌سازی واقعی/),
    ).not.toBeInTheDocument();
    // The record states its own epistemic status instead (PDR-17).
    expect(await screen.findByText(o.recordedOn)).toBeInTheDocument();
    expect(screen.getByText(o.operatorObserved)).toBeInTheDocument();
    expect(screen.getAllByText(o.notVerified).length).toBeGreaterThan(0);
    expect(screen.getAllByText(o.noArtifact).length).toBeGreaterThan(0);
    expect(screen.getAllByText(o.noContact).length).toBeGreaterThan(0);
  });
  it('denies operational records when operations.view is not granted', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['customers.view'],
    });
    mount('/app/operations');
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(api.operationalRecords).not.toHaveBeenCalled();
  });
  it('submits a selected customer and signingKeyId through the normal observation form', async () => {
    vi.mocked(api.signingKeys).mockResolvedValue({
      items: [
        {
          id: 'authority-2026',
          label: 'Authority',
          status: 'ACTIVE',
          statusDetectedAt: null,
          statusReason: null,
          evidenceRef: null,
          notes: null,
          createdAt: admin.createdAt,
          updatedAt: admin.createdAt,
          createdBy: admin.id,
          updatedBy: admin.id,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    mount('/app/operations/activation/new');
    const user = userEvent.setup();
    expect(await screen.findByText(o.manualBanner)).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: o.customerSearch }),
      'Acme',
    );
    await user.click(await screen.findByRole('radio', { name: /مشتری/ }));
    await user.selectOptions(
      await screen.findByLabelText(o.signingKeyLinkedTo),
      'authority-2026',
    );
    expect(api.signingKeys).toHaveBeenCalledWith(
      '',
      1,
      { status: 'ACTIVE' },
      expect.anything(),
    );
    await user.type(screen.getByLabelText(o.installation), 'INST-1');
    await user.type(screen.getByLabelText(o.reason), 'صدور خارجی مشاهده شد');
    await user.click(screen.getByRole('button', { name: o.recordIssuance }));
    expect(api.recordLicenseObservation).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('checkbox', { name: o.confirmObservation }),
    );
    await user.click(screen.getByRole('button', { name: o.recordIssuance }));
    expect(api.recordLicenseObservation).toHaveBeenCalledWith({
      customerId: customer.id,
      signingKeyId: 'authority-2026',
      installationReference: 'INST-1',
      reason: 'صدور خارجی مشاهده شد',
      evidenceReference: undefined,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      o.savedObservation,
    );
  });
  it('includes non-active keys only in explicit historical mode and resets the selection', async () => {
    mount('/app/operations/activation/new');
    const user = userEvent.setup();
    await screen.findByLabelText(o.signingKeyLinkedTo);
    await user.click(screen.getByLabelText(o.signingKeyHistorical));
    await screen.findByLabelText(o.signingKeyLinkedTo);
    expect(api.signingKeys).toHaveBeenLastCalledWith(
      '',
      1,
      {},
      expect.anything(),
    );
    expect(screen.getByLabelText(o.signingKeyLinkedTo)).toHaveValue('');
  });
  it('renders UNKNOWN for legacy observations with no key association', async () => {
    const record = await api.recordLicenseObservation(
      {} as Parameters<typeof api.recordLicenseObservation>[0],
    );
    vi.mocked(api.operationalRecord).mockResolvedValue(record);
    mount(`/app/operations/${record.id}`);
    expect(
      await screen.findByText(o.signingKeySafetyUnknown),
    ).toBeInTheDocument();
    expect(screen.queryByText(o.signingKeySafetySafe)).not.toBeInTheDocument();
  });
});
