import type { ReactElement } from 'react';
import type { MaterialRequestDetail } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Textarea } from '@/ui/textarea';
import type {
  MaterialRequestDecisionAction,
  MaterialRequestReasonProblem,
} from './material-request-decisions';
import { isMaterialRequestLineLocked } from './material-request-status';

/**
 * The in-dialog half of a decision: the reason field and the record facts shown
 * before confirming. Kept apart from the action bar so neither file has to know
 * how the other renders.
 */

export function DecisionReasonField({
  action,
  required,
  value,
  problem,
  disabled,
  onChange,
}: {
  action: MaterialRequestDecisionAction | null;
  required: boolean;
  value: string;
  problem: MaterialRequestReasonProblem | null;
  disabled: boolean;
  onChange: (next: string) => void;
}): ReactElement {
  const id = `material-request-${action ?? 'decision'}-reason`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm text-ink">
        {t.materialRequests.actions.reasonLabel}
        {required ? (
          <span aria-hidden className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <Textarea
        id={id}
        rows={3}
        value={value}
        aria-required={required}
        aria-invalid={problem !== null}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-ink-muted">
        {required
          ? t.materialRequests.actions.reasonRequired
          : t.materialRequests.actions.reasonOptional}
      </p>
      {problem === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {problem === 'required'
            ? t.materialRequests.actions.reasonRequired
            : t.materialRequests.actions.reasonTooLong}
        </p>
      )}
    </div>
  );
}

/**
 * What the decision acts on, shown before confirming: the request number and
 * the flagged lines whose stock will be reserved (approval) or released
 * (reversal/cancellation). The counts come from the server's own lines; no
 * quantity is recomputed here.
 */
export function DecisionFacts({
  request,
  action,
}: {
  request: MaterialRequestDetail;
  action: MaterialRequestDecisionAction | null;
}): ReactElement | null {
  if (action === null) return null;
  const flagged = request.lines.filter((line) => line.reservationRequested);
  const locked = request.lines.filter(isMaterialRequestLineLocked).length;
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted"
      data-testid="material-request-decision-facts"
    >
      <dt>{t.materialRequests.number}</dt>
      <dd dir="ltr" className="text-end">
        {request.number ?? t.materialRequests.draftNumber}
      </dd>
      <dt>{t.materialRequests.lines}</dt>
      <dd className="text-end">{request.lines.length}</dd>
      {flagged.length === 0 ? null : (
        <>
          <dt>{t.materialRequests.reservationYes}</dt>
          <dd className="text-end">{flagged.length}</dd>
        </>
      )}
      {locked === 0 ? null : (
        <>
          <dt>{t.materialRequests.invoked}</dt>
          <dd className="text-end">{locked}</dd>
        </>
      )}
    </dl>
  );
}
