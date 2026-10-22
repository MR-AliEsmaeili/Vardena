import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { InventoryWarehouse } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { Select } from '@/ui/select';
import {
  applyServerValidation,
  masterDataErrorMessage,
  type MasterDataErrorMessage,
} from '../master-data-errors';
import { MasterDataFormShell } from '../master-data-form-shell';
import { useActiveBranchOptions } from '../master-data-references';
import {
  warehouseSchema,
  type WarehouseFormValues,
} from '../master-data-schemas';
import {
  useCreateWarehouseMutation,
  useUpdateWarehouseMutation,
  useWarehouseDetail,
} from './warehouse-hooks';

/**
 * Create / edit a warehouse (`POST /warehouses`, `PATCH /warehouses/:id`).
 *
 * The form owns exactly what the DTO owns: identity (code/name), the branch
 * it lives under, and the three policies (`allowNegativeStock`,
 * `reservationsReduceAvailable`, `accountingPostingMode`). The branch picker
 * offers only active branches — the backend refuses anything else.
 */

const KNOWN_FIELDS = [
  'code',
  'name',
  'branchId',
  'accountingPostingMode',
] as const;

export function WarehouseCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  return <WarehouseForm organizationId={organizationId} mode="create" />;
}

export function WarehouseEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const query = useWarehouseDetail(organizationId, warehouseId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.editWarehouse} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.inventoryMaster.errors.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return (
    <WarehouseForm
      organizationId={organizationId}
      mode="edit"
      warehouse={query.data}
    />
  );
}

function WarehouseForm({
  organizationId,
  mode,
  warehouse,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  warehouse?: InventoryWarehouse;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<MasterDataErrorMessage | null>(
    null,
  );

  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: warehouse?.code ?? '',
      name: warehouse?.name ?? '',
      branchId: warehouse?.branchId ?? '',
      allowNegativeStock: warehouse?.allowNegativeStock ?? false,
      reservationsReduceAvailable:
        warehouse?.reservationsReduceAvailable ?? true,
      accountingPostingMode: warehouse?.accountingPostingMode ?? 'direct_final',
    },
  });

  const branches = useActiveBranchOptions(organizationId);
  const createMutation = useCreateWarehouseMutation(organizationId);
  const updateMutation = useUpdateWarehouseMutation(organizationId);
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
        : masterDataErrorMessage(
            'warehouse',
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
          branchId: values.branchId,
          allowNegativeStock: values.allowNegativeStock,
          reservationsReduceAvailable: values.reservationsReduceAvailable,
          accountingPostingMode: values.accountingPostingMode,
        },
        {
          onSuccess: (created) => {
            showToast({
              kind: 'success',
              message: t.inventoryMaster.warehouseCreated,
            });
            navigate(
              `/app/inventory/warehouses/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
      return;
    }
    const target = warehouse as InventoryWarehouse;
    updateMutation.mutate(
      {
        warehouseId: target.id,
        values: {
          code: values.code,
          name: values.name,
          branchId: values.branchId,
          allowNegativeStock: values.allowNegativeStock,
          reservationsReduceAvailable: values.reservationsReduceAvailable,
          accountingPostingMode: values.accountingPostingMode,
        },
      },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.warehouseUpdated,
          });
          navigate(
            `/app/inventory/warehouses/${encodeURIComponent(updated.id)}`,
          );
        },
        onError,
      },
    );
  });

  return (
    <MasterDataFormShell
      title={
        mode === 'create'
          ? t.inventoryMaster.newWarehouse
          : t.inventoryMaster.editWarehouse
      }
      description={t.inventoryMaster.warehousesDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={
        mode === 'create' ? t.inventoryMaster.create : t.inventoryMaster.update
      }
      cancelTo={
        mode === 'edit' && warehouse !== undefined
          ? `/app/inventory/warehouses/${encodeURIComponent(warehouse.id)}`
          : '/app/inventory/warehouses'
      }
      onSubmit={onSubmit}
      testId="warehouse-form"
    >
      <FormField
        id="warehouse-code"
        label={t.inventoryMaster.code}
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
        id="warehouse-name"
        label={t.inventoryMaster.name}
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
        id="warehouse-branch"
        label={t.inventoryMaster.branch}
        hint={t.inventoryMaster.branchHint}
        error={form.formState.errors.branchId?.message}
      >
        {() => (
          <Select
            disabled={submitting || branches.unavailable}
            {...form.register('branchId')}
          >
            <option value="">{t.inventoryMaster.selectBranch}</option>
            {branches.items.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="warehouse-posting-mode"
        label={t.inventoryMaster.accountingPostingMode}
        hint={t.inventoryMaster.accountingPostingModeHint}
        error={form.formState.errors.accountingPostingMode?.message}
      >
        {() => (
          <Select
            disabled={submitting}
            {...form.register('accountingPostingMode')}
          >
            <option value="direct_final">
              {t.inventoryMaster.postingModes.direct_final}
            </option>
            <option value="draft">
              {t.inventoryMaster.postingModes.draft}
            </option>
          </Select>
        )}
      </FormField>

      <fieldset className="sm:col-span-2 space-y-1.5">
        <legend className="text-sm font-medium text-slate-800">
          {t.inventoryMaster.warehousePolicies}
        </legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              disabled={submitting}
              {...form.register('allowNegativeStock')}
            />
            {t.inventoryMaster.allowNegativeStockPolicy}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              disabled={submitting}
              {...form.register('reservationsReduceAvailable')}
            />
            {t.inventoryMaster.reservationsReduceAvailable}
          </label>
        </div>
        <p className="text-xs text-slate-500">
          {t.inventoryMaster.reservationsReduceAvailableHint}
        </p>
      </fieldset>
    </MasterDataFormShell>
  );
}
