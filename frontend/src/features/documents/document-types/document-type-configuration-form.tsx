import { useState, type FormEvent } from 'react';
import type { DocumentType } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { useToast } from '@/ui/patterns/toast';
import { documentTypeErrorMessage } from './document-type-error-messages';
import { useConfigureDocumentTypeMutation } from './use-document-types';

/**
 * The ONLY writable field of a registered document type (DOC-01).
 *
 * `PUT /documents/types/:code/configuration` accepts exactly
 * `{ draftRequired: boolean }`. The checkbox is disabled when the exact
 * `Document.DocumentType.Configure` permission is missing (UX gate, AR-21 —
 * the backend still authorizes) AND when the registry entry is not
 * `draftCapable`: the backend would answer 422, so the UI refuses to offer a
 * request it knows is invalid. After a save the checkbox and the success line
 * show the SERVER's merged response, never the submitted form value.
 */
export function DocumentTypeConfigurationForm({
  organizationId,
  documentType,
}: {
  organizationId: string;
  documentType: DocumentType;
}) {
  const permissions = usePermissions();
  const { showToast } = useToast();
  const mutation = useConfigureDocumentTypeMutation(
    organizationId,
    documentType.code,
  );
  const [draftRequired, setDraftRequired] = useState(
    documentType.draftRequired,
  );
  const [saved, setSaved] = useState<DocumentType | null>(null);

  const canConfigure = permissions.has(
    PERMISSIONS.documents.documentTypeConfigure,
  );
  const editable = canConfigure && documentType.draftCapable;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || mutation.isPending) return;
    try {
      const response = await mutation.mutateAsync({ draftRequired });
      // Server truth: the upsert returns the merged registry + configuration.
      setDraftRequired(response.draftRequired);
      setSaved(response);
      showToast({ kind: 'success', message: t.documentTypes.saved });
    } catch {
      // Rendered below from `mutation.error` via the stable error code.
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div>
        <h2 className="text-sm font-semibold text-ink">
          {t.documentTypes.configuration}
        </h2>
        <p className="mt-1 text-xs leading-6 text-ink-muted">
          {t.documentTypes.configurationHint}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={draftRequired}
          disabled={!editable || mutation.isPending}
          aria-label={t.documentTypes.draftRequired}
          data-testid="document-type-draft-required"
          onChange={(event) => {
            setDraftRequired(event.target.checked);
            setSaved(null);
          }}
        />
        <span>{t.documentTypes.draftRequired}</span>
      </label>

      <p className="text-xs leading-6 text-ink-subtle">
        {documentType.draftCapable
          ? t.documentTypes.draftRequiredHint
          : t.documentTypes.draftNotCapableHint}
      </p>

      {!canConfigure && (
        <output className="block text-xs text-ink-subtle">
          {t.documentTypes.noConfigurePermission}
        </output>
      )}

      {editable && (
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? t.documentTypes.saving : t.documentTypes.save}
        </Button>
      )}

      {mutation.isError && (
        <ApiErrorAlert
          error={mutation.error}
          title={t.errors.title}
          description={documentTypeErrorMessage('save', mutation.error)}
        />
      )}

      {saved !== null && (
        <output
          className="block text-xs text-ok-ink"
          data-testid="document-type-saved-value"
        >
          {t.documentTypes.saved} — {t.documentTypes.savedValue}:{' '}
          {saved.draftRequired ? t.app.yes : t.app.no}
        </output>
      )}
    </form>
  );
}
