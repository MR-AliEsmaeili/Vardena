import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClientDevice,
  ClientDeviceInventory,
  DeviceEnrollmentChallenge,
  DeviceReplacement,
  DeviceReplacementChallenge,
  DeviceReplacementRequestExport,
} from '@/api/contracts';
import { ClientDevicesPage } from './client-devices-page';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

vi.mock('@/api/identity.api', () => ({
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  grantMembership: vi.fn(),
}));

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
  importLicenseDocument: vi.fn(),
  getClientDeviceInventory: vi.fn(),
  getClientDeviceHistory: vi.fn(),
  createDeviceEnrollmentChallenge: vi.fn(),
  activateDeviceEnrollment: vi.fn(),
  deactivateClientDevice: vi.fn(),
  createDeviceReplacementChallenge: vi.fn(),
  proveDeviceReplacement: vi.fn(),
  exportDeviceReplacementRequest: vi.fn(),
  importDeviceReplacementResponse: vi.fn(),
  cancelDeviceReplacement: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const licensingApi = await import('@/api/licensing.api');

const device: ClientDevice = {
  id: '01K7DEVICEAAAAAAAAAAAAAAAA',
  keyFingerprint: 'a'.repeat(64),
  status: 'ACTIVE',
  activatedAt: '2026-10-14T10:00:00.000Z',
  deactivatedAt: null,
  deactivatedBy: null,
  replacedAt: null,
  replacedByDeviceId: null,
  replacementRequestId: null,
};

const pendingReplacement: DeviceReplacement = {
  id: '01K7REPLACEMENTAAAAAAAAAAA',
  oldDeviceId: device.id,
  newDeviceId: '01K7NEWDEVICEAAAAAAAAAAAAA',
  keyFingerprint: 'b'.repeat(64),
  state: 'PENDING',
  requestHash: 'c'.repeat(64),
  createdAt: '2026-10-14T10:01:00.000Z',
  challengeExpiresAt: '2026-10-14T10:16:00.000Z',
  requestExpiresAt: '2026-11-13T10:01:00.000Z',
  completedAt: null,
  cancelledAt: null,
  expiredAt: null,
};

const inventory: ClientDeviceInventory = {
  installationId: '01K7INSTALLATIONAAAAAAAAAA',
  licenseActive: true,
  deviceLimitSpecified: true,
  deviceLimit: 2,
  activeDeviceCount: 1,
  availableDeviceSlots: 1,
  devices: [device],
  replacements: [],
};

const enrollmentChallenge: DeviceEnrollmentChallenge = {
  challengeId: '01K7CHALLENGEAAAAAAAAAAAAA',
  operationId: '01K7ENROLLMENTOPAAAAAAAAAA',
  deviceId: '01K7DEVICE2AAAAAAAAAAAAAAA',
  keyFingerprint: 'd'.repeat(64),
  expiresAt: '2026-10-14T10:15:00.000Z',
  canonicalPayload: '{"format":"VDEA1","challengeId":"01K7CHALLENGE"}',
};

const replacementChallenge: DeviceReplacementChallenge = {
  requestId: pendingReplacement.id,
  challengeId: '01K7REPLACEMENTCHALAAAAAAA',
  operationId: '01K7REPLACEMENTOPAAAAAAAA',
  oldDeviceId: device.id,
  newDeviceId: pendingReplacement.newDeviceId,
  keyFingerprint: pendingReplacement.keyFingerprint,
  challengeExpiresAt: pendingReplacement.challengeExpiresAt,
  requestExpiresAt: pendingReplacement.requestExpiresAt,
  canonicalPayload: '{"format":"VDRQ1","requestId":"01K7REPLACEMENT"}',
};

const requestExport: DeviceReplacementRequestExport = {
  requestId: pendingReplacement.id,
  requestHash: pendingReplacement.requestHash!,
  text: 'VDRQ1.eyJyZXF1ZXN0IjoxfQ.c2lnbmF0dXJl',
  file: '{"format":"vardena-device-replacement-request","fileVersion":1}',
  expiresAt: pendingReplacement.requestExpiresAt,
};

const devicePermissions = [
  PERMISSIONS.licensing.deviceView,
  PERMISSIONS.licensing.deviceActivate,
  PERMISSIONS.licensing.deviceDeactivate,
  PERMISSIONS.licensing.deviceReplace,
  PERMISSIONS.licensing.deviceCancelReplacement,
  PERMISSIONS.licensing.deviceCompleteReplacement,
];

function renderPage() {
  return renderWithProviders(<ClientDevicesPage />);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: devicePermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(licensingApi.getClientDeviceInventory).mockResolvedValue(inventory);
  vi.mocked(licensingApi.getClientDeviceHistory).mockResolvedValue({
    device,
    events: [],
  });
  vi.mocked(licensingApi.createDeviceEnrollmentChallenge).mockResolvedValue(
    enrollmentChallenge,
  );
  vi.mocked(licensingApi.activateDeviceEnrollment).mockResolvedValue(device);
  vi.mocked(licensingApi.deactivateClientDevice).mockResolvedValue({
    ...device,
    status: 'DEACTIVATED',
    deactivatedAt: '2026-10-14T11:00:00.000Z',
  });
  vi.mocked(licensingApi.createDeviceReplacementChallenge).mockResolvedValue(
    replacementChallenge,
  );
  vi.mocked(licensingApi.proveDeviceReplacement).mockResolvedValue(
    requestExport,
  );
  vi.mocked(licensingApi.exportDeviceReplacementRequest).mockResolvedValue(
    requestExport,
  );
  vi.mocked(licensingApi.importDeviceReplacementResponse).mockResolvedValue({
    oldDevice: { ...device, status: 'REPLACED' },
    newDevice: {
      ...device,
      id: pendingReplacement.newDeviceId,
      status: 'ACTIVE',
      keyFingerprint: pendingReplacement.keyFingerprint,
    },
    replacement: { ...pendingReplacement, state: 'COMPLETED' },
  });
  vi.mocked(licensingApi.cancelDeviceReplacement).mockResolvedValue({
    replacement: { ...pendingReplacement, state: 'CANCELLED' },
  });
});

describe('Persian client-device administrator surface', () => {
  it('renders the server-authoritative signed quota and retained inventory', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: t.deviceLicensing.title }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        t.deviceLicensing.quotaFinite
          .replace('{active}', '1')
          .replace('{limit}', '2'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(device.id)).toBeInTheDocument();
    expect(screen.getByText(device.keyFingerprint)).toBeInTheDocument();
    expect(screen.queryByLabelText(/کلید خصوصی/)).not.toBeInTheDocument();
    expect(licensingApi.getClientDeviceInventory).toHaveBeenCalled();
  });

  it('creates an enrollment challenge, submits the detached proof, and clears the one-use UI state', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: t.deviceLicensing.enroll }),
    );
    await user.type(
      screen.getByLabelText(t.deviceLicensing.publicKey),
      'MCowBQYDK2VwAyE' + 'a'.repeat(32),
    );
    await user.click(
      screen.getByRole('button', { name: t.deviceLicensing.createChallenge }),
    );

    expect(
      await screen.findByLabelText(t.deviceLicensing.challenge),
    ).toHaveValue(enrollmentChallenge.canonicalPayload);
    expect(licensingApi.createDeviceEnrollmentChallenge).toHaveBeenCalledWith({
      publicKey: 'MCowBQYDK2VwAyE' + 'a'.repeat(32),
    });

    await user.type(
      screen.getByLabelText(t.deviceLicensing.signature),
      'c2lnbmF0dXJl',
    );
    await user.click(
      screen.getByRole('button', { name: t.deviceLicensing.activate }),
    );

    await waitFor(() =>
      expect(licensingApi.activateDeviceEnrollment).toHaveBeenCalledWith(
        enrollmentChallenge.challengeId,
        { signature: 'c2lnbmF0dXJl' },
      ),
    );
    expect(
      await screen.findByText(t.deviceLicensing.enrollmentSuccess),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(t.deviceLicensing.challenge),
    ).not.toBeInTheDocument();
  });

  it('walks through the offline replacement exchange and imports only the authority response document', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: t.deviceLicensing.replace }),
    );
    await user.type(
      screen.getByLabelText(t.deviceLicensing.publicKey),
      'MCowBQYDK2VwAyE' + 'b'.repeat(32),
    );
    await user.click(
      screen.getByRole('button', {
        name: t.deviceLicensing.createReplacementChallenge,
      }),
    );

    expect(
      await screen.findByLabelText(t.deviceLicensing.replacementChallenge),
    ).toHaveValue(replacementChallenge.canonicalPayload);
    await user.type(
      screen.getByLabelText(t.deviceLicensing.signature),
      'c2lnbmF0dXJl',
    );
    await user.click(
      screen.getByRole('button', { name: t.deviceLicensing.proveReplacement }),
    );

    expect(
      await screen.findByLabelText(t.deviceLicensing.replacementText),
    ).toHaveValue(requestExport.text);
    expect(licensingApi.proveDeviceReplacement).toHaveBeenCalledWith(
      replacementChallenge.requestId,
      { signature: 'c2lnbmF0dXJl' },
    );

    const response = 'VDRP1.eyJmb3JtYXQiOiJWRFJQMSJ9.c2lnbmF0dXJl';
    await user.type(
      screen.getByLabelText(t.deviceLicensing.responseDocument),
      response,
    );
    await user.click(
      screen.getByRole('button', {
        name: t.deviceLicensing.importResponseSubmit,
      }),
    );

    await waitFor(() =>
      expect(licensingApi.importDeviceReplacementResponse).toHaveBeenCalledWith(
        {
          document: response,
        },
      ),
    );
    expect(
      await screen.findByText(t.deviceLicensing.importResponseSuccess),
    ).toBeInTheDocument();
  });

  it('requires confirmation before deactivation and retains the device after success', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: t.deviceLicensing.deactivate }),
    );
    const dialog = screen.getByRole('dialog', {
      name: t.deviceLicensing.deactivateTitle,
    });
    expect(
      within(dialog).getByText(t.deviceLicensing.deactivateDescription),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', {
        name: t.deviceLicensing.confirmDeactivate,
      }),
    );

    await waitFor(() =>
      expect(licensingApi.deactivateClientDevice).toHaveBeenCalledWith(
        device.id,
      ),
    );
    expect(
      await screen.findByText(t.deviceLicensing.deactivateSuccess),
    ).toBeInTheDocument();
  });

  it('makes cancellation explicit and terminal for a pending offline request', async () => {
    const user = userEvent.setup();
    vi.mocked(licensingApi.getClientDeviceInventory).mockResolvedValue({
      ...inventory,
      replacements: [pendingReplacement],
    });
    renderPage();

    const row = await screen.findByRole('row', {
      name: new RegExp(pendingReplacement.id),
    });
    expect(
      within(row).getByText(pendingReplacement.oldDeviceId),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(pendingReplacement.newDeviceId),
    ).toBeInTheDocument();
    await user.click(
      within(row).getByRole('button', {
        name: t.deviceLicensing.cancelReplacement,
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: t.deviceLicensing.cancelReplacementTitle,
    });
    expect(
      within(dialog).getByText(t.deviceLicensing.cancelReplacementDescription),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', {
        name: t.deviceLicensing.confirmCancelReplacement,
      }),
    );

    await waitFor(() =>
      expect(licensingApi.cancelDeviceReplacement).toHaveBeenCalledWith(
        pendingReplacement.id,
      ),
    );
    expect(
      await screen.findByText(t.deviceLicensing.cancelReplacementSuccess),
    ).toBeInTheDocument();
  });

  it('does not offer writes when the session only has the inventory permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [PERMISSIONS.licensing.deviceView],
    });
    renderPage();

    await screen.findByRole('heading', { name: t.deviceLicensing.title });
    expect(
      screen.queryByRole('button', { name: t.deviceLicensing.enroll }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.deviceLicensing.deactivate }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.deviceLicensing.replace }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.deviceLicensing.importResponse }),
    ).not.toBeInTheDocument();
  });
});
