import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountingConfiguration } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { configurationErrorMessage } from './configuration-error-messages';
import {
  useDeleteAccountingConfigurationMutation,
  usePublishAccountingConfigurationMutation,
} from './configuration-hooks';

const BASE_PATH = '/app/accounting/configurations';

type PendingAction = 'publish' | 'delete';

function detailPath(configurationId: string) {
  return `${BASE_PATH}/${encodeURIComponent(configurationId)}`;
}

function editPath(configurationId: string) {
  return `${BASE_PATH}/${encodeURIComponent(configurationId)}/edit`;
}

/**
 * The ONE action matrix of an accounting-configuration version (ACC-06).
 *
 * Permissions mirror the controller exactly: every read is
 * `Accounting.AccountingConfiguration.View`, and create/update/publish/delete
 * are all exactly `Accounting.AccountingConfiguration.Configure`.
 *
 * Version matrix (backend rules, not a UI invention):
 * - edit / publish : DRAFT only (PATCH and publish answer 422 otherwise);
 * - delete         : DRAFT **and** not operationally used;
 * - ACTIVE / SUPERSEDED expose no write action at all.
 */
export function ConfigurationActions({
  configuration,
  showView = true,
}: {
  configuration: AccountingConfiguration;
  showView?: boolean;
}) {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const canConfigure = permissions.has(
    PERMISSIONS.accounting.accountingConfigurationConfigure,
  );
  const canView = permissions.has(
    PERMISSIONS.accounting.accountingConfigurationView,
  );
  const isDraft = configuration.status === 'DRAFT';
  const canEdit = canConfigure && isDraft;
  const canDelete =
    canConfigure && isDraft && !configuration.isOperationallyUsed;

  if (!canView && !canConfigure) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {showView && canView && (
        <Button asChild variant="ghost" size="sm">
          <Link to={detailPath(configuration.id)}>
            {t.accountingConfig.view}
          </Link>
        </Button>
      )}
      {canEdit && (
        <Button asChild variant="ghost" size="sm">
          <Link to={editPath(configuration.id)}>{t.accountingConfig.edit}</Link>
        </Button>
      )}
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPending('publish')}
          data-testid={`configuration-publish-${configuration.id}`}
        >
          {t.accountingConfig.publish}
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPending('delete')}
          data-testid={`configuration-delete-${configuration.id}`}
        >
          {t.accountingConfig.delete}
        </Button>
      )}
      {pending !== null && organizationId !== null && (
        <ConfigurationActionDialog
          configuration={configuration}
          action={pending}
          organizationId={organizationId}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

function ConfigurationActionDialog({
  configuration,
  action,
  organizationId,
  onClose,
}: {
  configuration: AccountingConfiguration;
  action: PendingAction;
  organizationId: string;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const publishMutation =
    usePublishAccountingConfigurationMutation(organizationId);
  const deleteMutation =
    useDeleteAccountingConfigurationMutation(organizationId);
  const mutation = action === 'publish' ? publishMutation : deleteMutation;
  const [failure, setFailure] = useState<string | null>(null);
  const copy =
    action === 'publish'
      ? {
          title: t.accountingConfig.publishTitle,
          body: t.accountingConfig.publishBody,
          confirm: t.accountingConfig.publishConfirm,
          loading: t.accountingConfig.publishing,
          success: t.accountingConfig.published,
        }
      : {
          title: t.accountingConfig.deleteTitle,
          body: t.accountingConfig.deleteBody,
          confirm: t.accountingConfig.deleteConfirm,
          loading: t.accountingConfig.deleting,
          success: t.accountingConfig.deleted,
        };

  const confirm = () => {
    if (mutation.isPending) return;
    setFailure(null);
    const options = {
      onSuccess: () => {
        showToast({ kind: 'success' as const, message: copy.success });
        onClose();
      },
      onError: (error: unknown) =>
        setFailure(configurationErrorMessage(action, error)),
    };
    if (action === 'publish') publishMutation.mutate(configuration.id, options);
    else deleteMutation.mutate(configuration.id, options);
  };

  return (
    <ConfirmDialog
      open
      danger={action === 'delete'}
      title={copy.title}
      description={copy.body}
      confirmLabel={copy.confirm}
      loading={mutation.isPending}
      loadingLabel={copy.loading}
      onConfirm={confirm}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      {...(failure !== null ? { error: failure } : {})}
    />
  );
}
