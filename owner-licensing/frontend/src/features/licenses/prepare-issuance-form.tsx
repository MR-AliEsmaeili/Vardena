import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type {
  InstallationIdentity,
  Issuance,
  LicenseKind,
  LimitProfile,
} from '@/api/licensing';
import { ApiError, normalizeApiError } from '@/api/errors';
import {
  CustomerPicker,
  type CustomerOption,
} from '@/features/customers/customer-picker';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useSession } from '@/features/auth/use-session';
import { o } from '@/lib/owner-i18n';
import { formatOwnerBusinessDay, formatOwnerInstant } from '@/lib/date-time';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import {
  emptyDraft,
  toPrepareInput,
  validateDraft,
  type IssuanceDraft,
} from './issuance-draft';
import { PreparedPanel } from './prepared-panel';
import { useActiveSigningKeys } from './use-active-signing-keys';

export interface IssuancePrefill {
  customer: CustomerOption;
  source: Issuance;
  mode: 'renew' | 'supersede';
}

/**
 * Selection-driven issuance.
 *
 * The operator picks a real customer, one of that customer's registered
 * installations and an active signing key; the active limit profile is shown
 * before anything is typed, and the request is reviewed before it is created.
 * Nothing here invents a value: identifiers, ceilings, allowed modules and
 * lineage targets all come from the API, and the backend re-validates every
 * one of them inside the preparation transaction.
 *
 * The cryptographic boundary is unchanged (OD-LIC-08/11): this form produces an
 * *unsigned* request. The signed artifact comes back through the import step
 * and is only then recorded.
 */
export function PrepareIssuanceForm({
  prefill,
}: {
  prefill?: IssuancePrefill | null;
}) {
  const permissions = usePermissions();
  const { user } = useSession();
  const client = useQueryClient();
  const isOwnerAdmin = user?.role === 'OWNER_ADMIN';
  const [customer, setCustomer] = useState<CustomerOption | null>(
    prefill?.customer ?? null,
  );
  const [draft, setDraft] = useState<IssuanceDraft>(() =>
    prefill ? draftFromIssuance(prefill) : emptyDraft(),
  );
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    issuance: Issuance;
    requestPayloadSha256: string;
    requestBindingSha256: string;
  } | null>(null);

  const installations = useQuery({
    queryKey: ['owner', 'installation-identities', customer?.id ?? ''],
    queryFn: ({ signal }) =>
      lic.installationIdentities(customer?.id ?? '', signal),
    enabled: customer !== null && permissions.has('licenses.view'),
  });
  const profiles = useQuery({
    queryKey: ['owner', 'limit-profiles', customer?.id ?? ''],
    queryFn: ({ signal }) => lic.limitProfiles(customer?.id ?? '', signal),
    enabled: customer !== null && permissions.has('licenses.view'),
  });
  const keys = useActiveSigningKeys();
  const targets = useQuery({
    queryKey: ['owner', 'license-issuances', 'lineage', customer?.id ?? ''],
    queryFn: ({ signal }) =>
      lic.issuances(1, { customerId: customer?.id ?? '' }, signal),
    enabled:
      customer !== null && isOwnerAdmin && permissions.has('licenses.view'),
  });

  const activeIdentities =
    installations.data?.items.filter((item) => item.status === 'ACTIVE') ?? [];
  const activeKeys = keys.data?.items ?? [];
  const profile = profiles.data?.activeProfile ?? null;
  const lineageTargets =
    targets.data?.items.filter(
      (issuance) => issuance.status === 'SIGNED_RECORDED',
    ) ?? [];

  /**
   * Auto-selection is derived, never stored: an operator issuing for a customer
   * with exactly one active installation or one active key should not have to
   * click a single option, and an effect that writes state after a query
   * resolves is exactly the pattern the standards forbid.
   */
  const onlyIdentity =
    activeIdentities.length === 1 ? activeIdentities[0] : undefined;
  const onlyKey = activeKeys.length === 1 ? activeKeys[0] : undefined;
  const effective: IssuanceDraft = {
    ...draft,
    installationIdentityId:
      draft.installationIdentityId || onlyIdentity?.id || '',
    installationId: draft.installationId || onlyIdentity?.installationId || '',
    signingKeyId: draft.signingKeyId || onlyKey?.id || '',
    modules:
      draft.modules.length > 0
        ? draft.modules
        : (profile?.allowedModules ?? []),
  };

  const canPrepare =
    effective.kind === 'PERPETUAL'
      ? permissions.has('licenses.issue.perpetual')
      : permissions.has('licenses.issue.time_limited');

  const mutation = useMutation({
    mutationFn: async (input: IssuanceDraft) => {
      const problem = validateDraft(input);
      if (problem) throw new Error(problem);
      return await lic.prepareIssuance(toPrepareInput(input));
    },
    onSuccess: (result) => {
      if (!result.issuance) {
        setError(o.licenses.errorResponse);
        return;
      }
      setPrepared({
        issuance: result.issuance,
        requestPayloadSha256: result.requestPayloadSha256,
        requestBindingSha256: result.requestBindingSha256,
      });
      setStep('edit');
      setError(null);
      void client.invalidateQueries({
        queryKey: ['owner', 'license-issuances'],
      });
    },
    onError: (cause) => {
      setPrepared(null);
      // A ceiling refusal is not a malformed request: the operator must be told
      // WHICH fact conflicts and where it is managed. The code is the stable
      // machine reason (`fail(409, "LimitProfileExceeded", …)`), never the
      // backend message.
      if (cause instanceof ApiError && cause.code === 'LimitProfileExceeded') {
        setError(o.licenses.profileExceeded);
        return;
      }
      setError(
        cause instanceof Error && !('status' in cause)
          ? cause.message
          : normalizeApiError(cause).message,
      );
    },
  });

  if (!permissions.has('licenses.issue.time_limited'))
    return (
      <output className="block owner-panel p-4 text-sm text-secondary">
        {o.licenses.noPrepare}
      </output>
    );

  const selectCustomer = (next: CustomerOption) => {
    setCustomer(next);
    setPrepared(null);
    setError(null);
    setDraft((current) => ({
      ...emptyDraft(),
      // A lineage choice belongs to the previous customer's licenses.
      signingKeyId: current.signingKeyId,
      modules: current.modules,
      customerId: next.id,
      customerCode: next.customerCode,
      customerName: next.displayName,
    }));
  };

  const proceedToReview = () => {
    const problem = validateDraft(effective);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep('review');
  };

  if (step === 'review') {
    return (
      <section className="space-y-3 owner-panel p-4">
        <h2 className="font-bold">{o.licenses.reviewTitle}</h2>
        <p className="text-sm text-secondary">{o.licenses.reviewHelp}</p>
        <ReviewSummary draft={effective} profile={profile} />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={mutation.isPending}
            disabled={mutation.isPending || !canPrepare}
            onClick={() => mutation.mutate(effective)}
          >
            {mutation.isPending
              ? o.licenses.preparing
              : o.licenses.reviewConfirm}
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setStep('edit')}
          >
            {o.licenses.reviewBack}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 owner-panel p-4">
      <header className="space-y-1">
        <h2 className="font-bold">{o.licenses.prepareTitle}</h2>
        <p className="text-sm text-secondary">{o.licenses.prepareHelp}</p>
      </header>
      <CustomerPicker selected={customer} onSelect={selectCustomer} />
      {customer?.status === 'INACTIVE' ? (
        // The backend refuses to prepare for an inactive customer
        // (`prepare` re-reads the row), so this is said before the operator
        // fills the whole form for a request that cannot be created.
        <output className="block rounded border border-warning-line bg-warning-soft p-2 text-xs text-warning">
          {o.licenses.customerInactive}
        </output>
      ) : null}
      {customer ? (
        <>
          {installations.isPending ? <LoadingState rows={1} /> : null}
          <div className="space-y-1">
            <FormField
              id="issuance-installation"
              label={o.licenses.installationPick}
              hint={o.licenses.installationPickHint}
              error={
                activeIdentities.length === 0
                  ? o.licenses.installationNone
                  : undefined
              }
            >
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={effective.installationIdentityId}
                  onChange={(event) => {
                    const chosen = activeIdentities.find(
                      (item) => item.id === event.target.value,
                    );
                    setDraft((current) => ({
                      ...current,
                      installationIdentityId: event.target.value,
                      installationId: chosen?.installationId ?? '',
                    }));
                  }}
                >
                  <option value="">—</option>
                  {activeIdentities.map((item: InstallationIdentity) => (
                    <option key={item.id} value={item.id}>
                      {item.installationId} —{' '}
                      {formatOwnerInstant(item.confirmedAt)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <Link
              className="text-xs text-accent underline"
              to={`/app/customers/${customer.id}`}
            >
              {o.licenses.installationRegisterLink}
            </Link>
          </div>
          <ProfileBanner
            profile={profile}
            loading={profiles.isPending}
            customerId={customer.id}
          />
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <FormField
            id="issuance-key"
            label={o.licenses.keyPick}
            hint={o.licenses.keyPickHint}
            error={activeKeys.length === 0 ? o.licenses.keyNone : undefined}
          >
            {(fieldProps) =>
              activeKeys.length > 0 ? (
                <Select
                  {...fieldProps}
                  value={effective.signingKeyId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      signingKeyId: event.target.value,
                    }))
                  }
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
                  {...fieldProps}
                  dir="ltr"
                  value={draft.signingKeyId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      signingKeyId: event.target.value,
                    }))
                  }
                />
              )
            }
          </FormField>
          <Link
            className="text-xs text-accent underline"
            to="/app/signing-keys"
          >
            {o.licenses.keyRegisterLink}
          </Link>
        </div>
        <FormField id="issuance-kind" label={o.licenses.kind}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={draft.kind}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  kind: event.target.value as LicenseKind,
                }))
              }
            >
              <option value="TIME_LIMITED">{o.licenses.timeLimited}</option>
              {permissions.has('licenses.issue.perpetual') ? (
                <option value="PERPETUAL">{o.licenses.perpetual}</option>
              ) : null}
            </Select>
          )}
        </FormField>
        {draft.kind === 'TIME_LIMITED' ? (
          <FormField
            id="issuance-valid-until"
            label={o.licenses.endDate}
            hint={o.licenses.startDateNote}
          >
            {(fieldProps) => (
              <DateInput
                {...fieldProps}
                value={draft.validUntil}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, validUntil: value }))
                }
              />
            )}
          </FormField>
        ) : (
          <p className="self-end text-sm text-secondary">
            {o.licenses.perpetualHelp}
          </p>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ['organizationLimit', o.licenses.organizationLimit],
            ['userLimit', o.licenses.userLimit],
          ] as const
        ).map(([field, label]) => (
          <FormField key={field} id={`issuance-${field}`} label={label}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                dir="ltr"
                inputMode="numeric"
                value={draft[field]}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
              />
            )}
          </FormField>
        ))}
        <FormField id="issuance-device-limit" label={o.licenses.deviceLimit}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              dir="ltr"
              inputMode="numeric"
              disabled={!draft.deviceLimitSpecified}
              value={draft.deviceLimit}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  deviceLimit: event.target.value,
                }))
              }
            />
          )}
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.deviceLimitSpecified}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              deviceLimitSpecified: event.target.checked,
            }))
          }
        />
        {o.licenses.deviceSpecified}
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{o.licenses.modules}</legend>
        <div className="flex flex-wrap gap-3">
          {lic.MODULE_CODES.map((code) => {
            const allowed = !profile || profile.allowedModules.includes(code);
            return (
              <label key={code} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={effective.modules.includes(code)}
                  disabled={!allowed}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modules: event.target.checked
                        ? [...current.modules, code]
                        : current.modules.filter((entry) => entry !== code),
                    }))
                  }
                />
                <span dir="ltr">{code}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FormField
        id="issuance-features"
        label={o.licenses.features}
        hint={o.licenses.features}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            dir="ltr"
            value={draft.features}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                features: event.target.value,
              }))
            }
          />
        )}
      </FormField>
      <LineageFields
        draft={draft}
        setDraft={setDraft}
        isOwnerAdmin={isOwnerAdmin}
        targets={lineageTargets}
        loading={targets.isPending}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        disabled={mutation.isPending || !canPrepare}
        onClick={proceedToReview}
      >
        {o.licenses.review}
      </Button>
      {prepared ? (
        <PreparedPanel
          targetId={prepared.issuance.id}
          operationId={prepared.issuance.operationId}
          digests={{
            payload: prepared.requestPayloadSha256,
            binding: prepared.requestBindingSha256,
          }}
        />
      ) : null}
    </section>
  );
}

function draftFromIssuance(prefill: IssuancePrefill): IssuanceDraft {
  return {
    ...emptyDraft(),
    customerId: prefill.customer.id,
    customerCode: prefill.customer.customerCode,
    customerName: prefill.customer.displayName,
    installationIdentityId: prefill.source.installationIdentityId,
    installationId: prefill.source.installationId,
    signingKeyId: prefill.source.signingKeyId ?? '',
    kind: prefill.source.licenseKind,
    organizationLimit: prefill.source.organizationLimit?.toString() ?? '',
    userLimit: prefill.source.userLimit?.toString() ?? '',
    deviceLimit: prefill.source.deviceLimit?.toString() ?? '',
    deviceLimitSpecified: prefill.source.deviceLimitSpecified,
    modules: prefill.source.modules,
    features: prefill.source.features.join(', '),
    lineage: prefill.mode,
    lineageOperationId: prefill.source.operationId,
  };
}

function ProfileBanner({
  profile,
  loading,
  customerId,
}: {
  profile: LimitProfile | null;
  loading: boolean;
  customerId: string;
}) {
  if (loading) return <LoadingState rows={1} />;
  if (profile === null)
    return (
      <div className="space-y-1 rounded bg-canvas p-2 text-xs text-secondary">
        <p>{o.licenses.profileNone}</p>
        <ProfileLink customerId={customerId} />
      </div>
    );
  return (
    <div className="space-y-1 rounded border border-line bg-canvas p-2 text-xs">
      <p className="font-semibold">{o.licenses.profileTitle}</p>
      <p>
        {o.licenses.profileCeilings}:{' '}
        <span dir="ltr">
          {o.licenses.organizationLimit}{' '}
          {profile.organizationLimit ?? o.licenses.noLimit} ·{' '}
          {o.licenses.userLimit} {profile.userLimit ?? o.licenses.noLimit}
        </span>
      </p>
      <p>
        {o.licenses.profileModules}:{' '}
        <span dir="ltr">{profile.allowedModules.join(', ') || '—'}</span>
      </p>
      <p>
        {profile.perpetualAllowed
          ? o.licenses.profilePerpetualAllowed
          : o.licenses.profilePerpetualBlocked}
      </p>
      {/* The ceiling is managed on the customer record, so the banner links
          there instead of implying the form can change it (it cannot). */}
      <ProfileLink customerId={customerId} />
    </div>
  );
}

function ProfileLink({ customerId }: { customerId: string }) {
  return (
    <Link
      className="inline-block text-accent underline"
      to={`/app/customers/${customerId}`}
    >
      {o.licenses.profileManageLink}
    </Link>
  );
}

function LineageFields({
  draft,
  setDraft,
  isOwnerAdmin,
  targets,
  loading,
}: {
  draft: IssuanceDraft;
  setDraft: (update: (current: IssuanceDraft) => IssuanceDraft) => void;
  isOwnerAdmin: boolean;
  targets: Issuance[];
  loading: boolean;
}) {
  if (!isOwnerAdmin)
    return (
      <p className="rounded bg-canvas p-2 text-xs text-secondary">
        {o.licenses.lineageOperatorDenied}
      </p>
    );
  return (
    <fieldset className="space-y-2 rounded border border-line p-2">
      <legend className="text-sm font-semibold">
        {o.licenses.lineageTitle}
      </legend>
      <p className="text-xs text-muted-ink">{o.licenses.lineageHint}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField id="issuance-lineage-mode" label={o.licenses.lineageTitle}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={draft.lineage}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  lineage: event.target.value as IssuanceDraft['lineage'],
                  lineageOperationId:
                    event.target.value === 'none'
                      ? ''
                      : current.lineageOperationId,
                }))
              }
            >
              <option value="none">{o.licenses.lineageNone}</option>
              <option value="renew">{o.licenses.lineageRenew}</option>
              <option value="supersede">{o.licenses.lineageSupersede}</option>
            </Select>
          )}
        </FormField>
        {draft.lineage !== 'none' ? (
          <FormField
            id="issuance-lineage-target"
            label={o.licenses.lineageTarget}
            hint={loading ? o.licenses.importing : undefined}
            error={
              !loading && targets.length === 0
                ? o.licenses.lineageNoTargets
                : undefined
            }
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={draft.lineageOperationId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lineageOperationId: event.target.value,
                  }))
                }
              >
                <option value="">—</option>
                {targets.map((target) => (
                  <option key={target.operationId} value={target.operationId}>
                    {target.operationId} —{' '}
                    {target.validUntil?.slice(0, 10) ?? o.licenses.perpetual}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </div>
    </fieldset>
  );
}

function ReviewSummary({
  draft,
  profile,
}: {
  draft: IssuanceDraft;
  profile: LimitProfile | null;
}) {
  const rows: Array<[string, string]> = [
    [
      o.licenses.reviewCustomer,
      `${draft.customerName} (${draft.customerCode})`,
    ],
    [o.licenses.reviewInstallation, draft.installationId],
    [
      o.licenses.reviewKind,
      draft.kind === 'PERPETUAL'
        ? o.licenses.perpetual
        : o.licenses.timeLimited,
    ],
    [
      o.licenses.reviewWindow,
      draft.kind === 'PERPETUAL'
        ? o.licenses.perpetualHelp
        : `${o.licenses.startDateNote} → ${formatOwnerBusinessDay(draft.validUntil)}`,
    ],
    [
      o.licenses.reviewLimits,
      `${o.licenses.organizationLimit}: ${draft.organizationLimit || o.licenses.noLimit} · ${o.licenses.userLimit}: ${draft.userLimit || o.licenses.noLimit}`,
    ],
    [o.licenses.reviewModules, draft.modules.join(', ')],
    [o.licenses.reviewKey, draft.signingKeyId],
    [
      o.licenses.reviewLineage,
      draft.lineage === 'none'
        ? o.licenses.lineageNone
        : `${draft.lineage === 'renew' ? o.licenses.lineageRenew : o.licenses.lineageSupersede} — ${draft.lineageOperationId}`,
    ],
  ];
  return (
    <div className="space-y-2">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded bg-canvas p-2">
            <dt className="text-xs text-muted-ink">{label}</dt>
            <dd className="break-all" dir="auto">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {profile ? (
        <p className="text-xs text-muted-ink">{o.licenses.profileTitle}</p>
      ) : null}
      {profile && draft.kind === 'PERPETUAL' && !profile.perpetualAllowed ? (
        <p role="alert" className="text-sm text-danger">
          {o.licenses.profilePerpetualBlocked}
        </p>
      ) : null}
    </div>
  );
}
