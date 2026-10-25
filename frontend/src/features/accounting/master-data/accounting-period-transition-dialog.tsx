import { useState } from 'react';
import type { AccountingPeriod, FiscalYear } from '@/api/contracts';
import type { AccountingPeriodAction } from '@/api/accounting.api';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { accountingPeriodErrorMessage } from './accounting-period-error-messages';
import { useAccountingPeriodTransitionMutation } from './accounting-period-hooks';

const labels = {
  close: t.accountingPeriod.transitions.close,
  reopen: t.accountingPeriod.transitions.reopen,
  seal: t.accountingPeriod.transitions.seal,
};
const permissionCodes = {
  close: PERMISSIONS.accounting.accountingPeriodClose,
  reopen: PERMISSIONS.accounting.accountingPeriodReopen,
  seal: PERMISSIONS.accounting.accountingPeriodSeal,
};

/** Only operations allowed by BOTH the current row and its year are offered.
 * The server remains authoritative and rechecks status under lock. */
export function AccountingPeriodRowActions({
  period,
  year,
  organizationId,
}: {
  period: AccountingPeriod;
  year: FiscalYear | undefined;
  organizationId: string;
}) {
  const permissions = usePermissions();
  const mutation = useAccountingPeriodTransitionMutation(organizationId);
  const [action, setAction] = useState<AccountingPeriodAction | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const available: AccountingPeriodAction[] =
    year?.status !== 'open' || !year.isActive
      ? []
      : period.status === 'open'
        ? ['close']
        : period.status === 'closed'
          ? ['reopen', 'seal']
          : [];
  const closeDialog = () => {
    setAction(null);
    setReason('');
    setReasonError(false);
    mutation.reset();
  };
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {year !== undefined && year.status !== 'open' && (
        <span
          title={t.accountingPeriod.yearNotOpen}
          className="text-xs text-ink-muted"
        >
          {t.accountingPeriod.yearNotOpen}
        </span>
      )}
      {available
        .filter((item) => permissions.has(permissionCodes[item]))
        .map((item) => (
          <Button
            key={item}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAction(item)}
          >
            {labels[item]}
          </Button>
        ))}
      <ConfirmDialog
        open={action !== null}
        title={action === null ? '' : labels[action]}
        description={t.accountingPeriod.transitionBody}
        confirmLabel={action === null ? '' : labels[action]}
        danger={action === 'seal'}
        loading={mutation.isPending}
        confirmDisabled={
          reason.trim().length === 0 || reason.trim().length > 500
        }
        onCancel={closeDialog}
        onConfirm={() => {
          if (action === null) return;
          const trimmed = reason.trim();
          if (trimmed.length === 0 || trimmed.length > 500) {
            setReasonError(true);
            return;
          }
          mutation.mutate(
            { periodId: period.id, action, body: { reason: trimmed } },
            { onSuccess: closeDialog },
          );
        }}
        {...(mutation.isError
          ? { error: accountingPeriodErrorMessage(mutation.error) }
          : {})}
      >
        <label htmlFor={`period-reason-${period.id}`} className="block text-sm">
          {t.accountingPeriod.reason}
        </label>
        <Input
          id={`period-reason-${period.id}`}
          value={reason}
          maxLength={500}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(false);
          }}
          disabled={mutation.isPending}
          aria-invalid={reasonError}
        />
        {reasonError && (
          <p role="alert" className="text-sm text-danger">
            {t.accountingPeriod.reasonRequired}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
