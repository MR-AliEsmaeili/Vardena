import { useRef, useState } from 'react';
import type { InventoryMovement } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import {
  isBusinessDay,
  todayBusinessDay,
  toBusinessDateInput,
  useTimeZone,
} from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { DateInput } from '@/ui/patterns/date-input';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import {
  BackdateDialogs,
  type BackdateAssessment,
  type BackdateDecision,
} from './backdate-dialogs';
import {
  inventoryErrorMessage,
  isBackdateRefusal,
} from './inventory-error-messages';
import {
  newInventoryOperationKey,
  useReverseMovementMutation,
} from './inventory-mutations';

/** Server creates the mirror. We never mutate the original row optimistically. */
export function MovementReversalDialog({
  movement,
  onClose,
}: {
  movement: InventoryMovement;
  onClose: () => void;
}) {
  const zone = useTimeZone();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const mutation = useReverseMovementMutation(movement.organizationId);
  const operationKey = useRef(newInventoryOperationKey());
  const today = todayBusinessDay(zone);
  const [date, setDate] = useState(
    today < movement.movementDate ? movement.movementDate : today,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<BackdateAssessment | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const validDate = isBusinessDay(date) && date >= movement.movementDate;
  const canRecalculate = permissions.has(
    PERMISSIONS.inventory.valuationRecalculate,
  );

  function submit(decision: BackdateDecision) {
    if (
      mutation.isPending ||
      !validDate ||
      (decision?.repricing === 'recalculate' && !canRecalculate)
    )
      return;
    setFailure(null);
    setDecisionError(null);
    mutation.mutate(
      {
        movementId: movement.id,
        operationKey: operationKey.current,
        values: {
          movementDate: toBusinessDateInput(date),
          ...(decision ?? {}),
        },
      },
      {
        onSuccess: () => {
          setAssessment(null);
          showToast({ kind: 'success', message: t.inventory.reversed });
          onClose();
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          if (
            apiError.code === 'BusinessRuleViolation' &&
            isBackdateRefusal(apiError.details)
          ) {
            setAssessment({
              affectedMovements: apiError.details.affectedMovements,
              affectedValuedMovements: apiError.details.affectedValuedMovements,
              latestMovementDate: apiError.details.latestMovementDate,
              alreadyStale: apiError.details.alreadyStale,
            });
            return;
          }
          const message = inventoryErrorMessage(
            'reverseMovement',
            error,
          ).message;
          if (assessment !== null) setDecisionError(message);
          else setFailure(message);
        },
      },
    );
  }

  return (
    <>
      <ConfirmDialog
        open={assessment === null}
        danger
        title={t.inventory.reverseTitle}
        description={t.inventory.reverseBody}
        confirmLabel={t.inventory.reverseConfirm}
        loading={mutation.isPending}
        loadingLabel={t.inventory.reversing}
        confirmDisabled={!validDate}
        onConfirm={() => submit(null)}
        onCancel={onClose}
        {...(failure !== null ? { error: failure } : {})}
      >
        <label
          className="block space-y-1 text-sm"
          htmlFor="movement-reversal-date"
        >
          <span>{t.inventory.reverseDate}</span>
          <DateInput
            id="movement-reversal-date"
            value={date}
            onValueChange={(day) => {
              setDate(day);
              setFailure(null);
            }}
            disabled={mutation.isPending}
            aria-invalid={!validDate}
          />
          <span className="block text-ink-muted">
            {t.inventory.reverseDateHint}
          </span>
          {!validDate && (
            <span role="alert" className="block text-danger-ink">
              {t.inventory.reverseDateInvalid}
            </span>
          )}
        </label>
      </ConfirmDialog>
      <BackdateDialogs
        assessment={assessment}
        loading={mutation.isPending}
        error={decisionError}
        canRecalculate={canRecalculate}
        onDecide={(decision) => {
          if (decision === null) {
            setAssessment(null);
            setDecisionError(null);
          } else submit(decision);
        }}
      />
    </>
  );
}
