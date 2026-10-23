import { useState } from 'react';
import type { ReactNode } from 'react';
import type { InventoryRepricingChoice } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';

export interface SideEffectDecision {
  acknowledgeSideEffects: true;
  repricing: InventoryRepricingChoice;
}

/**
 * The OQ-54/ADR-0040 edit confirmation.
 *
 * Editing a document that already moved stock reverses the posted movements
 * and posts the corrected ones. The backend refuses such an edit until it
 * receives BOTH explicit answers, and this dialog is where the operator
 * gives them: the acknowledgement, and the repricing choice — which has NO
 * preselected value, because «انجام نشود» leaves the valuation honestly
 * stale and that must be a decision, not a default (OD-VAL-11).
 */
export function DocumentSideEffectDialog({
  open,
  loading,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  loading: boolean;
  error?: ReactNode;
  onConfirm: (decision: SideEffectDecision) => void;
  onCancel: () => void;
}) {
  const [repricing, setRepricing] = useState<InventoryRepricingChoice | null>(
    null,
  );

  const close = () => {
    setRepricing(null);
    onCancel();
  };

  return (
    <ConfirmDialog
      open={open}
      title={t.inventoryDocuments.sideEffectTitle}
      description={
        <>
          <p>{t.inventoryDocuments.sideEffectDescription}</p>
          <p className="mt-2">{t.inventoryDocuments.repricingDescription}</p>
        </>
      }
      confirmLabel={t.inventoryDocuments.saveChanges}
      loadingLabel={t.inventoryDocuments.saving}
      loading={loading}
      confirmDisabled={repricing === null}
      error={error}
      onCancel={close}
      onConfirm={() => {
        if (repricing === null) return;
        onConfirm({ acknowledgeSideEffects: true, repricing });
      }}
    >
      <fieldset className="space-y-2" data-testid="repricing-choice">
        <legend className="text-sm font-medium text-ink">
          {t.inventoryDocuments.repricingTitle}
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="repricing"
            value="recalculate"
            checked={repricing === 'recalculate'}
            onChange={() => setRepricing('recalculate')}
            data-testid="repricing-recalculate"
          />
          {t.inventoryDocuments.repricingRecalculate}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="repricing"
            value="skip"
            checked={repricing === 'skip'}
            onChange={() => setRepricing('skip')}
            data-testid="repricing-skip"
          />
          {t.inventoryDocuments.repricingSkip}
        </label>
      </fieldset>
    </ConfirmDialog>
  );
}
