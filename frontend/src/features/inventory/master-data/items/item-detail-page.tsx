import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getItemGroupAdmin, getUnitAdmin } from '@/api/inventory-master.api';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
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
import { useItemDetail, useItemLifecycleMutation } from './item-hooks';

/**
 * One item (`GET /items/:id`): identity, kind, its base unit and group
 * (resolved with the same detail reads their own pages use), the capability
 * flags as they actually are, and the enable/disable transitions.
 */
export function ItemDetailPage() {
  const organizationId = useOrganizationId();
  const { itemId } = useParams<{ itemId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = useItemDetail(organizationId, itemId);
  const lifecycle = useItemLifecycleMutation(organizationId ?? 'none');

  const baseUnit = useQuery({
    queryKey: queryKeys.inventory.unitDetail(
      organizationId ?? 'none',
      query.data?.baseUnitId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getUnitAdmin(
        organizationId as string,
        query.data?.baseUnitId as string,
        signal,
      ),
    enabled:
      organizationId !== null &&
      typeof query.data?.baseUnitId === 'string' &&
      query.data.baseUnitId !== '',
    staleTime: 5 * 60_000,
  });

  const group = useQuery({
    queryKey: queryKeys.inventory.itemGroupDetail(
      organizationId ?? 'none',
      query.data?.itemGroupId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getItemGroupAdmin(
        organizationId as string,
        query.data?.itemGroupId as string,
        signal,
      ),
    enabled:
      organizationId !== null &&
      typeof query.data?.itemGroupId === 'string' &&
      query.data.itemGroupId !== '',
    staleTime: 5 * 60_000,
  });

  if (query.isPending) return <LoadingState rows={8} label={t.app.loading} />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.items} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.inventoryMaster.errors.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const item = query.data;
  const resource: MasterDataResource = 'item';
  const negativeStockLabel =
    item.allowNegativeStock === null
      ? t.inventoryMaster.negativeStockFollow
      : item.allowNegativeStock
        ? t.inventoryMaster.negativeStockAllow
        : t.inventoryMaster.negativeStockForbid;

  return (
    <div className="space-y-4" data-testid="item-detail-page">
      <PageHeader
        title={item.name}
        description={`${item.code} — ${
          t.inventoryMaster.itemKinds[
            item.itemKind as keyof typeof t.inventoryMaster.itemKinds
          ]
        }`}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.inventory.itemEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/inventory/items/${encodeURIComponent(item.id)}/edit`}
                >
                  {t.inventoryMaster.edit}
                </Link>
              </Button>
            </PermissionGate>
            <MasterDataLifecycleActions
              isActive={item.isActive}
              canEnable={permissions.has(PERMISSIONS.inventory.itemEnable)}
              canDisable={permissions.has(PERMISSIONS.inventory.itemDisable)}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({ itemId: item.id, action: 'enable' })
              }
              onDisable={() =>
                lifecycle.mutateAsync({ itemId: item.id, action: 'disable' })
              }
              errorMessage={(action, error) =>
                masterDataErrorMessage(resource, action, error)
              }
              onConfirmed={(action) =>
                showToast({
                  kind: 'success',
                  message:
                    action === 'enable'
                      ? t.inventoryMaster.itemEnabled
                      : t.inventoryMaster.itemDisabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.inventoryMaster.code}>
          <span className="code">{item.code}</span>
        </Definition>
        <Definition label={t.inventoryMaster.name}>{item.name}</Definition>
        <Definition label={t.inventoryMaster.itemKind}>
          {
            t.inventoryMaster.itemKinds[
              item.itemKind as keyof typeof t.inventoryMaster.itemKinds
            ]
          }
        </Definition>
        <Definition label={t.inventoryMaster.baseUnit}>
          {baseUnit.isPending ? (
            t.app.loading
          ) : baseUnit.data !== undefined ? (
            <Link
              className="text-indigo-700 hover:underline"
              to={`/app/inventory/units/${encodeURIComponent(item.baseUnitId)}`}
            >
              {baseUnit.data.code} — {baseUnit.data.name}
            </Link>
          ) : (
            <span className="code">{item.baseUnitId}</span>
          )}
        </Definition>
        <Definition label={t.inventoryMaster.itemGroup}>
          {item.itemGroupId === null ? (
            t.inventoryMaster.noItemGroup
          ) : group.isPending ? (
            t.app.loading
          ) : group.data !== undefined ? (
            <Link
              className="text-indigo-700 hover:underline"
              to={`/app/inventory/item-groups/${encodeURIComponent(item.itemGroupId)}`}
            >
              {group.data.code} — {group.data.name}
            </Link>
          ) : (
            <span className="code">{item.itemGroupId}</span>
          )}
        </Definition>
        {item.barcode !== null && (
          <Definition label={t.inventoryMaster.barcode}>
            <span className="code">{item.barcode}</span>
          </Definition>
        )}
        {item.description !== null && (
          <Definition label={t.inventoryMaster.description}>
            {item.description}
          </Definition>
        )}
        <Definition label={t.inventoryMaster.allowNegativeStockPolicy}>
          {negativeStockLabel}
        </Definition>
        <Definition label={t.inventoryMaster.status}>
          <MasterDataStatusBadge active={item.isActive} />
        </Definition>
      </DefinitionList>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-800">
          {t.inventoryMaster.flags}
        </h3>
        <div className="flex flex-wrap gap-2">
          {(
            [
              [item.isStockable, t.inventoryMaster.isStockable],
              [item.isPurchasable, t.inventoryMaster.isPurchasable],
              [item.isSellable, t.inventoryMaster.isSellable],
              [item.isValued, t.inventoryMaster.isValued],
              [item.requiresLot, t.inventoryMaster.requiresLot],
              [item.requiresSerial, t.inventoryMaster.requiresSerial],
              [item.requiresExpiry, t.inventoryMaster.requiresExpiry],
            ] as const
          ).map(([value, label]) => (
            <MasterDataStatusBadge key={label} active={value} label={label} />
          ))}
        </div>
      </section>

      <DefinitionList>
        <Definition label={t.inventoryMaster.detail.createdAt}>
          <span className="num" title={item.createdAt}>
            {formatDateTimeWithZone(item.createdAt)}
          </span>
        </Definition>
        <Definition label={t.inventoryMaster.updatedAt}>
          <span className="num" title={item.updatedAt}>
            {formatDateTimeWithZone(item.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-slate-500">
        {t.inventoryMaster.lifecycle.disableBody}
      </p>
    </div>
  );
}
