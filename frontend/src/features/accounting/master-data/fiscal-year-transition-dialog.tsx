import { useState } from 'react';
import type { FiscalYearTransitionAction } from '@/api/accounting.api';
import type { FiscalYear } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import { fiscalYearErrorMessage } from './fiscal-year-error-messages';
import { useFiscalYearTransitionMutation } from './fiscal-year-hooks';

// Mirrors backend/src/modules/accounting/domain/master-data.ts.
const MAX_REASON_LENGTH = 500;

export function FiscalYearTransitionDialog({
  fiscalYear,
  action,
  onClose,
}: {
  fiscalYear: FiscalYear;
  action: FiscalYearTransitionAction;
  onClose: () => void;
}) {
  const organizationId = useOrganizationId();
  const { showToast } = useToast();
  const mutation = useFiscalYearTransitionMutation(organizationId ?? 'none');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const copy = t.fiscalYear.transitions[action];
  const isReasonValid =
    reason.trim().length > 0 && reason.length <= MAX_REASON_LENGTH;

  const confirm = () => {
    if (organizationId === null || !isReasonValid || mutation.isPending) return;
    setFailure(null);
    mutation.mutate(
      { id: fiscalYear.id, action, reason: reason.trim() },
      {
        onSuccess: () => {
          showToast({ kind: 'success', message: copy.success });
          onClose();
        },
        onError: (error) => setFailure(fiscalYearErrorMessage(action, error)),
      },
    );
  };

  return (
    <ConfirmDialog
      open
      danger={action === 'close' || action === 'seal'}
      title={copy.title}
      description={copy.body}
      confirmLabel={copy.confirm}
      loading={mutation.isPending}
      loadingLabel={t.fiscalYear.saving}
      confirmDisabled={!isReasonValid || organizationId === null}
      onConfirm={confirm}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      {...(failure !== null ? { error: failure } : {})}
    >
      <FormField
        id="fiscal-year-transition-reason"
        label={t.fiscalYear.reason}
        required
        error={
          isReasonValid
            ? undefined
            : reason.length > MAX_REASON_LENGTH
              ? t.fiscalYear.reasonTooLong
              : t.fiscalYear.reasonRequired
        }
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MAX_REASON_LENGTH + 1}
            disabled={mutation.isPending}
            autoComplete="off"
          />
        )}
      </FormField>
    </ConfirmDialog>
  );
}
