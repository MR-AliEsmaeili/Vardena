import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type { InstallationIdentity } from '@/api/licensing';
import { normalizeApiError, ApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { formatOwnerInstant } from '@/lib/date-time';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { EmptyState, LoadingState } from '@/ui/patterns/states';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Registered installations of one customer (OD-LIC-09).
 *
 * This is the missing prerequisite of issuance: a license is bound to an
 * installation id, and that id is read from the customer's own Vardena
 * licensing screen and recorded here by an operator who re-enters it and
 * acknowledges the consequence. The screen states that the identifier is a
 * recorded claim, not cryptographic proof, and never presents it as verified.
 */
export function InstallationIdentities({ customerId }: { customerId: string }) {
  const permissions = usePermissions();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['owner', 'installation-identities', customerId],
    queryFn: ({ signal }) => lic.installationIdentities(customerId, signal),
    enabled: permissions.has('licenses.view'),
  });

  const invalidate = () =>
    client.invalidateQueries({
      queryKey: ['owner', 'installation-identities', customerId],
    });

  if (!permissions.has('licenses.view'))
    return <p className="text-sm text-secondary">{o.forbidden}</p>;
  return (
    <section className="space-y-3 owner-panel p-4">
      <header className="space-y-1">
        <h2 className="font-bold">{o.installations.title}</h2>
        <p className="text-sm text-secondary">{o.installations.help}</p>
      </header>
      {query.isPending ? (
        <LoadingState rows={2} />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={o.installations.empty}
          description={o.installations.emptyHelp}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.items.map((identity) => (
            <IdentityRow
              key={identity.id}
              identity={identity}
              onRetired={invalidate}
              onError={setError}
            />
          ))}
        </ul>
      )}
      {permissions.has('licenses.issue.time_limited') ? (
        <RegisterForm customerId={customerId} onRegistered={invalidate} />
      ) : (
        <p className="text-sm text-secondary">{o.forbidden}</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function IdentityRow({
  identity,
  onRetired,
  onError,
}: {
  identity: InstallationIdentity;
  onRetired: () => void;
  onError: (message: string | null) => void;
}) {
  const permissions = usePermissions();
  const [reason, setReason] = useState('');
  const retire = useMutation({
    mutationFn: () =>
      lic.retireInstallationIdentity(identity.id, { reason: reason.trim() }),
    onSuccess: () => {
      onError(null);
      onRetired();
    },
    onError: (cause) => onError(normalizeApiError(cause).message),
  });
  return (
    <li className="space-y-1 rounded border border-line p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="code break-all" dir="ltr">
          {identity.installationId}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            identity.status === 'ACTIVE'
              ? 'bg-success-soft text-success'
              : 'bg-line text-secondary'
          }`}
        >
          {identity.status === 'ACTIVE'
            ? o.installations.active
            : o.installations.retired}
        </span>
      </div>
      <p className="text-xs text-muted-ink">
        {o.installations.evidenceBasis}: {o.installations.evidenceClaim} ·{' '}
        {o.installations.registeredAt}:{' '}
        {formatOwnerInstant(identity.confirmedAt)}
      </p>
      {identity.confirmationEvidenceRef ? (
        <p className="text-xs text-muted-ink" dir="auto">
          {o.installations.evidence}: {identity.confirmationEvidenceRef}
        </p>
      ) : null}
      {identity.status === 'ACTIVE' &&
      !permissions.has('licenses.issue.perpetual') ? (
        // Retirement is Owner-Admin-only (the backend re-checks it). Saying so
        // is better than silently rendering no control at all, which reads as
        // "there is nothing to do here".
        <p className="text-xs text-muted-ink">{o.installations.adminOnly}</p>
      ) : null}
      {identity.status === 'ACTIVE' &&
      permissions.has('licenses.issue.perpetual') ? (
        <details className="rounded border border-line p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            {o.installations.retire}
          </summary>
          <div className="mt-2 space-y-2">
            <FormField
              id={`retire-identity-${identity.id}`}
              label={o.installations.retireReason}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
            <Button
              variant="outline"
              loading={retire.isPending}
              disabled={retire.isPending || reason.trim().length === 0}
              onClick={() => retire.mutate()}
            >
              {o.installations.retire}
            </Button>
            {retire.isSuccess ? (
              <p className="text-xs text-success">
                {o.installations.retiredSuccess}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

function RegisterForm({
  customerId,
  onRegistered,
}: {
  customerId: string;
  onRegistered: () => void;
}) {
  const [installationId, setInstallationId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sourceDetail, setSourceDetail] = useState('');
  const [evidence, setEvidence] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const register = useMutation({
    mutationFn: async () => {
      const value = installationId.trim().toUpperCase();
      if (!ULID.test(value)) throw new Error(o.installations.invalid);
      if (confirmation.trim().toUpperCase() !== value)
        throw new Error(o.installations.confirmationMismatch);
      if (!acknowledged) throw new Error(o.installations.checklistRequired);
      return await lic.registerInstallationIdentity({
        customerId,
        installationId: value,
        source: 'CUSTOMER_VARDENA_SCREEN',
        ...(sourceDetail.trim() ? { sourceDetail: sourceDetail.trim() } : {}),
        confirmationInstallationId: value,
        ...(evidence.trim()
          ? { confirmationEvidenceRef: evidence.trim() }
          : {}),
        confirmed: true,
      });
    },
    onSuccess: () => {
      setError(null);
      setRegistered(true);
      setInstallationId('');
      setConfirmation('');
      setSourceDetail('');
      setEvidence('');
      setAcknowledged(false);
      onRegistered();
    },
    onError: (cause) => {
      setRegistered(false);
      if (cause instanceof Error && !(cause instanceof ApiError)) {
        setError(cause.message);
        return;
      }
      const apiError = normalizeApiError(cause);
      setError(
        apiError.code === 'DuplicateInstallationIdentity'
          ? o.installations.duplicate
          : apiError.message,
      );
    },
  });
  return (
    <details className="rounded border border-line p-2">
      <summary className="cursor-pointer text-sm font-semibold">
        {o.installations.register}
      </summary>
      <p className="mt-2 text-sm text-secondary">
        {o.installations.registerHelp}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <FormField
          id="installation-id"
          label={o.installations.installationId}
          hint={o.installations.installationIdHint}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              dir="ltr"
              maxLength={26}
              value={installationId}
              onChange={(event) => setInstallationId(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="installation-confirmation"
          label={o.installations.confirmation}
          hint={o.installations.confirmationHint}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              dir="ltr"
              maxLength={26}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="installation-source-detail"
          label={o.installations.sourceDetail}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={sourceDetail}
              maxLength={500}
              onChange={(event) => setSourceDetail(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="installation-evidence"
          label={o.installations.evidence}
          hint={o.installations.evidenceHint}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={evidence}
              maxLength={200}
              onChange={(event) => setEvidence(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>{o.installations.checklist}</span>
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {registered ? (
        <p className="mt-2 text-sm text-success">
          {o.installations.registered}
        </p>
      ) : null}
      <Button
        className="mt-2"
        loading={register.isPending}
        disabled={register.isPending}
        onClick={() => register.mutate()}
      >
        {register.isPending ? o.saving : o.installations.register}
      </Button>
    </details>
  );
}
