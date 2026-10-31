import type {
  MaterialRequestDetail,
  MaterialRequestStatus,
} from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

/**
 * The approval cycle of a Material Request (INV-07), expressed as ONE pure
 * function so the page never scatters status/permission/approver conditions
 * through JSX.
 *
 * Every rule below is copied from the backend, which stays authoritative:
 *
 * - `planDecision` (`domain/material-request.ts`) accepts ONLY `submitted`, so
 *   approve / reject / return-for-correction exist on `submitted` and nowhere
 *   else — a status that is not `submitted` renders NO decision action at all
 *   (not even a disabled one).
 * - `planReversal` accepts ONLY `approved`, so reverse-approval and cancel
 *   exist on `approved` and nowhere else. Cancelling a draft is `DELETE`
 *   (INV-06), not this command, and cancellation never returns to `submitted`.
 * - Both reversal commands are refused once ANY line has been invoked, even
 *   partially (`MaterialRequestLinesInvokedError`) — the row stays visible and
 *   is disabled with the reason, because the user must know why.
 * - Reversal additionally requires being the ORIGINAL approver
 *   (`approvedBy === currentUser`). That is a DOMAIN rule, not an RBAC code:
 *   holding `Inventory.MaterialRequest.ReverseApproval` is necessary but not
 *   sufficient, so the control stays visible-but-disabled for anybody else.
 * - Cancellation carries NO original-approver restriction on the backend.
 *
 * The UI gate is UX only (AR-21); the server re-checks all of it.
 */

export const MATERIAL_REQUEST_DECISION_ACTIONS = [
  'approve',
  'reject',
  'returnForCorrection',
  'reverseApproval',
  'cancel',
] as const;

export type MaterialRequestDecisionAction =
  (typeof MATERIAL_REQUEST_DECISION_ACTIONS)[number];

/** Why a visible action is disabled — mapped to i18n by the component. */
export type MaterialRequestDecisionBlockedReason =
  'linesInvoked' | 'notOriginalApprover';

export interface MaterialRequestActionAvailability {
  /** Held permission AND a status in which the backend allows the action. */
  visible: boolean;
  /** Visible AND no domain rule blocks it right now. */
  enabled: boolean;
  /** Present exactly when `visible && !enabled`. */
  blockedReason?: MaterialRequestDecisionBlockedReason;
}

export type MaterialRequestActionMatrix = Record<
  MaterialRequestDecisionAction,
  MaterialRequestActionAvailability
>;

const ACTION_PERMISSION: Record<MaterialRequestDecisionAction, string> = {
  approve: PERMISSIONS.inventory.materialRequestApprove,
  reject: PERMISSIONS.inventory.materialRequestReject,
  returnForCorrection: PERMISSIONS.inventory.materialRequestReturnForCorrection,
  reverseApproval: PERMISSIONS.inventory.materialRequestReverseApproval,
  cancel: PERMISSIONS.inventory.materialRequestCancel,
};

const DECISION_STATUS: MaterialRequestStatus = 'submitted';
const REVERSAL_STATUS: MaterialRequestStatus = 'approved';

const HIDDEN: MaterialRequestActionAvailability = {
  visible: false,
  enabled: false,
};

/** True when at least one line has been carried into a downstream process. */
export function hasInvokedMaterialRequestLine(
  request: Pick<MaterialRequestDetail, 'lines'>,
): boolean {
  return request.lines.some((line) => line.invocationCount > 0);
}

export function availableMaterialRequestActions(input: {
  status: MaterialRequestStatus;
  approvedBy: string | null;
  currentUserId: string | null;
  hasInvokedLine: boolean;
  permissions: ReadonlySet<string>;
}): MaterialRequestActionMatrix {
  const isSubmitted = input.status === DECISION_STATUS;
  const isApproved = input.status === REVERSAL_STATUS;

  function statusAllows(action: MaterialRequestDecisionAction): boolean {
    switch (action) {
      case 'approve':
      case 'reject':
      case 'returnForCorrection':
        return isSubmitted;
      case 'reverseApproval':
      case 'cancel':
        return isApproved;
    }
  }

  function availability(
    action: MaterialRequestDecisionAction,
    blockedReason: MaterialRequestDecisionBlockedReason | null,
  ): MaterialRequestActionAvailability {
    if (
      !input.permissions.has(ACTION_PERMISSION[action]) ||
      !statusAllows(action)
    ) {
      return HIDDEN;
    }
    return blockedReason === null
      ? { visible: true, enabled: true }
      : { visible: true, enabled: false, blockedReason };
  }

  const invokedBlock: MaterialRequestDecisionBlockedReason | null =
    input.hasInvokedLine ? 'linesInvoked' : null;
  const originalApprover =
    input.currentUserId !== null && input.approvedBy === input.currentUserId;

  return {
    approve: availability('approve', null),
    reject: availability('reject', null),
    returnForCorrection: availability('returnForCorrection', null),
    reverseApproval: availability(
      'reverseApproval',
      invokedBlock ?? (originalApprover ? null : 'notOriginalApprover'),
    ),
    cancel: availability('cancel', invokedBlock),
  };
}

/** Convenience for the page: render the action area only when it is non-empty. */
export function hasVisibleMaterialRequestAction(
  matrix: MaterialRequestActionMatrix,
): boolean {
  return MATERIAL_REQUEST_DECISION_ACTIONS.some(
    (action) => matrix[action].visible,
  );
}

/** Backend `MAX_REASON_LENGTH` of `material-request.ts` (reasons AND description). */
export const MATERIAL_REQUEST_REASON_MAX_LENGTH = 1000;

export type MaterialRequestReasonProblem = 'required' | 'tooLong';

/**
 * One reason field, two contracts: `reject`/`return-for-correction` require a
 * non-blank reason (`normalizeRequiredReason`), while `reverse-approval`/
 * `cancel` accept an omitted one (`normalizeDescription`, which trims blanks
 * to `null`). Both refuse more than 1000 characters.
 */
export function materialRequestReasonProblem(
  reason: string,
  required: boolean,
): MaterialRequestReasonProblem | null {
  const trimmed = reason.trim();
  if (trimmed.length > MATERIAL_REQUEST_REASON_MAX_LENGTH) return 'tooLong';
  if (required && trimmed.length === 0) return 'required';
  return null;
}

/** What the endpoint's body gets: a trimmed string, or nothing at all. */
export function normalizeMaterialRequestReason(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed === '' ? null : trimmed;
}
