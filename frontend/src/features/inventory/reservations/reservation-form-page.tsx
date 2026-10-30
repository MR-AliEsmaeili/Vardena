import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { reservationErrorMessage } from './reservation-error-messages';
import { newInventoryOperationKey } from '../inventory-mutations';
import { useInventoryReferences } from '../use-inventory-references';
import { reservationFormSchema } from './reservation-form-schema';
import type { ReservationFormValues } from './reservation-form-schema';
import { useCreateReservationMutation as useCreateReservation } from './reservation-hooks';

const FIELD_LABELS: Record<keyof ReservationFormValues, string> = {
  warehouseId: t.reservations.warehouse,
  itemId: t.reservations.item,
  quantity: t.reservations.quantity,
  unitId: t.reservations.unit,
  reason: t.reservations.reason,
  referenceType: t.reservations.referenceType,
  referenceId: t.reservations.referenceId,
};

/**
 * Create-only route. Master-data reads have their own permissions; if those
 * references are unavailable this screen says so instead of offering empty or
 * fabricated choices.
 */
export function ReservationFormPage(): ReactElement {
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
        <ReservationFormHeader />
        <ApiErrorAlert
          error={new Error(t.reservations.referencesUnavailable)}
          title={t.reservations.referencesUnavailable}
          description={t.reservations.referencesUnavailable}
          onRetry={references.refetch}
        />
      </div>
    );
  }
  if (
    references.warehouses.length === 0 ||
    references.items.length === 0 ||
    references.units.length === 0
  ) {
    return (
      <div className="space-y-4">
        <ReservationFormHeader />
        <Alert variant="warning">
          <AlertTitle>{t.reservations.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <p>{t.reservations.referencesEmpty}</p>
          </AlertBody>
        </Alert>
      </div>
    );
  }

  return (
    <ReservationForm organizationId={organizationId} references={references} />
  );
}

function ReservationFormHeader() {
  const permissions = usePermissions();
  return (
    <FormPageHeader
      title={t.reservations.createTitle}
      description={t.reservations.createDescription}
      backTo={
        permissions.has(PERMISSIONS.inventory.reservationView)
          ? '/app/inventory/reservations'
          : '/app/inventory'
      }
    />
  );
}

function ReservationForm({
  organizationId,
  references,
}: {
  organizationId: string;
  references: ReturnType<typeof useInventoryReferences>;
}): ReactElement {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const canViewConversions = permissions.has(
    PERMISSIONS.inventory.unitConversionView,
  );
  const form = useForm<ReservationFormValues>({
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
  const { register, watch, setValue, formState } = form;
  const itemId = watch('itemId');
  const selectedItem = references.itemById(itemId);
  const formId = useId().replaceAll(':', '');
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const operationKeyRef = useRef(newInventoryOperationKey());
  const submittedIntentRef = useRef<string | null>(null);
  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);
  const mutation = useCreateReservation(organizationId);
  const submitting = mutation.isPending;

  // Selecting an item defaults to its base unit. The form does not calculate
  // a factor or base quantity; the server resolves it for its current business
  // day and returns the exact values.
  useEffect(() => {
    if (selectedItem === undefined) return;
    setValue('unitId', selectedItem.baseUnitId, {
      shouldValidate: formState.isSubmitted,
    });
  }, [formState.isSubmitted, selectedItem, setValue]);

  // A dirty workspace form protects both dock-window close and browser unload.
  useEffect(() => {
    if (!formState.isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [formState.isDirty]);
  useWorkspaceWindowDirty(formState.isDirty);

  const availableUnits =
    selectedItem === undefined
      ? []
      : references.units.filter(
          (unit) => canViewConversions || unit.id === selectedItem.baseUnitId,
        );
  const fieldId = (field: keyof ReservationFormValues) =>
    `reservation-${formId}-${field}`;
  const validationIssues = Object.entries(formState.errors).flatMap(
    ([field, error]) => {
      if (error === undefined || typeof error.message !== 'string') return [];
      return [
        {
          field: field as keyof ReservationFormValues,
          message: error.message,
        },
      ];
    },
  );

  function submit(values: ReservationFormValues) {
    if (submitting) return;
    setServerError(null);
    const body = {
      warehouseId: values.warehouseId,
      itemId: values.itemId,
      quantity: values.quantity,
      unitId: values.unitId,
      ...(values.reason.trim() !== '' ? { reason: values.reason.trim() } : {}),
      ...(values.referenceType.trim() !== ''
        ? {
            referenceType: values.referenceType.trim(),
            referenceId: values.referenceId.trim(),
          }
        : {}),
    };
    const intent = JSON.stringify(body);
    if (
      submittedIntentRef.current !== null &&
      submittedIntentRef.current !== intent
    ) {
      operationKeyRef.current = newInventoryOperationKey();
    }
    submittedIntentRef.current = intent;

    mutation.mutate(
      { ...body, operationKey: operationKeyRef.current },
      {
        onSuccess: (reservation) => {
          operationKeyRef.current = newInventoryOperationKey();
          submittedIntentRef.current = null;
          form.reset();
          showToast({
            kind: 'success',
            message: t.reservations.createdSuccess,
          });
          navigate(
            permissions.has(PERMISSIONS.inventory.reservationView)
              ? `/app/inventory/reservations/${reservation.id}`
              : '/app/inventory',
          );
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          setServerError({
            error,
            message: reservationErrorMessage('create', error).message,
          });
        },
      },
    );
  }

  const handleSubmit = form.handleSubmit(submit, () => {
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  });

  return (
    <div className="space-y-4">
      <ReservationFormHeader />
      {serverError !== null ? (
        <div aria-live="polite">
          <ApiErrorAlert
            error={serverError.error}
            title={t.reservations.saveFailed}
            description={serverError.message}
          />
        </div>
      ) : null}
      {validationIssues.length > 0 && formState.isSubmitted ? (
        <div
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink focus-visible:outline"
          data-testid="reservation-error-summary"
        >
          <p className="font-semibold">{t.reservations.validationSummary}</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {validationIssues.map(({ field, message }) => (
              <li key={field}>
                <a className="underline" href={`#${fieldId(field)}`}>
                  {FIELD_LABELS[field]} — {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        className="space-y-4 rounded-card border border-line bg-surface p-4"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        onChange={() => setServerError(null)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={fieldId('warehouseId')}
            label={t.reservations.warehouse}
            error={formState.errors.warehouseId?.message}
            required
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
            id={fieldId('itemId')}
            label={t.reservations.item}
            error={formState.errors.itemId?.message}
            required
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
            id={fieldId('quantity')}
            label={t.reservations.quantity}
            error={formState.errors.quantity?.message}
            hint={t.reservations.quantityHint}
            required
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
            id={fieldId('unitId')}
            label={t.reservations.unit}
            error={formState.errors.unitId?.message}
            hint={t.reservations.conversionHint}
            required
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                {...register('unitId')}
                disabled={selectedItem === undefined}
              >
                <option value="">{t.filters.select}</option>
                {availableUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} — {unit.name}
                    {unit.id === selectedItem?.baseUnitId
                      ? ` (${t.reservations.baseUnit})`
                      : ''}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {!canViewConversions ? (
            <p className="text-xs leading-5 text-ink-subtle sm:col-span-2">
              {t.reservations.conversionPermissionHint}
            </p>
          ) : null}
          <FormField
            id={fieldId('reason')}
            label={t.reservations.reason}
            error={formState.errors.reason?.message}
            hint={t.reservations.reasonHint}
          >
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                {...register('reason')}
                maxLength={500}
                rows={3}
              />
            )}
          </FormField>

          <FormField
            id={fieldId('referenceType')}
            label={t.reservations.referenceType}
            error={formState.errors.referenceType?.message}
            hint={t.reservations.referenceTypeHint}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register('referenceType')}
                maxLength={64}
              />
            )}
          </FormField>

          <FormField
            id={fieldId('referenceId')}
            label={t.reservations.referenceId}
            error={formState.errors.referenceId?.message}
            hint={t.reservations.referenceTypeHint}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register('referenceId')}
                maxLength={128}
                dir="ltr"
              />
            )}
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={submitting} loading={submitting}>
            {submitting ? t.loading.saving : t.reservations.newReservation}
          </Button>
          <span className="text-xs text-ink-subtle">
            {t.reservations.createDescription}
          </span>
        </div>
      </form>
    </div>
  );
}
