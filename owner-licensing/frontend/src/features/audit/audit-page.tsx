import { formatOwnerInstant } from '@/lib/date-time';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as api from '@/api/owner.api';
import { queryKeys } from '@/api/query-keys';
import type { AuditEvent } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';
import {
  auditOutcomes,
  auditDayZone,
  auditTargetTypes,
  emptyAuditFilters,
  filtersFromParams,
  hasAppliedFilters,
  knownAuditEventTypes,
  observedAuditEventTypes,
  auditUrlIsWellFormed,
  pageFromParams,
  paramsFromFilters,
  toAuditQuery,
  type AuditFilterValues,
} from './audit-filters';
import { auditFilterSchema } from './audit-filter-schema';

const selectClass =
  'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900';

function eventLabel(code: string): string {
  return (o.auditEventLabels as Record<string, string>)[code] ?? code;
}

function targetText(event: AuditEvent): string {
  const type = event.targetType as keyof typeof o.auditTargetLabels;
  const label = o.auditTargetLabels[type] ?? event.targetType;
  return event.targetId ? `${label} — ${event.targetId}` : label;
}

function outcomeLabel(outcome: AuditEvent['outcome']): string {
  return o.auditOutcomeLabels[outcome];
}

function AuditEventCard({ event }: { event: AuditEvent }) {
  const rows: [string, string | null | undefined, string?][] = [
    [o.actor, event.actorId],
    [o.target, targetText(event)],
    [o.time, formatOwnerInstant(event.occurredAt), event.occurredAt],
    [o.outcome, outcomeLabel(event.outcome)],
    [o.reason, event.reason],
  ];
  return (
    <li className="space-y-2 rounded border bg-white p-4">
      <h2 className="font-semibold">{eventLabel(event.eventType)}</h2>
      <p className="code text-xs text-slate-500" dir="ltr">
        {event.eventType}
      </p>
      {observedAuditEventTypes.includes(event.eventType) ? (
        <p className="text-sm text-amber-800">{o.auditObservedNote}</p>
      ) : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value, canonical]) => (
          <div key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd title={canonical} dir="auto" className="break-all">
              {value ?? '—'}
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>
          {o.before} / {o.after}
        </summary>
        <p className="text-xs text-slate-500">{o.auditBeforeAfterHint}</p>
        <pre dir="ltr" className="overflow-auto text-xs">
          {JSON.stringify(
            { before: event.beforeState, after: event.afterState },
            null,
            2,
          )}
        </pre>
      </details>
    </li>
  );
}

export function AuditPage() {
  const permissions = usePermissions();
  const [params, setParams] = useSearchParams();
  const page = pageFromParams(params);
  const applied = filtersFromParams(params);
  const dayZone = auditDayZone(params);
  const appliedKey = paramsFromFilters(applied, 1, dayZone).toString();
  // A URL the backend would reject (repeated, unknown or malformed parameters) is
  // not queried, so it can never show results that differ from what it states.
  const auditQuery = toAuditQuery(applied, page, dayZone);
  const filtersValid =
    auditQuery !== undefined &&
    auditUrlIsWellFormed(params) &&
    auditFilterSchema.safeParse(applied).success;

  const form = useForm<AuditFilterValues>({
    resolver: zodResolver(auditFilterSchema),
    defaultValues: applied,
  });
  const { reset } = form;
  // Browser back/forward and deep links rewrite the URL: mirror that into the draft.
  // Pagination changes are excluded so an unapplied draft survives paging.
  useEffect(() => {
    reset(filtersFromParams(new URLSearchParams(appliedKey)));
  }, [appliedKey, reset]);

  // Invalid/unrepresentable UTC bounds disable the query rather than silently
  // removing a bound (including the backend year floor after local conversion).
  const query = useQuery({
    queryKey: queryKeys.auditEvents(auditQuery ?? { page }),
    queryFn: ({ signal }) => {
      if (auditQuery === undefined) throw new Error(o.auditInvalidFilters);
      return api.auditEvents(auditQuery, signal);
    },
    enabled:
      permissions.has('audit.view') && filtersValid && auditQuery !== undefined,
  });

  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('audit.view')) return <p>{o.forbidden}</p>;

  // Applying a filter writes a new URL without `page`, so the result is page one.
  const apply = form.handleSubmit((values) => {
    setParams(paramsFromFilters(values, 1, dayZone));
  });
  const resetFilters = () => {
    reset(emptyAuditFilters);
    setParams(new URLSearchParams());
  };
  const setPage = (next: number) => {
    setParams(paramsFromFilters(applied, next, dayZone));
  };
  const errors = form.formState.errors;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{o.audit}</h1>
      <p className="text-sm text-slate-500">{o.auditNotice}</p>
      <form
        aria-label={o.auditFilters}
        noValidate
        className="space-y-4 rounded-lg border bg-white p-4"
        onSubmit={(event) => void apply(event)}
      >
        <h2 className="font-semibold">{o.auditFilters}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            id="audit-event-type"
            label={o.auditEventType}
            hint={o.auditEventTypeHint}
            error={errors.eventType?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('eventType')}
                dir="ltr"
                list="audit-event-types"
                autoComplete="off"
                maxLength={120}
              />
            )}
          </FormField>
          <datalist id="audit-event-types">
            {knownAuditEventTypes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </datalist>
          <FormField
            id="audit-actor-id"
            label={o.auditActorId}
            error={errors.actorId?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('actorId')}
                dir="ltr"
                autoComplete="off"
                maxLength={26}
              />
            )}
          </FormField>
          <FormField
            id="audit-target-type"
            label={o.auditTargetType}
            error={errors.targetType?.message}
          >
            {(props) => (
              <select
                {...props}
                {...form.register('targetType')}
                className={selectClass}
              >
                <option value="">{o.all}</option>
                {auditTargetTypes.map((type) => (
                  <option key={type} value={type}>
                    {o.auditTargetLabels[type]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id="audit-target-id"
            label={o.auditTargetId}
            error={errors.targetId?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('targetId')}
                dir="ltr"
                autoComplete="off"
                maxLength={26}
              />
            )}
          </FormField>
          <FormField
            id="audit-outcome"
            label={o.auditOutcome}
            error={errors.outcome?.message}
          >
            {(props) => (
              <select
                {...props}
                {...form.register('outcome')}
                className={selectClass}
              >
                <option value="">{o.all}</option>
                {auditOutcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {o.auditOutcomeLabels[outcome]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="audit-from"
            label={o.auditFrom}
            error={errors.from?.message}
          >
            {(props) => (
              <Controller
                name="from"
                control={form.control}
                render={({ field }) => (
                  <DateInput
                    {...props}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
          </FormField>
          <FormField id="audit-to" label={o.auditTo} error={errors.to?.message}>
            {(props) => (
              <Controller
                name="to"
                control={form.control}
                render={({ field }) => (
                  <DateInput
                    {...props}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
          </FormField>
        </div>
        <p className="text-xs text-slate-500">
          {dayZone === 'UTC' ? o.auditLegacyRangeHint : o.auditRangeHint}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{o.auditApply}</Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            {o.auditReset}
          </Button>
        </div>
      </form>

      {filtersValid ? null : (
        <p role="alert" className="text-sm text-rose-700">
          {o.auditInvalidFilters}
        </p>
      )}
      {!filtersValid ? null : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={hasAppliedFilters(applied) ? o.noResults : o.noAudit}
        />
      ) : (
        <ul className="space-y-3">
          {query.data.items.map((event) => (
            <AuditEventCard key={event.id} event={event} />
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        hasNext={query.data?.hasNext ?? false}
        setPage={setPage}
      />
    </section>
  );
}
