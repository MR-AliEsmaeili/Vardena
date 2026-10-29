import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { LICENSE_DOCUMENT_MAX_LENGTH } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import { Textarea } from '@/ui/textarea';
import { LICENSE_FILE_ACCEPT } from './license-import-schema';
import { licenseRevocationImportErrorMessage } from './license-revocation-errors';
import type { LicenseImportErrorMessage } from './license-import-errors';
import {
  licenseRevocationImportSchema,
  type LicenseRevocationImportFormValues,
} from './license-revocation-schema';
import { useImportLicenseRevocationMutation } from './use-import-license-revocation';

/**
 * The signed-revocation import form (OD-LIC-17).
 *
 * This is the ONLY way a revocation reaches an installation that is not
 * already blocked: the Owner signs the artifact offline, transports it by hand
 * (USB, e-mail, any file channel) and an operator with
 * `Licensing.License.Revoke` registers it here. There is no remote disabling,
 * no polling and no push channel — the offline-first contract is exactly this
 * manual transfer.
 *
 * What the form does: read one file (or accept pasted text), POST it once, and
 * let the awaited re-read of `GET /license/current` decide. It performs no
 * cryptographic or binding check in the browser — a client-side "looks valid"
 * verdict would be a security claim this app cannot make — keeps no copy of
 * the artifact, and on a refused document stays exactly where it is with the
 * reason attached to the field so the operator can try the correct file.
 *
 * It is mounted only for a session holding the permission and only where an
 * installation is already licensed: a revoked license cannot be re-imported
 * into service (see the license gate), so the form must never appear to offer
 * that.
 */
export function LicenseRevocationImportForm(): ReactElement {
  const { showToast } = useToast();
  const [failure, setFailure] = useState<LicenseImportErrorMessage | null>(
    null,
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // Remount key for the native file input: a native file input can only be
  // emptied by resetting its value or remounting it, and remounting is what
  // keeps this component free of refs.
  const [fileInputKey, setFileInputKey] = useState(0);

  const form = useForm<LicenseRevocationImportFormValues>({
    resolver: zodResolver(licenseRevocationImportSchema),
    defaultValues: { document: '' },
    mode: 'onSubmit',
  });

  const mutation = useImportLicenseRevocationMutation();

  const clearSelection = () => {
    form.reset({ document: '' });
    setFileName(null);
    setFileInputKey((key) => key + 1);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFailure(null);
    if (!file) {
      setFileName(null);
      return;
    }
    // The backend bound is in characters; an ASCII JSON/base64url document has
    // one byte per character, so a byte-size check is exact and happens before
    // the file is read.
    if (file.size > LICENSE_DOCUMENT_MAX_LENGTH) {
      form.setValue('document', '');
      setFileName(null);
      event.target.value = '';
      form.setError('document', {
        type: 'manual',
        message: t.license.importFileTooLarge,
      });
      return;
    }
    try {
      const text = await file.text();
      form.setValue('document', text, {
        shouldDirty: true,
        shouldValidate: false,
      });
      form.clearErrors('document');
      setFileName(file.name);
    } catch {
      form.setValue('document', '');
      setFileName(null);
      event.target.value = '';
      form.setError('document', {
        type: 'manual',
        message: t.license.importFileReadFailed,
      });
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    // Guards a second submit fired before React re-rendered the disabled
    // button (double click, repeated Enter).
    if (mutation.isPending) return;
    setFailure(null);
    mutation.mutate(
      { document: values.document },
      {
        onSuccess: (result) => {
          // The POST succeeded and the authoritative re-read has settled; the
          // artifact is no longer needed anywhere.
          clearSelection();
          setPasteOpen(false);
          showToast({
            kind: 'success',
            message: result.changed
              ? t.license.revocationSuccess
              : t.license.revocationAlreadyApplied,
          });
        },
        onError: (error) => {
          const presented = licenseRevocationImportErrorMessage(error);
          setFailure(presented);
          if (presented.rejectedDocument) {
            // A refused artifact is known-bad: clearing it prevents
            // resubmitting the same bytes by reflex. A transport failure keeps
            // the selection so the retry costs the operator nothing.
            clearSelection();
          }
        },
      },
    );
  });

  const fieldError =
    form.formState.errors.document?.message ?? failure?.message;

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <FormField
        id="license-revocation-file"
        label={t.license.revocationFileLabel}
        error={fieldError}
        hint={t.license.revocationFileHint}
      >
        {(fieldProps) => (
          <div className="space-y-2">
            <input
              {...fieldProps}
              key={fileInputKey}
              type="file"
              dir="ltr"
              className="block w-full cursor-pointer rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink-muted file:me-3 file:rounded-control file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:bg-line/70 disabled:cursor-not-allowed disabled:opacity-60"
              accept={LICENSE_FILE_ACCEPT}
              autoComplete="off"
              aria-required="true"
              disabled={mutation.isPending}
              onChange={(event) => void onFileChange(event)}
            />
            {fileName !== null && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {t.license.importSelectedFile}{' '}
                <span className="code" dir="ltr">
                  {fileName}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={clearSelection}
                >
                  {t.license.importClearFile}
                </Button>
              </p>
            )}
          </div>
        )}
      </FormField>

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={pasteOpen}
          aria-controls="license-revocation-document-panel"
          disabled={mutation.isPending}
          onClick={() => setPasteOpen((open) => !open)}
        >
          {pasteOpen
            ? t.license.revocationPasteHide
            : t.license.revocationPasteToggle}
        </Button>
      </div>

      {pasteOpen && (
        <div id="license-revocation-document-panel">
          <FormField
            id="license-revocation-document"
            label={t.license.revocationDocumentLabel}
            hint={t.license.revocationDocumentHint}
          >
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                rows={6}
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-xs"
                disabled={mutation.isPending}
                aria-required="true"
                {...form.register('document')}
              />
            )}
          </FormField>
        </div>
      )}

      {/* Support data only: the failure sentence is rendered once, under the
          field, by `FormField` (role="alert" + aria-describedby). */}
      {failure?.correlationId !== undefined && (
        <p className="text-xs text-ink-subtle">
          {t.errors.correlationId}:{' '}
          <span className="code" dir="ltr">
            {failure.correlationId}
          </span>
        </p>
      )}

      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={mutation.isPending}
        loading={mutation.isPending}
      >
        {mutation.isPending
          ? t.license.revocationSubmitting
          : t.license.revocationSubmit}
      </Button>
    </form>
  );
}
