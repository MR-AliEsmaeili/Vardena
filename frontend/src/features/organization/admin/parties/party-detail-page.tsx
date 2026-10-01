import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { adminErrorMessage } from '../admin-error-messages';
import { AdminLifecycleActions } from '../admin-lifecycle-actions';
import { ActiveBadge, Definition, DefinitionList } from '../admin-ui';
import { PARTY_TYPE_LABELS } from '../party-types';
import { usePartyDetail, usePartyLifecycleMutation } from './party-hooks';

/** One party (`GET /parties/:id`) and its lifecycle transitions. */
export function PartyDetailPage() {
  const organizationId = useOrganizationId();
  const { partyId } = useParams<{ partyId: string }>();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const query = usePartyDetail(organizationId, partyId);
  const lifecycle = usePartyLifecycleMutation(organizationId ?? 'none');

  if (query.isPending) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.partyDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.partyLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const party = query.data;

  return (
    <div className="space-y-4" data-testid="party-detail-page">
      <PageHeader
        title={t.orgAdmin.partyDetail}
        description={`${party.code} — ${party.displayName}`}
        actions={
          <>
            <PermissionGate permission={PERMISSIONS.organization.partyEdit}>
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/app/organization/parties/${encodeURIComponent(party.id)}/edit`}
                >
                  {t.orgAdmin.edit}
                </Link>
              </Button>
            </PermissionGate>
            <AdminLifecycleActions
              isActive={party.isActive}
              canEnable={permissions.has(PERMISSIONS.organization.partyEnable)}
              canDisable={permissions.has(
                PERMISSIONS.organization.partyDisable,
              )}
              pending={lifecycle.isPending}
              onEnable={() =>
                lifecycle.mutateAsync({ partyId: party.id, action: 'enable' })
              }
              onDisable={() =>
                lifecycle.mutateAsync({ partyId: party.id, action: 'disable' })
              }
              errorMessage={(action, error) =>
                adminErrorMessage('party', action, error)
              }
              onConfirmed={(action) =>
                showToast({
                  kind: 'success',
                  message:
                    action === 'enable'
                      ? t.orgAdmin.enabled
                      : t.orgAdmin.disabled,
                })
              }
            />
          </>
        }
      />

      <DefinitionList>
        <Definition label={t.orgAdmin.code}>
          <span className="code">{party.code}</span>
        </Definition>
        <Definition label={t.orgAdmin.displayName}>
          {party.displayName}
        </Definition>
        <Definition label={t.orgAdmin.legalName}>
          {party.legalName ?? (
            <span className="text-slate-500">{t.orgAdmin.notAssigned}</span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.partyType}>
          {PARTY_TYPE_LABELS[party.partyType]}
        </Definition>
        <Definition label={t.orgAdmin.capabilities}>
          <span className="flex flex-wrap gap-1">
            {party.isCustomer && (
              <Badge variant="info">{t.orgAdmin.customer}</Badge>
            )}
            {party.isSupplier && (
              <Badge variant="info">{t.orgAdmin.supplier}</Badge>
            )}
          </span>
        </Definition>
        <Definition label={t.orgAdmin.status}>
          <ActiveBadge active={party.isActive} />
        </Definition>
        <Definition label={t.orgAdmin.email}>
          {party.email === null ? (
            <span className="text-slate-500">{t.orgAdmin.notAssigned}</span>
          ) : (
            <span className="code" dir="ltr">
              {party.email}
            </span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.phone}>
          {party.phone === null ? (
            <span className="text-slate-500">{t.orgAdmin.notAssigned}</span>
          ) : (
            <span className="code" dir="ltr">
              {party.phone}
            </span>
          )}
        </Definition>
        <Definition label={t.orgAdmin.updatedAt}>
          <span className="num">{formatDateTime(party.updatedAt)}</span>
        </Definition>
      </DefinitionList>

      <p className="text-xs text-slate-500">{t.orgAdmin.noDeleteHint}</p>
    </div>
  );
}
