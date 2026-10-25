import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FiscalYear } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import type { FiscalYearTransitionAction } from '@/api/accounting.api';
import { FiscalYearTransitionDialog } from './fiscal-year-transition-dialog';

const TRANSITION_PERMISSION: Record<FiscalYearTransitionAction, string> = {
  close: PERMISSIONS.accounting.fiscalYearClose,
  reopen: PERMISSIONS.accounting.fiscalYearReopen,
  seal: PERMISSIONS.accounting.fiscalYearSeal,
  unseal: PERMISSIONS.accounting.fiscalYearUnseal,
};

export function FiscalYearRowActions({
  fiscalYear,
}: {
  fiscalYear: FiscalYear;
}) {
  const permissions = usePermissions();
  const [action, setAction] = useState<FiscalYearTransitionAction | null>(null);
  const canEdit =
    fiscalYear.status !== 'sealed' &&
    permissions.has(PERMISSIONS.accounting.fiscalYearEdit);
  const availableActions: FiscalYearTransitionAction[] =
    fiscalYear.status === 'open'
      ? ['close']
      : fiscalYear.status === 'closed'
        ? ['seal', 'reopen']
        : ['unseal'];
  const actions = availableActions.filter((item) =>
    permissions.has(TRANSITION_PERMISSION[item]),
  );

  if (!canEdit && actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canEdit && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/app/accounting/fiscal-years/${encodeURIComponent(fiscalYear.id)}/edit`}
          >
            {t.fiscalYear.edit}
          </Link>
        </Button>
      )}
      {actions.map((item) => (
        <Button
          key={item}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAction(item)}
          data-testid={`fiscal-year-${item}-${fiscalYear.id}`}
        >
          {t.fiscalYear.transitions[item].label}
        </Button>
      ))}
      {action !== null && (
        <FiscalYearTransitionDialog
          fiscalYear={fiscalYear}
          action={action}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
