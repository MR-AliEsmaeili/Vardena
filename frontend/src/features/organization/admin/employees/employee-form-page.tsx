import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Employee, UpdateEmployeeRequest } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  adminErrorMessage,
  applyServerValidation,
  type AdminErrorMessage,
} from '../admin-error-messages';
import { AdminFormShell } from '../admin-form-shell';
import {
  useActiveBranchOptions,
  useActiveDepartmentOptions,
} from '../admin-references';
import { employeeSchema, type EmployeeFormValues } from '../admin-schemas';
import {
  useCreateEmployeeMutation,
  useEmployeeDetail,
  useUpdateEmployeeMutation,
} from './employee-hooks';

/**
 * Create / edit an employee (`POST /employees`, `PATCH /employees/:id`).
 *
 * Department and branch are optional references that must belong to the same
 * organization and be usable; the pickers therefore offer only this
 * organization's ACTIVE records, and an empty selection is sent as `null` on
 * update (the documented way to clear the assignment).
 */

const KNOWN_FIELDS = ['employeeCode', 'firstName', 'lastName'] as const;

export function EmployeeCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  return <EmployeeForm organizationId={organizationId} mode="create" />;
}

export function EmployeeEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { employeeId } = useParams<{ employeeId: string }>();
  const query = useEmployeeDetail(organizationId, employeeId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.employeeEditTitle} />
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
    <EmployeeForm
      organizationId={organizationId}
      mode="edit"
      employee={query.data}
    />
  );
}

function EmployeeForm({
  organizationId,
  mode,
  employee,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  employee?: Employee;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<AdminErrorMessage | null>(
    null,
  );
  const departments = useActiveDepartmentOptions(organizationId);
  const branches = useActiveBranchOptions(organizationId);

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    mode: 'onSubmit',
    defaultValues: {
      employeeCode: employee?.employeeCode ?? '',
      firstName: employee?.firstName ?? '',
      lastName: employee?.lastName ?? '',
      departmentId: employee?.departmentId ?? '',
      branchId: employee?.branchId ?? '',
    },
  });

  const createMutation = useCreateEmployeeMutation(organizationId);
  const updateMutation = useUpdateEmployeeMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const onError = (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.isUnauthorized) return;
    const validation = applyServerValidation(error, form, KNOWN_FIELDS);
    setServerError(
      validation !== null
        ? {
            message: validation.summary,
            ...(normalized.correlationId !== undefined
              ? { correlationId: normalized.correlationId }
              : {}),
          }
        : adminErrorMessage(
            'employee',
            mode === 'create' ? 'create' : 'update',
            error,
          ),
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);

    if (mode === 'create') {
      createMutation.mutate(
        {
          employeeCode: values.employeeCode,
          firstName: values.firstName,
          lastName: values.lastName,
          ...(values.departmentId !== ''
            ? { departmentId: values.departmentId }
            : {}),
          ...(values.branchId !== '' ? { branchId: values.branchId } : {}),
        },
        {
          onSuccess: (created) => {
            showToast({ kind: 'success', message: t.orgAdmin.employeeCreated });
            navigate(
              `/app/organization/employees/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
      return;
    }

    const target = employee as Employee;
    const body: UpdateEmployeeRequest = {
      employeeCode: values.employeeCode,
      firstName: values.firstName,
      lastName: values.lastName,
      departmentId: values.departmentId === '' ? null : values.departmentId,
      branchId: values.branchId === '' ? null : values.branchId,
    };
    updateMutation.mutate(
      { employeeId: target.id, values: body },
      {
        onSuccess: (updated) => {
          showToast({ kind: 'success', message: t.orgAdmin.employeeUpdated });
          navigate(
            `/app/organization/employees/${encodeURIComponent(updated.id)}`,
          );
        },
        onError,
      },
    );
  });

  return (
    <AdminFormShell
      title={
        mode === 'create'
          ? t.orgAdmin.employeeCreateTitle
          : t.orgAdmin.employeeEditTitle
      }
      description={t.orgAdmin.employeesDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.orgAdmin.save}
      cancelTo={
        mode === 'edit' && employee !== undefined
          ? `/app/organization/employees/${encodeURIComponent(employee.id)}`
          : '/app/organization/employees'
      }
      onSubmit={onSubmit}
      testId="employee-form"
    >
      <FormField
        id="employee-code"
        label={t.orgAdmin.employeeCode}
        error={form.formState.errors.employeeCode?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('employeeCode')}
          />
        )}
      </FormField>

      <FormField
        id="employee-first-name"
        label={t.orgAdmin.firstName}
        error={form.formState.errors.firstName?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('firstName')}
          />
        )}
      </FormField>

      <FormField
        id="employee-last-name"
        label={t.orgAdmin.lastName}
        error={form.formState.errors.lastName?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('lastName')}
          />
        )}
      </FormField>

      <FormField
        id="employee-department"
        label={t.orgAdmin.department}
        error={form.formState.errors.departmentId?.message}
        hint={
          departments.unavailable
            ? t.orgAdmin.departmentsUnavailable
            : departments.truncated
              ? t.orgAdmin.optionsTruncated
              : t.orgAdmin.referenceInactiveHint
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            disabled={submitting || departments.unavailable}
            {...form.register('departmentId')}
          >
            <option value="">{t.orgAdmin.noDepartmentAssigned}</option>
            {departments.items.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} — {department.name}
              </option>
            ))}
            {employee?.departmentId !== undefined &&
              employee.departmentId !== null &&
              !departments.items.some(
                (department) => department.id === employee.departmentId,
              ) && (
                <option value={employee.departmentId}>
                  {employee.departmentId}
                </option>
              )}
          </Select>
        )}
      </FormField>

      <FormField
        id="employee-branch"
        label={t.orgAdmin.branch}
        error={form.formState.errors.branchId?.message}
        hint={
          branches.unavailable
            ? t.orgAdmin.branchesUnavailable
            : branches.truncated
              ? t.orgAdmin.optionsTruncated
              : undefined
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            disabled={submitting || branches.unavailable}
            {...form.register('branchId')}
          >
            <option value="">{t.orgAdmin.noBranchAssigned}</option>
            {branches.items.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
            {employee?.branchId !== undefined &&
              employee.branchId !== null &&
              !branches.items.some(
                (branch) => branch.id === employee.branchId,
              ) && (
                <option value={employee.branchId}>{employee.branchId}</option>
              )}
          </Select>
        )}
      </FormField>
    </AdminFormShell>
  );
}
