import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { LICENSE_DOCUMENT_MAX_LENGTH } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import {
  licenseImportErrorMessage,
  type LicenseImportErrorMessage,
} from './license-import-errors';
import {
  LICENSE_FILE_ACCEPT,
  licenseImportSchema,
  type LicenseImportFormValues,
} from './license-import-schema';
import { useImportLicenseMutation } from './use-import-license';

/**
 * The file-first license import form (L-03, ADR-0046).
 *
 * Primary path: choose the signed license file the customer received. The
 * file is read in the browser with `File.text()` (never uploaded anywhere but
 * the Vardena API body, never written to storage) and its content is what the
 * form submits — the filename is never sent and the backend never sees it.
 * A file larger than the backend's own 65536-character bound is refused
 * before reading.
 *
 * Secondary path: paste the document text (or a legacy VLIC1 code) when there
 * is no file. Both paths fill the same single field — the API has exactly one
 * submission route (`POST /license/import`), so the two never diverge.
 *
 * What the form does, and only does: take one document, POST it once, and let
 * the re-read of `GET /license/current` decide. It leaves format, signature,
 * key trust, installation binding, payload validity and version position to
 * the backend, keeps no copy of the document (the value lives in this form's
 * state and in the body of the in-flight request — never in `localStorage`,
 * `sessionStorage`, the URL, a query cache entry or a log), and after a
 * rejected document stays exactly where it is with the error attached to the
 * field, ready for another attempt: an invalid license can never strand the
 * installation.
 */
export function LicenseImportForm(): ReactElement {
  const { showToast } = useToast();
  const [failure, setFailure] = useState<LicenseImportErrorMessage | null>(
    null,
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // Remount key for the native file input. Incrementing it is how the control
  // is cleared without touching a ref during render (a native file input can
  // only be emptied by resetting its value or remounting it).
  const [fileInputKey, setFileInputKey] = useState(0);

  const form = useForm<LicenseImportFormValues>({
    resolver: zodResolver(licenseImportSchema),
    defaultValues: { document: '' },
    mode: 'onSubmit',
  });

  const mutation = useImportLicenseMutation();

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
    // The backend bound is in characters; base64url/JSON documents are ASCII,
    // so a byte-size check is exact and happens before any read.
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
          // The POST succeeded AND the authoritative re-read has settled (the
          // mutation awaits the license invalidation). The document is
          // dropped from the form as soon as it is no longer needed.
          clearSelection();
          setPasteOpen(false);
          showToast({
            kind: 'success',
            message: result.changed
              ? t.license.importSuccess
              : t.license.importUnchanged,
          });
        },
        onError: (error) => {
          const presented = licenseImportErrorMessage(error);
          setFailure(presented);
          if (presented.rejectedDocument) {
            // A refused document is known-bad: clearing it prevents
            // resubmitting the same value by reflex. A transport failure
            // keeps the selection so the retry costs the operator nothing.
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
        id="license-file"
        label={t.license.importFileLabel}
        error={fieldError}
        hint={t.license.importFileHint}
      >
        {(fieldProps) => (
          <div className="space-y-2">
            <input
              {...fieldProps}
              key={fileInputKey}
              type="file"
              dir="ltr"
              className="block w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:text-slate-800 hover:file:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              accept={LICENSE_FILE_ACCEPT}
              autoComplete="off"
              aria-required="true"
              disabled={mutation.isPending}
              onChange={(event) => void onFileChange(event)}
            />
            {fileName !== null && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
          aria-controls="license-document-panel"
          disabled={mutation.isPending}
          onClick={() => setPasteOpen((open) => !open)}
        >
          {pasteOpen ? t.license.importPasteHide : t.license.importPasteToggle}
        </Button>
      </div>

      {pasteOpen && (
        <div id="license-document-panel">
          <FormField
            id="license-document"
            label={t.license.importDocumentLabel}
            hint={t.license.importDocumentHint}
          >
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                rows={6}
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus-visible:border-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-500 aria-[invalid=true]:border-rose-400"
                disabled={mutation.isPending}
                aria-required="true"
                {...form.register('document')}
              />
            )}
          </FormField>
        </div>
      )}

      {/*
        The failure message itself is rendered once, under the field
        (`FormField` gives it `role="alert"` and wires `aria-describedby`).
        Only the support correlation id is added here — it is data, not a
        second copy of the same sentence.
      */}
      {failure?.correlationId !== undefined && (
        <p className="text-xs text-slate-500">
          {t.errors.correlationId}:{' '}
          <span className="code" dir="ltr">
            {failure.correlationId}
          </span>
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending}
        loading={mutation.isPending}
      >
        {mutation.isPending
          ? t.license.importSubmitting
          : t.license.importSubmit}
      </Button>
    </form>
  );
}

/**
 * The import surface of the licensing bootstrap stage: the gate owns the
 * screen, this card only frames the form and shows the installation identity
 * the operator must quote when requesting a license (L-02).
 */
export function LicenseImportCard({
  installationId,
}: {
  installationId: string | null;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.license.importTitle}</CardTitle>
        <CardDescription>{t.license.importBody}</CardDescription>
      </CardHeader>
      <CardContent>
        {installationId !== null && (
          <p className="mb-4 text-sm text-slate-600">
            {t.license.installationIdLabel}:{' '}
            <span className="code" dir="ltr">
              {installationId}
            </span>
          </p>
        )}

        <LicenseImportForm />
      </CardContent>
    </Card>
  );
}
