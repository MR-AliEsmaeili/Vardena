import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getItemGroupAdmin } from '@/api/inventory-master.api';
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
import {
  useItemGroupDetail,
  useItemGroupLifecycleMutation,
} from './item-group-hooks';

/**
 * One item group (`GET /item-groups/:id`) with its parent shown as a link
 * (when it has one) and its enable/disable transitions.
 */
export function ItemGroupDetailPage() {
  const organizationId = useOrganizationId();
  const { itemGroupId } = useParams<{ itemGroupId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = useItemGroupDetail(organizationId, itemGroupId);
  const lifecycle = useItemGroupLifecycleMutation(organizationId ?? 'none');

  // The parent's name needs its own read — enabled only when the record has
  // a parentId, using the SAME detail key the parent's own page would use.
  const parent = useQuery({
    queryKey: queryKeys.inventory.itemGroupDetail(
      organizationId ?? 'none',
      query.data?.parentId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getItemGroupAdmin(
        organizationId as string,
        query.data?.parentId as string,
        signal,
      ),
    enabled:
      organizationId !== null &&
      typeof query.data?.parentId === 'string' &&
      query.data.parentId !== '',
    staleTime: 5 * 60_000,
  });

  if (query.isPending) return <LoadingState rows={6} label={t.app.loading} />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.inventoryMaster.itemGroups} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.inventoryMaster.errors.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const group = query.data;
  const resource: MasterDataResource = 'itemGroup';

  return (
    <div className="space-y-4" data-testid="item-group-detail-page">
      <PageHeader
        title={group.name}
        description={group.code}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.inventory.itemGroupEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/inventory/item-groups/${encodeURIComponent(group.id)}/edit`}
                >
                  {t.inventoryMaster.edit}
                </Link>
              </Button>
            </PermissionGate>
            <MasterDataLifecycleActions
              isActive={group.isActive}
              canEnable={permissions.has(PERMISSIONS.inventory.itemGroupEnable)}
              canDisable={permissions.has(
                PERMISSIONS.inventory.itemGroupDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({
                  itemGroupId: group.id,
                  action: 'enable',
                })
              }
              onDisable={() =>
                lifecycle.mutateAsync({
                  itemGroupId: group.id,
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
                      ? t.inventoryMaster.itemGroupEnabled
                      : t.inventoryMaster.itemGroupDisabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.inventoryMaster.code}>
          <span className="code">{group.code}</span>
        </Definition>
        <Definition label={t.inventoryMaster.name}>{group.name}</Definition>
        <Definition label={t.inventoryMaster.parentGroup}>
          {group.parentId === null ? (
            t.inventoryMaster.noParent
          ) : parent.isPending ? (
            t.app.loading
          ) : parent.data !== undefined ? (
            <Link
              className="text-indigo-700 hover:underline"
              to={`/app/inventory/item-groups/${encodeURIComponent(group.parentId)}`}
            >
              {parent.data.code} — {parent.data.name}
            </Link>
          ) : (
            <span className="code">{group.parentId}</span>
          )}
        </Definition>
        <Definition label={t.inventoryMaster.status}>
          <MasterDataStatusBadge active={group.isActive} />
        </Definition>
        <Definition label={t.inventoryMaster.detail.createdAt}>
          <span className="num" title={group.createdAt}>
            {formatDateTimeWithZone(group.createdAt)}
          </span>
        </Definition>
        <Definition label={t.inventoryMaster.updatedAt}>
          <span className="num" title={group.updatedAt}>
            {formatDateTimeWithZone(group.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-slate-500">
        {t.inventoryMaster.lifecycle.disableBody}
      </p>
    </div>
  );
}
