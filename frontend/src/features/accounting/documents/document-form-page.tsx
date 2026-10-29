import { FileSpreadsheet, List, Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import * as accountingApi from '@/api/accounting.api';
import { normalizeApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AccountingDocument, Account } from '@/api/contracts';
import { isBusinessDay, todayBusinessDay, useTimeZone } from '@/lib/datetime';
import { compareExactDecimals, sumExactDecimals } from '@/lib/decimal';
import { exportRowsToExcelCsv, printCurrentSurface } from '@/lib/export-table';
import { formatAmount, formatCount, formatDateOnly } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DateInput } from '@/ui/patterns/date-input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import {
  CollapsibleHeader,
  DocumentPaginationControl,
  OperationalFooter,
  OperationalFormShell,
  OperationalSummary,
  OperationalToolbar,
  type HeaderSummaryChip,
  type SummaryRow,
} from '@/ui/patterns/operational-form';
import { LoadingState } from '@/ui/patterns/states';
import { FormPageHeader } from '@/app/layouts/form-page-header';
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
  MONEY_INPUT_PATTERN,
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
          <FormPageHeader title={t.documents.editTitle} />
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
          <FormPageHeader title={t.documents.editTitle} />
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
        key={document.id}
        organizationId={organizationId}
        mode="edit"
        document={document}
      />
    );
  }

  return <DocumentForm organizationId={organizationId} mode="create" />;
}

function createDefaults(timeZone: string): DocumentFormValues {
  return {
    financialAreaId: '',
    documentDate: todayBusinessDay(timeZone),
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

const EMPTY_AREAS: readonly AccountingAreaLike[] = [];
interface AccountingAreaLike {
  id: string;
  code: string;
  title: string;
  isActive: boolean;
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
  const timeZone = useTimeZone();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<DocumentErrorMessage | null>(
    null,
  );
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);
  const operationKeyRef = useRef(newOperationKey());
  const editState =
    document === undefined ? null : parseDocumentState(document.state);
  const isTemporaryEdit = mode === 'edit' && editState === 'temporary';

  const accountsRef = useRef(new Map<string, Account>());
  const schema = useMemo(
    () => documentFormSchema((accountId) => accountsRef.current.get(accountId)),
    [],
  );

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(schema),
    defaultValues:
      mode === 'create'
        ? createDefaults(timeZone)
        : editDefaults(document as AccountingDocument),
  });
  const { register, watch, handleSubmit, formState } = form;
  const watchedLines = useWatch({ control: form.control, name: 'lines' });
  const watchedAreaId = watch('financialAreaId');
  const watchedDate = watch('documentDate');
  const watchedDescription = watch('description');

  const accountQueries = useQueries({
    queries: (watchedLines ?? [])
      .filter((line) => line.accountId !== '')
      .map((line) => ({
        queryKey: queryKeys.accounting.accountDetail(
          organizationId,
          line.accountId,
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          accountingApi.getAccount(organizationId, line.accountId, signal),
        staleTime: 5 * 60_000,
      })),
  });
  for (const query of accountQueries) {
    if (query.data !== undefined) {
      accountsRef.current.set(query.data.id, query.data);
    }
  }

  const areasQuery = useFinancialAreas(organizationId);
  const areas = areasQuery.data?.items ?? EMPTY_AREAS;
  const areaOptions =
    mode === 'edit'
      ? areas.filter(
          (area) =>
            area.isActive ||
            area.id === (document as AccountingDocument).financialAreaId,
        )
      : areas.filter((area) => area.isActive);

  // Optional neighbor-document pagination in edit mode (when `listAccountingDocuments`
  // is available and permitted).
  const canListDocuments =
    mode === 'edit' &&
    document !== undefined &&
    permissions.loaded &&
    permissions.has(PERMISSIONS.accounting.documentView) &&
    'listAccountingDocuments' in accountingApi &&
    typeof accountingApi.listAccountingDocuments === 'function';

  const neighborsQuery = useQuery({
    queryKey: queryKeys.accounting.accountingDocuments(organizationId, {
      page: 1,
      pageSize: 100,
      sort: 'documentDate:desc',
    }),
    queryFn: async ({ signal }) =>
      (await accountingApi.listAccountingDocuments(
        {
          organizationId,
          page: 1,
          pageSize: 100,
          sort: 'documentDate:desc',
        },
        signal,
      )) ?? null,
    enabled: canListDocuments,
    staleTime: 30_000,
  });

  const editableNeighbors = useMemo(
    () =>
      (neighborsQuery.data?.items ?? []).filter((item) => {
        const s = parseDocumentState(item.state);
        return s !== null && isEditableDocumentState(s);
      }),
    [neighborsQuery.data],
  );
  const currentNeighborIndex =
    document !== undefined
      ? editableNeighbors.findIndex((item) => item.id === document.id)
      : -1;

  const createMutation = useCreateDocumentMutation(organizationId);
  const updateMutation = useUpdateDocumentMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

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
  // ADR-0054 (§4.7): the workspace dock shows this form's dirty
  // state and guards window close — the page's own leave-confirm
  // guards stay untouched (no double dialog: the dock dialog only
  // runs from dock/reset flows).
  useWorkspaceWindowDirty(isDirty);

  const cancelTarget =
    mode === 'edit' && document !== undefined
      ? `/app/accounting/documents/${encodeURIComponent(document.id)}`
      : '/app/accounting/documents';

  const navigateWithDirtyGuard = (target: string) => {
    if (isDirty) {
      setPendingNavTarget(target);
    } else {
      navigate(target);
    }
  };

  const onSubmit = handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    const onError = (error: unknown) => {
      const normalized = normalizeApiError(error);
      if (normalized.isUnauthorized) return;
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    if (mode === 'create') {
      createMutation.mutate(
        { values, operationKey: operationKeyRef.current },
        {
          onSuccess: (created) => {
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

  // Digit-exact decimal totals (standards.md §7 — never float Number()).
  const summaryRows = useMemo<SummaryRow[]>(() => {
    const validDebits = (watchedLines ?? [])
      .map((line) => line.debitAmount.trim())
      .filter((val) => val !== '' && MONEY_INPUT_PATTERN.test(val));
    const validCredits = (watchedLines ?? [])
      .map((line) => line.creditAmount.trim())
      .filter((val) => val !== '' && MONEY_INPUT_PATTERN.test(val));

    const totalDebit = sumExactDecimals(validDebits, 0);
    const totalCredit = sumExactDecimals(validCredits, 0);
    const comparison = compareExactDecimals(totalDebit, totalCredit);

    const balanceValue = comparison.bothZero
      ? t.app.none
      : comparison.equal
        ? t.operationalForm.balanced
        : t.operationalForm.unbalancedDiff.replace(
            '{diff}',
            formatAmount(comparison.absoluteDifference),
          );

    return [
      {
        label: t.documents.totalDebit,
        value: formatAmount(totalDebit),
        emphasize: true,
      },
      {
        label: t.documents.totalCredit,
        value: formatAmount(totalCredit),
        emphasize: true,
      },
      {
        label: t.operationalForm.balanceStatus,
        value: balanceValue,
        emphasize: true,
        tone: comparison.bothZero
          ? 'default'
          : comparison.equal
            ? 'ok'
            : 'danger',
      },
      {
        label: t.operationalForm.lineCount,
        value: formatCount((watchedLines ?? []).length),
      },
    ];
  }, [watchedLines]);

  const headerCanCollapse =
    watchedAreaId.trim() !== '' &&
    watchedDate.trim() !== '' &&
    isBusinessDay(watchedDate) &&
    watchedDescription.trim() !== '' &&
    watchedDescription.trim().length <= MAX_DOCUMENT_DESCRIPTION_LENGTH;

  const hasHeaderErrors =
    !headerCanCollapse &&
    (formState.errors.financialAreaId !== undefined ||
      formState.errors.documentDate !== undefined ||
      formState.errors.description !== undefined);

  const summaryChips = useMemo<HeaderSummaryChip[]>(() => {
    const selectedArea = areas.find((area) => area.id === watchedAreaId);
    const chips: HeaderSummaryChip[] = [
      {
        label: t.documents.number,
        value: document?.documentNumber ?? t.app.none,
      },
      {
        label: t.documents.date,
        value: watchedDate ? formatDateOnly(watchedDate) : t.app.none,
      },
      {
        label: t.documents.documentType,
        value: t.documents.documentTypeVoucher,
      },
    ];
    if (selectedArea !== undefined) {
      chips.push({
        label: t.documents.area,
        value: selectedArea.title,
      });
    }
    return chips;
  }, [areas, document?.documentNumber, watchedAreaId, watchedDate]);

  const handleExportExcel = () => {
    const exportRows = (watchedLines ?? []).map((line, idx) => ({
      index: idx + 1,
      ...line,
    }));
    exportRowsToExcelCsv(
      `accounting-document-${document?.documentNumber ?? 'draft'}`,
      [
        { header: t.documents.lineNo, value: (row) => row.index },
        { header: t.documents.lineAccount, value: (row) => row.accountId },
        { header: t.documents.lineDetail, value: (row) => row.detailId },
        { header: t.documents.debit, value: (row) => row.debitAmount || '0' },
        { header: t.documents.credit, value: (row) => row.creditAmount || '0' },
        {
          header: t.documents.lineDescription,
          value: (row) => row.description,
        },
      ],
      exportRows,
    );
  };

  // Ctrl/Cmd+S saves (standards.md §13).
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

  const canCreateNew =
    permissions.loaded &&
    permissions.has(PERMISSIONS.accounting.documentCreate);
  const canViewList =
    permissions.loaded && permissions.has(PERMISSIONS.accounting.documentView);

  return (
    <FormProvider {...form}>
      <div className="space-y-4">
        <FormPageHeader
          title={
            mode === 'create' ? t.documents.createTitle : t.documents.editTitle
          }
          description={
            mode === 'create'
              ? t.documents.createSubtitle
              : t.documents.editSubtitle
          }
          meta={
            mode === 'edit' && editState !== null ? (
              <Badge variant={documentStatePresentation[editState].variant}>
                {documentStatePresentation[editState].label}
              </Badge>
            ) : null
          }
        />

        {serverError !== null && (
          <Alert variant="danger" role="alert">
            <AlertTitle>{t.errors.title}</AlertTitle>
            <AlertBody>
              <p aria-live="polite">{serverError.message}</p>
              {serverError.correlationId !== undefined && (
                <p className="mt-2 text-xs text-danger-ink/80">
                  {t.errors.correlationId}:{' '}
                  <span className="code">{serverError.correlationId}</span>
                </p>
              )}
            </AlertBody>
          </Alert>
        )}

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(event);
          }}
        >
          <OperationalFormShell
            toolbar={
              <OperationalToolbar>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={printCurrentSurface}
                  data-testid="form-toolbar-print"
                >
                  <Printer className="h-4 w-4" aria-hidden />
                  <span>{t.operationalForm.print}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportExcel}
                  data-testid="form-toolbar-excel"
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  <span>{t.operationalForm.exportExcel}</span>
                </Button>
                {canViewList && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    onClick={() =>
                      navigateWithDirtyGuard('/app/accounting/documents')
                    }
                  >
                    <List className="h-4 w-4" aria-hidden />
                    <span>{t.operationalForm.viewDocuments}</span>
                  </Button>
                )}
              </OperationalToolbar>
            }
            header={
              <CollapsibleHeader
                title={t.documents.headerSection}
                summaryChips={summaryChips}
                canCollapse={headerCanCollapse}
                hasRequiredErrors={hasHeaderErrors}
                onCollapseBlocked={() => {
                  void form.trigger([
                    'financialAreaId',
                    'documentDate',
                    'description',
                  ]);
                }}
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <Field
                    label={t.documents.fieldArea}
                    htmlFor="financialAreaId"
                    required
                    error={formState.errors.financialAreaId?.message}
                  >
                    <>
                      <Select
                        id="financialAreaId"
                        aria-required="true"
                        disabled={
                          isTemporaryEdit === true || areasQuery.isFetching
                        }
                        aria-invalid={
                          formState.errors.financialAreaId !== undefined
                        }
                        {...register('financialAreaId', {
                          onChange: () => form.clearErrors('financialAreaId'),
                        })}
                      >
                        <option value="">{t.filters.select}</option>
                        {areaOptions.map((area) => (
                          <option key={area.id} value={area.id}>
                            {area.code} — {area.title}
                          </option>
                        ))}
                      </Select>
                      {isTemporaryEdit === true && (
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {t.documents.areaImmutableHint}
                        </p>
                      )}
                    </>
                  </Field>
                  <Field
                    label={t.documents.fieldDate}
                    htmlFor="documentDate"
                    required
                    error={formState.errors.documentDate?.message}
                  >
                    <Controller
                      control={form.control}
                      name="documentDate"
                      render={({ field }) => (
                        <DateInput
                          id="documentDate"
                          className="code"
                          aria-invalid={
                            formState.errors.documentDate !== undefined
                          }
                          value={field.value}
                          onValueChange={field.onChange}
                        />
                      )}
                    />
                  </Field>
                  <Field
                    label={t.documents.fieldDescription}
                    htmlFor="description"
                    required
                    error={formState.errors.description?.message}
                  >
                    <Input
                      id="description"
                      aria-required="true"
                      maxLength={MAX_DOCUMENT_DESCRIPTION_LENGTH}
                      aria-invalid={formState.errors.description !== undefined}
                      {...register('description', {
                        onChange: () => form.clearErrors('description'),
                      })}
                    />
                  </Field>
                </div>
              </CollapsibleHeader>
            }
            detail={<DocumentLinesEditor organizationId={organizationId} />}
            summary={<OperationalSummary rows={summaryRows} />}
            footer={
              <OperationalFooter
                start={
                  <>
                    {mode === 'edit' && canCreateNew && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={submitting}
                        onClick={() =>
                          navigateWithDirtyGuard(
                            '/app/accounting/documents/new',
                          )
                        }
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        {t.operationalForm.newDocument}
                      </Button>
                    )}
                    {mode === 'edit' && document !== undefined && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={submitting}
                        onClick={() =>
                          navigateWithDirtyGuard(
                            `/app/accounting/documents/${encodeURIComponent(document.id)}`,
                          )
                        }
                      >
                        {t.documents.view}
                      </Button>
                    )}
                  </>
                }
                center={
                  mode === 'edit' && currentNeighborIndex >= 0 ? (
                    <DocumentPaginationControl
                      currentIndex={currentNeighborIndex}
                      totalCount={editableNeighbors.length}
                      hasPrev={currentNeighborIndex > 0}
                      hasNext={
                        currentNeighborIndex < editableNeighbors.length - 1
                      }
                      disabled={submitting}
                      onPrev={() => {
                        const prevDoc =
                          editableNeighbors[currentNeighborIndex - 1];
                        if (prevDoc !== undefined) {
                          navigateWithDirtyGuard(
                            `/app/accounting/documents/${encodeURIComponent(prevDoc.id)}/edit`,
                          );
                        }
                      }}
                      onNext={() => {
                        const nextDoc =
                          editableNeighbors[currentNeighborIndex + 1];
                        if (nextDoc !== undefined) {
                          navigateWithDirtyGuard(
                            `/app/accounting/documents/${encodeURIComponent(nextDoc.id)}/edit`,
                          );
                        }
                      }}
                    />
                  ) : document !== undefined ? (
                    <span className="text-xs text-ink-subtle">
                      {t.documents.number}:{' '}
                      {document.documentNumber ?? t.app.none} ·{' '}
                      {formatDateOnly(document.documentDate)}
                    </span>
                  ) : undefined
                }
                end={
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigateWithDirtyGuard(cancelTarget)}
                      disabled={submitting}
                    >
                      {t.app.cancel}
                    </Button>
                    <Button
                      type="submit"
                      disabled={submitting}
                      loading={submitting}
                    >
                      {submitLabel}
                    </Button>
                  </>
                }
              />
            }
          />
        </form>

        <ConfirmDialog
          open={pendingNavTarget !== null}
          title={t.documents.dirtyLeaveTitle}
          description={<p>{t.documents.dirtyLeaveDescription}</p>}
          confirmLabel={t.documents.dirtyLeaveConfirm}
          loading={false}
          onConfirm={() => {
            const target = pendingNavTarget ?? cancelTarget;
            setPendingNavTarget(null);
            navigate(target);
          }}
          onCancel={() => setPendingNavTarget(null)}
        />
      </div>
    </FormProvider>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string | undefined;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium text-ink-muted"
        >
          {label}
        </label>
        {required && (
          <span aria-hidden="true" className="text-xs text-danger">
            *
          </span>
        )}
      </div>
      {children}
      {error !== undefined && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs text-danger-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
