import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { useToast } from '@/ui/patterns/toast';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import type { CreateReservationInput } from '@/api/inventory.api';
import { newInventoryOperationKey } from '../inventory-mutations';
import { useCreateReservationMutation } from './reservation-hooks';
import {
  reservationErrorMessage,
  applyServerValidationToForm,
} from './reservation-error-messages';
import { normalizeApiError } from '@/api/errors';
import { useInventoryReferences } from '../use-inventory-references';

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;

export const reservationFormSchema = z
  .object({
    warehouseId: z.string().min(1, t.inventory.warehouseRequired),
    itemId: z.string().min(1, t.inventory.itemRequired),
    quantity: z
      .string()
      .min(1, t.inventory.quantityRequired)
      .regex(QUANTITY_PATTERN, t.inventory.quantityPositive)
      .refine(
        (value) => value !== '0' && !/^0+(?:\.0+)?$/.test(value),
        t.inventory.quantityPositive,
      ),
    unitId: z.string().min(1, t.inventory.unitRequired),
    reason: z.string().max(1000),
    referenceType: z.string().optional(),
    referenceId: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasType =
        data.referenceType !== undefined && data.referenceType !== '';
      const hasId = data.referenceId !== undefined && data.referenceId !== '';
      return hasType === hasId;
    },
    { message: t.reservations.errors.referencePairHint, path: ['referenceId'] },
  );

export function ReservationFormPage() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const references = useInventoryReferences(organizationId);
  const createMutation = useCreateReservationMutation(organizationId ?? '');

  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);
  // One idempotency key per create intent, reused across manual retries and
  // minted anew only after success (the backend replays the stored operation).
  const operationKeyRef = useRef(newInventoryOperationKey());

  const form = useForm<z.infer<typeof reservationFormSchema>>({
    resolver: zodResolver(reservationFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      warehouseId: '',
      itemId: '',
      quantity: '',
      unitId: '',
      reason: '',
      referenceType: '',
      referenceId: '',
    },
  });
  const { register, watch, setValue, formState, reset } = form;
  const itemId = watch('itemId');
  const selectedItem = references.itemById(itemId);
  const submitting = createMutation.isPending;

  useEffect(() => {
    if (selectedItem === undefined) return;
    setValue('unitId', selectedItem.baseUnitId, {
      shouldValidate: formState.isSubmitted,
    });
  }, [selectedItem, setValue, formState.isSubmitted]);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }
  if (references.isLoading) {
    return <LoadingState rows={6} label={t.filters.referencesLoading} />;
  }
  if (references.isFailed) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t.reservations.newReservation}
          description={t.reservations.newReservationDescription}
        />
        <ApiErrorAlert
          error={new Error(t.reservations.loadFailed)}
          title={t.errors.title}
          description={t.reservations.loadFailed}
          onRetry={references.refetch}
        />
      </div>
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    createMutation.mutate(
      {
        values: {
          warehouseId: values.warehouseId,
          itemId: values.itemId,
          quantity: values.quantity,
          unitId: values.unitId,
          ...(values.reason.trim() !== ''
            ? { reason: values.reason.trim() }
            : {}),
          ...(values.referenceType !== ''
            ? {
                referenceType: values.referenceType,
                referenceId: values.referenceId,
              }
            : {}),
        } as Omit<CreateReservationInput, 'organizationId' | 'operationKey'>,
        operationKey: operationKeyRef.current,
      },
      {
        onSuccess: (reservation) => {
          operationKeyRef.current = newInventoryOperationKey();
          reset({
            warehouseId: '',
            itemId: '',
            quantity: '',
            unitId: '',
            reason: '',
            referenceType: '',
            referenceId: '',
          });
          showToast({ kind: 'success', message: t.reservations.created });
          navigate(`/app/inventory/reservations/${reservation.id}`);
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          const validation = applyServerValidationToForm(error, form);
          const { message } = reservationErrorMessage(
            'createReservation',
            error,
          );
          if (validation === null || !validation.mappedToFields) {
            setServerError({ error, message });
          }
        },
      },
    );
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.reservations.newReservation}
        description={t.reservations.newReservationDescription}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/inventory/reservations">{t.app.cancel}</Link>
          </Button>
        }
      />
      {serverError !== null && (
        <div aria-live="polite">
          <ApiErrorAlert
            error={serverError.error}
            title={t.errors.title}
            description={serverError.message}
          />
        </div>
      )}
      <form
        className="space-y-4 rounded-lg border border-line bg-surface p-4"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
      >
        <FormField
          id="reservation-warehouse"
          label={t.inventory.warehouse}
          error={formState.errors.warehouseId?.message}
        >
          {(fieldProps) => (
            <Select {...fieldProps} {...register('warehouseId')}>
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
          id="reservation-item"
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
          id="reservation-quantity"
          label={t.reservations.quantity}
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
          id="reservation-unit"
          label={t.reservations.unit}
          error={formState.errors.unitId?.message}
          hint={
            selectedItem === undefined
              ? undefined
              : `${t.inventory.baseUnit}: ${
                  references.unitById(selectedItem.baseUnitId)?.code ??
                  selectedItem.baseUnitId
                }`
          }
        >
          {(fieldProps) => (
            <Select {...fieldProps} {...register('unitId')}>
              <option value="">{t.filters.select}</option>
              {references.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code} — {unit.name}
                  {selectedItem !== undefined &&
                    unit.id === selectedItem.baseUnitId &&
                    ` (${t.inventory.baseUnit})`}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id="reservation-reason"
          label={t.inventory.reason}
          error={formState.errors.reason?.message}
          hint={t.inventory.reasonOptionalHint}
        >
          {(fieldProps) => (
            <textarea
              {...fieldProps}
              {...register('reason')}
              className="input input-bordered w-full min-h-[80px] resize-y"
            />
          )}
        </FormField>

        <fieldset className="border border-line p-3 rounded-lg">
          <legend className="px-2 text-[11px] font-medium text-ink-subtle">
            {t.reservations.reference}
          </legend>
          <p className="text-xs text-ink-subtle">
            {t.reservations.errors.referencePairHint}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="reservation-reference-type"
              label={t.reservations.referenceTypeLabel}
              error={formState.errors.referenceType?.message}
            >
              {(fieldProps) => (
                <Input {...fieldProps} {...register('referenceType')} />
              )}
            </FormField>
            <FormField
              id="reservation-reference-id"
              label={t.reservations.referenceIdLabel}
              error={formState.errors.referenceId?.message}
            >
              {(fieldProps) => (
                <Input {...fieldProps} {...register('referenceId')} />
              )}
            </FormField>
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submitting} loading={submitting}>
            {submitting ? t.inventory.submitting : t.inventoryMaster.create}
          </Button>
        </div>
      </form>
    </div>
  );
}
