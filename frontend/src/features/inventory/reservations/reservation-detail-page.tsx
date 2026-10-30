import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { InventoryReservation } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatDateTimeWithZone, formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { useInventoryReferences } from '../use-inventory-references';
import { ReservationReleaseAction } from './reservation-release-action';
import { isMaterialRequestLineReservation } from './reservation-reference';
import { useReservation } from './reservation-hooks';

export function ReservationDetailPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { reservationId } = useParams<{ reservationId: string }>();
  const references = useInventoryReferences(organizationId);
  const reservationQuery = useReservation(organizationId, reservationId);

  if (organizationId === null || reservationQuery.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (reservationQuery.isError) {
    return (
      <div className="space-y-4">
        <DetailHeader />
        <ApiErrorAlert
          error={reservationQuery.error}
          title={t.reservations.detailLoadFailed}
          description={t.reservations.detailLoadFailed}
          onRetry={() => void reservationQuery.refetch()}
        />
      </div>
    );
  }

  const reservation = reservationQuery.data;
  if (reservation === undefined) {
    return (
      <EmptyState
        title={t.errors.notFound}
        description={t.reservations.detailNotFound}
      />
    );
  }

  const materialRequestOwned = isMaterialRequestLineReservation(reservation);
  const item = references.itemById(reservation.itemId);
  const warehouse = references.warehouseById(reservation.warehouseId);
  const enteredUnit = references.unitById(reservation.enteredUnitId);
  const baseUnit = references.unitById(reservation.baseUnitId);
  const createdAtInstant = reservation.createdAt;
  const updatedAtInstant = reservation.updatedAt;
  const releasedAtInstant = reservation.releasedAt;
  const releasedAt =
    releasedAtInstant === null
      ? t.app.none
      : formatDateTimeWithZone(releasedAtInstant);
  const releasedBy = reservation.releasedBy ?? t.app.none;
  const releasedSummary = t.reservations.releasedBannerBody
    .replace('{releasedAt}', releasedAt)
    .replace('{releasedBy}', releasedBy);

  return (
    <div className="space-y-4" data-testid="reservation-detail-page">
      <FormPageHeader
        title={t.reservations.detailTitle}
        description={reservation.id}
        actions={
          <ReservationReleaseAction
            organizationId={organizationId}
            reservation={reservation}
          />
        }
      />

      {references.isFailed ? (
        <Alert
          variant="warning"
          data-testid="reservation-detail-references-unavailable"
        >
          <AlertTitle>{t.reservations.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{t.reservations.referencesUnavailable}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={references.refetch}
              >
                {t.app.retry}
              </Button>
            </div>
          </AlertBody>
        </Alert>
      ) : null}

      {reservation.status === 'released' ? (
        <Alert variant="success" data-testid="reservation-released-banner">
          <AlertTitle>{t.reservations.statuses.released}</AlertTitle>
          <AlertBody>
            <p>{releasedSummary}</p>
          </AlertBody>
        </Alert>
      ) : null}

      {materialRequestOwned ? (
        <Alert
          variant="warning"
          data-testid="material-request-owned-reservation"
        >
          <AlertTitle>{t.reservations.materialRequestOwnedTitle}</AlertTitle>
          <AlertBody>
            <p>{t.reservations.materialRequestOwnedBody}</p>
            {reservation.referenceId !== null ? (
              <p className="mt-1">
                {t.reservations.referenceId}:{' '}
                <span className="code" dir="ltr">
                  {reservation.referenceId}
                </span>
              </p>
            ) : null}
          </AlertBody>
        </Alert>
      ) : null}

      <DefinitionList columns={3}>
        <Definition label={t.reservations.id}>
          <TechnicalValue value={reservation.id} />
        </Definition>
        <Definition label={t.reservations.status}>
          <Badge
            variant={reservation.status === 'active' ? 'success' : 'neutral'}
          >
            {t.reservations.statuses[reservation.status]}
          </Badge>
        </Definition>
        <Definition label={t.reservations.item}>
          {item === undefined
            ? reservation.itemId
            : `${item.code} — ${item.name}`}
        </Definition>
        <Definition label={t.reservations.warehouse}>
          {warehouse === undefined
            ? reservation.warehouseId
            : `${warehouse.code} — ${warehouse.name}`}
        </Definition>
        <Definition label={t.reservations.quantity}>
          <span className="num" dir="ltr">
            {formatQuantity(reservation.quantity)}{' '}
            {enteredUnit?.code ?? reservation.enteredUnitId}
          </span>
        </Definition>
        <Definition label={t.reservations.baseQuantity}>
          <span className="num" dir="ltr">
            {formatQuantity(reservation.baseQuantity)}{' '}
            {baseUnit?.code ?? reservation.baseUnitId}
          </span>
        </Definition>
        <Definition label={t.reservations.conversionFactor}>
          <span className="num" dir="ltr">
            {formatQuantity(reservation.conversionFactor)}
          </span>
        </Definition>
        <Definition label={t.reservations.reference} span>
          <ReservationReference reservation={reservation} />
        </Definition>
        <Definition label={t.reservations.reason} span>
          {reservation.reason ?? t.app.none}
        </Definition>
        <Definition label={t.reservations.operationKey} span>
          <TechnicalValue value={reservation.operationKey} />
        </Definition>
        <Definition label={t.reservations.createdAt}>
          <Timestamp value={createdAtInstant} />
        </Definition>
        <Definition label={t.reservations.updatedAt}>
          <Timestamp value={updatedAtInstant} />
        </Definition>
        <Definition label={t.reservations.releasedAt}>
          {releasedAtInstant === null ? (
            t.app.none
          ) : (
            <Timestamp value={releasedAtInstant} />
          )}
        </Definition>
        <Definition label={t.reservations.releasedBy}>
          {reservation.releasedBy === null ? (
            t.app.none
          ) : (
            <TechnicalValue value={reservation.releasedBy} />
          )}
        </Definition>
        <Definition label={t.reservations.releaseOperationKey} span>
          {reservation.releaseOperationKey === null ? (
            t.app.none
          ) : (
            <TechnicalValue value={reservation.releaseOperationKey} />
          )}
        </Definition>
      </DefinitionList>
    </div>
  );
}

function DetailHeader() {
  return (
    <FormPageHeader
      title={t.reservations.detailTitle}
      description={t.reservations.subtitle}
    />
  );
}

function Timestamp({ value }: { value: string }) {
  return (
    <span dir="ltr" title={value}>
      {formatDateTimeWithZone(value)}
    </span>
  );
}

function TechnicalValue({ value }: { value: string }) {
  return (
    <code className="code break-all select-all" dir="ltr">
      {value}
    </code>
  );
}

function ReservationReference({
  reservation,
}: {
  reservation: InventoryReservation;
}): ReactElement | string {
  if (reservation.referenceType === null && reservation.referenceId === null) {
    return t.app.none;
  }
  const type = isMaterialRequestLineReservation(reservation)
    ? t.reservations.referenceMaterialRequest
    : (reservation.referenceType ?? t.app.none);
  const referenceId = reservation.referenceId;
  return (
    <span>
      {type}
      {referenceId !== null ? (
        <>
          {' — '}
          <TechnicalValue value={referenceId} />
        </>
      ) : null}
    </span>
  );
}
