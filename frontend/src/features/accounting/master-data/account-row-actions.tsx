import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { useAccountLifecycleMutation } from './account-admin-hooks';

export function AccountRowActions({ account }: { account: Account }) {
  const permissions = usePermissions();
  const { showToast } = useToast();
  const lifecycle = useAccountLifecycleMutation(
    account.organizationId,
    account.id,
  );
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const action = account.isActive ? 'disable' : 'enable';
  const canTransition = permissions.has(
    account.isActive
      ? PERMISSIONS.accounting.accountDisable
      : PERMISSIONS.accounting.accountEnable,
  );
  const canEdit = permissions.has(PERMISSIONS.accounting.accountEdit);
  const label = account.isActive
    ? t.accountAdmin.disable
    : t.accountAdmin.enable;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button asChild variant="ghost" size="sm">
        <Link to={`/app/accounting/accounts/${encodeURIComponent(account.id)}`}>
          {t.masterData.view}
        </Link>
      </Button>
      {canEdit && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/app/accounting/accounts/${encodeURIComponent(account.id)}/edit`}
          >
            {t.accountAdmin.edit}
          </Link>
        </Button>
      )}
      {canTransition && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setFailure(null);
            setOpen(true);
          }}
        >
          {label}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        danger={account.isActive}
        title={label}
        description={
          account.isActive
            ? t.accountAdmin.disableBody
            : t.accountAdmin.enableBody
        }
        confirmLabel={label}
        loading={lifecycle.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (lifecycle.isPending) return;
          setFailure(null);
          lifecycle.mutate(action, {
            onSuccess: () => {
              setOpen(false);
              showToast({
                kind: 'success',
                message: account.isActive
                  ? t.accountAdmin.disabled
                  : t.accountAdmin.enabled,
              });
            },
            onError: () => setFailure(t.accountAdmin.saveFailed),
          });
        }}
        {...(failure !== null ? { error: failure } : {})}
      />
    </div>
  );
}
