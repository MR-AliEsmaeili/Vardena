import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as lic from '@/api/licensing';
import { o } from '@/lib/owner-i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/licensing', () => ({
  MODULE_CODES: [
    'accounting',
    'documents',
    'inventory',
    'organization',
    'rbac',
    'users',
    'workflow',
  ],
  REVOCATION_REASONS: [
    'NON_PAYMENT',
    'CONTRACT_TERMINATION',
    'FRAUD',
    'KEY_COMPROMISE',
    'ISSUED_IN_ERROR',
    'COURT_ORDER',
    'OTHER',
  ],
  issuances: vi.fn(),
  prepareIssuance: vi.fn(),
  issuanceRequest: vi.fn(),
  importIssuanceArtifact: vi.fn(),
  abandonIssuance: vi.fn(),
  prepareRevocation: vi.fn(),
  revocationRequest: vi.fn(),
  importRevocationArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  saveBlob: vi.fn(),
}));

const admin = {
  id: '01K76ZC2C29NQRB7R7R3GZAGZN',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};

const payloadDigest = 'a'.repeat(64);
const bindingDigest = 'b'.repeat(64);
const prepared = {
  id: '01K7HPPC8TNSYYKYEDVM9XJXN7',
  customerId: '01K76ZC2C29NQRB7R7R3GZAGZN',
  customerCode: 'CUST-UI-01',
  customerName: 'مشتری رابط',
  licenseId: '01K7T70APEYTRJZGRNE0N4K499',
  operationId: '01K76A539QMJGYGPW7HNW9BKWS',
  installationIdentityId: '01K7D0T5SET4HY654W9HREVCFT',
  installationId: '01K770CDMRGZP7RTERFB7A5A4V',
  licenseKind: 'TIME_LIMITED' as const,
  validFrom: '2026-10-20T00:00:00.000Z',
  validUntil: '2027-10-20T00:00:00.000Z',
  organizationLimit: 1,
  userLimit: 5,
  deviceLimit: null,
  deviceLimitSpecified: false,
  modules: ['accounting'],
  features: [],
  limitProfileId: null,
  signingKeyId: 'sha256-e6fc4307e011fd04',
  supersedesOperationId: null,
  renewsOperationId: null,
  status: 'REQUEST_PREPARED' as const,
  protocolVersion: 'VLIC2' as const,
  requestPayloadSha256: payloadDigest,
  requestBindingSha256: bindingDigest,
  requestedAt: '2026-10-20T10:00:00.000Z',
  requestedBy: admin.id,
  signedAt: null,
  importedAt: null,
  importedBy: null,
  artifactSha256: null,
  artifactAvailable: false,
  requestAgeDays: 0,
  customerImportAdvisory: 'IMPORTABLE' as const,
  revocation: null,
  signedArtifactProduced: false,
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={['/app/licenses']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  vi.mocked(identity.getCurrentUser).mockResolvedValue(admin);
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    permissions: [],
  });
  vi.mocked(lic.issuances).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 50,
  });
});

describe('Owner license issuance page', () => {
  it('renders the forbidden state without licenses.view and never lists data', async () => {
    mount();
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(lic.issuances).not.toHaveBeenCalled();
  });

  it('shows the empty state with view permission and no fabricated success', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['licenses.view'],
    });
    mount();
    expect(await screen.findByText(o.licenses.empty)).toBeInTheDocument();
    expect(screen.queryByText(o.licenses.preparedTitle)).toBeNull();
    expect(screen.queryByText(o.licenses.downloadSigned)).toBeNull();
  });

  it('validates the request locally before calling the API', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['licenses.view', 'licenses.issue.time_limited'],
    });
    mount();
    await screen.findByText(o.licenses.empty);
    await userEvent.type(
      screen.getByLabelText(o.licenses.customerId),
      'not-a-ulid',
    );
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.prepare }),
    );
    expect(
      await screen.findByText(o.licenses.errorCustomer),
    ).toBeInTheDocument();
    expect(lic.prepareIssuance).not.toHaveBeenCalled();
  });

  it('shows both full digests returned by the server after preparing', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'licenses.view',
        'licenses.issue.time_limited',
        'licenses.import',
        'licenses.download',
      ],
    });
    vi.mocked(lic.prepareIssuance).mockResolvedValue({
      issuance: prepared,
      requestPayloadSha256: payloadDigest,
      requestBindingSha256: bindingDigest,
      requestFileName: 'vardena-license-signing-request.json',
      unsignedRequest: true,
      signedArtifactProduced: false,
    });
    mount();
    await screen.findByText(o.licenses.empty);
    await userEvent.type(
      screen.getByLabelText(o.licenses.customerId),
      prepared.customerId,
    );
    await userEvent.type(
      screen.getByLabelText(o.licenses.installationIdentity),
      prepared.installationIdentityId,
    );
    await userEvent.type(
      screen.getByLabelText(o.licenses.signingKey),
      prepared.signingKeyId,
    );
    const end = screen.getByLabelText(o.licenses.endDate);
    // Jalali-first input, converted by the shared date foundation.
    fireEvent.change(end, { target: { value: '1406/07/28' } });
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.prepare }),
    );
    expect(
      await screen.findByText(o.licenses.preparedTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(payloadDigest)).toBeInTheDocument();
    expect(screen.getByText(bindingDigest)).toBeInTheDocument();
    expect(screen.getByText(o.licenses.digestWarning)).toBeInTheDocument();
    expect(lic.prepareIssuance).toHaveBeenCalledTimes(1);
  });
});
