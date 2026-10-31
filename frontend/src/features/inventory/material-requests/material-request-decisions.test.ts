import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import type { MaterialRequestStatus } from '@/api/contracts';
import {
  MATERIAL_REQUEST_DECISION_ACTIONS,
  availableMaterialRequestActions,
  hasInvokedMaterialRequestLine,
  hasVisibleMaterialRequestAction,
  materialRequestReasonProblem,
  normalizeMaterialRequestReason,
  type MaterialRequestDecisionAction,
} from './material-request-decisions';

const APPROVER = 'usr-approver';
const OTHER = 'usr-other';

const ALL_DECISION_PERMISSIONS = [
  PERMISSIONS.inventory.materialRequestApprove,
  PERMISSIONS.inventory.materialRequestReject,
  PERMISSIONS.inventory.materialRequestReturnForCorrection,
  PERMISSIONS.inventory.materialRequestReverseApproval,
  PERMISSIONS.inventory.materialRequestCancel,
];

const ALL_STATUSES: readonly MaterialRequestStatus[] = [
  'draft',
  'submitted',
  'returned',
  'approved',
  'rejected',
  'cancelled',
];

function matrix(input: {
  status: MaterialRequestStatus;
  approvedBy?: string | null;
  currentUserId?: string | null;
  hasInvokedLine?: boolean;
  permissions?: readonly string[];
}) {
  return availableMaterialRequestActions({
    status: input.status,
    approvedBy: input.approvedBy ?? null,
    currentUserId:
      input.currentUserId === undefined ? APPROVER : input.currentUserId,
    hasInvokedLine: input.hasInvokedLine ?? false,
    permissions: new Set(input.permissions ?? ALL_DECISION_PERMISSIONS),
  });
}

function visibleActions(status: MaterialRequestStatus): string[] {
  const actions = matrix({ status });
  return MATERIAL_REQUEST_DECISION_ACTIONS.filter(
    (action) => actions[action].visible,
  );
}

function enabledActions(
  status: MaterialRequestStatus,
  overrides: {
    approvedBy?: string | null;
    currentUserId?: string | null;
    hasInvokedLine?: boolean;
  } = {},
): MaterialRequestDecisionAction[] {
  const actions = matrix({ status, ...overrides });
  return MATERIAL_REQUEST_DECISION_ACTIONS.filter(
    (action) => actions[action].enabled,
  );
}

describe('material request decision availability', () => {
  it('offers all three review outcomes on submitted and nothing else', () => {
    expect(visibleActions('submitted')).toEqual([
      'approve',
      'reject',
      'returnForCorrection',
    ]);
  });

  it('offers only reversal and cancellation on approved', () => {
    expect(visibleActions('approved')).toEqual(['reverseApproval', 'cancel']);
  });

  it('offers no decision action on draft, returned, rejected or cancelled', () => {
    for (const status of [
      'draft',
      'returned',
      'rejected',
      'cancelled',
    ] as const) {
      expect(visibleActions(status)).toEqual([]);
      expect(hasVisibleMaterialRequestAction(matrix({ status }))).toBe(false);
    }
  });

  it('covers every status without inventing an action', () => {
    for (const status of ALL_STATUSES) {
      const actions = matrix({ status });
      for (const action of MATERIAL_REQUEST_DECISION_ACTIONS) {
        expect(typeof actions[action].visible).toBe('boolean');
        // A hidden action can never also claim to be enabled.
        expect(actions[action].visible || !actions[action].enabled).toBe(true);
      }
    }
  });

  it('hides an action the session holds no permission for', () => {
    const actions = matrix({
      status: 'submitted',
      permissions: [PERMISSIONS.inventory.materialRequestApprove],
    });
    expect(actions.approve.visible).toBe(true);
    expect(actions.reject.visible).toBe(false);
    expect(actions.returnForCorrection.visible).toBe(false);
    expect(actions.approve.blockedReason).toBeUndefined();
  });

  it('keeps reverse-approval visible but disabled for anybody but the original approver', () => {
    const actions = matrix({
      status: 'approved',
      approvedBy: APPROVER,
      currentUserId: OTHER,
    });
    expect(actions.reverseApproval).toEqual({
      visible: true,
      enabled: false,
      blockedReason: 'notOriginalApprover',
    });
    // Cancellation carries no approver restriction on the backend.
    expect(actions.cancel).toEqual({ visible: true, enabled: true });
  });

  it('disables reversal and cancellation once a line has been invoked', () => {
    const actions = matrix({ status: 'approved', hasInvokedLine: true });
    expect(actions.reverseApproval).toEqual({
      visible: true,
      enabled: false,
      blockedReason: 'linesInvoked',
    });
    expect(actions.cancel).toEqual({
      visible: true,
      enabled: false,
      blockedReason: 'linesInvoked',
    });
  });

  it('prefers the invoked-line reason over the approver reason', () => {
    const actions = matrix({
      status: 'approved',
      approvedBy: APPROVER,
      currentUserId: OTHER,
      hasInvokedLine: true,
    });
    expect(actions.reverseApproval.blockedReason).toBe('linesInvoked');
  });

  it('enables reversal for the original approver with no invoked line', () => {
    expect(
      enabledActions('approved', {
        approvedBy: APPROVER,
        currentUserId: APPROVER,
      }),
    ).toEqual(['reverseApproval', 'cancel']);
  });

  it('treats an unknown current user as "not the approver"', () => {
    const actions = matrix({
      status: 'approved',
      approvedBy: APPROVER,
      currentUserId: null,
    });
    expect(actions.reverseApproval.enabled).toBe(false);
    expect(actions.reverseApproval.blockedReason).toBe('notOriginalApprover');
  });

  it('enables the three review outcomes on submitted without extra gates', () => {
    expect(enabledActions('submitted')).toEqual([
      'approve',
      'reject',
      'returnForCorrection',
    ]);
  });
});

describe('hasInvokedMaterialRequestLine', () => {
  it('is true when any line carries an invocation count', () => {
    expect(
      hasInvokedMaterialRequestLine({
        lines: [{ invocationCount: 0 }, { invocationCount: 2 }] as never,
      }),
    ).toBe(true);
  });

  it('is false when no line was ever invoked', () => {
    expect(
      hasInvokedMaterialRequestLine({
        lines: [{ invocationCount: 0 }] as never,
      }),
    ).toBe(false);
  });
});

describe('material request reason field', () => {
  it('requires a non-blank reason when the endpoint requires one', () => {
    expect(materialRequestReasonProblem('', true)).toBe('required');
    expect(materialRequestReasonProblem('   ', true)).toBe('required');
    expect(materialRequestReasonProblem('  اشتباه در مقدار ', true)).toBeNull();
  });

  it('accepts an omitted reason when the endpoint makes it optional', () => {
    expect(materialRequestReasonProblem('', false)).toBeNull();
    expect(materialRequestReasonProblem('   ', false)).toBeNull();
  });

  it('refuses more than 1000 characters in both modes', () => {
    const tooLong = 'x'.repeat(1001);
    expect(materialRequestReasonProblem(tooLong, true)).toBe('tooLong');
    expect(materialRequestReasonProblem(tooLong, false)).toBe('tooLong');
    expect(materialRequestReasonProblem('x'.repeat(1000), true)).toBeNull();
  });

  it('trims the reason and turns a blank one into null', () => {
    expect(normalizeMaterialRequestReason('  دلیل  ')).toBe('دلیل');
    expect(normalizeMaterialRequestReason('   ')).toBeNull();
  });
});
