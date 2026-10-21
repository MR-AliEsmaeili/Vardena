import { useState } from 'react';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import type { MasterDataErrorMessage } from './master-data-errors';

/**
 * Enable / disable for one inventory master-data record.
 *
 * There is **no delete**: the inventory master-data controllers expose no
 * DELETE at all and the lifecycle is the `is_active` flag
 * (master-data-strategy.md §7.4, OQ-36). The UI offers exactly the two
 * transitions the backend has.
 *
 * Both transitions go through `ConfirmDialog` (standards.md §11): the dialog
 * states the CONSEQUENCE, the primary action is disabled while the request is
 * in flight, and on failure the dialog stays open with the mapped Persian
 * error inside it. Nothing is applied optimistically.
 */

export type LifecycleAction = 'enable' | 'disable';

export interface MasterDataLifecycleActionsProps {
  isActive: boolean;
  /** UX gating only (AR-21): the backend authorizes the call regardless. */
  canEnable: boolean;
  canDisable: boolean;
  pending: boolean;
  /** Resolves when the server confirmed; rejects with the API error. */
  onEnable: () => Promise<unknown>;
  onDisable: () => Promise<unknown>;
  /** Maps a failure to operation-scoped Persian copy. */
  errorMessage: (
    action: LifecycleAction,
    error: unknown,
  ) => MasterDataErrorMessage;
  /** Called after the backend confirmed (the caller owns the success toast). */
  onConfirmed: (action: LifecycleAction) => void;
}

export function MasterDataLifecycleActions({
  isActive,
  canEnable,
  canDisable,
  pending,
  onEnable,
  onDisable,
  errorMessage,
  onConfirmed,
}: MasterDataLifecycleActionsProps) {
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const [failure, setFailure] = useState<MasterDataErrorMessage | null>(null);

  const start = (action: LifecycleAction) => {
    setFailure(null);
    setOpen(action);
  };

  const close = () => {
    if (pending) return; // the request is in flight; the dialog stays
    setOpen(null);
    setFailure(null);
  };

  const confirm = () => {
    const action = open;
    if (action === null || pending) return;
    setFailure(null);
    void (action === 'enable' ? onEnable() : onDisable()).then(
      () => {
        setOpen(null);
        onConfirmed(action);
      },
      (error: unknown) => {
        setFailure(errorMessage(action, error));
      },
    );
  };

  const action: LifecycleAction = isActive ? 'disable' : 'enable';
  const allowed = isActive ? canDisable : canEnable;
  if (!allowed) return null;

  return (
    <>
      <Button
        type="button"
        variant={isActive ? 'outline' : 'default'}
        size="sm"
        onClick={() => start(action)}
        data-testid={`inventory-master-${action}`}
      >
        {isActive ? t.inventoryMaster.disable : t.inventoryMaster.enable}
      </Button>

      <ConfirmDialog
        open={open !== null}
        danger={open === 'disable'}
        title={
          open === 'disable'
            ? t.inventoryMaster.lifecycle.disableTitle
            : t.inventoryMaster.lifecycle.enableTitle
        }
        description={
          open === 'disable'
            ? t.inventoryMaster.lifecycle.disableBody
            : t.inventoryMaster.lifecycle.enableBody
        }
        confirmLabel={
          open === 'disable'
            ? t.inventoryMaster.disable
            : t.inventoryMaster.enable
        }
        loading={pending}
        loadingLabel={
          open === 'disable'
            ? t.inventoryMaster.disabling
            : t.inventoryMaster.enabling
        }
        onConfirm={confirm}
        onCancel={close}
        {...(failure !== null ? { error: failure.message } : {})}
      />
    </>
  );
}
