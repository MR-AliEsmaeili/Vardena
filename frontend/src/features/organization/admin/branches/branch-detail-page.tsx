import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { adminErrorMessage } from '../admin-error-messages';
import { AdminLifecycleActions } from '../admin-lifecycle-actions';
import { ActiveBadge, Definition, DefinitionList } from '../admin-ui';
import { useBranchDetail, useBranchLifecycleMutation } from './branch-hooks';

/** One branch (`GET /branches/:id`) with its enable/disable transitions. */
export function BranchDetailPage() {
  const organizationId = useOrganizationId();
  const { branchId } = useParams<{ branchId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = useBranchDetail(organizationId, branchId);
  const lifecycle = useBranchLifecycleMutation(organizationId ?? 'none');

  if (query.isPending)
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.branchDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.branchLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const branch = query.data;

  return (
    <div className="space-y-4" data-testid="branch-detail-page">
      <PageHeader
        title={t.orgAdmin.branchDetail}
        description={`${branch.code} — ${branch.name}`}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.organization.branchEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/organization/branches/${encodeURIComponent(branch.id)}/edit`}
                >
                  {t.orgAdmin.edit}
                </Link>
              </Button>
            </PermissionGate>
            <AdminLifecycleActions
              isActive={branch.isActive}
              canEnable={permissions.has(PERMISSIONS.organization.branchEnable)}
              canDisable={permissions.has(
                PERMISSIONS.organization.branchDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({ branchId: branch.id, action: 'enable' })
              }
              onDisable={() =>
                lifecycle.mutateAsync({
                  branchId: branch.id,
                  action: 'disable',
                })
              }
              errorMessage={(action, error) =>
                adminErrorMessage('branch', action, error)
              }
              onConfirmed={(action) =>
                showToast({
                  kind: 'success',
                  message:
                    action === 'enable'
                      ? t.orgAdmin.enabled
                      : t.orgAdmin.disabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.orgAdmin.code}>
          <span className="code">{branch.code}</span>
        </Definition>
        <Definition label={t.orgAdmin.name}>{branch.name}</Definition>
        <Definition label={t.orgAdmin.status}>
          <ActiveBadge active={branch.isActive} />
        </Definition>
        <Definition label={t.orgAdmin.identity}>
          <span className="code">{branch.id}</span>
        </Definition>
        <Definition label={t.orgAdmin.createdAt}>
          <span className="num" title={branch.createdAt}>
            {formatDateTimeWithZone(branch.createdAt)}
          </span>
        </Definition>
        <Definition label={t.orgAdmin.updatedAt}>
          <span className="num" title={branch.updatedAt}>
            {formatDateTimeWithZone(branch.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-ink-subtle">{t.orgAdmin.noDeleteHint}</p>
    </div>
  );
}
