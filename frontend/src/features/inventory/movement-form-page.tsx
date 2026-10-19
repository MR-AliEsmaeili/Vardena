import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { ArrowRight } from 'lucide-react';
import { checkInventoryBackdate } from '@/api/inventory.api';
import { normalizeApiError } from '@/api/errors';
import type { PostInventoryMovementInput } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatQuantity } from '@/lib/format';
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
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/patterns/toast';
import {
  BackdateDialogs,
  type BackdateAssessment,
  type BackdateDecision,
} from './backdate-dialogs';
import {
  applyServerValidationToForm,
  inventoryErrorMessage,
  isBackdateRefusal,
} from './inventory-error-messages';
import {
  newInventoryOperationKey,
  usePostMovementMutation,
  useRecalculateMutation,
} from './inventory-mutations';
import {
  movementTypeForKind,
  receiptFormSchema,
  type MovementFormKind,
} from './movement-form-schema';
import type { ReceiptFormValues } from './movement-form-schema';
import { useInventoryReferences } from './use-inventory-references';

/**
 * The receipt/issue posting form (single-warehouse movements).
 *
 * Contract rules implemented here:
 * - **Cost is optional on a receipt** (OD-VAL-05): a warehouse user posts
 *   without any price; the field exists ONLY for sessions holding
 *   `Inventory.Valuation.AssignCost`, and an issue has NO cost field at all
 *   (OD-VAL-07 — issue value comes from the backend's valuation method and
 *   is never typed by an operator).
 * - **Backdating is a two-step explicit decision** (OD-VAL-10/OD-VAL-11): on
 *   submit the form first asks the backend what the date would disturb
 *   (`backdate-check` — counts and dates only), explains it in step 1, takes
 *   the repricing choice in step 2 with NO default, and only then posts with
 *   `backdateConfirmed: true` + the chosen `repricing`. Nothing is ever
 *   repriced silently; the POST-side 422 refusals open the same dialogs when
 *   a race changed the answer between check and post.
 * - **Idempotency**: one operationKey per form intent, reused across the
 *   dialog round-trips (the backend excludes the backdate answers from its
 *   request hash) and across manual retries; a fresh key is minted only
 *   after a success.
 * - **«انجام نشود» is honest**: after a skip the page keeps a persistent
 *   stale-valuation notice with an explicit قیمت‌گذاری مجدد action (or a
 *   disabled one when the session may not recalculate) — never hidden.
 */

/** One form type for both kinds; an issue simply never renders the cost field. */
type MovementFormValues = ReceiptFormValues;

type MovementBody = Omit<
  PostInventoryMovementInput,
  'organizationId' | 'operationKey'
>;

export function MovementFormPage(): ReactElement {
  const organizationId = useOrganizationId();
  const [params] = useSearchParams();
  const kindParam = params.get('type') ?? 'receipt';
  const kind: MovementFormKind = kindParam === 'issue' ? 'issue' : 'receipt';

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
        <MovementFormHeader kind={kind} />
        <ApiErrorAlert
          error={new Error(t.inventory.referencesLoadingFailed)}
          title={t.inventory.referencesLoadingFailed}
          onRetry={references.refetch}
        />
      </div>
    );
  }
  if (references.warehouses.length === 0 || references.items.length === 0) {
    return (
      <div className="space-y-4">
        <MovementFormHeader kind={kind} />
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
    <MovementForm
      organizationId={organizationId}
      kind={kind}
      references={references}
    />
  );
}

function MovementFormHeader({ kind }: { kind: MovementFormKind }) {
  return (
    <PageHeader
      title={kind === 'receipt' ? t.inventory.newReceipt : t.inventory.newIssue}
      description={
        kind === 'receipt'
          ? t.inventory.newReceiptDescription
          : t.inventory.newIssueDescription
      }
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

function MovementForm({
  organizationId,
  kind,
  references,
}: {
  organizationId: string;
  kind: MovementFormKind;
  references: ReturnType<typeof useInventoryReferences>;
}): ReactElement {
  const timeZone = useTimeZone();
  const { showToast } = useToast();
  const permissions = usePermissions();
  // Cost entry is gated by the backend's own permission (UX only — the API
  // re-authorizes regardless, AR-21). An issue never shows the field at all.
  const mayAssignCost = permissions.has(
    PERMISSIONS.inventory.valuationAssignCost,
  );
  const mayRecalculate = permissions.has(
    PERMISSIONS.inventory.valuationRecalculate,
  );

  const form = useForm<MovementFormValues>({
    resolver: zodResolver(receiptFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      itemId: '',
      warehouseId: '',
      quantity: '',
      unitId: '',
      movementDate: todayBusinessDay(timeZone),
      reason: '',
      totalCost: '',
    },
  });
  const { register, watch, setValue, formState } = form;
  const itemId = watch('itemId');
  const selectedItem = references.itemById(itemId);

  // Selecting an item defaults the unit to the item's base unit (the
  // operator may still pick another one; the backend resolves the conversion
  // in force at the business date or refuses — never silently).
  useEffect(() => {
    if (selectedItem === undefined) return;
    setValue('unitId', selectedItem.baseUnitId, {
      shouldValidate: formState.isSubmitted,
    });
  }, [selectedItem, setValue, formState.isSubmitted]);

  const postMutation = usePostMovementMutation(organizationId);
  const recalculateMutation = useRecalculateMutation(organizationId);
  const submitting = postMutation.isPending;

  // One idempotency key per form intent, reused across retries and the
  // backdate dialog round-trips; minted anew only after a success.
  const operationKeyRef = useRef(newInventoryOperationKey());
  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);
  const [backdateAssessment, setBackdateAssessment] =
    useState<BackdateAssessment | null>(null);
  const [pendingValues, setPendingValues] = useState<MovementFormValues | null>(
    null,
  );
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** The skip decision of the last successful posting (stale notice). */
  const [staleNotice, setStaleNotice] = useState<{
    itemId: string;
    warehouseId: string;
  } | null>(null);
  const [recalculateConfirm, setRecalculateConfirm] = useState(false);
  const [recalculateError, setRecalculateError] = useState<string | null>(null);

  const buildBody = (
    values: MovementFormValues,
    decision: BackdateDecision,
  ): MovementBody => {
    const base: MovementBody = {
      warehouseId: values.warehouseId,
      itemId: values.itemId,
      movementType: movementTypeForKind(kind),
      quantity: values.quantity,
      unitId: values.unitId,
      ...(values.movementDate !== ''
        ? {
            // OQ-73 / ADR-0044: send the BusinessDate in the fixed Jalali-first
            // form when renderable; preserve canonical Gregorian fallback.
            movementDate: toBusinessDateInput(values.movementDate),
          }
        : {}),
      ...(values.reason.trim() !== '' ? { reason: values.reason.trim() } : {}),
    };
    // Cost travels only on a receipt, only when the session may assign one,
    // and only when the operator actually typed an amount (OD-VAL-05/07).
    const cost =
      kind === 'receipt' && mayAssignCost && values.totalCost !== ''
        ? { totalCost: values.totalCost }
        : {};
    const backdate =
      decision === null
        ? {}
        : { backdateConfirmed: true, repricing: decision.repricing };
    return { ...base, ...cost, ...backdate };
  };

  const post = (values: MovementFormValues, decision: BackdateDecision) => {
    setServerError(null);
    setDialogError(null);
    postMutation.mutate(
      {
        values: buildBody(values, decision),
        operationKey: operationKeyRef.current,
      },
      {
        onSuccess: (movement) => {
          showToast({
            kind: 'success',
            message:
              kind === 'receipt'
                ? t.inventory.receiptCreated
                : t.inventory.issueCreated,
          });
          // A fresh intent needs a fresh idempotency key.
          operationKeyRef.current = newInventoryOperationKey();
          form.reset({
            itemId: '',
            warehouseId: '',
            quantity: '',
            unitId: '',
            movementDate: values.movementDate,
            reason: '',
            totalCost: '',
          });
          setBackdateAssessment(null);
          setPendingValues(null);
          setDialogError(null);
          // «انجام نشود» keeps an honest, persistent stale notice.
          if (decision !== null && decision.repricing === 'skip') {
            setStaleNotice({
              itemId: movement.itemId,
              warehouseId: movement.warehouseId,
            });
          } else {
            setStaleNotice(null);
          }
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;

          // A backdating refusal (a fresh one, or a check→post race) opens
          // the two-step dialogs with the measured facts — never a raw error.
          if (
            apiError.code === 'BusinessRuleViolation' &&
            isBackdateRefusal(apiError.details)
          ) {
            const details = apiError.details;
            setBackdateAssessment({
              affectedMovements: details.affectedMovements,
              affectedValuedMovements: details.affectedValuedMovements,
              latestMovementDate: details.latestMovementDate,
              alreadyStale: details.alreadyStale,
            });
            setDialogError(null);
            return;
          }

          const validation = applyServerValidationToForm(
            error,
            form,
            kind === 'receipt' && mayAssignCost ? 'totalCost' : null,
          );
          const message = inventoryErrorMessage('postMovement', error);

          if (backdateAssessment !== null || pendingValues !== null) {
            // The failure happened inside the two-step flow: the dialog
            // stays open and the error renders inside it (FE-UX-02 §12.6).
            setDialogError(message.message);
            return;
          }
          if (validation === null || !validation.mappedToFields) {
            setServerError({ error, message: message.message });
          }
        },
      },
    );
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (submitting) return;
    setServerError(null);
    setStaleNotice(null);
    setPendingValues(values);

    // Pre-submit consequence preview (counts and dates only, gated by the
    // poster's own Movement.Create permission — FE-UX-02 §5.4). A failed
    // check never blocks the posting: the POST's own transactional gate
    // stays authoritative and re-opens these dialogs if needed.
    if (values.movementDate !== '') {
      try {
        const check = await checkInventoryBackdate({
          organizationId,
          warehouseId: values.warehouseId,
          itemId: values.itemId,
          // The backdate-check filter takes a strict canonical day.
          movementDate: values.movementDate,
        });
        if (check.backdated) {
          setBackdateAssessment({
            affectedMovements: check.affectedMovements,
            affectedValuedMovements: check.affectedValuedMovements,
            latestMovementDate: check.latestMovementDate,
            alreadyStale: check.alreadyStale,
          });
          return;
        }
      } catch {
        // The preview is a courtesy; the posting path re-detects
        // backdating transactionally. Fall through and post.
      }
    }

    post(values, null);
  });

  const onBackdateDecision = (decision: BackdateDecision) => {
    if (decision === null) {
      setBackdateAssessment(null);
      setPendingValues(null);
      setDialogError(null);
      return;
    }
    if (pendingValues === null) return;
    post(pendingValues, decision);
  };

  const runRecalculate = () => {
    if (staleNotice === null) return;
    setRecalculateError(null);
    recalculateMutation.mutate(
      {
        warehouseId: staleNotice.warehouseId,
        itemId: staleNotice.itemId,
        operationKey: newInventoryOperationKey(),
      },
      {
        onSuccess: (result) => {
          showToast({
            kind: 'success',
            message: `${t.inventory.recalculationDone} ${formatQuantity(
              String(result.run.movementsRevalued),
            )} ${t.inventory.recalculationDoneCount}`,
          });
          setStaleNotice(null);
          setRecalculateConfirm(false);
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          setRecalculateError(
            inventoryErrorMessage('recalculate', error).message,
          );
        },
      },
    );
  };

  const staleItem =
    staleNotice === null ? undefined : references.itemById(staleNotice.itemId);
  const staleWarehouse =
    staleNotice === null
      ? undefined
      : references.warehouseById(staleNotice.warehouseId);

  return (
    <div className="space-y-4">
      <MovementFormHeader kind={kind} />

      {staleNotice !== null && (
        <Alert variant="warning" role="alert">
          <AlertTitle>{t.inventory.staleNoticeTitle}</AlertTitle>
          <AlertBody>
            <p>{t.inventory.staleNoticeBody}</p>
            <p className="mt-2 text-xs">
              {t.inventory.item}:{' '}
              {staleItem === undefined
                ? '—'
                : `${staleItem.code} — ${staleItem.name}`}
              {' · '}
              {t.inventory.warehouse}:{' '}
              {staleWarehouse === undefined
                ? '—'
                : `${staleWarehouse.code} — ${staleWarehouse.name}`}
            </p>
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                disabled={!mayRecalculate || recalculateMutation.isPending}
                title={
                  mayRecalculate
                    ? undefined
                    : t.inventory.errors.recalculatePermission
                }
                onClick={() => setRecalculateConfirm(true)}
              >
                {t.inventory.staleNoticeRecalculate}
              </Button>
            </div>
            {recalculateError !== null && (
              <p role="alert" className="mt-2 text-xs text-rose-700">
                {recalculateError}
              </p>
            )}
          </AlertBody>
        </Alert>
      )}

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
            id="movement-item"
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
            id="movement-warehouse"
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
            id="movement-quantity"
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
            id="movement-unit"
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
            id="movement-date"
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
                    id="movement-date"
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                )}
              />
            )}
          </FormField>

          {kind === 'receipt' && mayAssignCost && (
            <FormField
              id="movement-total-cost"
              label={t.inventory.totalCost}
              error={formState.errors.totalCost?.message}
              hint={t.inventory.totalCostHint}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...register('totalCost')}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0.00"
                />
              )}
            </FormField>
          )}

          <FormField
            id="movement-reason"
            label={t.inventory.reason}
            error={formState.errors.reason?.message}
            hint={t.inventory.reasonOptionalHint}
          >
            {(fieldProps) => <Input {...fieldProps} {...register('reason')} />}
          </FormField>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submitting} loading={submitting}>
            {submitting
              ? t.inventory.submitting
              : kind === 'receipt'
                ? t.inventory.submitReceipt
                : t.inventory.submitIssue}
          </Button>
        </div>
      </form>

      <BackdateDialogs
        assessment={backdateAssessment}
        loading={submitting}
        error={dialogError !== null ? <span>{dialogError}</span> : undefined}
        onDecide={onBackdateDecision}
      />

      <ConfirmDialog
        open={recalculateConfirm}
        title={t.inventory.recalculateTitle}
        description={<p>{t.inventory.recalculateBody}</p>}
        confirmLabel={t.inventory.recalculateSubmit}
        loading={recalculateMutation.isPending}
        loadingLabel={t.inventory.recalculateSubmitting}
        error={
          recalculateError !== null ? (
            <span>{recalculateError}</span>
          ) : undefined
        }
        onConfirm={runRecalculate}
        onCancel={() => {
          setRecalculateConfirm(false);
          setRecalculateError(null);
        }}
      />
    </div>
  );
}
