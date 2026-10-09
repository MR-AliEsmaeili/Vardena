import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import type {
  CreateInventoryDocumentInput,
  InventoryDocument,
  InventoryDocumentKind,
  UpdateInventoryDocumentInput,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { getDateTimeSettings, toBusinessDateInput } from '@/lib/datetime';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
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
  type DocumentFormValues,
} from './inventory-document-form-schema';
import {
  useCreateDocumentMutation,
  useUpdateDocumentMutation,
} from './inventory-document-mutations';
import { useDocumentDetail } from './use-inventory-documents';

/** Create a draft, or edit a document that is not yet accounting-posted. */
export function InventoryDocumentFormPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { documentId } = useParams<{ documentId: string }>();
  const [params] = useSearchParams();
  const kindParam = params.get('kind');
  const kind: InventoryDocumentKind =
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

  return (
    <DocumentForm
      organizationId={organizationId}
      references={references}
      kind={detailQuery.data?.kind ?? kind}
      {...(detailQuery.data !== undefined
        ? { document: detailQuery.data }
        : {})}
    />
  );
}

function toFormValues(document: InventoryDocument): DocumentFormValues {
  return {
    kind: document.kind,
    // OQ-73: the API returns the business DAY itself (canonical Gregorian).
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

/**
 * C-63: the business date travels as what the operator authored — a declared
 * Jalali day for a Jalali organization, the canonical Gregorian day otherwise.
 * The backend resolves both to the SAME stored day (a declared `1405-07-16`
 * and a canonical `2026-10-08` are one day), so the request says which calendar
 * the user worked in without the UI ever inventing a day.
 */
function businessDateBody(
  businessDate: string,
): Pick<CreateInventoryDocumentInput, 'businessDate'> {
  if (businessDate === '') return {};
  return {
    businessDate: toBusinessDateInput(
      businessDate,
      getDateTimeSettings().calendarSystem,
    ),
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
    // An empty string CLEARS an assigned receipt cost (contract), so it is
    // sent deliberately rather than omitted.
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
  kind: InventoryDocumentKind;
  document?: InventoryDocument;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isEdit = document !== undefined;

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    mode: 'onSubmit',
    defaultValues:
      document === undefined ? emptyDocumentForm(kind) : toFormValues(document),
  });

  // Re-seed from the server response whenever the authoritative document
  // changes (after a save, or when the detail query refetches).
  useEffect(() => {
    if (document !== undefined) form.reset(toFormValues(document));
  }, [document, form]);

  const createMutation = useCreateDocumentMutation(organizationId);
  const updateMutation = useUpdateDocumentMutation(organizationId);
  const pending = createMutation.isPending || updateMutation.isPending;

  const [sideEffectOpen, setSideEffectOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
      // A material edit is REFUSED until the operator answers explicitly;
      // nothing was applied, so the dialog continues the same intent.
      if (isSideEffectRefusal(error)) {
        setSideEffectOpen(true);
        return;
      }
      setFailure(
        documentErrorMessage(isEdit ? 'update' : 'create', error).message,
      );
    }
  });

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

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${isEdit ? t.inventoryDocuments.editTitle : t.inventoryDocuments.createTitle} — ${documentKindLabel(kind)}`}
        description={
          isEdit
            ? t.inventoryDocuments.editDescription
            : t.inventoryDocuments.createDescription
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/inventory/documents">
              {t.inventoryDocuments.backToList}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        }
      />

      <form onSubmit={(event) => void submit(event)} noValidate>
        <Card className="space-y-6 p-4">
          <DocumentHeaderFields
            form={form}
            references={references}
            kind={kind}
            disabled={pending}
          />
          <DocumentLinesEditor
            form={form}
            references={references}
            disabled={pending}
          />

          {failure !== null ? (
            <p
              role="alert"
              className="text-sm text-rose-700"
              data-testid="document-form-error"
            >
              {failure}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={pending}
              data-testid="submit-document"
            >
              {pending
                ? t.inventoryDocuments.saving
                : isEdit
                  ? t.inventoryDocuments.saveChanges
                  : t.inventoryDocuments.save}
            </Button>
          </div>
        </Card>
      </form>

      <DocumentSideEffectDialog
        open={sideEffectOpen}
        loading={updateMutation.isPending}
        {...(failure !== null && sideEffectOpen ? { error: failure } : {})}
        onConfirm={(decision) => void confirmSideEffects(decision)}
        onCancel={() => setSideEffectOpen(false)}
      />
    </div>
  );
}
