import type { ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { InventoryDocument } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import {
  formatDateOnlyWithCanonical,
  formatDateTimeWithZone,
  formatQuantity,
} from '@/lib/format';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useInventoryReferences } from '../use-inventory-references';
import { DocumentLifecycleActions } from './document-lifecycle-actions';
import { DocumentLinesTable } from './document-lines-table';
import {
  documentKindLabel,
  documentStatusLabel,
  documentStatusTone,
} from './inventory-document-labels';
import { useDocumentDetail } from './use-inventory-documents';

/**
 * One business document: its header facts, its lines, and the lifecycle
 * commands it currently accepts.
 *
 * Which actions are offered comes from the DTO's own `canEdit`/`canFinalize`
 * /`canAccountingPost`/`canSeal`/`canCancel`/`canDelete` flags — the backend
 * states what is legal for THIS document in THIS state for THIS session, and
 * the UI never recomputes that rule locally.
 */
export function InventoryDocumentDetailPage(): ReactElement {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { documentId } = useParams<{ documentId: string }>();
  const references = useInventoryReferences(organizationId);
  const detailQuery = useDocumentDetail(organizationId, documentId);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }
  if (detailQuery.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (detailQuery.isError) {
    return (
      <div className="space-y-4">
        <DetailHeader />
        <ApiErrorAlert
          error={detailQuery.error}
          title={t.inventoryDocuments.detailLoadFailed}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  const document = detailQuery.data;
  if (document === undefined) {
    return (
      <EmptyState
        title={t.inventoryDocuments.notFoundTitle}
        description={t.inventoryDocuments.notFoundBody}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${documentKindLabel(document.kind)} — ${
          document.number ?? t.inventoryDocuments.numberNotAllocated
        }`}
        description={t.inventoryDocuments.permissionNote}
        actions={
          <>
            <DocumentLifecycleActions
              organizationId={organizationId}
              document={document}
              onDeleted={() => navigate('/app/inventory/documents')}
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/app/inventory/documents">
                {t.inventoryDocuments.backToList}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </>
        }
      />

      {document.valuationStale ? (
        <Alert variant="warning" data-testid="valuation-stale-notice">
          <AlertTitle>{t.inventoryDocuments.valuationStaleTitle}</AlertTitle>
          <AlertBody>
            <p>{t.inventoryDocuments.valuationStaleBody}</p>
          </AlertBody>
        </Alert>
      ) : null}

      <DocumentFacts document={document} references={references} />
      <DocumentLinesTable document={document} references={references} />
    </div>
  );
}

function DetailHeader() {
  return (
    <PageHeader
      title={t.inventoryDocuments.detailTitle}
      description={t.inventoryDocuments.subtitle}
    />
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: ReactElement | string;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function DocumentFacts({
  document,
  references,
}: {
  document: InventoryDocument;
  references: ReturnType<typeof useInventoryReferences>;
}) {
  const warehouseName = (id: string | null) => {
    if (id === null) return t.app.none;
    const warehouse = references.warehouseById(id);
    return warehouse === undefined
      ? id
      : `${warehouse.code} — ${warehouse.name}`;
  };

  return (
    <Card className="p-4">
      <dl className="grid gap-4 md:grid-cols-3" data-testid="document-facts">
        <Fact
          label={t.inventoryDocuments.columnStatus}
          value={
            <Badge variant={documentStatusTone(document.status)}>
              {documentStatusLabel(document.status)}
            </Badge>
          }
        />
        <Fact
          label={t.inventoryDocuments.columnDate}
          value={
            // Jalali-first with a canonical Gregorian fallback outside the
            // shared converter range; the underlying API value is still a day.
            <span dir="ltr">
              {formatDateOnlyWithCanonical(document.businessDate)}
            </span>
          }
        />
        <Fact
          label={t.inventoryDocuments.columnNumber}
          value={document.number ?? t.inventoryDocuments.numberNotAllocated}
        />
        {document.kind === 'transfer' ? (
          <>
            <Fact
              label={t.inventoryDocuments.sourceWarehouse}
              value={warehouseName(document.sourceWarehouseId)}
            />
            <Fact
              label={t.inventoryDocuments.destinationWarehouse}
              value={warehouseName(document.destinationWarehouseId)}
            />
          </>
        ) : (
          <Fact
            label={t.inventoryDocuments.warehouse}
            value={warehouseName(document.warehouseId)}
          />
        )}
        {document.cost !== undefined && document.cost !== null ? (
          <Fact
            label={t.inventoryDocuments.cost}
            value={<span className="num">{formatQuantity(document.cost)}</span>}
          />
        ) : null}
        {document.reference !== null ? (
          <Fact
            label={t.inventoryDocuments.reference}
            value={document.reference}
          />
        ) : null}
        {document.description !== null ? (
          <Fact
            label={t.inventoryDocuments.description}
            value={document.description}
          />
        ) : null}
        {document.finalizedAt !== null ? (
          <Fact
            label={t.inventoryDocuments.finalizedAt}
            value={
              <span title={document.finalizedAt}>
                {formatDateTimeWithZone(document.finalizedAt)}
              </span>
            }
          />
        ) : null}
        {document.accountingPostedAt !== null ? (
          <Fact
            label={t.inventoryDocuments.accountingPostedAt}
            value={
              <span title={document.accountingPostedAt}>
                {formatDateTimeWithZone(document.accountingPostedAt)}
              </span>
            }
          />
        ) : null}
        {document.sealedAt !== null ? (
          <Fact
            label={t.inventoryDocuments.sealedAt}
            value={
              <span title={document.sealedAt}>
                {formatDateTimeWithZone(document.sealedAt)}
              </span>
            }
          />
        ) : null}
        {document.cancelledAt !== null ? (
          <Fact
            label={t.inventoryDocuments.cancelledAt}
            value={
              <span title={document.cancelledAt}>
                {formatDateTimeWithZone(document.cancelledAt)}
              </span>
            }
          />
        ) : null}
        {document.cancellationReason !== null ? (
          <Fact
            label={t.inventoryDocuments.cancellationReason}
            value={document.cancellationReason}
          />
        ) : null}
      </dl>
    </Card>
  );
}
