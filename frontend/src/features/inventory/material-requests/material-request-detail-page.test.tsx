import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MaterialRequestDetailPage } from './material-request-detail-page';
import {
  materialRequestDetail,
  materialRequestEvent,
  materialRequestItem,
  materialRequestLine,
  materialRequestUnit,
  materialRequestWarehouse,
} from './material-request-test-fixtures';

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
vi.mock('@/api/inventory.api', () => ({
  INVENTORY_MAX_PAGE_SIZE: 500,
  listInventoryWarehouses: vi.fn(),
  listInventoryItems: vi.fn(),
  listInventoryUnits: vi.fn(),
  listMaterialRequests: vi.fn(),
  getMaterialRequest: vi.fn(),
  listMaterialRequestEvents: vi.fn(),
  createMaterialRequest: vi.fn(),
  updateMaterialRequest: vi.fn(),
  deleteMaterialRequest: vi.fn(),
  submitMaterialRequest: vi.fn(),
  approveMaterialRequest: vi.fn(),
  rejectMaterialRequest: vi.fn(),
  returnMaterialRequestForCorrection: vi.fn(),
  reverseMaterialRequestApproval: vi.fn(),
  cancelMaterialRequest: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const viewPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.materialRequestView,
];

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/material-requests"
        element={<div>list</div>}
      />
      <Route
        path="/app/inventory/material-requests/:requestId"
        element={<MaterialRequestDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/inventory/material-requests/request-1'] },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: viewPermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue({
    items: [materialRequestWarehouse],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue({
    items: [materialRequestItem],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue({
    items: [materialRequestUnit],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
    materialRequestDetail(),
  );
  vi.mocked(inventoryApi.listMaterialRequestEvents).mockResolvedValue([
    materialRequestEvent(),
  ]);
});

describe('material request detail', () => {
  it('renders status, lines and the ordered event narrative', async () => {
    renderDetail();

    expect(
      await screen.findByTestId('material-request-detail-page'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(t.materialRequests.statuses.draft).length,
    ).toBeGreaterThan(0);
    const linesTable = screen.getByTestId('material-request-lines-table');
    expect(
      within(linesTable).getByText('KAL-01 — کالای نمونه'),
    ).toBeInTheDocument();
    expect(within(linesTable).getByText('WH-01 — انبار مرکزی')).toBeVisible();
    expect(
      within(linesTable).getByText(t.materialRequests.reservationYes),
    ).toBeInTheDocument();

    const events = await screen.findByTestId('material-request-events');
    expect(
      within(events).getByText(t.materialRequests.eventTypes.created),
    ).toBeInTheDocument();
    expect(inventoryApi.listMaterialRequestEvents).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      expect.anything(),
    );
  });

  it('offers submit only with the permission and only for a draft/returned request', async () => {
    const first = renderDetail();
    await screen.findByTestId('material-request-detail-page');
    expect(
      screen.queryByTestId('material-request-submit'),
    ).not.toBeInTheDocument();
    first.unmount();

    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
      ],
    });
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'returned' }),
    );
    renderDetail();

    expect(
      await screen.findByTestId('material-request-submit'),
    ).toBeInTheDocument();
  });

  it('submits only after confirmation and shows the allocated number', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
      ],
    });
    vi.mocked(inventoryApi.submitMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0009' }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-submit'));
    expect(
      screen.getByText(t.materialRequests.submitConfirmTitle),
    ).toBeInTheDocument();
    expect(inventoryApi.submitMaterialRequest).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: t.materialRequests.submit }),
    );
    await waitFor(() =>
      expect(inventoryApi.submitMaterialRequest).toHaveBeenCalledWith(
        'org-1',
        'request-1',
      ),
    );
    expect(
      await screen.findByText(
        t.materialRequests.submittedNumber.replace('{number}', 'MR-1404-0009'),
      ),
    ).toBeInTheDocument();
  });

  it('offers delete only for a draft and only with the delete permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestDelete,
      ],
    });
    const first = renderDetail();
    expect(
      await screen.findByTestId('material-request-delete'),
    ).toBeInTheDocument();
    first.unmount();

    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0012' }),
    );
    renderDetail();
    expect(
      await screen.findByTestId('material-request-readonly-banner'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('material-request-delete'),
    ).not.toBeInTheDocument();
  });

  it('renders no decision command without its permission and NEVER the blocked line invocation', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
        PERMISSIONS.inventory.materialRequestDelete,
        PERMISSIONS.inventory.materialRequestEdit,
      ],
    });
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0010' }),
    );
    renderDetail();

    await screen.findByTestId('material-request-detail-page');
    // `submitted` DOES allow approve/reject/return-for-correction in the
    // backend, but this session holds none of those codes, so nothing renders.
    for (const testId of [
      'material-request-approve',
      'material-request-reject',
      'material-request-returnForCorrection',
      'material-request-reverseApproval',
      'material-request-cancel',
      // `PUT …/lines/invoke` is BLOCKED (`task/OUT-OF-SCOPE.md`): no code, no
      // command, in any status or permission set.
      'material-request-invoke',
    ]) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });

  it('renders an invoked line with its consumed and remaining base quantity', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({
        status: 'approved',
        number: 'MR-1404-0011',
        lines: [
          materialRequestLine({
            invocationCount: 1,
            invokedBaseQuantity: '2.0000',
            remainingBaseQuantity: '3.0000',
          }),
        ],
      }),
    );
    renderDetail();

    const linesTable = await screen.findByTestId(
      'material-request-lines-table',
    );
    expect(within(linesTable).getByText('2.0000')).toBeInTheDocument();
    expect(within(linesTable).getByText('3.0000')).toBeInTheDocument();
  });
});

/**
 * INV-07 — the approval cycle.
 *
 * The availability matrix itself is unit-tested in
 * `material-request-decisions.test.ts`; these tests prove the PAGE renders and
 * dispatches exactly what the matrix allows, and that the server's own message
 * is what the user sees when a decision is refused.
 */
describe('material request approval cycle', () => {
  const decisionPermissions = [
    PERMISSIONS.inventory.materialRequestApprove,
    PERMISSIONS.inventory.materialRequestReject,
    PERMISSIONS.inventory.materialRequestReturnForCorrection,
    PERMISSIONS.inventory.materialRequestReverseApproval,
    PERMISSIONS.inventory.materialRequestCancel,
  ];

  function grant(permissions: readonly string[]): void {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [...viewPermissions, ...permissions],
    });
  }

  function approvedRequest(
    overrides: Parameters<typeof materialRequestDetail>[0] = {},
  ) {
    return materialRequestDetail({
      status: 'approved',
      number: 'MR-1404-0020',
      approvedAt: '2026-10-29T09:00:00.000Z',
      approvedBy: testUser.id,
      ...overrides,
    });
  }

  it('shows exactly the three review outcomes on a submitted request', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    renderDetail();

    expect(await screen.findByTestId('material-request-approve')).toBeEnabled();
    expect(screen.getByTestId('material-request-reject')).toBeEnabled();
    expect(
      screen.getByTestId('material-request-returnForCorrection'),
    ).toBeEnabled();
    expect(
      screen.queryByTestId('material-request-reverseApproval'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('material-request-cancel'),
    ).not.toBeInTheDocument();
  });

  it('approves with NO request body and reports the server result', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    vi.mocked(inventoryApi.approveMaterialRequest).mockResolvedValue(
      approvedRequest(),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-approve'));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(t.materialRequests.actions.reserveWarning),
    ).toBeInTheDocument();
    // `POST …/approve` declares no body: the dialog must not offer a reason.
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(inventoryApi.approveMaterialRequest).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', {
        name: t.materialRequests.actions.approve,
      }),
    );
    await waitFor(() =>
      expect(inventoryApi.approveMaterialRequest).toHaveBeenCalledTimes(1),
    );
    // Exactly (organizationId, requestId) — no third "body" argument.
    expect(
      vi.mocked(inventoryApi.approveMaterialRequest).mock.calls[0],
    ).toHaveLength(2);
    expect(inventoryApi.approveMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
    );
    expect(
      await screen.findByText(t.materialRequests.actions.approved),
    ).toBeInTheDocument();
  });

  it('refuses to reject without a reason and sends the trimmed reason', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    vi.mocked(inventoryApi.rejectMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'rejected', number: 'MR-1404-0019' }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-reject'));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: t.materialRequests.actions.reject,
    });
    expect(confirm).toBeDisabled();
    expect(inventoryApi.rejectMaterialRequest).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByRole('textbox'),
      '  مقدار اشتباه وارد شده است  ',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(inventoryApi.rejectMaterialRequest).toHaveBeenCalledWith(
        'org-1',
        'request-1',
        { reason: 'مقدار اشتباه وارد شده است' },
      ),
    );
    expect(
      await screen.findByText(t.materialRequests.actions.rejected),
    ).toBeInTheDocument();
  });

  it('requires a reason to return a request for correction', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    vi.mocked(
      inventoryApi.returnMaterialRequestForCorrection,
    ).mockResolvedValue(materialRequestDetail({ status: 'returned' }));
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByTestId('material-request-returnForCorrection'),
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: t.materialRequests.actions.returnForCorrection,
    });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox'), 'ردیف دوم اصلاح شود');
    await user.click(confirm);

    await waitFor(() =>
      expect(
        inventoryApi.returnMaterialRequestForCorrection,
      ).toHaveBeenCalledWith('org-1', 'request-1', {
        reason: 'ردیف دوم اصلاح شود',
      }),
    );
  });

  it('reverses an approval with an OPTIONAL reason (null when left empty)', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest(),
    );
    vi.mocked(inventoryApi.reverseMaterialRequestApproval).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0020' }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByTestId('material-request-reverseApproval'),
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: t.materialRequests.actions.reverseApproval,
    });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(inventoryApi.reverseMaterialRequestApproval).toHaveBeenCalledWith(
        'org-1',
        'request-1',
        { reason: null },
      ),
    );
    expect(
      await screen.findByText(t.materialRequests.actions.approvalReversed),
    ).toBeInTheDocument();
  });

  it('offers cancellation only on an approved request', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    const first = renderDetail();
    await screen.findByTestId('material-request-detail-page');
    expect(
      screen.queryByTestId('material-request-cancel'),
    ).not.toBeInTheDocument();
    first.unmount();

    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest(),
    );
    vi.mocked(inventoryApi.cancelMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'cancelled', number: 'MR-1404-0020' }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-cancel'));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(t.materialRequests.actions.cancelWarning),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', {
        name: t.materialRequests.actions.cancel,
      }),
    );

    await waitFor(() =>
      expect(inventoryApi.cancelMaterialRequest).toHaveBeenCalledWith(
        'org-1',
        'request-1',
        { reason: null },
      ),
    );
    expect(
      await screen.findByText(t.materialRequests.actions.cancelled),
    ).toBeInTheDocument();
  });

  it('disables reversal and cancellation with a reason once a line was invoked', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest({
        lines: [materialRequestLine({ invocationCount: 1 })],
      }),
    );
    renderDetail();

    const reverse = await screen.findByTestId(
      'material-request-reverseApproval',
    );
    const cancel = screen.getByTestId('material-request-cancel');
    expect(reverse).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(reverse).toHaveAttribute(
      'title',
      t.materialRequests.actions.disabledLinesInvoked,
    );
    expect(cancel).toHaveAttribute(
      'title',
      t.materialRequests.actions.disabledLinesInvoked,
    );
  });

  it('keeps reversal visible-but-disabled for anyone but the original approver', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest({ approvedBy: 'usr-someone-else' }),
    );
    renderDetail();

    const reverse = await screen.findByTestId(
      'material-request-reverseApproval',
    );
    expect(reverse).toBeDisabled();
    expect(reverse).toHaveAttribute(
      'title',
      t.materialRequests.actions.disabledNotOriginalApprover,
    );
    // Cancellation has no approver restriction: it stays actionable.
    expect(screen.getByTestId('material-request-cancel')).toBeEnabled();
  });

  it('shows the server availability figures verbatim when approval finds too little stock', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0019' }),
    );
    const serverMessage =
      'Insufficient available stock: available 2.0000, requested 5.0000.';
    vi.mocked(inventoryApi.approveMaterialRequest).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: serverMessage,
        status: 422,
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-approve'));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.materialRequests.actions.approve,
      }),
    );

    expect(
      await within(dialog).findByText(
        t.materialRequests.errors.insufficientStock.replace(
          '{details}',
          serverMessage,
        ),
      ),
    ).toBeInTheDocument();
    // The dialog stays open so the user can retry or cancel.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the reversal dialog open with the domain 403 message', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest(),
    );
    vi.mocked(inventoryApi.reverseMaterialRequestApproval).mockRejectedValue(
      new ApiError({
        code: 'PermissionDenied',
        message: 'Only the original approver may reverse this approval.',
        status: 403,
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByTestId('material-request-reverseApproval'),
    );
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.materialRequests.actions.reverseApproval,
      }),
    );

    expect(
      await within(dialog).findByText(
        t.materialRequests.errors.notOriginalApprover,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('translates a projection-drift 409 on cancellation', async () => {
    grant(decisionPermissions);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      approvedRequest(),
    );
    vi.mocked(inventoryApi.cancelMaterialRequest).mockRejectedValue(
      new ApiError({
        code: 'Conflict',
        message:
          'The stored stock balance contradicts this operation. Run reconciliation to diagnose it before retrying.',
        status: 409,
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-cancel'));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.materialRequests.actions.cancel,
      }),
    );

    expect(
      await within(dialog).findByText(t.materialRequests.errors.balanceDrift),
    ).toBeInTheDocument();
  });

  it('renders who decided and why on the record itself', async () => {
    grant([]);
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({
        status: 'rejected',
        number: 'MR-1404-0021',
        rejectedAt: '2026-10-29T09:00:00.000Z',
        rejectedBy: 'usr-reviewer',
        rejectionReason: 'ردیف اول اشتباه است',
      }),
    );
    renderDetail();

    const page = await screen.findByTestId('material-request-detail-page');
    expect(page.textContent).toContain(
      `${t.materialRequests.decisions.rejectedBy}:`,
    );
    expect(screen.getByText('usr-reviewer')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t.materialRequests.decisions.rejectionReason}: ردیف اول اشتباه است`,
      ),
    ).toBeInTheDocument();
  });
});
