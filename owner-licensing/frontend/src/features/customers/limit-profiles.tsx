import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type { LimitProfile } from '@/api/licensing';
import { MODULE_CODES } from '@/api/licensing';
import { normalizeApiError, ApiError } from '@/api/errors';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { formatOwnerInstant } from '@/lib/date-time';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { EmptyState, LoadingState } from '@/ui/patterns/states';

/**
 * Customer limit profiles (F-1, OD-LIC-13, OD-LIC-14).
 *
 * The active profile bounds every new issuance for this customer: ceilings that
 * exist are maxima, an empty ceiling refuses the corresponding value, and the
 * allowed modules are the only module codes an issuance may carry. Absence of a
 * profile is *not* a prohibition — on the contrary it is the unbounded branch,
 * which is exactly why retirement is a privileged, audited act and why the UI
 * says so instead of implying that “no ceiling” blocks issuance.
 *
 * Ceiling columns are immutable after creation; a change is retire-plus-create,
 * and reactivating a retired profile restores the identical ceiling.
 */
export function LimitProfiles({ customerId }: { customerId: string }) {
  const permissions = usePermissions();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['owner', 'limit-profiles', customerId],
    queryFn: ({ signal }) => lic.limitProfiles(customerId, signal),
    enabled: permissions.has('licenses.view'),
  });
  const canManage = permissions.has('limit_profiles.manage');
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['owner', 'limit-profiles'] });
  };

  if (!permissions.has('licenses.view'))
    return <p className="text-sm text-secondary">{o.forbidden}</p>;
  return (
    <section className="space-y-3 owner-panel p-4">
      <header className="space-y-1">
        <h2 className="font-bold">{o.limitProfiles.title}</h2>
        <p className="text-sm text-secondary">{o.limitProfiles.help}</p>
      </header>
      {query.isPending ? (
        <LoadingState rows={2} />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {query.data.activeProfile ? (
            <ProfileRow
              profile={query.data.activeProfile}
              canManage={canManage}
              onChanged={invalidate}
              onError={setError}
            />
          ) : (
            <p className="rounded bg-canvas p-2 text-sm text-secondary">
              {o.limitProfiles.emptyHelp}
            </p>
          )}
          {query.data.items.length > 1 ? (
            <details className="rounded border border-line p-2">
              <summary className="cursor-pointer text-sm font-semibold">
                {o.limitProfiles.history}
              </summary>
              <ul className="mt-2 space-y-2">
                {query.data.items
                  .filter((item) => item.status === 'RETIRED')
                  .map((profile) => (
                    <ProfileRow
                      key={profile.id}
                      profile={profile}
                      canManage={canManage}
                      onChanged={invalidate}
                      onError={setError}
                    />
                  ))}
              </ul>
            </details>
          ) : null}
          {query.data.items.length === 0 ? (
            <EmptyState
              title={o.limitProfiles.empty}
              description={o.limitProfiles.emptyHelp}
            />
          ) : null}
        </>
      )}
      {canManage ? (
        <CreateProfileForm customerId={customerId} onCreated={invalidate} />
      ) : (
        <p className="text-xs text-muted-ink">{o.limitProfiles.adminOnly}</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ProfileRow({
  profile,
  canManage,
  onChanged,
  onError,
}: {
  profile: LimitProfile;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  // The confirmation is a sentence about the transition that just committed,
  // so it is cleared on the next attempt: a stale «بازنشسته شد» under a row
  // that has since been reactivated would be a false statement.
  const [done, setDone] = useState<string | null>(null);
  const retire = useMutation({
    mutationFn: () =>
      lic.retireLimitProfile(profile.id, { reason: reason.trim() }),
    onSuccess: () => {
      onError(null);
      setDone(o.limitProfiles.retiredAction);
      onChanged();
    },
    onError: (cause) => {
      setDone(null);
      onError(limitProfileError(cause));
    },
  });
  const reactivate = useMutation({
    mutationFn: () =>
      lic.reactivateLimitProfile(profile.id, { reason: reason.trim() }),
    onSuccess: () => {
      onError(null);
      setDone(o.limitProfiles.reactivated);
      onChanged();
    },
    onError: (cause) => {
      setDone(null);
      onError(limitProfileError(cause));
    },
  });
  const pending = retire.isPending || reactivate.isPending;
  return (
    <div className="space-y-1 rounded border border-line p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {profile.status === 'ACTIVE'
            ? o.limitProfiles.active
            : o.limitProfiles.retired}
        </span>
        <span className="text-xs text-muted-ink" dir="ltr">
          {formatOwnerInstant(profile.updatedAt)}
        </span>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold">
            {o.limitProfiles.organizationLimit}:{' '}
          </dt>
          <dd className="inline" dir="ltr">
            {profile.organizationLimit ?? o.licenses.noLimit}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">
            {o.limitProfiles.userLimit}:{' '}
          </dt>
          <dd className="inline" dir="ltr">
            {profile.userLimit ?? o.licenses.noLimit}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-semibold">
            {o.limitProfiles.allowedModules}:{' '}
          </dt>
          <dd className="inline" dir="ltr">
            {profile.allowedModules.join(', ') || '—'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-semibold">
            {o.limitProfiles.perpetualAllowed}:{' '}
          </dt>
          <dd className="inline">
            {profile.perpetualAllowed ? o.active : o.inactive}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-ink">
        {o.limitProfiles.ceilingImmutable}
      </p>
      {canManage ? (
        <details className="rounded border border-line p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            {profile.status === 'ACTIVE'
              ? o.limitProfiles.retire
              : o.limitProfiles.reactivate}
          </summary>
          <div className="mt-2 space-y-2">
            <FormField
              id={`profile-reason-${profile.id}`}
              label={o.limitProfiles.reason}
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
              loading={pending}
              disabled={pending || reason.trim().length === 0}
              onClick={() => {
                setDone(null);
                return profile.status === 'ACTIVE'
                  ? retire.mutate()
                  : reactivate.mutate();
              }}
            >
              {profile.status === 'ACTIVE'
                ? o.limitProfiles.retire
                : o.limitProfiles.reactivate}
            </Button>
            {done !== null ? (
              <p className="text-xs text-success">{done}</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CreateProfileForm({
  customerId,
  onCreated,
}: {
  customerId: string;
  onCreated: () => void;
}) {
  const [organizationLimit, setOrganizationLimit] = useState('');
  const [userLimit, setUserLimit] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [perpetualAllowed, setPerpetualAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      const parse = (value: string, label: string): number | null => {
        if (!value.trim()) return null;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0)
          throw new Error(`${label}: ${o.licenses.errorPositive}`);
        return parsed;
      };
      if (modules.length === 0)
        throw new Error(o.limitProfiles.modulesRequired);
      return await lic.createLimitProfile(customerId, {
        organizationLimit: parse(
          organizationLimit,
          o.limitProfiles.organizationLimit,
        ),
        userLimit: parse(userLimit, o.limitProfiles.userLimit),
        allowedModules: modules,
        perpetualAllowed,
      });
    },
    onSuccess: () => {
      setError(null);
      setCreated(true);
      setOrganizationLimit('');
      setUserLimit('');
      setModules([]);
      setPerpetualAllowed(false);
      onCreated();
    },
    onError: (cause) => {
      setCreated(false);
      if (cause instanceof Error && !(cause instanceof ApiError)) {
        setError(cause.message);
        return;
      }
      setError(limitProfileError(cause));
    },
  });
  return (
    <details className="rounded border border-line p-2">
      <summary className="cursor-pointer text-sm font-semibold">
        {o.limitProfiles.create}
      </summary>
      <p className="mt-2 text-sm text-secondary">
        {o.limitProfiles.createHelp}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <FormField
          id="profile-organization-limit"
          label={o.limitProfiles.organizationLimit}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              dir="ltr"
              inputMode="numeric"
              value={organizationLimit}
              onChange={(event) => setOrganizationLimit(event.target.value)}
            />
          )}
        </FormField>
        <FormField id="profile-user-limit" label={o.limitProfiles.userLimit}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              dir="ltr"
              inputMode="numeric"
              value={userLimit}
              onChange={(event) => setUserLimit(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <fieldset className="mt-2 space-y-1">
        <legend className="text-sm font-semibold">
          {o.limitProfiles.allowedModules}
        </legend>
        <div className="flex flex-wrap gap-3">
          {MODULE_CODES.map((code) => (
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
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={perpetualAllowed}
          onChange={(event) => setPerpetualAllowed(event.target.checked)}
        />
        {o.limitProfiles.perpetualAllowed}
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {created ? (
        <p className="mt-2 text-sm text-success">{o.limitProfiles.created}</p>
      ) : null}
      <Button
        className="mt-2"
        loading={create.isPending}
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? o.saving : o.limitProfiles.create}
      </Button>
    </details>
  );
}

function limitProfileError(cause: unknown): string {
  const error = normalizeApiError(cause);
  if (error.code === 'ActiveProfileExists') {
    // The API distinguishes “another profile is already active” (a conflict on
    // reactivation) from “this customer already has an active profile”. The
    // sentence is chosen by the server's own wording, never guessed.
    return error.message.toLowerCase().includes('another')
      ? o.limitProfiles.reactivateConflict
      : o.limitProfiles.activeExists;
  }
  if (error.code === 'InvalidTransition')
    return o.limitProfiles.invalidTransition;
  return error.message;
}
