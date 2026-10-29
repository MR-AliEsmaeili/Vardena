import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormPageHeader } from '@/app/layouts/form-page-header';
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
import { useUnitDetail, useUnitLifecycleMutation } from './unit-hooks';

/** One unit (`GET /units/:id`) with its enable/disable transitions. */
export function UnitDetailPage() {
  const organizationId = useOrganizationId();
  const { unitId } = useParams<{ unitId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = useUnitDetail(organizationId, unitId);
  const lifecycle = useUnitLifecycleMutation(organizationId ?? 'none');

  if (query.isPending) return <LoadingState rows={6} label={t.app.loading} />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.inventoryMaster.units} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.inventoryMaster.errors.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const unit = query.data;
  const resource: MasterDataResource = 'unit';

  return (
    <div className="space-y-4" data-testid="unit-detail-page">
      <FormPageHeader
        title={unit.name}
        description={`${t.inventoryMaster.unitSymbol}: ${unit.symbol ?? t.app.none}`}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.inventory.unitEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/inventory/units/${encodeURIComponent(unit.id)}/edit`}
                >
                  {t.inventoryMaster.edit}
                </Link>
              </Button>
            </PermissionGate>
            <MasterDataLifecycleActions
              isActive={unit.isActive}
              canEnable={permissions.has(PERMISSIONS.inventory.unitEnable)}
              canDisable={permissions.has(PERMISSIONS.inventory.unitDisable)}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({ unitId: unit.id, action: 'enable' })
              }
              onDisable={() =>
                lifecycle.mutateAsync({ unitId: unit.id, action: 'disable' })
              }
              errorMessage={(action, error) =>
                masterDataErrorMessage(resource, action, error)
              }
              onConfirmed={(action) =>
                showToast({
                  kind: 'success',
                  message:
                    action === 'enable'
                      ? t.inventoryMaster.unitEnabled
                      : t.inventoryMaster.unitDisabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.inventoryMaster.code}>
          <span className="code">{unit.code}</span>
        </Definition>
        <Definition label={t.inventoryMaster.name}>{unit.name}</Definition>
        <Definition label={t.inventoryMaster.unitSymbol}>
          {unit.symbol ?? t.app.none}
        </Definition>
        <Definition label={t.inventoryMaster.status}>
          <MasterDataStatusBadge active={unit.isActive} />
        </Definition>
        <Definition label={t.inventoryMaster.detail.createdAt}>
          <span className="num" title={unit.createdAt}>
            {formatDateTimeWithZone(unit.createdAt)}
          </span>
        </Definition>
        <Definition label={t.inventoryMaster.updatedAt}>
          <span className="num" title={unit.updatedAt}>
            {formatDateTimeWithZone(unit.updatedAt)}
          </span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-ink-subtle">
        {t.inventoryMaster.lifecycle.disableBody}
      </p>
    </div>
  );
}
