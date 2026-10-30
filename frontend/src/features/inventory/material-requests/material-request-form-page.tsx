import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import type { MaterialRequestDetail } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { useInventoryReferences } from '../use-inventory-references';
import { materialRequestErrorMessage } from './material-request-error-messages';
import {
  emptyMaterialRequestLine,
  materialRequestFormSchema,
  toCreateMaterialRequestInput,
  toUpdateMaterialRequestInput,
  type MaterialRequestFormValues,
} from './material-request-form-schema';
import {
  useCreateMaterialRequestMutation,
  useMaterialRequest,
  useUpdateMaterialRequestMutation,
} from './material-request-hooks';
import { MaterialRequestLineRow } from './material-request-line-row';
import {
  isMaterialRequestEditable,
  isMaterialRequestLineLocked,
} from './material-request-status';

export type MaterialRequestFormMode = 'create' | 'edit';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `errors.lines` is an array of per-line errors, optionally carrying a
 * `root`/array-level `message` (the `min(1)` rule). Only that array-level
 * message is read here; per-line messages render under their own fields.
 */
function arrayLevelMessage(errors: unknown): string | undefined {
  if (!isRecord(errors)) return undefined;
  const message = errors['message'];
  return typeof message === 'string' ? message : undefined;
}

interface ValidationIssue {
  field: string;
  message: string;
}

/** Per-line/per-field messages, flattened for the error summary. */
function lineIssues(errors: unknown): ValidationIssue[] {
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((lineError, index) => {
    if (!isRecord(lineError)) return [];
    return Object.entries(lineError).flatMap(([field, error]) =>
      isRecord(error) && typeof error['message'] === 'string'
        ? [{ field: `lines.${index}.${field}`, message: error['message'] }]
        : [],
    );
  });
}

function valuesFromDetail(
  detail: MaterialRequestDetail,
): MaterialRequestFormValues {
  return {
    description: detail.description ?? '',
    lines: detail.lines.map((line) => ({
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitId: line.unitId,
      reservationRequested: line.reservationRequested,
    })),
  };
}

/** Create/edit route. References have their own permissions; a failure says so. */
export function MaterialRequestFormPage({
  mode,
}: {
  mode: MaterialRequestFormMode;
}): ReactElement {
  const organizationId = useOrganizationId();
  const references = useInventoryReferences(organizationId);
  const { requestId } = useParams<{ requestId: string }>();
  const requestQuery = useMaterialRequest(
    mode === 'edit' ? organizationId : null,
    mode === 'edit' ? requestId : undefined,
  );

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }
  if (mode === 'edit' && requestQuery.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (mode === 'edit' && requestQuery.isError) {
    return (
      <div className="space-y-4">
        <MaterialRequestFormHeader mode={mode} />
        <ApiErrorAlert
          error={requestQuery.error}
          title={t.materialRequests.detailLoadFailed}
          description={t.materialRequests.detailLoadFailed}
          onRetry={() => void requestQuery.refetch()}
        />
      </div>
    );
  }
  if (references.isLoading) {
    return <LoadingState rows={6} label={t.filters.referencesLoading} />;
  }
  if (references.isFailed) {
    return (
      <div className="space-y-4">
        <MaterialRequestFormHeader mode={mode} />
        <ApiErrorAlert
          error={new Error(t.materialRequests.referencesUnavailable)}
          title={t.materialRequests.referencesUnavailable}
          description={t.materialRequests.referencesUnavailable}
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
        <MaterialRequestFormHeader mode={mode} />
        <Alert variant="warning">
          <AlertTitle>{t.materialRequests.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <p>{t.materialRequests.referencesEmpty}</p>
          </AlertBody>
        </Alert>
      </div>
    );
  }

  const detail = mode === 'edit' ? requestQuery.data : undefined;
  if (mode === 'edit' && detail === undefined) {
    return (
      <div className="space-y-4">
        <MaterialRequestFormHeader mode={mode} />
        <Alert variant="warning">
          <AlertTitle>{t.errors.notFound}</AlertTitle>
          <AlertBody>
            <p>{t.materialRequests.detailNotFound}</p>
          </AlertBody>
        </Alert>
      </div>
    );
  }

  return (
    <MaterialRequestForm
      mode={mode}
      organizationId={organizationId}
      references={references}
      detail={detail}
    />
  );
}

function MaterialRequestFormHeader({
  mode,
}: {
  mode: MaterialRequestFormMode;
}) {
  const permissions = usePermissions();
  return (
    <FormPageHeader
      title={
        mode === 'create'
          ? t.materialRequests.createTitle
          : t.materialRequests.editTitle
      }
      description={
        mode === 'create'
          ? t.materialRequests.createDescription
          : t.materialRequests.editDescription
      }
      backTo={
        permissions.has(PERMISSIONS.inventory.materialRequestView)
          ? '/app/inventory/material-requests'
          : '/app/inventory'
      }
    />
  );
}

function MaterialRequestForm({
  mode,
  organizationId,
  references,
  detail,
}: {
  mode: MaterialRequestFormMode;
  organizationId: string;
  references: ReturnType<typeof useInventoryReferences>;
  detail: MaterialRequestDetail | undefined;
}): ReactElement {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const canViewConversions = permissions.has(
    PERMISSIONS.inventory.unitConversionView,
  );
  const form = useForm<MaterialRequestFormValues>({
    resolver: zodResolver(materialRequestFormSchema),
    mode: 'onSubmit',
    defaultValues:
      detail === undefined
        ? { description: '', lines: [emptyMaterialRequestLine()] }
        : valuesFromDetail(detail),
  });
  const { register, control, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const formId = useId().replaceAll(':', '');
  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);
  const createMutation = useCreateMaterialRequestMutation(organizationId);
  const updateMutation = useUpdateMaterialRequestMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

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

  const editable =
    detail === undefined || isMaterialRequestEditable(detail.status);
  const lockedLineIndexes = new Set(
    (detail?.lines ?? [])
      .map((line, index) => (isMaterialRequestLineLocked(line) ? index : -1))
      .filter((index) => index >= 0),
  );

  if (!editable) {
    return (
      <div className="space-y-4">
        <MaterialRequestFormHeader mode={mode} />
        <Alert variant="warning" data-testid="material-request-not-editable">
          <AlertTitle>{t.materialRequests.readonlyTitle}</AlertTitle>
          <AlertBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{t.materialRequests.notEditable}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(`/app/inventory/material-requests/${detail?.id}`)
                }
              >
                {t.materialRequests.openDetails}
              </Button>
            </div>
          </AlertBody>
        </Alert>
      </div>
    );
  }

  const linesError = arrayLevelMessage(formState.errors.lines);
  const descriptionError = formState.errors.description?.message;
  const validationIssues: ValidationIssue[] = [
    ...(descriptionError === undefined
      ? []
      : [{ field: 'description', message: descriptionError }]),
    ...(linesError === undefined
      ? []
      : [{ field: 'lines', message: linesError }]),
    ...lineIssues(formState.errors.lines),
  ];

  function submit(values: MaterialRequestFormValues) {
    if (submitting) return;
    setServerError(null);
    const onSuccess = (saved: MaterialRequestDetail) => {
      showToast({
        kind: 'success',
        message:
          mode === 'create'
            ? t.materialRequests.createdSuccess
            : t.materialRequests.updatedSuccess,
      });
      form.reset(valuesFromDetail(saved));
      navigate(`/app/inventory/material-requests/${saved.id}`);
    };
    const onError = (error: unknown) => {
      const apiError = normalizeApiError(error);
      if (apiError.isUnauthorized) return;
      setServerError({
        error,
        message: materialRequestErrorMessage(
          mode === 'create' ? 'create' : 'update',
          error,
        ).message,
      });
    };

    if (mode === 'create') {
      createMutation.mutate(
        toCreateMaterialRequestInput(organizationId, values),
        {
          onSuccess,
          onError,
        },
      );
      return;
    }
    if (detail === undefined) return;
    updateMutation.mutate(
      { requestId: detail.id, body: toUpdateMaterialRequestInput(values) },
      { onSuccess, onError },
    );
  }

  // A stable callback REF, not a ref object: when the summary first appears
  // after a failed submit, mounting it moves focus there (standards.md §9)
  // without reading a ref during render.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);
  const handleSubmit = form.handleSubmit(submit);

  return (
    <div className="space-y-4">
      <MaterialRequestFormHeader mode={mode} />
      {serverError !== null ? (
        <div aria-live="polite">
          <ApiErrorAlert
            error={serverError.error}
            title={t.materialRequests.saveFailed}
            description={serverError.message}
          />
        </div>
      ) : null}
      {validationIssues.length > 0 && formState.isSubmitted ? (
        <div
          ref={focusOnMount}
          role="alert"
          tabIndex={-1}
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink focus-visible:outline"
          data-testid="material-request-error-summary"
        >
          <p className="font-semibold">
            {t.materialRequests.validationSummary}
          </p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {validationIssues.map(({ field, message }) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        onChange={() => setServerError(null)}
      >
        <div className="rounded-card border border-line bg-surface p-4">
          <FormField
            id={`material-request-${formId}-description`}
            label={t.materialRequests.description}
            error={formState.errors.description?.message}
            hint={t.materialRequests.descriptionHint}
          >
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                {...register('description')}
                maxLength={1000}
                rows={2}
              />
            )}
          </FormField>
        </div>

        <div className="space-y-3">
          {fields.map((field, index) => (
            <MaterialRequestLineRow
              key={field.id}
              form={form}
              index={index}
              references={references}
              canViewConversions={canViewConversions}
              locked={lockedLineIndexes.has(index)}
              canRemove={fields.length > 1}
              onRemove={() => remove(index)}
            />
          ))}
          {linesError !== undefined ? (
            <p role="alert" className="text-xs text-danger-ink">
              {linesError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(emptyMaterialRequestLine())}
            disabled={submitting}
          >
            {t.materialRequests.addLine}
          </Button>
          <Button type="submit" disabled={submitting} loading={submitting}>
            {submitting
              ? t.loading.saving
              : mode === 'create'
                ? t.materialRequests.createTitle
                : t.materialRequests.editTitle}
          </Button>
          <span className="text-xs text-ink-subtle">
            {t.materialRequests.lastLineNote}
          </span>
        </div>
      </form>
    </div>
  );
}
