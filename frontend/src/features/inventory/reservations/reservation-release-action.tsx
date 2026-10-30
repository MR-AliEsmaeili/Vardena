import { useRef, useState } from 'react';
import type { InventoryReservation } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { newInventoryOperationKey } from '../inventory-mutations';
import { reservationErrorMessage } from './reservation-error-messages';
import { canGenericReleaseReservation } from './reservation-reference';
import { useReleaseReservationMutation } from './reservation-hooks';

/** Terminal, idempotent release; this UI never edits or deletes a reservation. */
export function ReservationReleaseAction({
  organizationId,
  reservation,
}: {
  organizationId: string;
  reservation: InventoryReservation;
}) {
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const canRelease = canGenericReleaseReservation(
    reservation,
    permissions.has(PERMISSIONS.inventory.reservationRelease),
  );
  if (!canRelease) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setOpen(true)}
      >
        {t.reservations.release}
      </Button>
      {open ? (
        <ReservationReleaseDialog
          organizationId={organizationId}
          reservation={reservation}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReservationReleaseDialog({
  organizationId,
  reservation,
  onClose,
}: {
  organizationId: string;
  reservation: InventoryReservation;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const mutation = useReleaseReservationMutation(organizationId);
  const operationKey = useRef(newInventoryOperationKey());
  const [failure, setFailure] = useState<string | null>(null);

  function confirm() {
    if (mutation.isPending || !canGenericReleaseReservation(reservation, true))
      return;
    setFailure(null);
    mutation.mutate(
      {
        reservationId: reservation.id,
        body: { operationKey: operationKey.current },
      },
      {
        onSuccess: () => {
          showToast({
            kind: 'success',
            message: t.reservations.releaseSuccess,
          });
          onClose();
        },
        onError: (error) => {
          const apiError = normalizeApiError(error);
          if (apiError.isUnauthorized) return;
          setFailure(reservationErrorMessage('release', error).message);
        },
      },
    );
  }

  return (
    <ConfirmDialog
      open
      danger
      title={t.reservations.releaseConfirmTitle}
      description={t.reservations.releaseConfirmBody}
      confirmLabel={t.reservations.releaseConfirm}
      loading={mutation.isPending}
      loadingLabel={t.reservations.releasing}
      error={failure}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}
