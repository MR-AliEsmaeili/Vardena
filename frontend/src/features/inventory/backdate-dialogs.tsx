import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';

/**
 * The two explicit, SEPARATE confirmations a backdated inventory document
 * requires (OD-VAL-10/OD-VAL-11, feedback-standard §5.3/§5.4).
 *
 * Step 1 — پذیرش پیامد: WHAT the past date disturbs (real counts from the
 * backend), with a continue action that posts NOTHING.
 * Step 2 — انتخاب قیمت‌گذاری: the different question of repricing, with two
 * radio options, NO default selection, and a submit that stays disabled
 * until the operator chose. Collapsing the two steps into one dialog, or
 * defaulting either answer, is a contract violation — the system never
 * decides an accounting matter on the operator's behalf.
 */

export interface BackdateAssessment {
  affectedMovements: number;
  affectedValuedMovements: number;
  latestMovementDate: string | null;
  alreadyStale: boolean;
}

export type BackdateDecision = {
  backdateConfirmed: true;
  repricing: 'recalculate' | 'skip';
} | null;

export interface BackdateDialogsProps {
  /** `null` = closed. The measured facts shown in step 1. */
  assessment: BackdateAssessment | null;
  /** The operation that will run once the decision exists. */
  loading: boolean;
  /** Operation failure rendered INSIDE the step-2 dialog (it stays open). */
  error: ReactNode;
  /**
   * Called with the user's explicit decision (`null` = canceled at either
   * step — nothing is posted, nothing is defaulted).
   */
  onDecide: (decision: BackdateDecision) => void;
}

export function BackdateDialogs({
  assessment,
  loading,
  error,
  onDecide,
}: BackdateDialogsProps): ReactElement {
  const [state, setState] = useState<{
    assessment: BackdateAssessment;
    step: 1 | 2;
    repricing: 'recalculate' | 'skip' | null;
  } | null>(null);

  // A NEW assessment (a fresh submission attempt) resets the flow to step 1
  // with no preselected answer — a remembered choice would be a default.
  // State adjusted during render (the React-documented reset pattern), not
  // in an effect.
  if (assessment !== null && state?.assessment !== assessment) {
    setState({ assessment, step: 1, repricing: null });
  }

  if (assessment === null || state === null) {
    return <></>;
  }

  const step1Body = t.inventory.backdateStep1Body
    .replace('{affectedMovements}', String(assessment.affectedMovements))
    .replace(
      '{affectedValuedMovements}',
      String(assessment.affectedValuedMovements),
    );

  return (
    <>
      {state.step === 1 && (
        <ConfirmDialog
          open
          title={t.inventory.backdateStep1Title}
          description={<p>{step1Body}</p>}
          confirmLabel={t.inventory.backdateStep1Continue}
          onConfirm={() => setState({ ...state, step: 2 })}
          onCancel={() => onDecide(null)}
        />
      )}

      {state.step === 2 && (
        <ConfirmDialog
          open
          title={t.inventory.backdateStep2Title}
          description={<p>{t.inventory.backdateStep2Body}</p>}
          confirmLabel={t.inventory.backdateStep2Submit}
          loading={loading}
          loadingLabel={t.inventory.submitting}
          error={error}
          // No decision, no submit: the primary action stays disabled until
          // the operator explicitly picked one of the two answers.
          confirmDisabled={state.repricing === null}
          onConfirm={() => {
            if (state.repricing === null || loading) return;
            onDecide({
              backdateConfirmed: true,
              repricing: state.repricing,
            });
          }}
          onCancel={() => onDecide(null)}
        >
          <fieldset className="space-y-2">
            <legend className="sr-only">
              {t.inventory.backdateStep2Title}
            </legend>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
              <input
                type="radio"
                name="backdate-repricing"
                value="recalculate"
                checked={state.repricing === 'recalculate'}
                onChange={() =>
                  setState({ ...state, repricing: 'recalculate' })
                }
                disabled={loading}
                className="mt-1"
              />
              <span>{t.inventory.backdateStep2Recalculate}</span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
              <input
                type="radio"
                name="backdate-repricing"
                value="skip"
                checked={state.repricing === 'skip'}
                onChange={() => setState({ ...state, repricing: 'skip' })}
                disabled={loading}
                className="mt-1"
              />
              <span>{t.inventory.backdateStep2Skip}</span>
            </label>
          </fieldset>
        </ConfirmDialog>
      )}
    </>
  );
}
