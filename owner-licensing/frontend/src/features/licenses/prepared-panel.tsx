import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import { normalizeApiError } from '@/api/errors';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { ArtifactImport } from './artifact-import';

function Digest({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? o.licenses.copied : o.licenses.copy}
        </Button>
      </div>
      <code
        dir="ltr"
        className="block break-all rounded bg-canvas p-2 font-mono text-xs"
      >
        {value}
      </code>
    </div>
  );
}

/**
 * The prepared request: the two digests the operator must carry out-of-band,
 * the unsigned request file, and the import of the returned signed artifact.
 *
 * Download is a separate event from preparation and from import; the panel
 * never claims a license exists until `SIGNED_RECORDED` comes back from the
 * server, which the issuance list re-reads.
 */
export function PreparedPanel({
  targetId,
  operationId,
  digests,
  kind = 'license',
}: {
  /** Issuance id or revocation id — the resource whose request was prepared. */
  targetId: string;
  operationId: string;
  /**
   * The two digests are shown only when this response carried them. A
   * revocation re-read from the issuance summary has no digest panel: the
   * server refuses a mismatch at import, and the operator does not need a
   * number they cannot re-derive.
   */
  digests?: { payload: string; binding: string } | undefined;
  kind?: 'license' | 'revocation';
}) {
  const client = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      const request =
        kind === 'license'
          ? await lic.issuanceRequest(targetId)
          : await lic.revocationRequest(targetId);
      lic.saveBlob(
        new Blob([request.fileContent], { type: 'application/json' }),
        request.fileName,
      );
      setFileName(request.fileName);
    },
    onError: (cause) => setError(normalizeApiError(cause).message),
  });
  return (
    <div className="space-y-3 rounded border border-accent-line bg-accent-soft p-3">
      <h3 className="font-semibold">
        {kind === 'license'
          ? o.licenses.preparedTitle
          : o.licenses.revocationPrepared}
      </h3>
      {digests ? (
        <>
          <p className="text-sm">{o.licenses.digestWarning}</p>
          <Digest label={o.licenses.payloadDigest} value={digests.payload} />
          <Digest label={o.licenses.bindingDigest} value={digests.binding} />
        </>
      ) : null}
      <p className="text-sm text-secondary">
        {o.licenses.operationId}: <span dir="ltr">{operationId}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          loading={download.isPending}
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending
            ? o.licenses.downloading
            : kind === 'license'
              ? o.licenses.downloadRequest
              : o.licenses.revocationDownloadRequest}
        </Button>
      </div>
      {fileName ? <p className="text-xs text-secondary">{fileName}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {kind === 'revocation' ? (
        <p className="text-xs text-secondary">{o.licenses.revokeImportHint}</p>
      ) : null}
      <ArtifactImport
        label={
          kind === 'license'
            ? o.licenses.importLabel
            : o.licenses.revocationImportLabel
        }
        // A revocation is not a license: the confirmation names the artifact
        // that was archived, and a replay is reported as the historical result
        // rather than as a second revocation (OD-LIC-18).
        {...(kind === 'revocation'
          ? {
              successMessage: o.licenses.revocationImportSuccess,
              replayedMessage: o.licenses.revocationImportReplayed,
            }
          : {})}
        onImport={async (fileContent) => {
          const result =
            kind === 'license'
              ? await lic.importIssuanceArtifact(targetId, fileContent)
              : await lic.importRevocationArtifact(targetId, fileContent);
          await client.invalidateQueries({
            queryKey: ['owner', 'license-issuances'],
          });
          return { replayed: 'replayed' in result ? result.replayed : false };
        }}
      />
    </div>
  );
}
