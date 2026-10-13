import { Link, useParams } from 'react-router-dom';
import type { Department } from '@/api/contracts';
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
import {
  useDepartmentDetail,
  useDepartmentLifecycleMutation,
} from './department-hooks';

/** One department (`GET /departments/:id`) and its lifecycle transitions. */
export function DepartmentDetailPage() {
  const organizationId = useOrganizationId();
  const { departmentId } = useParams<{ departmentId: string }>();
  const query = useDepartmentDetail(organizationId, departmentId);

  if (query.isPending) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.departmentDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.departmentLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <DepartmentDetailView
      organizationId={organizationId as string}
      department={query.data}
    />
  );
}

function DepartmentDetailView({
  organizationId,
  department,
}: {
  organizationId: string;
  department: Department;
}) {
  const permissions = usePermissions();
  const { showToast } = useToast();
  const lifecycle = useDepartmentLifecycleMutation(organizationId);
  // The parent is a second read of the same endpoint; a parent that was later
  // disabled still resolves, so history is never hidden.
  const parentQuery = useDepartmentDetail(
    organizationId,
    department.parentDepartmentId ?? undefined,
  );

  return (
    <div className="space-y-4" data-testid="department-detail-page">
      <PageHeader
        title={t.orgAdmin.departmentDetail}
        description={`${department.code} — ${department.name}`}
        actions={
          <>
            <PermissionGate
              permission={PERMISSIONS.organization.departmentEdit}
            >
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/organization/departments/${encodeURIComponent(department.id)}/edit`}
                >
                  {t.orgAdmin.edit}
                </Link>
              </Button>
            </PermissionGate>
            <AdminLifecycleActions
              isActive={department.isActive}
              canEnable={permissions.has(
                PERMISSIONS.organization.departmentEnable,
              )}
              canDisable={permissions.has(
                PERMISSIONS.organization.departmentDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({
                  departmentId: department.id,
                  action: 'enable',
                })
              }
              onDisable={() =>
                lifecycle.mutateAsync({
                  departmentId: department.id,
                  action: 'disable',
                })
              }
              errorMessage={(action, error) =>
                adminErrorMessage('department', action, error)
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
          <span className="code">{department.code}</span>
        </Definition>
        <Definition label={t.orgAdmin.name}>{department.name}</Definition>
        <Definition label={t.orgAdmin.parentDepartment}>
          {department.parentDepartmentId === null ? (
            <span className="text-slate-500">{t.orgAdmin.rootDepartment}</span>
          ) : parentQuery.data !== undefined ? (
            <Link
              className="text-indigo-700 hover:underline"
              to={`/app/organization/departments/${encodeURIComponent(department.parentDepartmentId)}`}
            >
              {parentQuery.data.code} — {parentQuery.data.name}
            </Link>
          ) : (
            <span className="code">{department.parentDepartmentId}</span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.status}>
          <ActiveBadge active={department.isActive} />
        </Definition>
        <Definition label={t.orgAdmin.createdAt}>
          <span className="num" title={department.createdAt}>
            {formatDateTimeWithZone(department.createdAt)}
          </span>
        </Definition>
        <Definition label={t.orgAdmin.updatedAt}>
          <span className="num" title={department.updatedAt}>
            {formatDateTimeWithZone(department.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-slate-500">{t.orgAdmin.noDeleteHint}</p>
    </div>
  );
}
