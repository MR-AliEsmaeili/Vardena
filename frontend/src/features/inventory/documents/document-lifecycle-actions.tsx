import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import { documentErrorMessage } from './inventory-document-errors';
import {
  useAccountingPostDocumentMutation,
  useCancelDocumentMutation,
  useDeleteDocumentMutation,
  useFinalizeDocumentMutation,
  useSealDocumentMutation,
} from './inventory-document-mutations';

type LifecycleAction =
  'finalize' | 'accountingPost' | 'seal' | 'cancel' | 'delete';

/**
 * The lifecycle commands of one document.
 *
 * Each one is confirmed with its CONSEQUENCE, never with «آیا مطمئنید؟»:
 * finalize moves real stock, accounting-post closes the document to direct
 * change, seal is terminal, cancel reverses the posted effect, delete only
 * ever applies to a draft. Cancellation additionally requires a written
 * reason — an irreversible correction must say why it happened.
 */
export function DocumentLifecycleActions({
  organizationId,
  document,
  onDeleted,
}: {
  organizationId: string;
  document: InventoryDocument;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const finalizeMutation = useFinalizeDocumentMutation(organizationId);
  const accountingPostMutation =
    useAccountingPostDocumentMutation(organizationId);
  const sealMutation = useSealDocumentMutation(organizationId);
  const cancelMutation = useCancelDocumentMutation(organizationId);
  const deleteMutation = useDeleteDocumentMutation(organizationId);

  const close = () => {
    setAction(null);
    setFailure(null);
    setReason('');
  };

  const run = async (selected: LifecycleAction) => {
    setFailure(null);
    try {
      switch (selected) {
        case 'finalize':
          await finalizeMutation.mutateAsync({ documentId: document.id });
          showToast({
            kind: 'success',
            message: t.inventoryDocuments.finalized,
          });
          break;
        case 'accountingPost':
          await accountingPostMutation.mutateAsync(document.id);
          showToast({
            kind: 'success',
            message: t.inventoryDocuments.accountingPosted,
          });
          break;
        case 'seal':
          await sealMutation.mutateAsync(document.id);
          showToast({ kind: 'success', message: t.inventoryDocuments.sealed });
          break;
        case 'cancel':
          await cancelMutation.mutateAsync({
            documentId: document.id,
            values: { reason },
          });
          showToast({
            kind: 'success',
            message: t.inventoryDocuments.cancelled,
          });
          break;
        case 'delete':
          await deleteMutation.mutateAsync(document.id);
          showToast({ kind: 'success', message: t.inventoryDocuments.deleted });
          close();
          onDeleted();
          return;
      }
      close();
    } catch (error) {
      setFailure(documentErrorMessage(selected, error).message);
    }
  };

  const pending =
    finalizeMutation.isPending ||
    accountingPostMutation.isPending ||
    sealMutation.isPending ||
    cancelMutation.isPending ||
    deleteMutation.isPending;

  return (
    <>
      {document.canEdit ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/app/inventory/documents/${document.id}/edit`}
            data-testid="edit-document"
          >
            {t.inventoryDocuments.edit}
          </Link>
        </Button>
      ) : null}
      {document.canFinalize ? (
        <Button
          size="sm"
          onClick={() => setAction('finalize')}
          data-testid="finalize-document"
        >
          {t.inventoryDocuments.finalize}
        </Button>
      ) : null}
      {document.canAccountingPost ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAction('accountingPost')}
          data-testid="accounting-post-document"
        >
          {t.inventoryDocuments.accountingPost}
        </Button>
      ) : null}
      {document.canSeal ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAction('seal')}
          data-testid="seal-document"
        >
          {t.inventoryDocuments.seal}
        </Button>
      ) : null}
      {document.canCancel ? (
        <Button
          size="sm"
          variant="danger"
          onClick={() => setAction('cancel')}
          data-testid="cancel-document"
        >
          {t.inventoryDocuments.cancel}
        </Button>
      ) : null}
      {document.canDelete ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAction('delete')}
          data-testid="delete-document"
        >
          {t.inventoryDocuments.deleteDraft}
        </Button>
      ) : null}

      <ConfirmDialog
        open={action === 'finalize'}
        title={t.inventoryDocuments.finalizeTitle}
        description={t.inventoryDocuments.finalizeDescription}
        confirmLabel={t.inventoryDocuments.finalize}
        loadingLabel={t.inventoryDocuments.finalizing}
        loading={pending}
        {...(failure !== null ? { error: failure } : {})}
        onConfirm={() => void run('finalize')}
        onCancel={close}
      />
      <ConfirmDialog
        open={action === 'accountingPost'}
        title={t.inventoryDocuments.accountingPostTitle}
        description={t.inventoryDocuments.accountingPostDescription}
        confirmLabel={t.inventoryDocuments.accountingPost}
        loadingLabel={t.inventoryDocuments.accountingPosting}
        loading={pending}
        {...(failure !== null ? { error: failure } : {})}
        onConfirm={() => void run('accountingPost')}
        onCancel={close}
      />
      <ConfirmDialog
        open={action === 'seal'}
        title={t.inventoryDocuments.sealTitle}
        description={t.inventoryDocuments.sealDescription}
        confirmLabel={t.inventoryDocuments.seal}
        loadingLabel={t.inventoryDocuments.sealing}
        loading={pending}
        danger
        {...(failure !== null ? { error: failure } : {})}
        onConfirm={() => void run('seal')}
        onCancel={close}
      />
      <ConfirmDialog
        open={action === 'cancel'}
        title={t.inventoryDocuments.cancelTitle}
        description={t.inventoryDocuments.cancelDescription}
        confirmLabel={t.inventoryDocuments.cancel}
        loadingLabel={t.inventoryDocuments.cancelling}
        loading={pending}
        danger
        confirmDisabled={reason.trim() === ''}
        {...(failure !== null ? { error: failure } : {})}
        onConfirm={() => void run('cancel')}
        onCancel={close}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">
            {t.inventoryDocuments.cancelReason}
          </Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="cancel-reason"
          />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={action === 'delete'}
        title={t.inventoryDocuments.deleteTitle}
        description={t.inventoryDocuments.deleteDescription}
        confirmLabel={t.inventoryDocuments.deleteDraft}
        loadingLabel={t.inventoryDocuments.deleting}
        loading={pending}
        danger
        {...(failure !== null ? { error: failure } : {})}
        onConfirm={() => void run('delete')}
        onCancel={close}
      />
    </>
  );
}
