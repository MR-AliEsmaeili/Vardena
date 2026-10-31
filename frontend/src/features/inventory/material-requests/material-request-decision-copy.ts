import { t } from '@/lib/i18n';
import type {
  MaterialRequestDecisionAction,
  MaterialRequestDecisionBlockedReason,
} from './material-request-decisions';

/**
 * Every localized string a decision command needs, in ONE table, so the page
 * renders copy from data instead of five near-identical JSX branches.
 *
 * `reason` is the contract of the endpoint itself: `reject` and
 * `return-for-correction` REQUIRE it, `reverse-approval` and `cancel` accept an
 * omitted one, and `approve` has no body at all.
 */
export type DecisionReasonMode = 'none' | 'required' | 'optional';

export interface DecisionActionCopy {
  label: string;
  confirmTitle: string;
  confirmBody: string;
  /** Consequence lines rendered above the record facts, one per paragraph. */
  warnings?: readonly string[];
  loadingLabel: string;
  successMessage: string;
  reasonMode: DecisionReasonMode;
  danger: boolean;
}

export const DECISION_ACTION_COPY: Record<
  MaterialRequestDecisionAction,
  DecisionActionCopy
> = {
  approve: {
    label: t.materialRequests.actions.approve,
    confirmTitle: t.materialRequests.actions.approveConfirmTitle,
    confirmBody: t.materialRequests.actions.approveConfirmBody,
    warnings: [t.materialRequests.actions.reserveWarning],
    loadingLabel: t.materialRequests.actions.approving,
    successMessage: t.materialRequests.actions.approved,
    reasonMode: 'none',
    danger: false,
  },
  reject: {
    label: t.materialRequests.actions.reject,
    confirmTitle: t.materialRequests.actions.rejectConfirmTitle,
    confirmBody: t.materialRequests.actions.rejectConfirmBody,
    loadingLabel: t.materialRequests.actions.rejecting,
    successMessage: t.materialRequests.actions.rejected,
    reasonMode: 'required',
    danger: true,
  },
  returnForCorrection: {
    label: t.materialRequests.actions.returnForCorrection,
    confirmTitle: t.materialRequests.actions.returnConfirmTitle,
    confirmBody: t.materialRequests.actions.returnConfirmBody,
    loadingLabel: t.materialRequests.actions.returning,
    successMessage: t.materialRequests.actions.returned,
    reasonMode: 'required',
    danger: false,
  },
  reverseApproval: {
    label: t.materialRequests.actions.reverseApproval,
    confirmTitle: t.materialRequests.actions.reverseConfirmTitle,
    confirmBody: t.materialRequests.actions.reverseConfirmBody,
    warnings: [t.materialRequests.actions.reverseWarning],
    loadingLabel: t.materialRequests.actions.reversingApproval,
    successMessage: t.materialRequests.actions.approvalReversed,
    reasonMode: 'optional',
    danger: false,
  },
  cancel: {
    label: t.materialRequests.actions.cancel,
    confirmTitle: t.materialRequests.actions.cancelConfirmTitle,
    confirmBody: t.materialRequests.actions.cancelConfirmBody,
    warnings: [
      t.materialRequests.actions.cancelWarning,
      t.materialRequests.actions.cancelledIrreversible,
    ],
    loadingLabel: t.materialRequests.actions.cancelling,
    successMessage: t.materialRequests.actions.cancelled,
    reasonMode: 'optional',
    danger: true,
  },
};

/** Why a visible action is disabled, as the sentence the user reads. */
export const DECISION_BLOCKED_COPY: Record<
  MaterialRequestDecisionBlockedReason,
  string
> = {
  linesInvoked: t.materialRequests.actions.disabledLinesInvoked,
  notOriginalApprover: t.materialRequests.actions.disabledNotOriginalApprover,
};
