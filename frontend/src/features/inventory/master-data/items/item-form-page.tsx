import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { InventoryItem } from '@/api/contracts';
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
import {
  useActiveItemGroupOptions,
  useActiveUnitOptions,
} from '../master-data-references';
import {
  itemSchema,
  ITEM_KINDS,
  type ItemFormValues,
} from '../master-data-schemas';
import {
  useCreateItemMutation,
  useItemDetail,
  useUpdateItemMutation,
} from './item-hooks';

/**
 * Create / edit an item (`POST /items`, `PATCH /items/:id`).
 *
 * `itemKind` is a creation-time choice: the backend stores kind-derived
 * defaults once and refuses to re-run them over deliberately-set flags, so
 * the edit form shows the kind read-only. Clearing the group or the
 * negative-stock override is a legal update (null clears), which the
 * "follow warehouse policy" option expresses for the override.
 */

const KNOWN_FIELDS = [
  'code',
  'name',
  'description',
  'baseUnitId',
  'itemGroupId',
  'barcode',
] as const;

export function ItemCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={8} label={t.app.loading} />;
  }
  return <ItemForm organizationId={organizationId} mode="create" />;
}

export function ItemEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { itemId } = useParams<{ itemId: string }>();
  const query = useItemDetail(organizationId, itemId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={8} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.editItem} />
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
    <ItemForm organizationId={organizationId} mode="edit" item={query.data} />
  );
}

function ItemForm({
  organizationId,
  mode,
  item,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  item?: InventoryItem;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<MasterDataErrorMessage | null>(
    null,
  );

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      itemKind: item?.itemKind ?? 'goods',
      itemGroupId: item?.itemGroupId ?? '',
      baseUnitId: item?.baseUnitId ?? '',
      isStockable: item?.isStockable ?? true,
      isPurchasable: item?.isPurchasable ?? true,
      isSellable: item?.isSellable ?? true,
      isValued: item?.isValued ?? true,
      requiresLot: item?.requiresLot ?? false,
      requiresSerial: item?.requiresSerial ?? false,
      requiresExpiry: item?.requiresExpiry ?? false,
      negativeStock:
        item?.allowNegativeStock === null || item === undefined
          ? 'follow'
          : item.allowNegativeStock
            ? 'allow'
            : 'forbid',
      barcode: item?.barcode ?? '',
    },
  });

  const units = useActiveUnitOptions(organizationId);
  const groups = useActiveItemGroupOptions(organizationId);
  const createMutation = useCreateItemMutation(organizationId);
  const updateMutation = useUpdateItemMutation(organizationId);
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
            'item',
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
          // Omitted = "take the kind's default" (and absent values in general).
          ...(values.description !== ''
            ? { description: values.description }
            : {}),
          itemKind: values.itemKind,
          ...(values.itemGroupId !== ''
            ? { itemGroupId: values.itemGroupId }
            : {}),
          baseUnitId: values.baseUnitId,
          isStockable: values.isStockable,
          isPurchasable: values.isPurchasable,
          isSellable: values.isSellable,
          isValued: values.isValued,
          requiresLot: values.requiresLot,
          requiresSerial: values.requiresSerial,
          requiresExpiry: values.requiresExpiry,
          ...(values.negativeStock !== 'follow'
            ? { allowNegativeStock: values.negativeStock === 'allow' }
            : {}),
          ...(values.barcode !== '' ? { barcode: values.barcode } : {}),
        },
        {
          onSuccess: (created) => {
            showToast({
              kind: 'success',
              message: t.inventoryMaster.itemCreated,
            });
            navigate(`/app/inventory/items/${encodeURIComponent(created.id)}`);
          },
          onError,
        },
      );
      return;
    }
    const target = item as InventoryItem;
    updateMutation.mutate(
      {
        itemId: target.id,
        values: {
          code: values.code,
          name: values.name,
          // The service stores what it receives: '' clears the free texts,
          // null clears the group and the override (documented semantics).
          description: values.description,
          itemGroupId: values.itemGroupId === '' ? null : values.itemGroupId,
          baseUnitId: values.baseUnitId,
          isStockable: values.isStockable,
          isPurchasable: values.isPurchasable,
          isSellable: values.isSellable,
          isValued: values.isValued,
          requiresLot: values.requiresLot,
          requiresSerial: values.requiresSerial,
          requiresExpiry: values.requiresExpiry,
          allowNegativeStock:
            values.negativeStock === 'follow'
              ? null
              : values.negativeStock === 'allow',
          barcode: values.barcode,
          // itemKind is intentionally absent — immutable after creation.
        },
      },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: t.inventoryMaster.itemUpdated,
          });
          navigate(`/app/inventory/items/${encodeURIComponent(updated.id)}`);
        },
        onError,
      },
    );
  });

  const isStockable = form.watch('isStockable');

  return (
    <MasterDataFormShell
      title={
        mode === 'create'
          ? t.inventoryMaster.newItem
          : t.inventoryMaster.editItem
      }
      description={t.inventoryMaster.itemsDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={
        mode === 'create' ? t.inventoryMaster.create : t.inventoryMaster.update
      }
      cancelTo={
        mode === 'edit' && item !== undefined
          ? `/app/inventory/items/${encodeURIComponent(item.id)}`
          : '/app/inventory/items'
      }
      onSubmit={onSubmit}
      testId="item-form"
    >
      <FormField
        id="item-code"
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
        id="item-name"
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
        id="item-kind"
        label={t.inventoryMaster.itemKind}
        hint={
          mode === 'edit' ? t.inventoryMaster.itemKindImmutableHint : undefined
        }
        error={form.formState.errors.itemKind?.message}
      >
        {() => (
          <Select
            disabled={mode === 'edit' || submitting}
            {...form.register('itemKind')}
          >
            {ITEM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.inventoryMaster.itemKinds[kind]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="item-base-unit"
        label={t.inventoryMaster.baseUnit}
        hint={
          units.unavailable || units.items.length === 0
            ? t.inventoryMaster.unitMissingHint
            : t.inventoryMaster.baseUnitHint
        }
        error={form.formState.errors.baseUnitId?.message}
      >
        {() => (
          <Select
            disabled={submitting || units.unavailable}
            {...form.register('baseUnitId')}
          >
            <option value="">{t.inventoryMaster.selectUnit}</option>
            {units.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} — {unit.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="item-group"
        label={t.inventoryMaster.itemGroup}
        hint={t.inventoryMaster.noItemGroupHint}
        error={form.formState.errors.itemGroupId?.message}
      >
        {() => (
          <Select
            disabled={submitting || groups.unavailable}
            {...form.register('itemGroupId')}
          >
            <option value="">{t.inventoryMaster.noItemGroup}</option>
            {groups.items.map((group) => (
              <option key={group.id} value={group.id}>
                {group.code} — {group.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="item-negative-stock"
        label={t.inventoryMaster.allowNegativeStockPolicy}
        hint={t.inventoryMaster.allowNegativeStockHint}
      >
        {() => (
          <Select disabled={submitting} {...form.register('negativeStock')}>
            <option value="follow">
              {t.inventoryMaster.negativeStockFollow}
            </option>
            <option value="allow">
              {t.inventoryMaster.negativeStockAllow}
            </option>
            <option value="forbid">
              {t.inventoryMaster.negativeStockForbid}
            </option>
          </Select>
        )}
      </FormField>

      <FormField
        id="item-barcode"
        label={t.inventoryMaster.barcode}
        error={form.formState.errors.barcode?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            disabled={submitting}
            {...form.register('barcode')}
          />
        )}
      </FormField>

      <FormField
        id="item-description"
        label={t.inventoryMaster.description}
        error={form.formState.errors.description?.message}
        className="sm:col-span-2"
      >
        {(fieldProps) => (
          <textarea
            {...fieldProps}
            rows={3}
            disabled={submitting}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            {...form.register('description')}
          />
        )}
      </FormField>

      <fieldset className="sm:col-span-2 space-y-1.5">
        <legend className="text-sm font-medium text-ink">
          {t.inventoryMaster.capabilities}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['isStockable', t.inventoryMaster.isStockable],
              ['isPurchasable', t.inventoryMaster.isPurchasable],
              ['isSellable', t.inventoryMaster.isSellable],
              ['isValued', t.inventoryMaster.isValued],
              ['requiresLot', t.inventoryMaster.requiresLot],
              ['requiresSerial', t.inventoryMaster.requiresSerial],
              ['requiresExpiry', t.inventoryMaster.requiresExpiry],
            ] as const
          ).map(([name, label]) => (
            <label
              key={name}
              className="flex items-center gap-2 text-sm text-ink-muted"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line-strong"
                disabled={
                  submitting ||
                  (!isStockable &&
                    (name === 'requiresLot' ||
                      name === 'requiresSerial' ||
                      name === 'requiresExpiry'))
                }
                {...form.register(name)}
              />
              {label}
            </label>
          ))}
        </div>
        {form.formState.errors.isValued?.message !== undefined && (
          <p role="alert" className="text-xs text-danger-ink">
            {form.formState.errors.isValued.message}
          </p>
        )}
        {form.formState.errors.requiresLot?.message !== undefined && (
          <p role="alert" className="text-xs text-danger-ink">
            {form.formState.errors.requiresLot.message}
          </p>
        )}
      </fieldset>
    </MasterDataFormShell>
  );
}
