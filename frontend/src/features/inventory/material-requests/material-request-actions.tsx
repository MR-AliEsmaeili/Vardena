import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Send, Trash2 } from 'lucide-react';
import type { MaterialRequestDetail } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { materialRequestErrorMessage } from './material-request-error-messages';
import {
  useDeleteMaterialRequestMutation,
  useSubmitMaterialRequestMutation,
} from './material-request-hooks';
import {
  isMaterialRequestDeletable,
  isMaterialRequestEditable,
  isMaterialRequestSubmittable,
} from './material-request-status';

/**
 * The AUTHORING actions of one request (INV-06): edit, submit for approval,
 * delete a draft. Approval, rejection, return-for-correction, approval
 * reversal, cancellation (INV-07) and line invocation (BLOCKED in
 * `task/OUT-OF-SCOPE.md`) are deliberately absent — not even disabled.
 */
export function MaterialRequestActions({
  organizationId,
  request,
}: {
  organizationId: string;
  request: MaterialRequestDetail;
}): ReactElement | null {
  const permissions = usePermissions();
  const [dialog, setDialog] = useState<'submit' | 'delete' | null>(null);

  const canEdit =
    permissions.has(PERMISSIONS.inventory.materialRequestEdit) &&
    isMaterialRequestEditable(request.status);
  const canSubmit =
    permissions.has(PERMISSIONS.inventory.materialRequestSubmit) &&
    isMaterialRequestSubmittable(request.status);
  const canDelete =
    permissions.has(PERMISSIONS.inventory.materialRequestDelete) &&
    isMaterialRequestDeletable(request.status);

  if (!canEdit && !canSubmit && !canDelete) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/app/inventory/material-requests/${request.id}/edit`}
            data-testid="material-request-edit"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            {t.materialRequests.edit}
          </Link>
        </Button>
      ) : null}
      {canSubmit ? (
        <>
          <Button
            type="button"
            size="sm"
            onClick={() => setDialog('submit')}
            data-testid="material-request-submit"
          >
            <Send className="h-4 w-4" aria-hidden />
            {t.materialRequests.submit}
          </Button>
          {dialog === 'submit' ? (
            <SubmitDialog
              organizationId={organizationId}
              request={request}
              onClose={() => setDialog(null)}
            />
          ) : null}
        </>
      ) : null}
      {canDelete ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => setDialog('delete')}
            data-testid="material-request-delete"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t.materialRequests.delete}
          </Button>
          {dialog === 'delete' ? (
            <DeleteDialog
              organizationId={organizationId}
              request={request}
              onClose={() => setDialog(null)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SubmitDialog({
  organizationId,
  request,
  onClose,
}: {
  organizationId: string;
  request: MaterialRequestDetail;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const mutation = useSubmitMaterialRequestMutation(organizationId);
  const [failure, setFailure] = useState<string | null>(null);

  function confirm() {
    if (mutation.isPending) return;
    setFailure(null);
    mutation.mutate(request.id, {
      onSuccess: (submitted) => {
        showToast({
          kind: 'success',
          message:
            submitted.number === null
              ? t.materialRequests.submitted
              : t.materialRequests.submittedNumber.replace(
                  '{number}',
                  submitted.number,
                ),
        });
        onClose();
      },
      onError: (error) => {
        const apiError = normalizeApiError(error);
        if (apiError.isUnauthorized) return;
        setFailure(materialRequestErrorMessage('submit', error).message);
      },
    });
  }

  return (
    <ConfirmDialog
      open
      title={t.materialRequests.submitConfirmTitle}
      description={t.materialRequests.submitConfirmBody}
      confirmLabel={t.materialRequests.submit}
      loading={mutation.isPending}
      loadingLabel={t.materialRequests.submitting}
      error={failure}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}

function DeleteDialog({
  organizationId,
  request,
  onClose,
}: {
  organizationId: string;
  request: MaterialRequestDetail;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useDeleteMaterialRequestMutation(organizationId);
  const [failure, setFailure] = useState<string | null>(null);

  function confirm() {
    if (mutation.isPending) return;
    setFailure(null);
    mutation.mutate(request.id, {
      onSuccess: () => {
        showToast({ kind: 'success', message: t.materialRequests.deleted });
        onClose();
        navigate('/app/inventory/material-requests');
      },
      onError: (error) => {
        const apiError = normalizeApiError(error);
        if (apiError.isUnauthorized) return;
        setFailure(materialRequestErrorMessage('delete', error).message);
      },
    });
  }

  return (
    <ConfirmDialog
      open
      danger
      title={t.materialRequests.deleteConfirmTitle}
      description={t.materialRequests.deleteConfirmBody}
      confirmLabel={t.materialRequests.delete}
      loading={mutation.isPending}
      loadingLabel={t.materialRequests.deleting}
      error={failure}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}
