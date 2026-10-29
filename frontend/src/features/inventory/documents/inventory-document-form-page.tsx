import { FileSpreadsheet, Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as inventoryApi from '@/api/inventory.api';
import { queryKeys } from '@/api/query-keys';
import type {
  CreateInventoryDocumentInput,
  InventoryDocument,
  UpdateInventoryDocumentInput,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { isBusinessDay, toBusinessDateInput } from '@/lib/datetime';
import { sumExactDecimals } from '@/lib/decimal';
import { exportRowsToExcelCsv, printCurrentSurface } from '@/lib/export-table';
import { formatCount, formatDateOnly, formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { Button } from '@/ui/button';
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
import { useInventoryReferences } from '../use-inventory-references';
import { DocumentHeaderFields } from './document-header-fields';
import { DocumentLinesEditor } from './document-lines-editor';
import {
  DocumentSideEffectDialog,
  type SideEffectDecision,
} from './document-side-effect-dialog';
import {
  documentErrorMessage,
  isSideEffectRefusal,
} from './inventory-document-errors';
import { documentKindLabel } from './inventory-document-labels';
import {
  documentFormSchema,
  emptyDocumentForm,
  isDocumentFormKind,
  type DocumentFormKind,
  type DocumentFormValues,
} from './inventory-document-form-schema';
import {
  useCreateDocumentMutation,
  useUpdateDocumentMutation,
} from './inventory-document-mutations';
import { useDocumentDetail } from './use-inventory-documents';

type EditableInventoryDocument = Omit<InventoryDocument, 'kind'> & {
  kind: DocumentFormKind;
};

function isEditableInventoryDocument(
  document: InventoryDocument,
): document is EditableInventoryDocument {
  return isDocumentFormKind(document.kind);
}

/** Create a draft, or edit a document that is not yet accounting-posted. */
export function InventoryDocumentFormPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { documentId } = useParams<{ documentId: string }>();
  const [params] = useSearchParams();
  const kindParam = params.get('kind');
  const kind: DocumentFormKind =
    kindParam === 'issue' || kindParam === 'transfer' ? kindParam : 'receipt';

  const references = useInventoryReferences(organizationId);
  const detailQuery = useDocumentDetail(organizationId, documentId);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }
  if (
    references.isLoading ||
    (documentId !== undefined && detailQuery.isPending)
  ) {
    return <LoadingState rows={6} label={t.filters.referencesLoading} />;
  }
  if (references.isFailed) {
    return (
      <ApiErrorAlert
        error={new Error(t.inventory.referencesLoadingFailed)}
        title={t.inventory.referencesLoadingFailed}
        onRetry={references.refetch}
      />
    );
  }
  if (documentId !== undefined && detailQuery.isError) {
    return (
      <ApiErrorAlert
        error={detailQuery.error}
        title={t.inventoryDocuments.detailLoadFailed}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const document = detailQuery.data;
  if (document !== undefined && !isEditableInventoryDocument(document)) {
    return (
      <ApiErrorAlert
        error={new Error(t.inventoryDocuments.unsupportedEditKind)}
        title={t.inventoryDocuments.editTitle}
        description={t.inventoryDocuments.unsupportedEditKind}
      />
    );
  }

  return (
    <DocumentForm
      key={document?.id ?? `new-${kind}`}
      organizationId={organizationId}
      references={references}
      kind={document?.kind ?? kind}
      {...(document !== undefined ? { document } : {})}
    />
  );
}

function toFormValues(document: EditableInventoryDocument): DocumentFormValues {
  return {
    kind: document.kind,
    businessDate: document.businessDate,
    warehouseId: document.warehouseId ?? '',
    sourceWarehouseId: document.sourceWarehouseId ?? '',
    destinationWarehouseId: document.destinationWarehouseId ?? '',
    cost: document.cost ?? '',
    description: document.description ?? '',
    reference: document.reference ?? '',
    lines: document.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitId: line.unitId,
    })),
  };
}

function businessDateBody(
  businessDate: string,
): Pick<CreateInventoryDocumentInput, 'businessDate'> {
  if (businessDate === '') return {};
  return {
    businessDate: toBusinessDateInput(businessDate),
  };
}

function toCreateBody(
  values: DocumentFormValues,
): Omit<CreateInventoryDocumentInput, 'organizationId'> {
  const transfer = values.kind === 'transfer';
  return {
    kind: values.kind,
    ...businessDateBody(values.businessDate),
    ...(transfer
      ? {
          sourceWarehouseId: values.sourceWarehouseId,
          destinationWarehouseId: values.destinationWarehouseId,
        }
      : { warehouseId: values.warehouseId }),
    ...(values.kind === 'receipt' && values.cost !== ''
      ? { cost: values.cost }
      : {}),
    ...(values.description !== '' ? { description: values.description } : {}),
    ...(values.reference !== '' ? { reference: values.reference } : {}),
    lines: values.lines,
  };
}

function toUpdateBody(
  values: DocumentFormValues,
): UpdateInventoryDocumentInput {
  const transfer = values.kind === 'transfer';
  return {
    ...businessDateBody(values.businessDate),
    ...(transfer
      ? {
          sourceWarehouseId: values.sourceWarehouseId,
          destinationWarehouseId: values.destinationWarehouseId,
        }
      : { warehouseId: values.warehouseId }),
    ...(values.kind === 'receipt' ? { cost: values.cost } : {}),
    description: values.description,
    reference: values.reference,
    lines: values.lines,
  };
}

function DocumentForm({
  organizationId,
  references,
  kind,
  document,
}: {
  organizationId: string;
  references: ReturnType<typeof useInventoryReferences>;
  kind: DocumentFormKind;
  document?: EditableInventoryDocument;
}): ReactElement {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const isEdit = document !== undefined;

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    mode: 'onSubmit',
    defaultValues:
      document === undefined ? emptyDocumentForm(kind) : toFormValues(document),
  });

  useEffect(() => {
    if (document !== undefined) form.reset(toFormValues(document));
  }, [document, form]);

  const createMutation = useCreateDocumentMutation(organizationId);
  const updateMutation = useUpdateDocumentMutation(organizationId);
  const pending = createMutation.isPending || updateMutation.isPending;

  const [sideEffectOpen, setSideEffectOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);

  const isDirty = form.formState.isDirty;
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

  const canListDocuments =
    isEdit &&
    permissions.loaded &&
    permissions.has(PERMISSIONS.inventory.documentView) &&
    'listInventoryDocuments' in inventoryApi &&
    typeof inventoryApi.listInventoryDocuments === 'function';

  const neighborsQuery = useQuery({
    queryKey: queryKeys.inventory.documents(organizationId, {
      page: 1,
      pageSize: 100,
    }),
    queryFn: async ({ signal }) =>
      (await inventoryApi.listInventoryDocuments(
        {
          organizationId,
          page: 1,
          pageSize: 100,
        },
        signal,
      )) ?? null,
    enabled: canListDocuments,
    staleTime: 30_000,
  });

  const editableNeighbors = useMemo(
    () =>
      (neighborsQuery.data?.items ?? []).filter(
        (item) => item.canEdit && isDocumentFormKind(item.kind),
      ),
    [neighborsQuery.data],
  );
  const currentNeighborIndex =
    document !== undefined
      ? editableNeighbors.findIndex((item) => item.id === document.id)
      : -1;

  const navigateWithDirtyGuard = (target: string) => {
    if (isDirty) {
      setPendingNavTarget(target);
    } else {
      navigate(target);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      if (!isEdit) {
        const created = await createMutation.mutateAsync(toCreateBody(values));
        showToast({ kind: 'success', message: t.inventoryDocuments.created });
        navigate(`/app/inventory/documents/${created.id}`);
        return;
      }
      await updateMutation.mutateAsync({
        documentId: document.id,
        values: toUpdateBody(values),
      });
      showToast({ kind: 'success', message: t.inventoryDocuments.updated });
      navigate(`/app/inventory/documents/${document.id}`);
    } catch (error) {
      if (isSideEffectRefusal(error)) {
        setSideEffectOpen(true);
        return;
      }
      setFailure(
        documentErrorMessage(isEdit ? 'update' : 'create', error).message,
      );
    }
  });

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
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

  const confirmSideEffects = async (decision: SideEffectDecision) => {
    if (document === undefined) return;
    setFailure(null);
    try {
      await updateMutation.mutateAsync({
        documentId: document.id,
        values: { ...toUpdateBody(form.getValues()), ...decision },
      });
      setSideEffectOpen(false);
      showToast({ kind: 'success', message: t.inventoryDocuments.updated });
      navigate(`/app/inventory/documents/${document.id}`);
    } catch (error) {
      setFailure(documentErrorMessage('update', error).message);
    }
  };

  const watchedLines = useWatch({ control: form.control, name: 'lines' });
  const watchedDate = form.watch('businessDate');
  const watchedWarehouseId = form.watch('warehouseId');
  const watchedSourceWarehouseId = form.watch('sourceWarehouseId');
  const watchedDestinationWarehouseId = form.watch('destinationWarehouseId');

  const headerCanCollapse = useMemo(() => {
    const dateValid = watchedDate === '' || isBusinessDay(watchedDate);
    if (!dateValid) return false;
    if (kind === 'transfer') {
      return (
        watchedSourceWarehouseId !== '' &&
        watchedDestinationWarehouseId !== '' &&
        watchedSourceWarehouseId !== watchedDestinationWarehouseId
      );
    }
    return watchedWarehouseId !== '';
  }, [
    kind,
    watchedDate,
    watchedDestinationWarehouseId,
    watchedSourceWarehouseId,
    watchedWarehouseId,
  ]);

  const hasHeaderErrors =
    !headerCanCollapse &&
    (form.formState.errors.businessDate !== undefined ||
      form.formState.errors.warehouseId !== undefined ||
      form.formState.errors.sourceWarehouseId !== undefined ||
      form.formState.errors.destinationWarehouseId !== undefined ||
      form.formState.errors.cost !== undefined);

  const summaryChips = useMemo<HeaderSummaryChip[]>(() => {
    const chips: HeaderSummaryChip[] = [
      {
        label: t.inventoryDocuments.columnNumber,
        value: document?.number ?? t.inventoryDocuments.numberNotAllocated,
      },
      {
        label: t.inventoryDocuments.columnDate,
        value: watchedDate ? formatDateOnly(watchedDate) : t.app.none,
      },
      {
        label: t.inventoryDocuments.columnKind,
        value: documentKindLabel(kind),
      },
    ];
    if (kind !== 'transfer' && watchedWarehouseId !== '') {
      const wh = references.warehouseById(watchedWarehouseId);
      if (wh !== undefined) {
        chips.push({
          label: t.inventoryDocuments.warehouse,
          value: wh.name,
        });
      }
    }
    return chips;
  }, [document?.number, kind, references, watchedDate, watchedWarehouseId]);

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const quantities = (watchedLines ?? []).map((line) => line.quantity);
    const totalQty = sumExactDecimals(quantities, 0);
    return [
      {
        label: t.operationalForm.totalQuantity,
        value: formatQuantity(totalQty),
        emphasize: true,
      },
      {
        label: t.operationalForm.lineCount,
        value: formatCount((watchedLines ?? []).length),
      },
    ];
  }, [watchedLines]);

  const handleExportExcel = () => {
    exportRowsToExcelCsv(
      `inventory-document-${document?.number ?? kind}`,
      [
        {
          header: t.inventoryDocuments.lineNumber,
          value: (row) => row.lineNo,
        },
        {
          header: t.inventoryDocuments.lineItem,
          value: (row) => references.itemById(row.itemId)?.name ?? row.itemId,
        },
        {
          header: t.inventoryDocuments.lineQuantity,
          value: (row) => row.quantity,
        },
        {
          header: t.inventoryDocuments.lineUnit,
          value: (row) => references.unitById(row.unitId)?.name ?? row.unitId,
        },
      ],
      (watchedLines ?? []).map((line, idx) => ({
        lineNo: idx + 1,
        ...line,
      })),
    );
  };

  const cancelTarget = isEdit
    ? `/app/inventory/documents/${document.id}`
    : '/app/inventory/documents';

  return (
    <div className="space-y-4">
      <FormPageHeader
        title={`${isEdit ? t.inventoryDocuments.editTitle : t.inventoryDocuments.createTitle} — ${documentKindLabel(kind)}`}
        description={
          isEdit
            ? t.inventoryDocuments.editDescription
            : t.inventoryDocuments.createDescription
        }
      />

      <form onSubmit={(event) => void submit(event)} noValidate>
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
            </OperationalToolbar>
          }
          header={
            <CollapsibleHeader
              title={t.documents.headerSection}
              summaryChips={summaryChips}
              canCollapse={headerCanCollapse}
              hasRequiredErrors={hasHeaderErrors}
              onCollapseBlocked={() => {
                void form.trigger(
                  kind === 'transfer'
                    ? [
                        'businessDate',
                        'sourceWarehouseId',
                        'destinationWarehouseId',
                      ]
                    : ['businessDate', 'warehouseId'],
                );
              }}
            >
              <DocumentHeaderFields
                form={form}
                references={references}
                kind={kind}
                disabled={pending}
              />
            </CollapsibleHeader>
          }
          detail={
            <DocumentLinesEditor
              form={form}
              references={references}
              disabled={pending}
            />
          }
          summary={<OperationalSummary rows={summaryRows} />}
          footer={
            <OperationalFooter
              start={
                isEdit &&
                permissions.loaded &&
                permissions.has(PERMISSIONS.inventory.documentCreate) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      navigateWithDirtyGuard(
                        `/app/inventory/documents/new?kind=${kind}`,
                      )
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {t.operationalForm.newDocument}
                  </Button>
                ) : undefined
              }
              center={
                isEdit && currentNeighborIndex >= 0 ? (
                  <DocumentPaginationControl
                    currentIndex={currentNeighborIndex}
                    totalCount={editableNeighbors.length}
                    hasPrev={currentNeighborIndex > 0}
                    hasNext={
                      currentNeighborIndex < editableNeighbors.length - 1
                    }
                    disabled={pending}
                    onPrev={() => {
                      const prevDoc =
                        editableNeighbors[currentNeighborIndex - 1];
                      if (prevDoc !== undefined) {
                        navigateWithDirtyGuard(
                          `/app/inventory/documents/${prevDoc.id}/edit`,
                        );
                      }
                    }}
                    onNext={() => {
                      const nextDoc =
                        editableNeighbors[currentNeighborIndex + 1];
                      if (nextDoc !== undefined) {
                        navigateWithDirtyGuard(
                          `/app/inventory/documents/${nextDoc.id}/edit`,
                        );
                      }
                    }}
                  />
                ) : undefined
              }
              end={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => navigateWithDirtyGuard(cancelTarget)}
                  >
                    {t.app.cancel}
                  </Button>
                  <Button
                    type="submit"
                    disabled={pending}
                    loading={pending}
                    data-testid="submit-document"
                  >
                    {pending
                      ? t.inventoryDocuments.saving
                      : isEdit
                        ? t.inventoryDocuments.saveChanges
                        : t.inventoryDocuments.save}
                  </Button>
                </>
              }
            />
          }
        >
          {failure !== null ? (
            <p
              role="alert"
              className="text-sm text-danger-ink"
              data-testid="document-form-error"
            >
              {failure}
            </p>
          ) : null}
        </OperationalFormShell>
      </form>

      <DocumentSideEffectDialog
        open={sideEffectOpen}
        loading={updateMutation.isPending}
        {...(failure !== null && sideEffectOpen ? { error: failure } : {})}
        onConfirm={(decision) => void confirmSideEffects(decision)}
        onCancel={() => setSideEffectOpen(false)}
      />

      <ConfirmDialog
        open={pendingNavTarget !== null}
        title={t.operationalForm.unsavedNavigationTitle}
        description={<p>{t.operationalForm.unsavedNavigationBody}</p>}
        confirmLabel={t.operationalForm.unsavedNavigationConfirm}
        loading={false}
        onConfirm={() => {
          const target = pendingNavTarget ?? cancelTarget;
          setPendingNavTarget(null);
          navigate(target);
        }}
        onCancel={() => setPendingNavTarget(null)}
      />
    </div>
  );
}
