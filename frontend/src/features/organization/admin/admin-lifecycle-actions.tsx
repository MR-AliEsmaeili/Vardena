import { useState } from 'react';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import type { AdminErrorMessage } from './admin-error-messages';

/**
 * Enable / disable for one organization master-data record.
 *
 * There is **no delete**: the organization controllers expose no DELETE at
 * all and the lifecycle of this master data is the `is_active` flag
 * (`docs/architecture/domain/master-data-strategy.md` §7.4, OQ-36). The UI
 * therefore offers exactly the two transitions the backend has.
 *
 * Both transitions go through `ConfirmDialog` (standards.md §11): the dialog
 * states the CONSEQUENCE, the primary action is disabled while the request is
 * in flight (no double submit), and on failure the dialog stays open with the
 * mapped Persian error inside it. Nothing is applied optimistically — the
 * caller's mutation writes the server's own response into the cache.
 */

export type LifecycleAction = 'enable' | 'disable';

export interface AdminLifecycleActionsProps {
  isActive: boolean;
  /** UX gating only (AR-21): the backend authorizes the call regardless. */
  canEnable: boolean;
  canDisable: boolean;
  pending: boolean;
  /** Resolves when the server confirmed; rejects with the API error. */
  onEnable: () => Promise<unknown>;
  onDisable: () => Promise<unknown>;
  /** Maps a failure to operation-scoped Persian copy. */
  errorMessage: (action: LifecycleAction, error: unknown) => AdminErrorMessage;
  /** Called after the backend confirmed (the caller owns the success toast). */
  onConfirmed: (action: LifecycleAction) => void;
  enableTitle?: string;
  enableBody?: string;
  disableTitle?: string;
  disableBody?: string;
}

export function AdminLifecycleActions({
  isActive,
  canEnable,
  canDisable,
  pending,
  onEnable,
  onDisable,
  errorMessage,
  onConfirmed,
  enableTitle = t.orgAdmin.enableTitle,
  enableBody = t.orgAdmin.enableBody,
  disableTitle = t.orgAdmin.disableTitle,
  disableBody = t.orgAdmin.disableBody,
}: AdminLifecycleActionsProps) {
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const [failure, setFailure] = useState<AdminErrorMessage | null>(null);

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
        data-testid={`org-admin-${action}`}
      >
        {isActive ? t.orgAdmin.disable : t.orgAdmin.enable}
      </Button>

      <ConfirmDialog
        open={open !== null}
        danger={open === 'disable'}
        title={open === 'disable' ? disableTitle : enableTitle}
        description={open === 'disable' ? disableBody : enableBody}
        confirmLabel={
          open === 'disable' ? t.orgAdmin.disable : t.orgAdmin.enable
        }
        loading={pending}
        loadingLabel={
          open === 'disable' ? t.orgAdmin.disabling : t.orgAdmin.enabling
        }
        onConfirm={confirm}
        onCancel={close}
        {...(failure !== null ? { error: failure.message } : {})}
      />
    </>
  );
}
