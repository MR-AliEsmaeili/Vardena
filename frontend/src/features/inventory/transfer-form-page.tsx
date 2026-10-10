import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { ArrowRight } from 'lucide-react';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import {
  todayBusinessDay,
  toBusinessDateInput,
  useTimeZone,
} from '@/lib/datetime';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DateInput } from '@/ui/patterns/date-input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/patterns/toast';
import {
  applyServerValidationToForm,
  inventoryErrorMessage,
} from './inventory-error-messages';
import {
  newInventoryOperationKey,
  usePostTransferMutation,
} from './inventory-mutations';
import { transferFormSchema } from './transfer-form-schema';
import type { TransferFormValues } from './transfer-form-schema';
import { useInventoryReferences } from './use-inventory-references';

/**
 * The warehouse-to-warehouse transfer form.
 *
 * A transfer is ONE atomic operation with two legs — it is not a delete plus
 * a re-post. Two backend contracts shape this form:
 *
 * - **No cost anywhere.** Neither leg is priced by the operator; value
 *   follows the moving-average mechanism of each key (OD-VAL-08/09).
 * - **A backdated transfer is valued, but only once confirmed.** The
 *   backend answers a transfer dated before the latest movement on either
 *   key with the shared refusal (`inventory.backdated_document`, C-59C) until
 *   the caller confirms it; the confirmed command replays BOTH keys together
 *   and needs the valuation authority. This surface has no confirmation
 *   dialog yet (recorded follow-up), so it renders the refusal as a business
 *   error and offers no bypass.
 */

export function TransferFormPage(): ReactElement {
  const organizationId = useOrganizationId();
  const references = useInventoryReferences(organizationId);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }
  if (references.isLoading) {
    return <LoadingState rows={6} label={t.filters.referencesLoading} />;
  }
  if (references.isFailed) {
    return (
      <div className="space-y-4">
        <TransferFormHeader />
        <ApiErrorAlert
          error={new Error(t.inventory.referencesLoadingFailed)}
          title={t.inventory.referencesLoadingFailed}
          onRetry={references.refetch}
        />
      </div>
    );
  }
  if (references.warehouses.length < 2 || references.items.length === 0) {
    return (
      <div className="space-y-4">
        <TransferFormHeader />
        <Alert variant="warning">
          <AlertTitle>{t.inventory.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <p>{t.inventory.referencesUnavailable}</p>
          </AlertBody>
        </Alert>
      </div>
    );
  }

  return (
    <TransferForm organizationId={organizationId} references={references} />
  );
}

function TransferFormHeader() {
  return (
    <PageHeader
      title={t.inventory.newTransfer}
      description={t.inventory.newTransferDescription}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/app/inventory/movements">
            {t.inventory.movementsTitle}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      }
    />
  );
}

function TransferForm({
  organizationId,
  references,
}: {
  organizationId: string;
  references: ReturnType<typeof useInventoryReferences>;
}): ReactElement {
  const timeZone = useTimeZone();
  const { showToast } = useToast();
  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      sourceWarehouseId: '',
      destinationWarehouseId: '',
      itemId: '',
      quantity: '',
      unitId: '',
      movementDate: todayBusinessDay(timeZone),
      reason: '',
    },
  });
  const { register, watch, setValue, formState } = form;
  const itemId = watch('itemId');
  const selectedItem = references.itemById(itemId);

  // The unit defaults to the item's base unit (see the movement form).
  useEffect(() => {
    if (selectedItem === undefined) return;
    setValue('unitId', selectedItem.baseUnitId, {
      shouldValidate: formState.isSubmitted,
    });
  }, [selectedItem, setValue, formState.isSubmitted]);

  const transferMutation = usePostTransferMutation(organizationId);
  const submitting = transferMutation.isPending;
  const operationKeyRef = useRef(newInventoryOperationKey());
  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    transferMutation.mutate(
      {
        values: {
          sourceWarehouseId: values.sourceWarehouseId,
          destinationWarehouseId: values.destinationWarehouseId,
          itemId: values.itemId,
          quantity: values.quantity,
          unitId: values.unitId,
          ...(values.movementDate !== ''
            ? {
                // OQ-73 / ADR-0044: send the BusinessDate in the fixed Jalali-first
                // form when renderable; preserve canonical Gregorian fallback.
                movementDate: toBusinessDateInput(values.movementDate),
              }
            : {}),
          ...(values.reason.trim() !== ''
            ? { reason: values.reason.trim() }
            : {}),
        },
        operationKey: operationKeyRef.current,
      },
      {
        onSuccess: () => {
          showToast({
            kind: 'success',
            message: t.inventory.transferCreated,
          });
          operationKeyRef.current = newInventoryOperationKey();
          form.reset({
            sourceWarehouseId: '',
            destinationWarehouseId: '',
            itemId: '',
            quantity: '',
            unitId: '',
            movementDate: values.movementDate,
            reason: '',
          });
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          const validation = applyServerValidationToForm(error, form, null);
          const message = inventoryErrorMessage('postTransfer', error);
          if (validation === null || !validation.mappedToFields) {
            setServerError({ error, message: message.message });
          }
        },
      },
    );
  });

  return (
    <div className="space-y-4">
      <TransferFormHeader />

      <form
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
      >
        {serverError !== null && (
          <div aria-live="polite">
            <ApiErrorAlert
              error={serverError.error}
              title={t.errors.title}
              description={serverError.message}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="transfer-source-warehouse"
            label={t.inventory.sourceWarehouse}
            error={formState.errors.sourceWarehouseId?.message}
          >
            {(fieldProps) => (
              <Select {...fieldProps} {...register('sourceWarehouseId')}>
                <option value="">{t.filters.select}</option>
                {references.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="transfer-destination-warehouse"
            label={t.inventory.destinationWarehouse}
            error={formState.errors.destinationWarehouseId?.message}
          >
            {(fieldProps) => (
              <Select {...fieldProps} {...register('destinationWarehouseId')}>
                <option value="">{t.filters.select}</option>
                {references.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="transfer-item"
            label={t.inventory.item}
            error={formState.errors.itemId?.message}
          >
            {(fieldProps) => (
              <Select {...fieldProps} {...register('itemId')}>
                <option value="">{t.filters.select}</option>
                {references.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="transfer-quantity"
            label={t.inventory.quantity}
            error={formState.errors.quantity?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register('quantity')}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.0000"
              />
            )}
          </FormField>

          <FormField
            id="transfer-unit"
            label={t.inventory.unit}
            error={formState.errors.unitId?.message}
            hint={
              selectedItem !== undefined
                ? `${t.inventory.baseUnit}: ${
                    references.unitById(selectedItem.baseUnitId)?.code ??
                    selectedItem.baseUnitId
                  }`
                : undefined
            }
          >
            {(fieldProps) => (
              <Select {...fieldProps} {...register('unitId')}>
                <option value="">{t.filters.select}</option>
                {references.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} — {unit.name}
                    {selectedItem !== undefined &&
                    unit.id === selectedItem.baseUnitId
                      ? ` (${t.inventory.baseUnit})`
                      : ''}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="transfer-date"
            label={t.inventory.movementDate}
            error={formState.errors.movementDate?.message}
            hint={t.inventory.movementDateHint}
          >
            {(fieldProps) => (
              <Controller
                control={form.control}
                name="movementDate"
                render={({ field }) => (
                  <DateInput
                    {...fieldProps}
                    id="transfer-date"
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                )}
              />
            )}
          </FormField>

          <FormField
            id="transfer-reason"
            label={t.inventory.reason}
            error={formState.errors.reason?.message}
            hint={t.inventory.reasonOptionalHint}
          >
            {(fieldProps) => <Input {...fieldProps} {...register('reason')} />}
          </FormField>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? t.inventory.submitting : t.inventory.submitTransfer}
          </Button>
        </div>
      </form>
    </div>
  );
}
