import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type { Issuance, RevocationReason } from '@/api/licensing';
import { normalizeApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Owner-side license issuance (OD-LIC-07…19).
 *
 * Everything cryptographic happens elsewhere: the Owner API prepares an
 * unsigned request, an operator carries its digest to the air-gapped signer,
 * and the signed bytes come back here for server-side verification and durable
 * archiving. This page never claims a license was issued until the backend
 * reports `SIGNED_RECORDED`, and it never displays anything the server did not
 * return.
 */
export function LicensesPage() {
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['owner', 'license-issuances', page],
    queryFn: ({ signal }) => lic.issuances(page, signal),
    enabled: permissions.has('licenses.view'),
  });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('licenses.view')) return <p>{o.forbidden}</p>;
  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">{o.licenses.title}</h1>
        <p className="text-sm text-slate-600">{o.licenses.intro}</p>
      </header>
      <PrepareForm />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={o.licenses.empty}
          description={o.licenses.emptyHelp}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {query.data.items.map((issuance) => (
              <IssuanceCard key={issuance.id} issuance={issuance} />
            ))}
          </ul>
          <Pagination
            page={query.data.page}
            count={query.data.items.length}
            setPage={setPage}
            hasNext={query.data.items.length === query.data.pageSize}
          />
        </>
      )}
    </section>
  );
}

function prepareError(inputs: {
  customerId: string;
  installationIdentityId: string;
  signingKeyId: string;
  kind: lic.LicenseKind;
  validUntil: string;
  modules: readonly string[];
}): string | null {
  if (!ULID.test(inputs.customerId.trim())) return o.licenses.errorCustomer;
  if (!ULID.test(inputs.installationIdentityId.trim()))
    return o.licenses.errorInstallation;
  if (!inputs.signingKeyId.trim()) return o.licenses.errorKey;
  if (inputs.modules.length === 0) return o.licenses.errorModules;
  if (inputs.kind === 'TIME_LIMITED') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inputs.validUntil))
      return o.licenses.errorEndDate;
    const instant = new Date(`${inputs.validUntil}T00:00:00.000Z`);
    if (Number.isNaN(instant.getTime()) || instant.getTime() <= Date.now())
      return o.licenses.errorEndFuture;
  }
  return null;
}

function PrepareForm() {
  const permissions = usePermissions();
  const client = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [installationIdentityId, setInstallationIdentityId] = useState('');
  const [signingKeyId, setSigningKeyId] = useState('');
  const [kind, setKind] = useState<lic.LicenseKind>('TIME_LIMITED');
  const [validUntil, setValidUntil] = useState('');
  const [organizationLimit, setOrganizationLimit] = useState('');
  const [userLimit, setUserLimit] = useState('');
  const [deviceLimit, setDeviceLimit] = useState('');
  const [deviceLimitSpecified, setDeviceLimitSpecified] = useState(false);
  const [modules, setModules] = useState<string[]>(['accounting']);
  const [features, setFeatures] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    issuance: Issuance;
    requestPayloadSha256: string;
    requestBindingSha256: string;
  } | null>(null);

  const canPrepare =
    kind === 'PERPETUAL'
      ? permissions.has('licenses.issue.perpetual')
      : permissions.has('licenses.issue.time_limited');
  const mutation = useMutation({
    mutationFn: async () => {
      const problem = prepareError({
        customerId,
        installationIdentityId,
        signingKeyId,
        kind,
        validUntil,
        modules,
      });
      if (problem) throw new Error(problem);
      const limit = (value: string, label: string): number | null => {
        if (!value.trim()) return null;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0)
          throw new Error(`${label} ${o.licenses.errorPositive}`);
        return parsed;
      };
      const device = deviceLimitSpecified
        ? (() => {
            const parsed = Number(deviceLimit);
            if (!Number.isInteger(parsed) || parsed < 0)
              throw new Error(o.licenses.errorDevice);
            return parsed;
          })()
        : null;
      const result = await lic.prepareIssuance({
        customerId: customerId.trim(),
        installationIdentityId: installationIdentityId.trim(),
        validUntil:
          kind === 'PERPETUAL'
            ? null
            : new Date(`${validUntil}T00:00:00.000Z`).toISOString(),
        organizationLimit: limit(
          organizationLimit,
          o.licenses.organizationLimit,
        ),
        userLimit: limit(userLimit, o.licenses.userLimit),
        deviceLimit: device,
        deviceLimitSpecified,
        modules,
        features: features
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        signingKeyId: signingKeyId.trim(),
        supersedesOperationId: null,
        renewsOperationId: null,
      });
      if (!result.issuance) throw new Error(o.licenses.errorResponse);
      return {
        issuance: result.issuance,
        requestPayloadSha256: result.requestPayloadSha256,
        requestBindingSha256: result.requestBindingSha256,
      };
    },
    onSuccess: (value) => {
      setPrepared(value);
      setError(null);
      void client.invalidateQueries({
        queryKey: ['owner', 'license-issuances'],
      });
    },
    onError: (cause) => {
      setPrepared(null);
      setError(
        cause instanceof Error && !('status' in cause)
          ? cause.message
          : normalizeApiError(cause).message,
      );
    },
  });

  if (!permissions.has('licenses.issue.time_limited'))
    return (
      <output className="block rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        {o.licenses.noPrepare}
      </output>
    );
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-bold">{o.licenses.prepareTitle}</h2>
      <p className="text-sm text-slate-600">{o.licenses.prepareHelp}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{o.licenses.customerId}</span>
          <Input
            dir="ltr"
            value={customerId}
            maxLength={26}
            onChange={(event) => setCustomerId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{o.licenses.installationIdentity}</span>
          <Input
            dir="ltr"
            value={installationIdentityId}
            maxLength={26}
            onChange={(event) => setInstallationIdentityId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{o.licenses.signingKey}</span>
          <Input
            dir="ltr"
            value={signingKeyId}
            onChange={(event) => setSigningKeyId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{o.licenses.kind}</span>
          <select
            className="w-full rounded border border-slate-300 bg-white px-2 py-2"
            value={kind}
            onChange={(event) => setKind(event.target.value as lic.LicenseKind)}
          >
            <option value="TIME_LIMITED">{o.licenses.timeLimited}</option>
            {permissions.has('licenses.issue.perpetual') && (
              <option value="PERPETUAL">{o.licenses.perpetual}</option>
            )}
          </select>
        </label>
        {kind === 'TIME_LIMITED' ? (
          <label className="space-y-1 text-sm">
            <span>{o.licenses.endDate}</span>
            <Input
              dir="ltr"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </label>
        ) : (
          <p className="self-end text-sm text-slate-600">
            {o.licenses.perpetualHelp}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1 text-sm">
            <span>{o.licenses.organizationLimit}</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={organizationLimit}
              onChange={(event) => setOrganizationLimit(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>{o.licenses.userLimit}</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={userLimit}
              onChange={(event) => setUserLimit(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>{o.licenses.deviceLimit}</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={deviceLimit}
              disabled={!deviceLimitSpecified}
              onChange={(event) => setDeviceLimit(event.target.value)}
            />
          </label>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={deviceLimitSpecified}
          onChange={(event) => setDeviceLimitSpecified(event.target.checked)}
        />
        {o.licenses.deviceSpecified}
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{o.licenses.modules}</legend>
        <div className="flex flex-wrap gap-3">
          {lic.MODULE_CODES.map((code) => (
            <label key={code} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={modules.includes(code)}
                onChange={(event) =>
                  setModules((current) =>
                    event.target.checked
                      ? [...current, code]
                      : current.filter((entry) => entry !== code),
                  )
                }
              />
              <span dir="ltr">{code}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="space-y-1 text-sm">
        <span>{o.licenses.features}</span>
        <Input
          dir="ltr"
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <Button
        disabled={mutation.isPending || !canPrepare}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? o.licenses.preparing : o.licenses.prepare}
      </Button>
      {prepared && (
        <PreparedPanel
          issuance={prepared.issuance}
          requestPayloadSha256={prepared.requestPayloadSha256}
          requestBindingSha256={prepared.requestBindingSha256}
        />
      )}
    </section>
  );
}

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
        className="block break-all rounded bg-slate-50 p-2 font-mono text-xs"
      >
        {value}
      </code>
    </div>
  );
}

function PreparedPanel({
  issuance,
  requestPayloadSha256,
  requestBindingSha256,
}: {
  issuance: Issuance;
  requestPayloadSha256: string;
  requestBindingSha256: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      const request = await lic.issuanceRequest(issuance.id);
      lic.saveBlob(
        new Blob([request.fileContent], { type: 'application/json' }),
        request.fileName,
      );
      setFileName(request.fileName);
    },
    onError: (cause) => setError(normalizeApiError(cause).message),
  });
  return (
    <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50 p-3">
      <h3 className="font-semibold">{o.licenses.preparedTitle}</h3>
      <p className="text-sm">{o.licenses.digestWarning}</p>
      <Digest label={o.licenses.payloadDigest} value={requestPayloadSha256} />
      <Digest label={o.licenses.bindingDigest} value={requestBindingSha256} />
      <p className="text-sm text-slate-700">
        {o.licenses.operationId}: <span dir="ltr">{issuance.operationId}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending
            ? o.licenses.downloading
            : o.licenses.downloadRequest}
        </Button>
      </div>
      {fileName && <p className="text-xs text-slate-600">{fileName}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <ArtifactImporter issuanceId={issuance.id} />
    </div>
  );
}

function ArtifactImporter({ issuanceId }: { issuanceId: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold">
        {o.licenses.importLabel}
        <input
          className="mt-1 block w-full text-sm"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            setMessage(null);
            try {
              const content = await file.text();
              const result = await lic.importIssuanceArtifact(
                issuanceId,
                content,
              );
              setMessage(
                result.replayed
                  ? o.licenses.importReplayed
                  : o.licenses.importSuccess,
              );
              await client.invalidateQueries({
                queryKey: ['owner', 'license-issuances'],
              });
            } catch (cause) {
              setError(normalizeApiError(cause).message);
            } finally {
              setBusy(false);
              event.target.value = '';
            }
          }}
        />
      </label>
      {busy && <p className="text-sm">{o.licenses.importing}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function IssuanceCard({ issuance }: { issuance: Issuance }) {
  const permissions = usePermissions();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [revocationReason, setRevocationReason] =
    useState<RevocationReason>('NON_PAYMENT');
  const [reasonDetail, setReasonDetail] = useState('');
  const [revocationKeyId, setRevocationKeyId] = useState(
    issuance.signingKeyId ?? '',
  );
  const [revocationMessage, setRevocationMessage] = useState<string | null>(
    null,
  );
  const download = useMutation({
    mutationFn: () => lic.downloadArtifact('license-issuances', issuance.id),
    onSuccess: (blob) =>
      lic.saveBlob(blob, `vardena-license-${issuance.operationId}.json`),
    onError: (cause) => setError(normalizeApiError(cause).message),
  });
  const revoke = useMutation({
    mutationFn: async () => {
      if (!revocationKeyId.trim()) throw new Error(o.licenses.errorKey);
      const prepared = await lic.prepareRevocation(issuance.id, {
        reason: revocationReason,
        reasonDetail: reasonDetail.trim() ? reasonDetail.trim() : null,
        signingKeyId: revocationKeyId.trim(),
      });
      return prepared;
    },
    onSuccess: () => {
      setRevocationMessage(o.licenses.revocationPrepared);
      void client.invalidateQueries({
        queryKey: ['owner', 'license-issuances'],
      });
    },
    onError: (cause) =>
      setRevocationMessage(
        cause instanceof Error && !('status' in cause)
          ? cause.message
          : normalizeApiError(cause).message,
      ),
  });

  const statusLabel =
    issuance.status === 'SIGNED_RECORDED'
      ? o.licenses.statusSigned
      : issuance.status === 'ABANDONED'
        ? o.licenses.statusAbandoned
        : o.licenses.statusPrepared;
  return (
    <li className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="font-semibold">
            {issuance.customerName}{' '}
            <span dir="ltr" className="text-sm text-slate-500">
              ({issuance.customerCode})
            </span>
          </h3>
          <p className="text-sm text-slate-600">
            {o.licenses.operationId}:{' '}
            <span dir="ltr">{issuance.operationId}</span>
          </p>
          <p className="text-sm text-slate-600">
            {issuance.licenseKind === 'PERPETUAL'
              ? o.licenses.perpetual
              : `${o.licenses.validFrom} ${issuance.validFrom.slice(0, 10)} — ${o.licenses.validUntil} ${issuance.validUntil?.slice(0, 10) ?? ''}`}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            issuance.status === 'SIGNED_RECORDED'
              ? 'bg-emerald-100 text-emerald-800'
              : issuance.status === 'ABANDONED'
                ? 'bg-slate-200 text-slate-700'
                : 'bg-amber-100 text-amber-900'
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
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
            {issuance.requestedAt}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{o.licenses.age}: </dt>
          <dd className="inline">{issuance.requestAgeDays}</dd>
        </div>
      </dl>
      {issuance.customerImportAdvisory === 'TERM_ENDED' && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          {o.licenses.termEnded}
        </p>
      )}
      {issuance.revocation && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-800">
          {o.licenses.revokedWith}: {issuance.revocation.reason} —{' '}
          {issuance.revocation.status}
        </p>
      )}
      {issuance.status === 'SIGNED_RECORDED' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                !permissions.has('licenses.download') || download.isPending
              }
              onClick={() => download.mutate()}
            >
              {download.isPending
                ? o.licenses.downloading
                : o.licenses.downloadSigned}
            </Button>
            {issuance.artifactSha256 && (
              <span className="self-center font-mono text-xs" dir="ltr">
                sha256:{issuance.artifactSha256.slice(0, 16)}…
              </span>
            )}
          </div>
          {permissions.has('licenses.issue.perpetual') &&
            issuance.revocation === null && (
              <details className="rounded border border-slate-200 p-2">
                <summary className="cursor-pointer text-sm font-semibold">
                  {o.licenses.revokeTitle}
                </summary>
                <p className="mt-2 text-sm text-slate-600">
                  {o.licenses.revokeHelp}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>{o.licenses.reason}</span>
                    <select
                      className="w-full rounded border border-slate-300 bg-white px-2 py-2"
                      value={revocationReason}
                      onChange={(event) =>
                        setRevocationReason(
                          event.target.value as RevocationReason,
                        )
                      }
                    >
                      {lic.REVOCATION_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>{o.licenses.signingKey}</span>
                    <Input
                      dir="ltr"
                      value={revocationKeyId}
                      onChange={(event) =>
                        setRevocationKeyId(event.target.value)
                      }
                    />
                  </label>
                </div>
                {revocationReason === 'OTHER' && (
                  <label className="mt-2 block space-y-1 text-sm">
                    <span>{o.licenses.reasonDetail}</span>
                    <Input
                      value={reasonDetail}
                      maxLength={500}
                      onChange={(event) => setReasonDetail(event.target.value)}
                    />
                  </label>
                )}
                <Button
                  className="mt-2"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate()}
                >
                  {revoke.isPending
                    ? o.licenses.preparing
                    : o.licenses.revokePrepare}
                </Button>
                {revocationMessage && (
                  <p className="mt-2 text-sm text-slate-700">
                    {revocationMessage}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {o.licenses.revokeImportHint}
                </p>
              </details>
            )}
        </div>
      ) : issuance.status === 'REQUEST_PREPARED' ? (
        <p className="text-sm text-slate-600">{o.licenses.waitingSignature}</p>
      ) : null}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </li>
  );
}
