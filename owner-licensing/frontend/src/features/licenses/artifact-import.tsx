import { useState } from 'react';
import { normalizeApiError } from '@/api/errors';
import { o } from '@/lib/owner-i18n';

/**
 * One file input for a returned signed artifact.
 *
 * The only thing this control decides is *when* to hand the file's text to the
 * caller. Verification, binding, replay and archival belong to the backend; a
 * success message is shown only after the API returns, and a replay is labelled
 * as the historical result rather than as a new registration (OD-LIC-18).
 */
export function ArtifactImport({
  label,
  onImport,
  successMessage = o.licenses.importSuccess,
  replayedMessage = o.licenses.importReplayed,
}: {
  label: string;
  onImport: (fileContent: string) => Promise<{ replayed: boolean }>;
  successMessage?: string;
  replayedMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold">
        {label}
        <input
          className="mt-1 block w-full text-sm"
          type="file"
          accept="application/json,.json,.vlic,.txt"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            setMessage(null);
            try {
              const content = await file.text();
              const result = await onImport(content);
              setMessage(result.replayed ? replayedMessage : successMessage);
            } catch (cause) {
              setError(normalizeApiError(cause).message);
            } finally {
              setBusy(false);
              event.target.value = '';
            }
          }}
        />
      </label>
      {busy ? <p className="text-sm">{o.licenses.importing}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
