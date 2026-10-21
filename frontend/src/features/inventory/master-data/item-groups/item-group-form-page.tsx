import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { InventoryItemGroup } from '@/api/contracts';
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
import { useActiveItemGroupOptions } from '../master-data-references';
import {
  itemGroupSchema,
  type ItemGroupFormValues,
} from '../master-data-schemas';
import {
  useCreateItemGroupMutation,
  useItemGroupDetail,
  useUpdateItemGroupMutation,
} from './item-group-hooks';

/**
 * Create / edit an item group (`POST /item-groups`, `PATCH /item-groups/:id`).
 *
 * The parent picker offers only ACTIVE groups and excludes the group itself
 * (a group can never be its own parent — the backend refuses the cycle, but
 * the form does not even offer it).
 */

const KNOWN_FIELDS = ['code', 'name', 'parentId'] as const;

export function ItemGroupCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  return <ItemGroupForm organizationId={organizationId} mode="create" />;
}

export function ItemGroupEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { itemGroupId } = useParams<{ itemGroupId: string }>();
  const query = useItemGroupDetail(organizationId, itemGroupId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.editItemGroup} />
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
    <ItemGroupForm
      organizationId={organizationId}
      mode="edit"
      group={query.data}
    />
  );
}

function ItemGroupForm({
  organizationId,
  mode,
  group,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  group?: InventoryItemGroup;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<MasterDataErrorMessage | null>(
    null,
  );

  const form = useForm<ItemGroupFormValues>({
    resolver: zodResolver(itemGroupSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: group?.code ?? '',
      name: group?.name ?? '',
      parentId: group?.parentId ?? '',
    },
  });

  const parents = useActiveItemGroupOptions(organizationId);
  const createMutation = useCreateItemGroupMutation(organizationId);
  const updateMutation = useUpdateItemGroupMutation(organizationId);
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
            'itemGroup',
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
          ...(values.parentId !== '' ? { parentId: values.parentId } : {}),
        },
        {
          onSuccess: (created) => {
            showToast({
              kind: 'success',
              message: t.inventoryMaster.itemGroupCreated,
            });
            navigate(
              `/app/inventory/item-groups/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
      return;
    }
    const target = group as InventoryItemGroup;
    updateMutation.mutate(
      {
        itemGroupId: target.id,
        values: {
          code: values.code,
          name: values.name,
          parentId: values.parentId === '' ? null : values.parentId,
        },
      },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.itemGroupUpdated,
          });
          navigate(
            `/app/inventory/item-groups/${encodeURIComponent(updated.id)}`,
          );
        },
        onError,
      },
    );
  });

  const selfId = mode === 'edit' ? group?.id : undefined;

  return (
    <MasterDataFormShell
      title={
        mode === 'create'
          ? t.inventoryMaster.newItemGroup
          : t.inventoryMaster.editItemGroup
      }
      description={t.inventoryMaster.itemGroupsDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={
        mode === 'create' ? t.inventoryMaster.create : t.inventoryMaster.update
      }
      cancelTo={
        mode === 'edit' && group !== undefined
          ? `/app/inventory/item-groups/${encodeURIComponent(group.id)}`
          : '/app/inventory/item-groups'
      }
      onSubmit={onSubmit}
      testId="item-group-form"
    >
      <FormField
        id="item-group-code"
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
        id="item-group-name"
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
        id="item-group-parent"
        label={t.inventoryMaster.parentGroup}
        hint={t.inventoryMaster.parentGroupHint}
        error={form.formState.errors.parentId?.message}
      >
        {() => (
          <Select
            disabled={submitting || parents.unavailable}
            {...form.register('parentId')}
          >
            <option value="">{t.inventoryMaster.noParent}</option>
            {parents.items
              .filter((option) => option.id !== selfId)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} — {option.name}
                </option>
              ))}
          </Select>
        )}
      </FormField>
    </MasterDataFormShell>
  );
}
