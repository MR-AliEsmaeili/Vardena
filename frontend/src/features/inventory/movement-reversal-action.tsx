import { useState } from 'react';
import type { InventoryMovement } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { MovementReversalDialog } from './movement-reversal-dialog';

/** A transfer has no single-leg reversal; a mirror is never reversed again. */
export function MovementReversalAction({
  movement,
}: {
  movement: InventoryMovement;
}) {
  const [open, setOpen] = useState(false);
  const transfer =
    movement.transferId !== null ||
    movement.movementType.startsWith('transfer_');
  const reversed =
    movement.reversalOfMovementId !== null ||
    movement.movementType.startsWith('reversal_');
  if (transfer || reversed) {
    const reason = transfer
      ? t.inventory.reverseNotAllowedTransfer
      : t.inventory.reverseNotAllowedAlreadyReversed;
    return (
      <span className="text-xs text-ink-muted" title={reason}>
        {reason}
      </span>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t.inventory.reverse}
      </Button>
      {open && (
        <MovementReversalDialog
          movement={movement}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
