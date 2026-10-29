import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Department, UpdateDepartmentRequest } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  adminErrorMessage,
  applyServerValidation,
  type AdminErrorMessage,
} from '../admin-error-messages';
import { AdminFormShell } from '../admin-form-shell';
import { useActiveDepartmentOptions } from '../admin-references';
import { departmentSchema, type DepartmentFormValues } from '../admin-schemas';
import {
  useCreateDepartmentMutation,
  useDepartmentDetail,
  useUpdateDepartmentMutation,
} from './department-hooks';

/**
 * Create / edit a department (`POST /departments`, `PATCH /departments/:id`).
 *
 * The parent picker offers only ACTIVE departments of the same organization —
 * the two conditions `requireUsableDepartmentInOrganization` checks when a
 * parent is newly assigned. The remaining hierarchy rules (no self-parenting,
 * no cycles) stay with the service: it owns the rows and answers 422, which
 * is surfaced as the parent-rejected message rather than guessed at here.
 */

const KNOWN_FIELDS = ['code', 'name'] as const;

export function DepartmentCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  return <DepartmentForm organizationId={organizationId} mode="create" />;
}

export function DepartmentEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { departmentId } = useParams<{ departmentId: string }>();
  const query = useDepartmentDetail(organizationId, departmentId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.orgAdmin.departmentEditTitle} />
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
    <DepartmentForm
      organizationId={organizationId}
      mode="edit"
      department={query.data}
    />
  );
}

function DepartmentForm({
  organizationId,
  mode,
  department,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  department?: Department;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<AdminErrorMessage | null>(
    null,
  );
  const parents = useActiveDepartmentOptions(organizationId);

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: department?.code ?? '',
      name: department?.name ?? '',
      parentDepartmentId: department?.parentDepartmentId ?? '',
    },
  });

  const createMutation = useCreateDepartmentMutation(organizationId);
  const updateMutation = useUpdateDepartmentMutation(organizationId);
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
            'department',
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
          code: values.code,
          name: values.name,
          // Omitted = a root department (the create DTO has no null form).
          ...(values.parentDepartmentId !== ''
            ? { parentDepartmentId: values.parentDepartmentId }
            : {}),
        },
        {
          onSuccess: (created) => {
            showToast({
              kind: 'success',
              message: t.orgAdmin.departmentCreated,
            });
            navigate(
              `/app/organization/departments/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
      return;
    }

    const target = department as Department;
    // `null` is the documented detach signal on update.
    const body: UpdateDepartmentRequest = {
      code: values.code,
      name: values.name,
      parentDepartmentId:
        values.parentDepartmentId === '' ? null : values.parentDepartmentId,
    };
    updateMutation.mutate(
      { departmentId: target.id, values: body },
      {
        onSuccess: (updated) => {
          showToast({ kind: 'success', message: t.orgAdmin.departmentUpdated });
          navigate(
            `/app/organization/departments/${encodeURIComponent(updated.id)}`,
          );
        },
        onError,
      },
    );
  });

  // A department can never be its own parent; the service refuses it and the
  // option is not offered either.
  const parentOptions = parents.items.filter(
    (candidate) => candidate.id !== department?.id,
  );

  return (
    <AdminFormShell
      title={
        mode === 'create'
          ? t.orgAdmin.departmentCreateTitle
          : t.orgAdmin.departmentEditTitle
      }
      description={t.orgAdmin.departmentsDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.orgAdmin.save}
      cancelTo={
        mode === 'edit' && department !== undefined
          ? `/app/organization/departments/${encodeURIComponent(department.id)}`
          : '/app/organization/departments'
      }
      onSubmit={onSubmit}
      testId="department-form"
    >
      <FormField
        id="department-code"
        label={t.orgAdmin.code}
        error={form.formState.errors.code?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('code')}
          />
        )}
      </FormField>

      <FormField
        id="department-name"
        label={t.orgAdmin.name}
        error={form.formState.errors.name?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('name')}
          />
        )}
      </FormField>

      <FormField
        id="department-parent"
        label={t.orgAdmin.parentDepartment}
        error={form.formState.errors.parentDepartmentId?.message}
        hint={
          parents.unavailable
            ? t.orgAdmin.parentsUnavailable
            : parents.truncated
              ? t.orgAdmin.optionsTruncated
              : t.orgAdmin.parentHint
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            disabled={submitting || parents.unavailable}
            {...form.register('parentDepartmentId')}
          >
            <option value="">{t.orgAdmin.rootDepartment}</option>
            {parentOptions.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.code} — {parent.name}
              </option>
            ))}
            {/*
              An existing parent that is no longer active is kept selectable
              so an unrelated edit cannot silently detach the department.
            */}
            {department?.parentDepartmentId !== undefined &&
              department.parentDepartmentId !== null &&
              !parentOptions.some(
                (parent) => parent.id === department.parentDepartmentId,
              ) && (
                <option value={department.parentDepartmentId}>
                  {department.parentDepartmentId}
                </option>
              )}
          </Select>
        )}
      </FormField>
    </AdminFormShell>
  );
}
