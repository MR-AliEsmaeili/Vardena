import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { getAccount } from '@/api/accounting.api';
import { normalizeApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AccountingDocument, Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { useOrganizationId } from '@/features/organization/use-organization';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useToast } from '@/ui/patterns/toast';
import { useFinancialAreas } from '../shared/use-accounting-references';
import {
  applyServerValidationToForm,
  documentErrorMessage,
  type DocumentErrorMessage,
} from './document-error-messages';
import {
  documentFormSchema,
  emptyDocumentLine,
  isZeroAmount,
  MAX_DOCUMENT_DESCRIPTION_LENGTH,
  type DocumentFormValues,
} from './document-form-schema';
import {
  newOperationKey,
  useCreateDocumentMutation,
  useUpdateDocumentMutation,
} from './document-mutations';
import { DocumentLinesEditor } from './document-lines-editor';
import {
  isEditableDocumentState,
  parseDocumentState,
  documentStatePresentation,
} from './document-lifecycle';
import { useDocumentDetail } from './use-document-detail';

/**
 * Compose / edit form (FE-UX-08 §8–§9, standards.md §9).
 *
 * RHF + Zod over the exact transport DTO: description (≤ 500), date-only
 * date, ≥ 2 lines, one non-negative decimal side per line, detail required
 * when the chosen account is linked to a detail group. Server-side answers
 * are mapped into the form (`applyServerValidationToForm`) or into a Persian
 * error summary; submit is disabled while in flight (no duplicate create),
 * and the idempotency key is created once per form intent and reused across
 * its retries.
 *
 * The user may leave only through the explicit cancel (confirmed when dirty)
 * or a successful save — plus the browser-level `beforeunload` guard.
 * A router-level in-app dirty guard would need `useBlocker`, which this
 * app's declarative router does not expose; that stays a registered CONTRACT
 * GAP, not a fake guard.
 */

export function DocumentCreatePage(): ReactElement | null {
  return <DocumentFormPage mode="create" />;
}

export function DocumentEditPage(): ReactElement | null {
  const { documentId } = useParams<{ documentId: string }>();
  return <DocumentFormPage mode="edit" documentId={documentId} />;
}

function DocumentFormPage({
  mode,
  documentId,
}: {
  mode: 'create' | 'edit';
  documentId?: string | undefined;
}): ReactElement | null {
  const organizationId = useOrganizationId();
  const editQuery = useDocumentDetail(organizationId, documentId);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }

  if (mode === 'edit') {
    if (editQuery.isPending) {
      return <LoadingState rows={8} label={t.app.loading} />;
    }
    if (editQuery.error !== null) {
      return (
        <div className="space-y-4">
          <PageHeader title={t.documents.editTitle} />
          <ApiErrorAlert
            error={editQuery.error}
            title={t.documents.loadDocumentFailed}
            onRetry={() => void editQuery.refetch()}
          />
        </div>
      );
    }
    const document = editQuery.data;
    const state = parseDocumentState(document.state);
    if (state === null || !isEditableDocumentState(state)) {
      return (
        <div className="space-y-4">
          <PageHeader title={t.documents.editTitle} />
          <Alert variant="warning" role="alert">
            <AlertTitle>{t.documents.notEditableTitle}</AlertTitle>
            <AlertBody>
              <p>{t.documents.notEditableBody}</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link
                  to={`/app/accounting/documents/${encodeURIComponent(document.id)}`}
                >
                  {t.documents.view}
                </Link>
              </Button>
            </AlertBody>
          </Alert>
        </div>
      );
    }
    return (
      <DocumentForm
        organizationId={organizationId}
        mode="edit"
        document={document}
      />
    );
  }

  return <DocumentForm organizationId={organizationId} mode="create" />;
}

// -----------------------------------------------------------------------------

function createDefaults(): DocumentFormValues {
  return {
    financialAreaId: '',
    documentDate: new Date().toLocaleDateString('en-CA'),
    description: '',
    lines: [emptyDocumentLine(), emptyDocumentLine()],
  };
}

function editDefaults(document: AccountingDocument): DocumentFormValues {
  return {
    financialAreaId: document.financialAreaId,
    documentDate: document.documentDate,
    description: document.description,
    lines: document.lines.map((line) => ({
      accountId: line.accountId,
      detailId: line.detailId ?? '',
      debitAmount: isZeroAmount(line.debitAmount) ? '' : line.debitAmount,
      creditAmount: isZeroAmount(line.creditAmount) ? '' : line.creditAmount,
      description: line.description ?? '',
    })),
  };
}

function DocumentForm({
  organizationId,
  mode,
  document,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  document?: AccountingDocument | undefined;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<DocumentErrorMessage | null>(
    null,
  );
  const [confirmLeave, setConfirmLeave] = useState(false);
  // One idempotency key per form intent, reused across this intent's retries.
  const operationKeyRef = useRef(newOperationKey());
  const editState =
    document === undefined ? null : parseDocumentState(document.state);
  const isTemporaryEdit = mode === 'edit' && editState === 'temporary';

  // The selected accounts, resolved lazily from the pickers' own cache; the
  // Zod detail-required rule reads them at validation time.
  const accountsRef = useRef(new Map<string, Account>());
  const schema = useMemo(
    () => documentFormSchema((accountId) => accountsRef.current.get(accountId)),
    [],
  );

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(schema),
    defaultValues:
      mode === 'create'
        ? createDefaults()
        : editDefaults(document as AccountingDocument),
  });
  const { register, watch, handleSubmit, formState } = form;
  const lines = watch('lines');

  // Resolve the selected accounts (the pickers' own cache) so the Zod
  // detail-required rule can check them; unresolved accounts are skipped.
  const accountQueries = useQueries({
    queries: (lines ?? [])
      .filter((line) => line.accountId !== '')
      .map((line) => ({
        queryKey: queryKeys.accounting.accountDetail(
          organizationId,
          line.accountId,
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getAccount(organizationId, line.accountId, signal),
        staleTime: 5 * 60_000,
      })),
  });
  for (const query of accountQueries) {
    if (query.data !== undefined) {
      accountsRef.current.set(query.data.id, query.data);
    }
  }

  const areasQuery = useFinancialAreas(organizationId);
  const areas = areasQuery.data?.items ?? [];
  const areaOptions =
    mode === 'edit'
      ? // The document's current area stays selectable in edit mode even if
        // it has since been deactivated (history is not rewritten); the
        // backend still validates the choice.
        areas.filter(
          (area) =>
            area.isActive ||
            area.id === (document as AccountingDocument).financialAreaId,
        )
      : areas.filter((area) => area.isActive);

  const createMutation = useCreateDocumentMutation(organizationId);
  const updateMutation = useUpdateDocumentMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  // The browser-level unsaved-changes guard.
  const isDirty = formState.isDirty;
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const cancelTarget =
    mode === 'edit' && document !== undefined
      ? `/app/accounting/documents/${encodeURIComponent(document.id)}`
      : '/app/accounting/documents';

  const onDirtyCancel = () => {
    if (isDirty) setConfirmLeave(true);
    else navigate(cancelTarget);
  };

  const onSubmit = handleSubmit((values) => {
    if (submitting) return; // duplicate-submit protection
    setServerError(null);
    const onError = (error: unknown) => {
      const normalized = normalizeApiError(error);
      if (normalized.isUnauthorized) return; // owned by the session flow
      const validation = applyServerValidationToForm(error, form);
      if (validation !== null) {
        setServerError({
          message: validation.summary,
          ...(normalized.correlationId !== undefined
            ? { correlationId: normalized.correlationId }
            : {}),
        });
      } else {
        setServerError(
          documentErrorMessage(mode === 'create' ? 'create' : 'update', error),
        );
      }
      // Bring the persistent failure into view; it is never a toast.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    if (mode === 'create') {
      createMutation.mutate(
        { values, operationKey: operationKeyRef.current },
        {
          onSuccess: (created) => {
            // The type may issue immediately (draft_required=false): the
            // response's own state decides the announcement, never the UI.
            showToast({
              kind: 'success',
              message:
                created.state === 'temporary'
                  ? t.documents.createdIssued
                  : t.documents.created,
            });
            navigate(
              `/app/accounting/documents/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
    } else {
      const target = document as AccountingDocument;
      updateMutation.mutate(
        { documentId: target.id, values },
        {
          onSuccess: (updated) => {
            showToast({ kind: 'success', message: t.documents.updated });
            navigate(
              `/app/accounting/documents/${encodeURIComponent(updated.id)}`,
            );
          },
          onError,
        },
      );
    }
  });

  const submitLabel =
    mode === 'create'
      ? submitting
        ? t.documents.saving
        : t.documents.save
      : submitting
        ? t.documents.updating
        : t.documents.update;

  // Ctrl/Cmd+S saves (FE-UX-02 §13). A window-level listener — the same
  // pattern the dashboard uses — keeps the handler off the non-interactive
  // <form> element; the latest submit closure is read through a ref.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <FormProvider {...form}>
      <div className="space-y-4">
        <PageHeader
          title={
            mode === 'create' ? t.documents.createTitle : t.documents.editTitle
          }
          description={
            mode === 'create' ? (
              t.documents.createSubtitle
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                {editState !== null && (
                  <Badge variant={documentStatePresentation[editState].variant}>
                    {documentStatePresentation[editState].label}
                  </Badge>
                )}
                <span className="text-xs">{t.documents.editSubtitle}</span>
              </span>
            )
          }
        />

        {serverError !== null && (
          <Alert variant="danger" role="alert">
            <AlertTitle>{t.errors.title}</AlertTitle>
            <AlertBody>
              <p aria-live="polite">{serverError.message}</p>
              {serverError.correlationId !== undefined && (
                <p className="mt-2 text-xs text-rose-800/80">
                  {t.errors.correlationId}:{' '}
                  <span className="code">{serverError.correlationId}</span>
                </p>
              )}
            </AlertBody>
          </Alert>
        )}

        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(event);
          }}
        >
          <Card>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Field
                label={t.documents.fieldArea}
                htmlFor="financialAreaId"
                error={formState.errors.financialAreaId?.message}
              >
                <>
                  <Select
                    id="financialAreaId"
                    disabled={isTemporaryEdit === true || areasQuery.isFetching}
                    aria-invalid={
                      formState.errors.financialAreaId !== undefined
                    }
                    {...register('financialAreaId')}
                  >
                    <option value="">{t.filters.select}</option>
                    {areaOptions.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.code} — {area.title}
                      </option>
                    ))}
                  </Select>
                  {isTemporaryEdit === true && (
                    <p className="text-[11px] text-slate-500">
                      {t.documents.areaImmutableHint}
                    </p>
                  )}
                </>
              </Field>
              <Field
                label={t.documents.fieldDate}
                htmlFor="documentDate"
                error={formState.errors.documentDate?.message}
              >
                <Input
                  id="documentDate"
                  type="date"
                  dir="ltr"
                  className="code"
                  aria-invalid={formState.errors.documentDate !== undefined}
                  {...register('documentDate')}
                />
              </Field>
              <Field
                label={t.documents.fieldDescription}
                htmlFor="description"
                error={formState.errors.description?.message}
              >
                <Input
                  id="description"
                  maxLength={MAX_DOCUMENT_DESCRIPTION_LENGTH}
                  aria-invalid={formState.errors.description !== undefined}
                  {...register('description')}
                />
              </Field>
            </CardContent>
          </Card>

          <DocumentLinesEditor organizationId={organizationId} />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onDirtyCancel}
              disabled={submitting}
            >
              {t.app.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitLabel}
            </Button>
          </div>
        </form>

        <ConfirmDialog
          open={confirmLeave}
          title={t.documents.dirtyLeaveTitle}
          description={<p>{t.documents.dirtyLeaveDescription}</p>}
          confirmLabel={t.documents.dirtyLeaveConfirm}
          loading={false}
          onConfirm={() => {
            setConfirmLeave(false);
            navigate(cancelTarget);
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      </div>
    </FormProvider>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-slate-700"
      >
        {label}
      </label>
      {children}
      {error !== undefined && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs text-rose-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
