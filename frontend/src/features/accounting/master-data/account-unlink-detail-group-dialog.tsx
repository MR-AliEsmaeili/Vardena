import { useState } from 'react';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { useUnlinkAccountDetailGroupMutation } from './account-admin-hooks';

/** The destructive unlink also clears historical detail allocations on the server. */
export function AccountUnlinkDetailGroupDialog({
  organizationId,
  accountId,
  groupName,
  onClose,
}: {
  organizationId: string;
  accountId: string;
  groupName: string;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mutation = useUnlinkAccountDetailGroupMutation(
    organizationId,
    accountId,
  );
  const { showToast } = useToast();
  return (
    <ConfirmDialog
      open
      danger
      title={t.accountAdmin.unlinkTitle}
      description={<span>{groupName}</span>}
      confirmLabel={t.accountAdmin.unlink}
      confirmDisabled={!acknowledged}
      loading={mutation.isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (!acknowledged || mutation.isPending) return;
        setFailure(null);
        mutation.mutate(undefined, {
          onSuccess: () => {
            showToast({
              kind: 'success',
              message: t.accountAdmin.unlinkSuccess,
            });
            onClose();
          },
          onError: () => setFailure(t.accountAdmin.unlinkFailed),
        });
      }}
      {...(failure !== null ? { error: failure } : {})}
    >
      <div className="space-y-3">
        <Alert variant="danger" role="alert">
          <AlertBody>{t.accountAdmin.unlinkWarning}</AlertBody>
        </Alert>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={mutation.isPending}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {t.accountAdmin.unlinkAcknowledge}
        </label>
      </div>
    </ConfirmDialog>
  );
}
