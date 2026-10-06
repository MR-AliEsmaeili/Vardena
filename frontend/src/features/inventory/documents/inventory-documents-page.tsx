import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Label } from '@/ui/label';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useInventoryReferences } from '../use-inventory-references';
import { inventoryDocumentsColumns } from './inventory-documents-columns';
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  documentKindLabel,
  documentStatusLabel,
} from './inventory-document-labels';
import {
  DOCUMENTS_DEFAULT_SORT,
  documentsSortingState,
  hasActiveDocumentFilters,
  useDocumentsList,
  useDocumentsUrlState,
} from './use-inventory-documents';
import type {
  InventoryDocumentKind,
  InventoryDocumentStatus,
} from '@/api/contracts';

/**
 * The inventory business-document workspace: receipts, issues and transfers
 * of the active organization, with the endpoint's declared filters, server
 * paging and sorting — all owned by the URL so a filtered view is
 * shareable and survives Back/Forward (standards.md §5).
 */
export function InventoryDocumentsPage() {
  const organizationId = useOrganizationId();
  const { state, update, clearFilters } = useDocumentsUrlState();
  const references = useInventoryReferences(organizationId);
  const documentsQuery = useDocumentsList(organizationId, state);

  const columns = useMemo(
    () => inventoryDocumentsColumns(references),
    [references],
  );

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const filtersActive = hasActiveDocumentFilters(state);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.inventoryDocuments.title}
        description={t.inventoryDocuments.subtitle}
        actions={<DocumentCreateActions />}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40">
            <Label htmlFor="documents-kind">
              {t.inventoryDocuments.kindFilter}
            </Label>
            <Select
              id="documents-kind"
              data-testid="documents-kind-filter"
              value={state.kind}
              onChange={(event) =>
                update({
                  kind: event.target.value as InventoryDocumentKind | '',
                  page: 1,
                })
              }
            >
              <option value="">{t.inventoryDocuments.allKinds}</option>
              {DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {documentKindLabel(kind)}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-40">
            <Label htmlFor="documents-status">
              {t.inventoryDocuments.statusFilter}
            </Label>
            <Select
              id="documents-status"
              data-testid="documents-status-filter"
              value={state.status}
              onChange={(event) =>
                update({
                  status: event.target.value as InventoryDocumentStatus | '',
                  page: 1,
                })
              }
            >
              <option value="">{t.inventoryDocuments.allStatuses}</option>
              {DOCUMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {documentStatusLabel(status)}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-56">
            <Label htmlFor="documents-warehouse">
              {t.inventoryDocuments.columnWarehouse}
            </Label>
            <Select
              id="documents-warehouse"
              data-testid="documents-warehouse-filter"
              value={state.warehouseId}
              onChange={(event) =>
                update({ warehouseId: event.target.value, page: 1 })
              }
            >
              <option value="">{t.inventoryDocuments.allWarehouses}</option>
              {references.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </Select>
          </div>

          {filtersActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              data-testid="documents-clear-filters"
            >
              {t.app.reset}
            </Button>
          ) : null}
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={documentsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={documentsQuery.isPending}
        isFetching={documentsQuery.isFetching}
        error={documentsQuery.isError ? documentsQuery.error : undefined}
        errorDescription={t.inventoryDocuments.loadFailed}
        onRetry={() => void documentsQuery.refetch()}
        emptyTitle={
          filtersActive
            ? t.table.emptyTitle
            : t.inventoryDocuments.emptyFirstUse
        }
        emptyDescription={
          filtersActive
            ? t.inventoryDocuments.emptyFiltered
            : t.inventoryDocuments.emptyFirstUse
        }
        sorting={documentsSortingState(state.sort)}
        onSortingChange={(sorting) => {
          const first = sorting[0];
          update({
            sort:
              first === undefined
                ? DOCUMENTS_DEFAULT_SORT
                : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          });
        }}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: documentsQuery.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: 1 }),
        }}
        caption={t.inventoryDocuments.listTitle}
      />
    </div>
  );
}

/**
 * Creation CTAs. This gate is UX only: the backend authorizes every command
 * independently, so hiding a button never grants or protects anything.
 */
function DocumentCreateActions() {
  const permissions = usePermissions();
  if (!permissions.has(PERMISSIONS.inventory.documentCreate)) return null;
  return (
    <>
      <Button asChild size="sm">
        <Link
          to="/app/inventory/documents/new?kind=receipt"
          data-testid="new-receipt-document"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t.inventoryDocuments.newReceipt}
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link
          to="/app/inventory/documents/new?kind=issue"
          data-testid="new-issue-document"
        >
          {t.inventoryDocuments.newIssue}
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link
          to="/app/inventory/documents/new?kind=transfer"
          data-testid="new-transfer-document"
        >
          {t.inventoryDocuments.newTransfer}
        </Link>
      </Button>
    </>
  );
}
