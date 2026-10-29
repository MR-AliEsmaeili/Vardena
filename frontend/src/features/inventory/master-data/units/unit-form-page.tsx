import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { InventoryUnit } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  applyServerValidation,
  masterDataErrorMessage,
  type MasterDataErrorMessage,
} from '../master-data-errors';
import { MasterDataFormShell } from '../master-data-form-shell';
import { unitSchema, type UnitFormValues } from '../master-data-schemas';
import {
  useCreateUnitMutation,
  useUnitDetail,
  useUpdateUnitMutation,
} from './unit-hooks';

/**
 * Create / edit a unit (`POST /units`, `PATCH /units/:id`).
 *
 * The edit screen loads the record first (`GET /units/:id`), which is why
 * its route requires `Inventory.Unit.View` in addition to
 * `Inventory.Unit.Edit`; the create route requires only
 * `Inventory.Unit.Create`, exactly like the endpoint.
 */

const KNOWN_FIELDS = ['code', 'name', 'symbol'] as const;

export function UnitCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  return <UnitForm organizationId={organizationId} mode="create" />;
}

export function UnitEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { unitId } = useParams<{ unitId: string }>();
  const query = useUnitDetail(organizationId, unitId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.inventoryMaster.editUnit} />
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
    <UnitForm organizationId={organizationId} mode="edit" unit={query.data} />
  );
}

function UnitForm({
  organizationId,
  mode,
  unit,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  unit?: InventoryUnit;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<MasterDataErrorMessage | null>(
    null,
  );

  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: unit?.code ?? '',
      name: unit?.name ?? '',
      symbol: unit?.symbol ?? '',
    },
  });

  const createMutation = useCreateUnitMutation(organizationId);
  const updateMutation = useUpdateUnitMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const onError = (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.isUnauthorized) return; // owned by the session flow
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
            'unit',
            mode === 'create' ? 'create' : 'update',
            error,
          ),
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return; // duplicate-submit protection
    setServerError(null);
    const payload = {
      code: values.code,
      name: values.name,
      // An empty symbol is the documented absent value, not `''`.
      ...(values.symbol !== '' ? { symbol: values.symbol } : {}),
    };
    if (mode === 'create') {
      createMutation.mutate(payload, {
        onSuccess: (created) => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.unitCreated,
          });
          navigate(`/app/inventory/units/${encodeURIComponent(created.id)}`);
        },
        onError,
      });
      return;
    }
    const target = unit as InventoryUnit;
    updateMutation.mutate(
      {
        unitId: target.id,
        values: {
          code: payload.code,
          name: payload.name,
          symbol: values.symbol,
        },
      },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.unitUpdated,
          });
          navigate(`/app/inventory/units/${encodeURIComponent(updated.id)}`);
        },
        onError,
      },
    );
  });

  return (
    <MasterDataFormShell
      title={
        mode === 'create'
          ? t.inventoryMaster.newUnit
          : t.inventoryMaster.editUnit
      }
      description={t.inventoryMaster.unitsDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={
        mode === 'create' ? t.inventoryMaster.create : t.inventoryMaster.update
      }
      cancelTo={
        mode === 'edit' && unit !== undefined
          ? `/app/inventory/units/${encodeURIComponent(unit.id)}`
          : '/app/inventory/units'
      }
      onSubmit={onSubmit}
      testId="unit-form"
    >
      <FormField
        id="unit-code"
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
        id="unit-name"
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
        id="unit-symbol"
        label={t.inventoryMaster.unitSymbol}
        error={form.formState.errors.symbol?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            disabled={submitting}
            {...form.register('symbol')}
          />
        )}
      </FormField>
    </MasterDataFormShell>
  );
}
