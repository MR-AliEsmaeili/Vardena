import { formatOwnerBusinessDay, formatOwnerInstant } from '@/lib/date-time';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as api from '@/api/owner.api';
import type { OperationalRecord } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { auditTrailHref } from '@/features/audit/audit-filters';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { useDirtyGuard } from '@/ui/patterns/owner-states';
import {
  activationObservationSchema,
  installedSchema,
  oldServerSchema,
  type ActivationObservationValues,
} from './operation-schema';
import { ManualNotice, OperationError, labelOf } from './operation-ui';

function noted(values: { reason: string; evidenceReference: string }) {
  const evidence = values.evidenceReference.trim();
  return evidence
    ? { reason: values.reason, evidenceReference: evidence }
    : { reason: values.reason };
}
function ObservationFields({
  idPrefix,
  register,
  errors,
}: {
  idPrefix: string;
  register: UseFormReturn<ActivationObservationValues>['register'];
  errors: {
    reason?: { message?: string } | undefined;
    evidenceReference?: { message?: string } | undefined;
    acknowledged?: { message?: string } | undefined;
  };
}) {
  return (
    <>
      <FormField
        id={`${idPrefix}-reason`}
        label={o.reason}
        error={errors.reason?.message}
      >
        {(props) => (
          <Input {...props} {...register('reason')} aria-required="true" />
        )}
      </FormField>
      <FormField
        id={`${idPrefix}-evidence`}
        label={o.evidence}
        hint={o.evidenceHint}
        error={errors.evidenceReference?.message}
      >
        {(props) => (
          <Input {...props} {...register('evidenceReference')} dir="ltr" />
        )}
      </FormField>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          aria-required="true"
          {...register('acknowledged')}
        />
        <span>{o.confirmObservation}</span>
      </label>
      {errors.acknowledged ? (
        <p role="alert" className="text-xs text-rose-700">
          {errors.acknowledged.message}
        </p>
      ) : null}
    </>
  );
}
function FollowUp({
  record,
  onDone,
}: {
  record: OperationalRecord;
  onDone: (next: OperationalRecord) => Promise<void>;
}) {
  const permissions = usePermissions();
  const activation = useForm<ActivationObservationValues>({
    resolver: zodResolver(activationObservationSchema),
    defaultValues: { reason: '', evidenceReference: '', acknowledged: false },
  });
  const oldServer = useForm({
    resolver: zodResolver(oldServerSchema),
    defaultValues: {
      reason: '',
      evidenceReference: '',
      oldServerObservedState: 'DEACTIVATION_OBSERVED' as const,
      acknowledged: false,
    },
  });
  const installed = useForm({
    resolver: zodResolver(installedSchema),
    defaultValues: {
      reason: '',
      evidenceReference: '',
      replacementObservedState: 'INSTALLATION_OBSERVED' as const,
      acknowledged: false,
    },
  });
  useDirtyGuard(
    activation.formState.isDirty ||
      oldServer.formState.isDirty ||
      installed.formState.isDirty,
  );
  const mutation = useMutation({
    mutationFn: (work: () => Promise<OperationalRecord>) => work(),
    onSuccess: async (next) => {
      activation.reset();
      oldServer.reset();
      installed.reset();
      await onDone(next);
    },
  });
  if (!permissions.has('operations.record')) return null;
  return (
    <>
      {record.kind === 'LICENSE' && record.observedStatus === 'ISSUED' ? (
        <form
          className="space-y-4 rounded-lg border bg-white p-5"
          onSubmit={activation.handleSubmit((values) =>
            mutation.mutate(() =>
              api.recordActivationObservation(record.id, noted(values)),
            ),
          )}
        >
          <h2 className="font-semibold">{o.recordActivation}</h2>
          <p className="text-sm">{o.notReceipt}</p>
          <ObservationFields
            idPrefix="activation"
            register={activation.register}
            errors={activation.formState.errors}
          />
          {mutation.isError ? <OperationError error={mutation.error} /> : null}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? o.saving : o.recordActivation}
          </Button>
        </form>
      ) : null}
      {record.kind === 'SERVER_REPLACEMENT' &&
      record.observedStatus === 'REPLACEMENT_AUTHORIZED' &&
      !record.emergencyOldServerLost ? (
        <form
          className="space-y-4 rounded-lg border bg-white p-5"
          onSubmit={oldServer.handleSubmit((values) =>
            mutation.mutate(() =>
              api.recordOldServerObservation(record.id, {
                ...noted(values),
                oldServerObservedState: 'DEACTIVATION_OBSERVED',
              }),
            ),
          )}
        >
          <h2 className="font-semibold">{o.recordOldServer}</h2>
          <p className="text-sm">{o.notEnforcement}</p>
          <ObservationFields
            idPrefix="old-server"
            register={oldServer.register}
            errors={oldServer.formState.errors}
          />
          {mutation.isError ? <OperationError error={mutation.error} /> : null}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? o.saving : o.recordOldServer}
          </Button>
        </form>
      ) : null}
      {record.kind === 'SERVER_REPLACEMENT' &&
      record.observedStatus === 'OLD_SERVER_STATE_RECORDED' ? (
        <form
          className="space-y-4 rounded-lg border bg-white p-5"
          onSubmit={installed.handleSubmit((values) =>
            mutation.mutate(() =>
              api.recordReplacementObservation(record.id, {
                ...noted(values),
                replacementObservedState: 'INSTALLATION_OBSERVED',
              }),
            ),
          )}
        >
          <h2 className="font-semibold">{o.recordInstalled}</h2>
          <ObservationFields
            idPrefix="installed"
            register={installed.register}
            errors={installed.formState.errors}
          />
          {mutation.isError ? <OperationError error={mutation.error} /> : null}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? o.saving : o.recordInstalled}
          </Button>
        </form>
      ) : null}
    </>
  );
}

export function OperationPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const permissions = usePermissions();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['owner', 'operation', id],
    queryFn: ({ signal }) => api.operationalRecord(id, signal),
    enabled: permissions.has('operations.view') && id.length > 0,
  });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('operations.view')) return <p>{o.forbidden}</p>;
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <OperationError error={query.error} />;
  const record = query.data;
  const refs = [
    record.installationReference,
    record.oldInstallationReference,
    record.replacementInstallationReference,
  ].filter(Boolean);
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{record.displayName}</h1>
      {!!(location.state as { saved?: boolean } | null)?.saved && (
        <output>{o.savedObservation}</output>
      )}
      <ManualNotice />
      <dl className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-2">
        {[
          [o.currentState, labelOf(record.observedStatus)],
          [o.kindFilter, o.kinds[record.kind]],
          [o.code, record.customerCode],
          [o.evidenceBasis, o.operatorObserved],
          [o.notVerified, o.notVerified],
          [o.noArtifact, o.noArtifact],
          [o.noContact, o.noContact],
          // PDR-18 §1: the recorded activation-validity window. Distinct from
          // the customer's commercial contract dates, which live on the
          // customer record and are never mixed in here.
          ...(record.kind === 'LICENSE'
            ? ([
                [
                  o.activationValidFrom,
                  formatOwnerBusinessDay(record.activationValidFrom),
                  record.activationValidFrom,
                ],
                [
                  o.activationValidUntil,
                  formatOwnerBusinessDay(record.activationValidUntil),
                  record.activationValidUntil,
                ],
              ] as [string, string, string | null][])
            : []),
          [o.id, record.id],
          [o.actor, record.createdBy],
          [o.created, formatOwnerInstant(record.createdAt), record.createdAt],
          [o.updated, formatOwnerInstant(record.updatedAt), record.updatedAt],
          [o.installation, refs.join(' → ') || '—'],
        ].map(([label, value, canonical]) => (
          <div key={label}>
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd title={canonical ?? undefined} className="break-all" dir="auto">
              {value}
            </dd>
          </div>
        ))}
        {record.emergencyOldServerLost ? (
          <div>
            <dt className="text-sm text-slate-500">{o.emergency}</dt>
            <dd>{o.emergencyHelp}</dd>
          </div>
        ) : null}
        {record.oldServerObservedState ? (
          <div>
            <dt className="text-sm text-slate-500">{o.recordOldServer}</dt>
            <dd>{labelOf(record.oldServerObservedState)}</dd>
          </div>
        ) : null}
      </dl>
      <h2 className="font-semibold">{o.history}</h2>
      {record.transitions && record.transitions.length > 0 ? (
        <ol className="space-y-3">
          {record.transitions.map((item) => (
            <li key={item.id} className="rounded border bg-white p-4 text-sm">
              <p>
                {labelOf(item.priorStatus)} → {labelOf(item.newStatus)}
              </p>
              <p>{item.reason}</p>
              <p className="text-slate-500">
                {o.actor}: <span dir="ltr">{item.actorId}</span>
              </p>
              <p className="text-slate-500" dir="ltr">
                <time dateTime={item.occurredAt} title={item.occurredAt}>
                  {formatOwnerInstant(item.occurredAt)}
                </time>
              </p>
              <p>
                {o.evidence}: {item.evidenceReference || '—'}
              </p>
              <p>{o.operatorObserved}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>{o.noResults}</p>
      )}
      <FollowUp
        record={record}
        onDone={async (next) => {
          qc.setQueryData(['owner', 'operation', record.id], next);
          await qc.invalidateQueries({ queryKey: ['owner', 'operations'] });
        }}
      />
      <div className="flex flex-wrap gap-3">
        {permissions.has('audit.view') ? (
          <Button asChild variant="outline">
            <Link to={auditTrailHref('OperationalRecord', record.id)}>
              {o.auditOperationLink}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/app/operations">{o.back}</Link>
        </Button>
      </div>
    </section>
  );
}
