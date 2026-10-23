import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  masterDataErrorMessage,
  type MasterDataResource,
} from '../master-data-errors';
import { MasterDataLifecycleActions } from '../master-data-lifecycle-actions';
import {
  Definition,
  DefinitionList,
  MasterDataStatusBadge,
} from '../master-data-ui';
import {
  useWarehouseDetail,
  useWarehouseLifecycleMutation,
} from './warehouse-hooks';

/** One warehouse (`GET /warehouses/:id`) with its policies and lifecycle. */
export function WarehouseDetailPage() {
  const organizationId = useOrganizationId();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = useWarehouseDetail(organizationId, warehouseId);
  const lifecycle = useWarehouseLifecycleMutation(organizationId ?? 'none');

  if (query.isPending) return <LoadingState rows={7} label={t.app.loading} />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.warehouses} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.inventoryMaster.errors.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const warehouse = query.data;
  const resource: MasterDataResource = 'warehouse';

  return (
    <div className="space-y-4" data-testid="warehouse-detail-page">
      <PageHeader
        title={warehouse.name}
        description={warehouse.code}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.inventory.warehouseEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/inventory/warehouses/${encodeURIComponent(warehouse.id)}/edit`}
                >
                  {t.inventoryMaster.edit}
                </Link>
              </Button>
            </PermissionGate>
            <MasterDataLifecycleActions
              isActive={warehouse.isActive}
              canEnable={permissions.has(PERMISSIONS.inventory.warehouseEnable)}
              canDisable={permissions.has(
                PERMISSIONS.inventory.warehouseDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({
                  warehouseId: warehouse.id,
                  action: 'enable',
                })
              }
              onDisable={() =>
                lifecycle.mutateAsync({
                  warehouseId: warehouse.id,
                  action: 'disable',
                })
              }
              errorMessage={(action, error) =>
                masterDataErrorMessage(resource, action, error)
              }
              onConfirmed={(action) =>
                showToast({
                  kind: 'success',
                  message:
                    action === 'enable'
                      ? t.inventoryMaster.warehouseEnabled
                      : t.inventoryMaster.warehouseDisabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.inventoryMaster.code}>
          <span className="code">{warehouse.code}</span>
        </Definition>
        <Definition label={t.inventoryMaster.name}>{warehouse.name}</Definition>
        <Definition label={t.inventoryMaster.branch}>
          <span className="code">{warehouse.branchId}</span>
        </Definition>
        <Definition label={t.inventoryMaster.status}>
          <MasterDataStatusBadge active={warehouse.isActive} />
        </Definition>
        <Definition label={t.inventoryMaster.allowNegativeStockPolicy}>
          <MasterDataStatusBadge active={warehouse.allowNegativeStock} />
        </Definition>
        <Definition label={t.inventoryMaster.reservationsReduceAvailable}>
          <MasterDataStatusBadge
            active={warehouse.reservationsReduceAvailable}
          />
        </Definition>
        <Definition label={t.inventoryMaster.accountingPostingMode}>
          <Badge
            variant={
              warehouse.accountingPostingMode === 'draft' ? 'info' : 'neutral'
            }
          >
            {warehouse.accountingPostingMode === 'draft'
              ? t.inventoryMaster.postingModes.draft
              : t.inventoryMaster.postingModes.direct_final}
          </Badge>
        </Definition>
        <Definition label={t.inventoryMaster.detail.createdAt}>
          <span className="num" title={warehouse.createdAt}>
            {formatDateTimeWithZone(warehouse.createdAt)}
          </span>
        </Definition>
        <Definition label={t.inventoryMaster.updatedAt}>
          <span className="num" title={warehouse.updatedAt}>
            {formatDateTimeWithZone(warehouse.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-ink-subtle">
        {t.inventoryMaster.lifecycle.disableBody}
      </p>
    </div>
  );
}
