import { useState } from 'react';
import type { ReactElement } from 'react';
import { Ban, Check, CornerUpLeft, RotateCcw, X } from 'lucide-react';
import type { MaterialRequestDetail } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { Tooltip } from '@/ui/tooltip';
import {
  DECISION_ACTION_COPY,
  DECISION_BLOCKED_COPY,
} from './material-request-decision-copy';
import {
  DecisionFacts,
  DecisionReasonField,
} from './material-request-decision-dialog-fields';
import {
  availableMaterialRequestActions,
  hasInvokedMaterialRequestLine,
  hasVisibleMaterialRequestAction,
  materialRequestReasonProblem,
  normalizeMaterialRequestReason,
  type MaterialRequestDecisionAction,
} from './material-request-decisions';
import { materialRequestErrorMessage } from './material-request-error-messages';
import {
  useApproveMaterialRequestMutation,
  useCancelMaterialRequestMutation,
  useRejectMaterialRequestMutation,
  useReturnMaterialRequestForCorrectionMutation,
  useReverseMaterialRequestApprovalMutation,
} from './material-request-hooks';

const ACTION_ORDER: readonly MaterialRequestDecisionAction[] = [
  'approve',
  'reject',
  'returnForCorrection',
  'reverseApproval',
  'cancel',
];

const ACTION_ICON: Record<MaterialRequestDecisionAction, typeof Check> = {
  approve: Check,
  reject: X,
  returnForCorrection: CornerUpLeft,
  reverseApproval: RotateCcw,
  cancel: Ban,
};

/**
 * The five decision commands of the approval cycle (INV-07), rendered from the
 * pure availability matrix in `material-request-decisions.ts`.
 *
 * Nothing here decides WHAT is allowed: the matrix mirrors `planDecision` /
 * `planReversal` / the original-approver rule, and the server re-checks every
 * one of them. A command that the current status does not allow is not
 * rendered at all; a command the user may not finish because of a DOMAIN rule
 * (an invoked line, a different original approver) stays visible and disabled
 * WITH the reason, so the user learns why instead of hunting a missing button.
 */
export function MaterialRequestDecisionActions({
  organizationId,
  request,
}: {
  organizationId: string;
  request: MaterialRequestDetail;
}): ReactElement | null {
  const permissions = usePermissions();
  const session = useSession();
  const { showToast } = useToast();
  const approve = useApproveMaterialRequestMutation(organizationId);
  const reject = useRejectMaterialRequestMutation(organizationId);
  const returnForCorrection =
    useReturnMaterialRequestForCorrectionMutation(organizationId);
  const reverseApproval =
    useReverseMaterialRequestApprovalMutation(organizationId);
  const cancel = useCancelMaterialRequestMutation(organizationId);

  const [action, setAction] = useState<MaterialRequestDecisionAction | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const matrix = availableMaterialRequestActions({
    status: request.status,
    approvedBy: request.approvedBy,
    currentUserId: session.user?.id ?? null,
    hasInvokedLine: hasInvokedMaterialRequestLine(request),
    permissions: new Set(permissions.codes),
  });

  if (!hasVisibleMaterialRequestAction(matrix)) return null;

  const pending =
    approve.isPending ||
    reject.isPending ||
    returnForCorrection.isPending ||
    reverseApproval.isPending ||
    cancel.isPending;

  function close() {
    setAction(null);
    setReason('');
    setFailure(null);
  }

  function onSuccess(message: string) {
    showToast({ kind: 'success', message });
    close();
  }

  function onError(error: unknown) {
    if (normalizeApiError(error).isUnauthorized) return;
    // The server message is the truth (it can carry the residual availability
    // figures); the dialog stays open so the user can retry or cancel.
    setFailure(materialRequestErrorMessage(action ?? 'approve', error).message);
  }

  function confirm() {
    if (action === null || pending) return;
    const copy = DECISION_ACTION_COPY[action];
    const problem = materialRequestReasonProblem(
      reason,
      copy.reasonMode === 'required',
    );
    if (problem !== null) return;
    setFailure(null);
    const trimmed = normalizeMaterialRequestReason(reason);
    const requestId = request.id;
    const callbacks = {
      onSuccess: () => onSuccess(copy.successMessage),
      onError,
    };

    switch (action) {
      case 'approve':
        approve.mutate(requestId, callbacks);
        return;
      case 'reject':
        reject.mutate({ requestId, reason: trimmed ?? '' }, callbacks);
        return;
      case 'returnForCorrection':
        returnForCorrection.mutate(
          { requestId, reason: trimmed ?? '' },
          callbacks,
        );
        return;
      case 'reverseApproval':
        reverseApproval.mutate({ requestId, reason: trimmed }, callbacks);
        return;
      case 'cancel':
        cancel.mutate({ requestId, reason: trimmed }, callbacks);
        return;
    }
  }

  const dialogCopy = action === null ? null : DECISION_ACTION_COPY[action];
  const reasonProblem =
    dialogCopy === null
      ? null
      : materialRequestReasonProblem(
          reason,
          dialogCopy.reasonMode === 'required',
        );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACTION_ORDER.filter((item) => matrix[item].visible).map((item) => {
        const copy = DECISION_ACTION_COPY[item];
        const availability = matrix[item];
        const Icon = ACTION_ICON[item];
        const blockedReason =
          availability.enabled || availability.blockedReason === undefined
            ? null
            : DECISION_BLOCKED_COPY[availability.blockedReason];
        const button = (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={copy.danger ? 'danger' : 'outline'}
            disabled={!availability.enabled || pending}
            title={blockedReason ?? undefined}
            onClick={() => {
              setFailure(null);
              setReason('');
              setAction(item);
            }}
            data-testid={`material-request-${item}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {copy.label}
          </Button>
        );
        return blockedReason === null ? (
          button
        ) : (
          <Tooltip key={item} content={blockedReason}>
            {button}
          </Tooltip>
        );
      })}

      {dialogCopy === null ? null : (
        <ConfirmDialog
          open
          danger={dialogCopy.danger}
          title={dialogCopy.confirmTitle}
          description={
            <>
              <p>{dialogCopy.confirmBody}</p>
              {(dialogCopy.warnings ?? []).map((warning) => (
                <p key={warning} className="font-medium text-ink">
                  {warning}
                </p>
              ))}
              <DecisionFacts request={request} action={action} />
            </>
          }
          confirmLabel={dialogCopy.label}
          loading={pending}
          loadingLabel={dialogCopy.loadingLabel}
          confirmDisabled={reasonProblem !== null}
          error={failure}
          onConfirm={confirm}
          onCancel={close}
        >
          {dialogCopy.reasonMode === 'none' ? null : (
            <DecisionReasonField
              action={action}
              required={dialogCopy.reasonMode === 'required'}
              value={reason}
              problem={reasonProblem}
              disabled={pending}
              onChange={(next) => {
                setReason(next);
                setFailure(null);
              }}
            />
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
