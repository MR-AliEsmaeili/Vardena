import { useEffect, useId, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { useActiveItemOptions } from '@/features/inventory/master-data/master-data-references';
import { useOrganizationId } from '@/features/organization/use-organization';
import { isBusinessDay, todayBusinessDay, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { FormField } from '@/ui/patterns/form-field';
import { JalaliDateInputField } from '@/ui/patterns/jalali-date-input-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { Select } from '@/ui/select';
import { useConfigureValuationMethodMutation } from './use-valuation-methods';
import {
  isValuationMethodImplemented,
  VALUATION_METHODS,
  valuationMethodErrorMessage,
  valuationMethodLabel,
} from './valuation-method-error-messages';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function buildValuationMethodFormSchema(options?: {
  manualItemUlid?: boolean;
}) {
  return z
    .object({
      itemId: z
        .string()
        .trim()
        .min(1, t.inventoryValuationMethods.validation.itemRequired)
        .refine(
          (val) => !options?.manualItemUlid || ULID_PATTERN.test(val),
          t.inventoryValuationMethods.validation.itemInvalidUlid,
        ),
      method: z
        .enum(VALUATION_METHODS)
        .refine(
          (val) => isValuationMethodImplemented(val),
          t.inventoryValuationMethods.validation.methodNotImplemented,
        ),
      validFrom: z
        .string()
        .trim()
        .min(1, t.inventoryValuationMethods.validation.validFromRequired)
        .refine(
          (val) => isBusinessDay(val),
          t.inventoryValuationMethods.validation.validFromInvalid,
        ),
      validTo: z
        .string()
        .trim()
        .refine(
          (val) => val === '' || isBusinessDay(val),
          t.inventoryValuationMethods.validation.validToInvalid,
        ),
      note: z
        .string()
        .trim()
        .max(500, t.inventoryValuationMethods.validation.noteTooLong),
    })
    .superRefine((values, ctx) => {
      if (
        values.validTo !== '' &&
        isBusinessDay(values.validFrom) &&
        isBusinessDay(values.validTo) &&
        values.validTo <= values.validFrom
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['validTo'],
          message:
            t.inventoryValuationMethods.validation.validToMustBeAfterValidFrom,
        });
      }
    });
}

export type ValuationMethodFormValues = z.infer<
  ReturnType<typeof buildValuationMethodFormSchema>
>;

interface ValuationMethodCreateFormBodyProps {
  organizationId: string;
  initialItemId: string;
}

function ValuationMethodCreateFormBody({
  organizationId,
  initialItemId,
}: ValuationMethodCreateFormBodyProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const zone = useTimeZone();
  const defaultValidFrom = useMemo(() => todayBusinessDay(zone), [zone]);
  const items = useActiveItemOptions(organizationId);
  const mutation = useConfigureValuationMethodMutation(organizationId);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const itemFieldId = useId();
  const methodFieldId = useId();
  const validFromFieldId = useId();
  const validToFieldId = useId();
  const noteFieldId = useId();

  const schema = useMemo(
    () =>
      buildValuationMethodFormSchema({
        manualItemUlid: items.unavailable,
      }),
    [items.unavailable],
  );

  const form = useForm<ValuationMethodFormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      itemId: initialItemId,
      method: 'moving_weighted_average',
      validFrom: defaultValidFrom,
      validTo: '',
      note: '',
    },
  });

  const isDirty = form.formState.isDirty && !mutation.isSuccess;
  useWorkspaceWindowDirty(isDirty);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  const backHref =
    initialItemId !== ''
      ? `/app/inventory/valuation-methods?itemId=${encodeURIComponent(initialItemId)}`
      : '/app/inventory/valuation-methods';

  const handleRequestLeave = () => {
    if (isDirty) {
      setConfirmLeaveOpen(true);
      return;
    }
    navigate(backHref);
  };

  const selectedItemId = form.watch('itemId');
  const hasSelectedOptionInList = useMemo(
    () => items.items.some((opt) => opt.id === selectedItemId),
    [items.items, selectedItemId],
  );

  const submitting = mutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    const normalizedItemId = items.unavailable
      ? values.itemId.trim().toUpperCase()
      : values.itemId.trim();
    const trimmedNote = values.note.trim();

    mutation.mutate(
      {
        itemId: normalizedItemId,
        method: values.method,
        validFrom: values.validFrom,
        ...(values.validTo !== '' ? { validTo: values.validTo } : {}),
        ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
      },
      {
        onSuccess: (created) => {
          form.reset(values);
          showToast({
            kind: 'success',
            message: t.inventoryValuationMethods.createdToast,
          });
          navigate(
            `/app/inventory/valuation-methods?itemId=${encodeURIComponent(created.itemId)}`,
          );
        },
      },
    );
  });

  return (
    <div
      className="mx-auto max-w-3xl space-y-6"
      data-testid="valuation-method-form-page"
    >
      <PageHeader
        title={t.inventoryValuationMethods.newVersionTitle}
        description={t.inventoryValuationMethods.newVersionSubtitle}
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={handleRequestLeave}
          >
            {t.app.backToPrevious}
          </Button>
        }
      />

      <Alert variant="neutral">
        <AlertTitle>{t.inventoryValuationMethods.immutableNote}</AlertTitle>
        <AlertBody>{t.inventoryValuationMethods.halfOpenWindowNote}</AlertBody>
      </Alert>

      {mutation.isError && (
        <ApiErrorAlert
          error={mutation.error}
          title={t.inventoryValuationMethods.saveFailed}
          description={
            valuationMethodErrorMessage('configure', mutation.error).message
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.inventoryValuationMethods.title}</CardTitle>
          <CardDescription>
            {t.inventoryValuationMethods.methodHint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={onSubmit}
            className="space-y-6"
            data-testid="valuation-method-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id={itemFieldId}
                label={t.inventoryValuationMethods.item}
                required
                error={form.formState.errors.itemId?.message}
                hint={
                  items.unavailable
                    ? t.inventoryValuationMethods.itemPickerUnavailableHint
                    : undefined
                }
                className="sm:col-span-2"
              >
                {(fieldProps) =>
                  items.unavailable ? (
                    <Input
                      {...fieldProps}
                      dir="ltr"
                      className="font-mono"
                      disabled={submitting}
                      placeholder={
                        t.inventoryValuationMethods.itemIdPlaceholder
                      }
                      {...form.register('itemId')}
                    />
                  ) : (
                    <Select
                      {...fieldProps}
                      disabled={submitting || items.isPending}
                      {...form.register('itemId')}
                    >
                      <option value="">
                        {t.inventoryValuationMethods.selectItem}
                      </option>
                      {selectedItemId !== '' && !hasSelectedOptionInList && (
                        <option value={selectedItemId}>{selectedItemId}</option>
                      )}
                      {items.items.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.code} — {opt.name}
                        </option>
                      ))}
                    </Select>
                  )
                }
              </FormField>

              <FormField
                id={methodFieldId}
                label={t.inventoryValuationMethods.method}
                required
                error={form.formState.errors.method?.message}
                hint={t.inventoryValuationMethods.methodHint}
                className="sm:col-span-2"
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    disabled={submitting}
                    {...form.register('method')}
                  >
                    {VALUATION_METHODS.map((methodCode) => {
                      const implemented =
                        isValuationMethodImplemented(methodCode);
                      return (
                        <option
                          key={methodCode}
                          value={methodCode}
                          disabled={!implemented}
                        >
                          {valuationMethodLabel(methodCode)}
                          {implemented
                            ? ''
                            : t.inventoryValuationMethods
                                .methodOptionDisabledSuffix}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </FormField>

              <Controller
                control={form.control}
                name="validFrom"
                render={({ field, fieldState }) => (
                  <FormField
                    id={validFromFieldId}
                    label={t.inventoryValuationMethods.validFrom}
                    required
                    error={fieldState.error?.message}
                    hint={t.inventoryValuationMethods.validFromHint}
                  >
                    {(fieldProps) => (
                      <JalaliDateInputField
                        {...fieldProps}
                        value={field.value}
                        disabled={submitting}
                        onValueChange={(next) => field.onChange(next)}
                      />
                    )}
                  </FormField>
                )}
              />

              <Controller
                control={form.control}
                name="validTo"
                render={({ field, fieldState }) => (
                  <FormField
                    id={validToFieldId}
                    label={t.inventoryValuationMethods.validTo}
                    error={fieldState.error?.message}
                    hint={t.inventoryValuationMethods.validToHint}
                  >
                    {(fieldProps) => (
                      <JalaliDateInputField
                        {...fieldProps}
                        value={field.value}
                        disabled={submitting}
                        onValueChange={(next) => field.onChange(next)}
                      />
                    )}
                  </FormField>
                )}
              />

              <FormField
                id={noteFieldId}
                label={t.inventoryValuationMethods.note}
                error={form.formState.errors.note?.message}
                hint={t.inventoryValuationMethods.noteHint}
                className="sm:col-span-2"
              >
                {(fieldProps) => (
                  <textarea
                    {...fieldProps}
                    rows={3}
                    maxLength={500}
                    disabled={submitting}
                    className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-subtle/70 hover:border-ink-subtle/60 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger"
                    {...form.register('note')}
                  />
                )}
              </FormField>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={handleRequestLeave}
              >
                {t.app.cancel}
              </Button>
              <Button type="submit" disabled={submitting} loading={submitting}>
                {submitting
                  ? t.inventoryValuationMethods.submitting
                  : t.inventoryValuationMethods.submitCreate}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmLeaveOpen}
        title={t.inventoryValuationMethods.leaveConfirmTitle}
        description={t.inventoryValuationMethods.leaveConfirmBody}
        confirmLabel={t.inventoryValuationMethods.leaveConfirmAction}
        danger
        onConfirm={() => {
          setConfirmLeaveOpen(false);
          navigate(backHref);
        }}
        onCancel={() => setConfirmLeaveOpen(false)}
      />
    </div>
  );
}

/**
 * Create a new effective-dated item valuation method version
 * (`POST /inventory/valuation/methods`, gated by `Inventory.Valuation.Configure`).
 */
export function ValuationMethodFormPage() {
  const organizationId = useOrganizationId();
  const [searchParams] = useSearchParams();
  const initialItemId = (searchParams.get('itemId') ?? '').trim();

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  return (
    <ValuationMethodCreateFormBody
      key={`${organizationId}:${initialItemId}`}
      organizationId={organizationId}
      initialItemId={initialItemId}
    />
  );
}
