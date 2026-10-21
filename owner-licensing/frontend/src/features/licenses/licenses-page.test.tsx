import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as lic from '@/api/licensing';
import * as owner from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/owner.api')>('@/api/owner.api');
  return {
    ...actual,
    customers: vi.fn(),
    signingKeys: vi.fn(),
  };
});
vi.mock('@/api/licensing', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/licensing')>('@/api/licensing');
  return {
    ...actual,
    issuances: vi.fn(),
    issuance: vi.fn(),
    installationIdentities: vi.fn(),
    registerInstallationIdentity: vi.fn(),
    retireInstallationIdentity: vi.fn(),
    limitProfiles: vi.fn(),
    createLimitProfile: vi.fn(),
    retireLimitProfile: vi.fn(),
    reactivateLimitProfile: vi.fn(),
    prepareIssuance: vi.fn(),
    issuanceRequest: vi.fn(),
    importIssuanceArtifact: vi.fn(),
    abandonIssuance: vi.fn(),
    prepareRevocation: vi.fn(),
    revocationRequest: vi.fn(),
    importRevocationArtifact: vi.fn(),
    downloadArtifact: vi.fn(),
    saveBlob: vi.fn(),
  };
});

const admin = {
  id: '01K76ZC2C29NQRB7R7R3GZAGZN',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};

const customer = {
  id: '01K76ZC2C29NQRB7R7R3GZAGZZ',
  customerCode: 'CUST-UI-01',
  displayName: 'مشتری رابط',
  status: 'ACTIVE' as const,
};

const identityRow = {
  id: '01K7D0T5SET4HY654W9HREVCFT',
  customerId: customer.id,
  installationId: '01K770CDMRGZP7RTERFB7A5A4V',
  source: 'CUSTOMER_VARDENA_SCREEN',
  sourceDetail: null,
  confirmedBy: admin.id,
  confirmedAt: '2026-10-19T08:00:00.000Z',
  confirmationEvidenceRef: null,
  status: 'ACTIVE' as const,
  createdBy: admin.id,
  createdAt: '2026-10-19T08:00:00.000Z',
  bindingEvidence: 'OPERATOR_RECORDED_NOT_CRYPTOGRAPHIC' as const,
};

const key = {
  id: 'sha256-e6fc4307e011fd04',
  label: 'کلید تولید',
  status: 'ACTIVE' as const,
  statusDetectedAt: null,
  statusReason: null,
  evidenceRef: null,
  notes: null,
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  createdBy: admin.id,
  updatedBy: admin.id,
};

const profile = {
  id: '01K7PROFILE000000000000000A',
  customerId: customer.id,
  organizationLimit: 1,
  userLimit: 5,
  allowedModules: ['accounting'],
  perpetualAllowed: false,
  status: 'ACTIVE' as const,
  createdBy: admin.id,
  createdAt: '2026-10-19T08:00:00.000Z',
  updatedBy: admin.id,
  updatedAt: '2026-10-19T08:00:00.000Z',
};

const payloadDigest = 'a'.repeat(64);
const bindingDigest = 'b'.repeat(64);

const prepared = {
  id: '01K7HPPC8TNSYYKYEDVM9XJXN7',
  customerId: customer.id,
  customerCode: customer.customerCode,
  customerName: customer.displayName,
  licenseId: '01K7T70APEYTRJZGRNE0N4K499',
  operationId: '01K76A539QMJGYGPW7HNW9BKWS',
  installationIdentityId: identityRow.id,
  installationId: identityRow.installationId,
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
  signingKeyId: key.id,
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

function mount(path = '/app/licenses') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
    permissions: [],
  });
  vi.mocked(lic.issuances).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 50,
  });
  vi.mocked(owner.customers).mockResolvedValue({
    items: [customer],
    page: 1,
    pageSize: 50,
  });
  vi.mocked(owner.signingKeys).mockResolvedValue({
    items: [key],
    page: 1,
    pageSize: 50,
    total: 1,
  });
  vi.mocked(lic.installationIdentities).mockResolvedValue({
    customerId: customer.id,
    items: [identityRow],
  });
  vi.mocked(lic.limitProfiles).mockResolvedValue({
    customerId: customer.id,
    activeProfile: profile,
    items: [profile],
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

  it('refuses to review without a customer and never calls the API', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['licenses.view', 'licenses.issue.time_limited'],
    });
    mount();
    await screen.findByText(o.licenses.empty);
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.review }),
    );
    expect(
      await screen.findByText(o.licenses.errorCustomer),
    ).toBeInTheDocument();
    expect(lic.prepareIssuance).not.toHaveBeenCalled();
  });

  it('prepares from selected records, shows the review step and both digests', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
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

    // The customer, installation and key are *selected*, never typed.
    const radio = await screen.findByRole('radio', {
      name: new RegExp(customer.displayName),
    });
    await userEvent.click(radio);
    await waitFor(() =>
      expect(lic.installationIdentities).toHaveBeenCalledWith(
        customer.id,
        expect.anything(),
      ),
    );
    // The active limit profile is shown before anything is prepared.
    expect(
      await screen.findByText(o.licenses.profileTitle),
    ).toBeInTheDocument();

    const end = await screen.findByLabelText(o.licenses.endDate);
    fireEvent.change(end, { target: { value: '1406/07/28' } });
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.review }),
    );
    expect(await screen.findByText(o.licenses.reviewTitle)).toBeInTheDocument();
    expect(screen.getByText(o.licenses.reviewConfirm)).toBeInTheDocument();
    expect(lic.prepareIssuance).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.reviewConfirm }),
    );
    expect(
      await screen.findByText(o.licenses.preparedTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(payloadDigest)).toBeInTheDocument();
    expect(screen.getByText(bindingDigest)).toBeInTheDocument();
    expect(screen.getByText(o.licenses.digestWarning)).toBeInTheDocument();
    expect(lic.prepareIssuance).toHaveBeenCalledTimes(1);
    expect(lic.prepareIssuance).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer.id,
        installationIdentityId: identityRow.id,
        signingKeyId: key.id,
        // Auto-selected from the single active identity/key and the profile.
        modules: ['accounting'],
        supersedesOperationId: null,
        renewsOperationId: null,
      }),
    );
  });

  it('pre-fills a renewal from the named issuance and sends its operation id', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'licenses.view',
        'licenses.issue.time_limited',
        'licenses.issue.perpetual',
      ],
    });
    vi.mocked(lic.issuance).mockResolvedValue({
      ...prepared,
      status: 'SIGNED_RECORDED',
      signedAt: '2026-10-20T10:05:00.000Z',
      importedAt: '2026-10-20T10:06:00.000Z',
      artifactSha256: 'c'.repeat(64),
      artifactAvailable: true,
      signedArtifactProduced: true,
    });
    vi.mocked(lic.prepareIssuance).mockResolvedValue({
      issuance: prepared,
      requestPayloadSha256: payloadDigest,
      requestBindingSha256: bindingDigest,
      requestFileName: 'vardena-license-signing-request.json',
      unsignedRequest: true,
      signedArtifactProduced: false,
    });
    mount(`/app/licenses?renews=${prepared.operationId}`);
    expect(
      await screen.findByText(o.licenses.lineagePreselected),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(lic.issuance).toHaveBeenCalledWith(
        prepared.operationId,
        expect.anything(),
      ),
    );
    const end = await screen.findByLabelText(o.licenses.endDate);
    fireEvent.change(end, { target: { value: '1406/07/28' } });
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.review }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: o.licenses.reviewConfirm }),
    );
    await screen.findByText(o.licenses.preparedTitle);
    expect(lic.prepareIssuance).toHaveBeenCalledWith(
      expect.objectContaining({
        renewsOperationId: prepared.operationId,
        supersedesOperationId: null,
      }),
    );
  });

  it('states that a recorded revocation document is not an applied revocation', async () => {
    // OD-LIC-17 / OD-LIC-19: the Owner records and archives the signed
    // document; it cannot and must not claim any installation applied it.
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['licenses.view'],
    });
    vi.mocked(lic.issuances).mockResolvedValue({
      items: [
        {
          ...prepared,
          status: 'SIGNED_RECORDED',
          signedAt: '2026-10-20T10:05:00.000Z',
          importedAt: '2026-10-20T10:06:00.000Z',
          artifactSha256: 'c'.repeat(64),
          artifactAvailable: true,
          signedArtifactProduced: true,
          revocation: {
            revocationId: '01K7REVOCATIONAAAAAAAAAAAA',
            reason: 'NON_PAYMENT',
            status: 'SIGNED_RECORDED',
            importedAt: '2026-10-21T10:00:00.000Z',
          },
        },
      ],
      page: 1,
      pageSize: 50,
    });
    mount();
    expect(
      await screen.findByText(o.licenses.revocationNotApplied),
    ).toBeInTheDocument();
    expect(screen.getByText(/NON_PAYMENT/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(o.licenses.revocationStatusSigned)),
    ).toBeInTheDocument();
  });

  it('reports the revocation artifact import with revocation wording, not license wording', async () => {
    // A revocation is a different act from a license import. Sharing the
    // license sentence here would tell the operator a license was registered
    // when what was archived is a revocation of it (OD-LIC-17).
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'licenses.view',
        'licenses.issue.perpetual',
        'licenses.download',
      ],
    });
    vi.mocked(lic.issuances).mockResolvedValue({
      items: [
        {
          ...prepared,
          status: 'SIGNED_RECORDED',
          signedAt: '2026-10-20T10:05:00.000Z',
          importedAt: '2026-10-20T10:06:00.000Z',
          artifactSha256: 'c'.repeat(64),
          artifactAvailable: true,
          signedArtifactProduced: true,
        },
      ],
      page: 1,
      pageSize: 50,
    });
    vi.mocked(lic.prepareRevocation).mockResolvedValue({
      revocation: {
        revocationId: '01K7REVOCATIONAAAAAAAAAAAA',
        issuanceId: prepared.id,
        licenseId: '01K7LICENSE0000000000000AA',
        targetOperationId: prepared.operationId,
        customerId: customer.id,
        customerCode: customer.customerCode,
        installationId: identityRow.installationId,
        reason: 'NON_PAYMENT',
        reasonDetail: null,
        effect: 'LICENSE_ONLY',
        protocolVersion: 'VREV1',
        signingKeyId: key.id,
        status: 'REQUEST_PREPARED',
        issuedAt: '2026-10-21T09:00:00.000Z',
        requestedAt: '2026-10-21T09:00:00.000Z',
        requestPayloadSha256: 'd'.repeat(64),
        requestBindingSha256: 'e'.repeat(64),
        artifactSha256: null,
        artifactAvailable: false,
        signedArtifactProduced: false,
        reactivationPermitted: false,
      },
      requestPayloadSha256: 'd'.repeat(64),
      requestBindingSha256: 'e'.repeat(64),
      requestFileName: 'revocation-request.json',
      unsignedRequest: true,
      signedArtifactProduced: false,
    });
    vi.mocked(lic.importRevocationArtifact).mockResolvedValue({
      revocation: {
        revocationId: '01K7REVOCATIONAAAAAAAAAAAA',
      },
      replayed: false,
    } as never);

    mount();
    await screen.findByText(o.licenses.revokeTitle);
    await userEvent.click(
      screen.getByText(o.licenses.revokeTitle, { selector: 'summary' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.revokePrepare }),
    );

    // The prepared revocation panel explains the offline step and offers the
    // import control labelled as a revocation artifact.
    // Twice on purpose: the section confirms the transition and the prepared
    // panel is titled by it.
    expect(
      await screen.findAllByText(o.licenses.revocationPrepared),
    ).toHaveLength(2);
    expect(screen.getByText(o.licenses.revokeImportHint)).toBeInTheDocument();
    const input = screen.getByLabelText(o.licenses.revocationImportLabel);
    fireEvent.change(input, {
      target: {
        files: [
          new File(['{"format":"vardena-revocation"}'], 'revocation.json', {
            type: 'application/json',
          }),
        ],
      },
    });

    expect(
      await screen.findByText(o.licenses.revocationImportSuccess),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(o.licenses.importSuccess),
    ).not.toBeInTheDocument();
  });

  it('offers the revocation round trip (request download and signed import) to an Owner Admin', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'licenses.view',
        'licenses.issue.perpetual',
        'licenses.download',
      ],
    });
    vi.mocked(lic.issuances).mockResolvedValue({
      items: [
        {
          ...prepared,
          status: 'SIGNED_RECORDED',
          signedAt: '2026-10-20T10:05:00.000Z',
          importedAt: '2026-10-20T10:06:00.000Z',
          artifactSha256: 'c'.repeat(64),
          artifactAvailable: true,
          signedArtifactProduced: true,
        },
      ],
      page: 1,
      pageSize: 50,
    });
    mount();
    await screen.findByText(o.licenses.revokeTitle);
    await userEvent.click(
      screen.getByText(o.licenses.revokeTitle, { selector: 'summary' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: o.licenses.revokePrepare }),
    );
    expect(lic.prepareRevocation).toHaveBeenCalledWith(prepared.id, {
      reason: 'NON_PAYMENT',
      reasonDetail: null,
      signingKeyId: key.id,
    });
  });
});
