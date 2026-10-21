import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type { Issuance, Revocation, RevocationReason } from '@/api/licensing';
import { normalizeApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { formatOwnerInstant } from '@/lib/date-time';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { PreparedPanel } from './prepared-panel';
import { useActiveSigningKeys } from './use-active-signing-keys';

/**
 * One recorded/prepared issuance.
 *
 * Status vocabulary is the server's: `REQUEST_PREPARED` is an unsigned request,
 * `SIGNED_RECORDED` is an archived signed artifact. Renewal and supersession
 * links are offered to `OWNER_ADMIN` only (OD-LIC-16) and merely pre-fill the
 * preparation form — the backend enforces the privilege again.
 *
 * The revocation block is the operator half of `VREV1`: prepare the unsigned
 * request, download it for the offline signer, import the returned signed
 * artifact, and finally hand the archived artifact to the customer. Recording
 * the artifact here is not applying it on the customer installation, and the
 * copy says so.
 */
export function IssuanceCard({ issuance }: { issuance: Issuance }) {
  const permissions = usePermissions();
  const client = useQueryClient();
  const keys = useActiveSigningKeys();
  const isOwnerAdmin = permissions.has('licenses.issue.perpetual');
  const activeKeys = keys.data?.items ?? [];

  const statusLabel =
    issuance.status === 'SIGNED_RECORDED'
      ? o.licenses.statusSigned
      : issuance.status === 'ABANDONED'
        ? o.licenses.statusAbandoned
        : o.licenses.statusPrepared;

  return (
    <li className="space-y-3 owner-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="font-semibold">
            {issuance.customerName}{' '}
            <span dir="ltr" className="text-sm text-muted-ink">
              ({issuance.customerCode})
            </span>
          </h3>
          <p className="text-sm text-secondary">
            {o.licenses.operationId}:{' '}
            <span dir="ltr">{issuance.operationId}</span>
          </p>
          <p className="text-sm text-secondary">
            {issuance.licenseKind === 'PERPETUAL'
              ? o.licenses.perpetual
              : `${o.licenses.validFrom} ${issuance.validFrom.slice(0, 10)} — ${o.licenses.validUntil} ${issuance.validUntil?.slice(0, 10) ?? ''}`}
          </p>
          {issuance.renewsOperationId ? (
            <p className="text-xs text-muted-ink">
              {o.licenses.lineageRenew}:{' '}
              <span dir="ltr">{issuance.renewsOperationId}</span>
            </p>
          ) : null}
          {issuance.supersedesOperationId ? (
            <p className="text-xs text-muted-ink">
              {o.licenses.lineageSupersede}:{' '}
              <span dir="ltr">{issuance.supersedesOperationId}</span>
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            issuance.status === 'SIGNED_RECORDED'
              ? 'bg-success-soft text-success'
              : issuance.status === 'ABANDONED'
                ? 'bg-line text-secondary'
                : 'bg-warning-soft text-warning'
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <dl className="grid gap-1 text-xs text-secondary sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold">
            {o.licenses.installationId}:{' '}
          </dt>
          <dd className="inline" dir="ltr">
            {issuance.installationId}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{o.licenses.modules}: </dt>
          <dd className="inline" dir="ltr">
            {issuance.modules.join(', ')}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{o.licenses.requestedAt}: </dt>
          <dd className="inline" dir="ltr">
            {formatOwnerInstant(issuance.requestedAt)}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{o.licenses.age}: </dt>
          <dd className="inline">{issuance.requestAgeDays}</dd>
        </div>
      </dl>
      {issuance.customerImportAdvisory === 'TERM_ENDED' ? (
        <p className="rounded bg-warning-soft p-2 text-sm text-warning">
          {o.licenses.termEnded}
        </p>
      ) : null}
      {issuance.revocation ? (
        <RevocationStatus revocation={issuance.revocation} />
      ) : null}
      {issuance.status === 'SIGNED_RECORDED' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <DownloadArtifactButton
              kind="license-issuances"
              id={issuance.id}
              fileName={`vardena-license-${issuance.operationId}.json`}
              label={o.licenses.downloadSigned}
            />
            {issuance.artifactSha256 ? (
              <span className="self-center font-mono text-xs" dir="ltr">
                sha256:{issuance.artifactSha256.slice(0, 16)}…
              </span>
            ) : null}
          </div>
          {isOwnerAdmin ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                className="text-accent underline"
                to={`/app/licenses?renews=${issuance.operationId}`}
              >
                {o.licenses.renewAction}
              </Link>
              <Link
                className="text-accent underline"
                to={`/app/licenses?supersedes=${issuance.operationId}`}
              >
                {o.licenses.supersedeAction}
              </Link>
            </div>
          ) : null}
          {isOwnerAdmin && issuance.revocation === null ? (
            <RevocationPrepare
              issuance={issuance}
              activeKeys={activeKeys}
              onDone={() =>
                void client.invalidateQueries({
                  queryKey: ['owner', 'license-issuances'],
                })
              }
            />
          ) : null}
        </div>
      ) : issuance.status === 'REQUEST_PREPARED' ? (
        <p className="text-sm text-secondary">{o.licenses.waitingSignature}</p>
      ) : null}
    </li>
  );
}

function DownloadArtifactButton({
  kind,
  id,
  fileName,
  label,
}: {
  kind: 'license-issuances' | 'license-revocations';
  id: string;
  fileName: string;
  label: string;
}) {
  const permissions = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: () => lic.downloadArtifact(kind, id),
    onSuccess: (blob) => lic.saveBlob(blob, fileName),
    onError: (cause) => setError(normalizeApiError(cause).message),
  });
  return (
    <span className="space-y-1">
      <Button
        variant="outline"
        loading={download.isPending}
        disabled={!permissions.has('licenses.download') || download.isPending}
        onClick={() => download.mutate()}
      >
        {download.isPending ? o.licenses.downloading : label}
      </Button>
      {error ? (
        <span role="alert" className="block text-sm text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function RevocationStatus({
  revocation,
}: {
  revocation: NonNullable<Issuance['revocation']>;
}) {
  const permissions = usePermissions();
  return (
    <div className="space-y-2 rounded bg-danger-soft p-2 text-sm text-danger">
      <p>
        {o.licenses.revokedWith}: {revocation.reason} —{' '}
        {revocation.status === 'SIGNED_RECORDED'
          ? o.licenses.revocationStatusSigned
          : o.licenses.revocationStatusPrepared}
      </p>
      <p className="text-xs">{o.licenses.revocationNotApplied}</p>
      {revocation.status === 'SIGNED_RECORDED' ? (
        permissions.has('licenses.download') ? (
          <div className="space-y-1">
            <DownloadArtifactButton
              kind="license-revocations"
              id={revocation.revocationId}
              fileName={`vardena-revocation-${revocation.revocationId}.json`}
              label={o.licenses.revocationDownloadSigned}
            />
            <p className="text-xs">{o.licenses.revocationCustomerStep}</p>
          </div>
        ) : null
      ) : (
        <details className="rounded border border-line p-2">
          <summary className="cursor-pointer text-sm font-semibold">
            {o.licenses.revocationSectionTitle}
          </summary>
          <div className="mt-2">
            <PreparedPanel
              kind="revocation"
              targetId={revocation.revocationId}
              operationId={revocation.revocationId}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function RevocationPrepare({
  issuance,
  activeKeys,
  onDone,
}: {
  issuance: Issuance;
  activeKeys: Array<{ id: string; label: string }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RevocationReason>('NON_PAYMENT');
  const [reasonDetail, setReasonDetail] = useState('');
  const [keyId, setKeyId] = useState(issuance.signingKeyId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    revocation: Revocation;
    requestPayloadSha256: string;
    requestBindingSha256: string;
  } | null>(null);
  const prepare = useMutation({
    mutationFn: async () => {
      if (!keyId.trim()) throw new Error(o.licenses.errorKey);
      return await lic.prepareRevocation(issuance.id, {
        reason,
        reasonDetail: reasonDetail.trim() ? reasonDetail.trim() : null,
        signingKeyId: keyId.trim(),
      });
    },
    onSuccess: (result) => {
      if (!result.revocation) {
        setMessage(o.licenses.errorResponse);
        return;
      }
      setPrepared({
        revocation: result.revocation,
        requestPayloadSha256: result.requestPayloadSha256,
        requestBindingSha256: result.requestBindingSha256,
      });
      setMessage(o.licenses.revocationPrepared);
      onDone();
    },
    onError: (cause) =>
      setMessage(
        cause instanceof Error && !('status' in cause)
          ? cause.message
          : normalizeApiError(cause).message,
      ),
  });
  return (
    <details
      className="rounded border border-line p-2"
      open={open}
      onToggle={(event) =>
        setOpen((event.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {o.licenses.revokeTitle}
      </summary>
      <p className="mt-2 text-sm text-secondary">{o.licenses.revokeHelp}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{o.licenses.reason}</span>
          <Select
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as RevocationReason)
            }
          >
            {lic.REVOCATION_REASONS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{o.licenses.signingKey}</span>
          {activeKeys.length > 0 ? (
            <Select
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            >
              <option value="">—</option>
              {activeKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.label} ({key.id})
                </option>
              ))}
            </Select>
          ) : (
            <Input
              dir="ltr"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
          )}
        </label>
      </div>
      {reason === 'OTHER' ? (
        <label className="mt-2 block space-y-1 text-sm">
          <span>{o.licenses.reasonDetail}</span>
          <Input
            value={reasonDetail}
            maxLength={500}
            onChange={(event) => setReasonDetail(event.target.value)}
          />
        </label>
      ) : null}
      <Button
        className="mt-2"
        variant="outline"
        loading={prepare.isPending}
        disabled={prepare.isPending}
        onClick={() => prepare.mutate()}
      >
        {prepare.isPending ? o.licenses.preparing : o.licenses.revokePrepare}
      </Button>
      {message ? (
        <p className="mt-2 text-sm text-secondary">{message}</p>
      ) : null}
      {prepared ? (
        <div className="mt-2">
          <PreparedPanel
            kind="revocation"
            targetId={prepared.revocation.revocationId}
            operationId={prepared.revocation.revocationId}
            digests={{
              payload: prepared.requestPayloadSha256,
              binding: prepared.requestBindingSha256,
            }}
          />
        </div>
      ) : null}
    </details>
  );
}
