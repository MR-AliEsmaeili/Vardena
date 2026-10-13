import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { useToast } from '@/ui/patterns/toast';
import {
  documentErrorMessage,
  type DocumentErrorMessage,
} from './document-error-messages';
import {
  useDeleteDocumentMutation,
  useFinalizeDocumentMutation,
  useIssueDocumentMutation,
  newOperationKey,
  useReverseDocumentMutation,
} from './document-mutations';

/**
 * The lifecycle action dialogs (FE-UX-08 §10/§11, FE-UX-02 §5).
 *
 * Every sensitive transition is confirmed before the request, states its
 * consequence (never «آیا مطمئنید؟»), disables the primary action while in
 * flight (no double submit), and on failure STAYS OPEN with the mapped
 * Persian error inside it. On success the dialog closes, exactly one success
 * toast is shown, and the mutation hooks refresh the affected caches.
 *
 * Idempotency: each intent carries one `operationKey`. Retrying the same
 * intent (same reversal reason) reuses the key, so the backend replays the
 * stored operation instead of applying it twice; a new dialog session or an
 * edited reason is a new intent and gets a new key.
 */

export type DialogKind = 'issue' | 'finalize' | 'reverse' | 'delete';

export interface DocumentActionDialogProps {
  /** `null` = closed. Opening a different kind resets the form state. */
  kind: DialogKind | null;
  onClose: () => void;
  organizationId: string;
  documentId: string;
  documentNumber: string | null;
}

function ErrorBody({ error }: { error: DocumentErrorMessage }): ReactElement {
  return (
    <>
      <p>{error.message}</p>
      {error.correlationId !== undefined && (
        <p className="mt-2 text-xs text-rose-800/80">
          {t.errors.correlationId}:{' '}
          <span className="code">{error.correlationId}</span>
        </p>
      )}
    </>
  );
}

export function DocumentActionDialog({
  kind,
  onClose,
  organizationId,
  documentId,
  documentNumber,
}: DocumentActionDialogProps): ReactElement | null {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<DocumentErrorMessage | null>(
    null,
  );
  // Increments on every dialog open — the operation-intent session counter.
  const [dialogSession, setDialogSession] = useState(0);

  const issueMutation = useIssueDocumentMutation(organizationId);
  const finalizeMutation = useFinalizeDocumentMutation(organizationId);
  const reverseMutation = useReverseDocumentMutation(organizationId);
  const deleteMutation = useDeleteDocumentMutation(organizationId);

  useEffect(() => {
    if (kind !== null) {
      setReason('');
      setReasonError(null);
      setDialogError(null);
      setDialogSession((current) => current + 1);
    }
  }, [kind]);

  const busy =
    issueMutation.isPending ||
    finalizeMutation.isPending ||
    reverseMutation.isPending ||
    deleteMutation.isPending;

  const close = () => {
    if (busy) return; // the request is in flight; the dialog stays until it settles
    onClose();
    setDialogError(null);
    setReasonError(null);
  };

  // One operationKey per intent: a new dialog session, and (for reversal) a
  // new reason text, are new intents.
  const reasonForKey = kind === 'reverse' ? reason : '';
  const operationKey = useMemo(
    () => newOperationKey(),
    // The key follows the intent, not the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogSession, reasonForKey],
  );

  const handle = (run: () => Promise<unknown>) => {
    setDialogError(null);
    void run().then(
      () => {
        onClose();
        setDialogError(null);
      },
      (error: unknown) => {
        // Session expiry is owned by the global flow (redirect to login);
        // the dialog must not add a second, local error for it.
        if (normalizeApiError(error).isUnauthorized) return;
        setDialogError(documentErrorMessage(kind ?? 'finalize', error));
      },
    );
  };

  const confirmIssue = () =>
    handle(() =>
      issueMutation
        .mutateAsync({
          documentId,
          operationKey,
        })
        .then((issued) => {
          showToast({ kind: 'success', message: t.documents.issued });
          return issued;
        }),
    );

  const confirmFinalize = () =>
    handle(() =>
      finalizeMutation
        .mutateAsync({
          documentId,
          operationKey,
        })
        .then((finalized) => {
          showToast({ kind: 'success', message: t.documents.finalized });
          return finalized;
        }),
    );

  const confirmReverse = () => {
    const trimmed = reason.trim();
    if (trimmed === '') {
      setReasonError(t.documents.reverseReasonRequired);
      return;
    }
    handle(() =>
      reverseMutation
        .mutateAsync({
          documentId,
          reason: trimmed,
          operationKey,
        })
        .then((reversal) => {
          // The toast offers the resulting document — the relation the
          // backend returned, not something the UI invented.
          showToast({
            kind: 'success',
            message: t.documents.reversed,
            action: {
              label: t.documents.viewReversal,
              onAction: () =>
                navigate(
                  `/app/accounting/documents/${encodeURIComponent(reversal.id)}`,
                ),
            },
          });
          return reversal;
        }),
    );
  };

  const confirmDelete = () =>
    handle(() =>
      deleteMutation.mutateAsync({ documentId }).then((deleted) => {
        showToast({ kind: 'success', message: t.documents.deleted });
        navigate('/app/accounting/documents');
        return deleted;
      }),
    );

  if (kind === null) return null;

  const numberHint = documentNumber ?? t.app.none;
  const numberLine = (
    <p className="text-xs text-slate-500">
      {t.documents.number}: <span className="code">{numberHint}</span>
    </p>
  );

  switch (kind) {
    case 'issue':
      return (
        <ConfirmDialog
          open
          title={t.documents.issueTitle}
          description={
            <>
              <p>{t.documents.issueDescription}</p>
              {numberLine}
            </>
          }
          confirmLabel={t.documents.issueConfirm}
          loadingLabel={t.documents.issueLoading}
          loading={issueMutation.isPending}
          error={
            dialogError !== null ? <ErrorBody error={dialogError} /> : null
          }
          onConfirm={confirmIssue}
          onCancel={close}
        />
      );
    case 'finalize':
      return (
        <ConfirmDialog
          open
          title={t.documents.finalizeTitle}
          description={
            <>
              <p>{t.documents.finalizeDescription}</p>
              {numberLine}
            </>
          }
          confirmLabel={t.documents.finalizeConfirm}
          loadingLabel={t.documents.finalizeLoading}
          loading={finalizeMutation.isPending}
          error={
            dialogError !== null ? <ErrorBody error={dialogError} /> : null
          }
          onConfirm={confirmFinalize}
          onCancel={close}
        />
      );
    case 'reverse':
      return (
        <ConfirmDialog
          open
          title={t.documents.reverseTitle}
          description={<p>{t.documents.reverseDescription}</p>}
          confirmLabel={t.documents.reverseConfirm}
          loadingLabel={t.documents.reverseLoading}
          loading={reverseMutation.isPending}
          error={
            dialogError !== null ? <ErrorBody error={dialogError} /> : null
          }
          onConfirm={confirmReverse}
          onCancel={close}
          danger
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">
              {t.documents.reverseReason}
            </span>
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:border-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-500 aria-[invalid=true]:border-rose-400"
              rows={3}
              value={reason}
              aria-invalid={reasonError !== null}
              disabled={reverseMutation.isPending}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError !== null) setReasonError(null);
              }}
            />
            {reasonError !== null && (
              <p role="alert" className="text-xs text-rose-700">
                {reasonError}
              </p>
            )}
          </label>
        </ConfirmDialog>
      );
    case 'delete':
      return (
        <ConfirmDialog
          open
          title={t.documents.deleteTitle}
          description={<p>{t.documents.deleteDescription}</p>}
          confirmLabel={t.documents.deleteConfirm}
          loadingLabel={t.documents.deleteLoading}
          loading={deleteMutation.isPending}
          error={
            dialogError !== null ? <ErrorBody error={dialogError} /> : null
          }
          onConfirm={confirmDelete}
          onCancel={close}
          danger
        />
      );
  }
}
