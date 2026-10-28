import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { useToast } from '@/ui/patterns/toast';
import { Button } from '@/ui/button';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useReleaseReservationMutation } from './reservation-hooks';
import { reservationErrorMessage } from './reservation-error-messages';
import { normalizeApiError } from '@/api/errors';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { Badge } from '@/ui/badge';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { useInventoryReferences } from '../use-inventory-references';
import { useReservation } from './reservation-hooks';
import { newInventoryOperationKey } from '../inventory-mutations';

export function ReservationDetailPage() {
  const organizationId = useOrganizationId();
  const { reservationId } = useParams();
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const references = useInventoryReferences(organizationId);
  const reservationQuery = useReservation(organizationId, reservationId ?? '');

  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseKey, setReleaseKey] = useState(() =>
    newInventoryOperationKey(),
  );
  const [serverError, setServerError] = useState<{
    error: unknown;
    message: string;
  } | null>(null);

  const releaseMutation = useReleaseReservationMutation(organizationId ?? '');

  if (organizationId === null) {
    return <LoadingState rows={4} label={t.app.loading} />;
  }
  if (reservationQuery.isPending) {
    return <LoadingState rows={4} label={t.app.loading} />;
  }
  if (reservationQuery.isError) {
    return (
      <ApiErrorAlert
        error={reservationQuery.error}
        title={t.errors.title}
        onRetry={() => void reservationQuery.refetch()}
      />
    );
  }
  const reservation = reservationQuery.data;
  if (reservation === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.reservations.title} />
        <p>{t.reservations.emptyTitle}</p>
      </div>
    );
  }

  const item = references.itemById(reservation.itemId);
  const warehouse = references.warehouseById(reservation.warehouseId);
  const enteredUnit = references.unitById(reservation.enteredUnitId);
  const baseUnit = references.unitById(reservation.baseUnitId);

  const canRelease =
    reservation.status === 'active' &&
    reservation.referenceType !== 'material_request_line' &&
    permissions.has(PERMISSIONS.inventory.reservationRelease);
  const isMaterialRequestOwned =
    reservation.referenceType === 'material_request_line';
  const canOpenMaterialRequest =
    isMaterialRequestOwned &&
    reservation.referenceId !== null &&
    reservation.referenceId !== '';

  const onConfirmRelease = () => {
    setServerError(null);
    releaseMutation.mutate(
      { reservationId: reservation.id, operationKey: releaseKey },
      {
        onSuccess: () => {
          setReleaseOpen(false);
          setReleaseKey(newInventoryOperationKey());
          void queryClient.invalidateQueries({
            queryKey: queryKeys.inventory.reservationsPrefix(organizationId),
          });
          void reservationQuery.refetch();
          showToast({
            kind: 'success',
            message: t.reservations.releaseSuccess,
          });
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          setServerError({
            error,
            message: reservationErrorMessage('releaseReservation', error)
              .message,
          });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.reservations.title}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/app/inventory/reservations">{t.app.backToPrevious}</Link>
          </Button>
        }
      />
      {serverError !== null && (
        <ApiErrorAlert
          error={serverError.error}
          title={t.errors.title}
          description={serverError.message}
        />
      )}
      {reservation.status === 'released' && (
        <Alert variant="info">
          <AlertTitle>{t.reservations.releasedAlready}</AlertTitle>
          <AlertBody>
            <p>
              {t.reservations.releasedAt}:{' '}
              {reservation.releasedAt === null
                ? '—'
                : formatDateTime(reservation.releasedAt)}
              {reservation.releasedBy === null
                ? ''
                : ` · ${reservation.releasedBy}`}
            </p>
          </AlertBody>
        </Alert>
      )}
      <DefinitionList>
        <Definition label={t.inventory.item}>
          {item === undefined
            ? reservation.itemId
            : `${item.code} — ${item.name}`}
        </Definition>
        <Definition label={t.inventory.warehouse}>
          {warehouse === undefined
            ? reservation.warehouseId
            : `${warehouse.code} — ${warehouse.name}`}
        </Definition>
        <Definition label={t.reservations.quantity}>
          <span dir="ltr" className="num">
            {reservation.quantity} {enteredUnit?.code ?? ''}
          </span>
        </Definition>
        <Definition label={t.reservations.baseQuantity}>
          <span dir="ltr" className="num">
            {reservation.baseQuantity} {baseUnit?.code ?? ''}
          </span>
        </Definition>
        <Definition label={t.reservations.conversionFactor}>
          <span dir="ltr" className="num">
            {reservation.conversionFactor}
          </span>
        </Definition>
        <Definition label={t.reservations.status}>
          <Badge
            variant={reservation.status === 'active' ? 'success' : 'neutral'}
          >
            {reservation.status === 'active'
              ? t.reservations.statuses.active
              : t.reservations.statuses.released}
          </Badge>
        </Definition>
        <Definition label={t.reservations.reason}>
          {reservation.reason === null || reservation.reason === ''
            ? '—'
            : reservation.reason}
        </Definition>
        <Definition label={t.reservations.reference}>
          {isMaterialRequestOwned
            ? t.reservations.referenceMaterialRequest
            : reservation.referenceType === null ||
                reservation.referenceType === ''
              ? '—'
              : reservation.referenceType}
          {reservation.referenceId !== null &&
          reservation.referenceId !== '' ? (
            <span> · {reservation.referenceId}</span>
          ) : null}
        </Definition>
        <Definition label={t.reservations.operationKey}>
          <span
            className="font-mono text-xs text-ink-subtle"
            title={reservation.operationKey}
          >
            {reservation.operationKey}
          </span>
        </Definition>
        <Definition label={t.reservations.createdAt}>
          <time>{formatDateTime(reservation.createdAt)}</time>
        </Definition>
        <Definition label={t.reservations.updatedAt}>
          <time>{formatDateTime(reservation.updatedAt)}</time>
        </Definition>
        <Definition label={t.reservations.releasedAt}>
          {reservation.releasedAt === null ? (
            '—'
          ) : (
            <time>{formatDateTime(reservation.releasedAt)}</time>
          )}
        </Definition>
      </DefinitionList>

      {isMaterialRequestOwned && (
        <div className="rounded-lg border border-line bg-warning-light p-3">
          <p className="text-sm font-medium">
            {t.reservations.materialRequestOwnedTitle}
          </p>
          <p className="mt-1 text-sm">
            {t.reservations.materialRequestOwnedBody}
          </p>
          {canOpenMaterialRequest && (
            <p className="mt-2">
              <Button asChild size="sm">
                <Link
                  to={`/app/inventory/material-requests/${reservation.referenceId}`}
                >
                  {t.reservations.openMaterialRequest}
                </Link>
              </Button>
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {canRelease && (
          <Button
            type="button"
            onClick={() => setReleaseOpen(true)}
            disabled={releaseMutation.isPending}
          >
            {t.reservations.release}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={releaseOpen}
        title={t.reservations.releaseConfirmTitle}
        description={<p>{t.reservations.releaseConfirmBody}</p>}
        confirmLabel={t.reservations.release}
        loading={releaseMutation.isPending}
        loadingLabel={t.inventory.submitting}
        error={
          serverError !== null ? <span>{serverError.message}</span> : undefined
        }
        onConfirm={onConfirmRelease}
        onCancel={() => {
          setReleaseOpen(false);
          setServerError(null);
          setReleaseKey(newInventoryOperationKey());
        }}
      />
    </div>
  );
}
