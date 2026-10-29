import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Employee } from '@/api/contracts';
import { getBranch } from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { adminErrorMessage } from '../admin-error-messages';
import { AdminLifecycleActions } from '../admin-lifecycle-actions';
import { ActiveBadge, Definition, DefinitionList } from '../admin-ui';
import { useDepartmentDetail } from '../departments/department-hooks';
import {
  useEmployeeDetail,
  useEmployeeLifecycleMutation,
} from './employee-hooks';

/** One employee (`GET /employees/:id`) and its lifecycle transitions. */
export function EmployeeDetailPage() {
  const organizationId = useOrganizationId();
  const { employeeId } = useParams<{ employeeId: string }>();
  const query = useEmployeeDetail(organizationId, employeeId);

  if (query.isPending) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.orgAdmin.employeeDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.employeeLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <EmployeeDetailView
      organizationId={organizationId as string}
      employee={query.data}
    />
  );
}

function EmployeeDetailView({
  organizationId,
  employee,
}: {
  organizationId: string;
  employee: Employee;
}) {
  const permissions = usePermissions();
  const { showToast } = useToast();
  const lifecycle = useEmployeeLifecycleMutation(organizationId);

  // Reference reads for display. Each is gated by the permission of its own
  // endpoint: without it the raw id is shown instead of a guaranteed 403.
  const departmentQuery = useDepartmentDetail(
    permissions.has(PERMISSIONS.organization.departmentView)
      ? organizationId
      : null,
    employee.departmentId ?? undefined,
  );
  const branchQuery = useQuery({
    queryKey: queryKeys.organizations.branchDetail(
      organizationId,
      employee.branchId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getBranch(organizationId, employee.branchId as string, signal),
    enabled:
      employee.branchId !== null &&
      permissions.has(PERMISSIONS.organization.branchView),
  });

  return (
    <div className="space-y-4" data-testid="employee-detail-page">
      <FormPageHeader
        title={t.orgAdmin.employeeDetail}
        description={`${employee.employeeCode} — ${employee.firstName} ${employee.lastName}`}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.organization.employeeEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/organization/employees/${encodeURIComponent(employee.id)}/edit`}
                >
                  {t.orgAdmin.edit}
                </Link>
              </Button>
            </PermissionGate>
            <AdminLifecycleActions
              isActive={employee.isActive}
              canEnable={permissions.has(
                PERMISSIONS.organization.employeeEnable,
              )}
              canDisable={permissions.has(
                PERMISSIONS.organization.employeeDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({
                  employeeId: employee.id,
                  action: 'enable',
                })
              }
              onDisable={() =>
                lifecycle.mutateAsync({
                  employeeId: employee.id,
                  action: 'disable',
                })
              }
              errorMessage={(action, error) =>
                adminErrorMessage('employee', action, error)
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
        <Definition label={t.orgAdmin.employeeCode}>
          <span className="code">{employee.employeeCode}</span>
        </Definition>
        <Definition label={t.orgAdmin.fullName}>
          {employee.firstName} {employee.lastName}
        </Definition>
        <Definition label={t.orgAdmin.department}>
          {employee.departmentId === null ? (
            <span className="text-ink-subtle">
              {t.orgAdmin.noDepartmentAssigned}
            </span>
          ) : departmentQuery.data !== undefined ? (
            <Link
              className="text-brand hover:underline"
              to={`/app/organization/departments/${encodeURIComponent(employee.departmentId)}`}
            >
              {departmentQuery.data.code} — {departmentQuery.data.name}
            </Link>
          ) : (
            <span className="code">{employee.departmentId}</span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.branch}>
          {employee.branchId === null ? (
            <span className="text-ink-subtle">
              {t.orgAdmin.noBranchAssigned}
            </span>
          ) : branchQuery.data !== undefined ? (
            <Link
              className="text-brand hover:underline"
              to={`/app/organization/branches/${encodeURIComponent(employee.branchId)}`}
            >
              {branchQuery.data.code} — {branchQuery.data.name}
            </Link>
          ) : (
            <span className="code">{employee.branchId}</span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.status}>
          <ActiveBadge active={employee.isActive} />
        </Definition>
        <Definition label={t.orgAdmin.updatedAt}>
          <span className="num" title={employee.updatedAt}>
            {formatDateTimeWithZone(employee.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-ink-subtle">{t.orgAdmin.noDeleteHint}</p>
    </div>
  );
}
