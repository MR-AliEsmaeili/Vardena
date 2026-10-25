import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { FinancialArea } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import {
  financialAreaErrorMessage,
  type FinancialAreaErrorMessage,
  type FinancialAreaOperation,
} from './financial-area-error-messages';
import {
  useFinancialAreaLifecycleMutation,
  useUpdateFinancialAreaMutation,
} from './financial-area-hooks';

/**
 * Row actions of one financial area in the administration list (ACC-01).
 *
 * The same shape as `organization/admin/admin-lifecycle-actions.tsx`:
 * - an operation the session clearly cannot use is NOT rendered at all
 *   (hidden, never disabled) — UX only (AR-21), the backend re-authorizes
 *   every call with the exact code of that operation;
 * - every mutation first states its consequence in a `ConfirmDialog`
 *   (standards.md §11) and, on failure, the dialog stays open with the
 *   mapped Persian error inside it;
 * - nothing is applied optimistically: the hooks write the server's own
 *   response and invalidate, so the status badge and the default flag move
 *   only after the backend confirmed.
 *
 * "Set default" sends exactly `{ isDefault: true }`. The frontend never
 * un-flags a default and never re-implements the "only one default" rule —
 * the backend clears the previous default in the same transaction, and the
 * invalidated list re-reads the result.
 */

type RowAction = 'enable' | 'disable' | 'setDefault';

const ACTION_OPERATION: Record<RowAction, FinancialAreaOperation> = {
  enable: 'enable',
  disable: 'disable',
  setDefault: 'setDefault',
};

const ACTION_LABEL: Record<RowAction, string> = {
  enable: t.financialArea.enable,
  disable: t.financialArea.disable,
  setDefault: t.financialArea.setDefault,
};

const ACTION_BODY: Record<RowAction, string> = {
  enable: t.financialArea.enableBody,
  disable: t.financialArea.disableBody,
  setDefault: t.financialArea.setDefaultBody,
};

const ACTION_SUCCESS: Record<RowAction, string> = {
  enable: t.financialArea.enabled,
  disable: t.financialArea.disabled,
  setDefault: t.financialArea.defaultSet,
};

export function FinancialAreaRowActions({
  area,
}: {
  area: FinancialArea;
}): ReactElement | null {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const lifecycle = useFinancialAreaLifecycleMutation(organizationId ?? 'none');
  const update = useUpdateFinancialAreaMutation(
    organizationId ?? 'none',
    area.id,
  );
  const [open, setOpen] = useState<RowAction | null>(null);
  const [failure, setFailure] = useState<FinancialAreaErrorMessage | null>(
    null,
  );

  if (organizationId === null) return null;

  const canEdit = permissions.has(PERMISSIONS.accounting.financialAreaEdit);
  const canEnable = permissions.has(PERMISSIONS.accounting.financialAreaEnable);
  const canDisable = permissions.has(
    PERMISSIONS.accounting.financialAreaDisable,
  );
  const lifecycleAction: RowAction = area.isActive ? 'disable' : 'enable';
  const canLifecycle = area.isActive ? canDisable : canEnable;
  const pending = lifecycle.isPending || update.isPending;

  if (!canEdit && !canLifecycle) return null;

  const start = (action: RowAction) => {
    setFailure(null);
    setOpen(action);
  };

  const close = () => {
    if (pending) return; // the request is in flight; the dialog stays
    setOpen(null);
    setFailure(null);
  };

  const confirm = () => {
    const action = open;
    if (action === null || pending) return;
    setFailure(null);
    const request =
      action === 'setDefault'
        ? update.mutateAsync({ isDefault: true })
        : lifecycle.mutateAsync({ id: area.id, next: action });
    void request.then(
      () => {
        setOpen(null);
        showToast({ kind: 'success', message: ACTION_SUCCESS[action] });
      },
      (error: unknown) => {
        setFailure(financialAreaErrorMessage(ACTION_OPERATION[action], error));
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canEdit && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/app/accounting/financial-areas/${encodeURIComponent(area.id)}/edit`}
          >
            {t.financialArea.edit}
          </Link>
        </Button>
      )}
      {canEdit && !area.isDefault && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => start('setDefault')}
          data-testid={`financial-area-set-default-${area.id}`}
        >
          {t.financialArea.setDefault}
        </Button>
      )}
      {canLifecycle && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => start(lifecycleAction)}
          data-testid={`financial-area-${lifecycleAction}-${area.id}`}
        >
          {ACTION_LABEL[lifecycleAction]}
        </Button>
      )}

      <ConfirmDialog
        open={open !== null}
        danger={open === 'disable'}
        title={open !== null ? ACTION_LABEL[open] : ''}
        description={open !== null ? ACTION_BODY[open] : ''}
        confirmLabel={open !== null ? ACTION_LABEL[open] : ''}
        loading={pending}
        loadingLabel={
          open === 'disable'
            ? t.financialArea.disabling
            : open === 'enable'
              ? t.financialArea.enabling
              : t.financialArea.saving
        }
        onConfirm={confirm}
        onCancel={close}
        {...(failure !== null ? { error: failure.message } : {})}
      />
    </div>
  );
}
