import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { isBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import {
  useAccountingPeriods,
  useFinancialAreas,
  useFiscalYears,
} from '../shared/use-accounting-references';
import type { DocumentsUrlState } from './use-documents-list';

/**
 * Documents workspace filters — exactly the query parameters the
 * `AccountingDocumentsController.list` endpoint declares: free-text search
 * (server-side narration match), state, origin, fiscal scope
 * (area → year → period, narrowed server-side like the report filters),
 * exact document number and a date range. Nothing else exists here because
 * nothing else exists in the contract.
 *
 * Filters are applied EXPLICITLY (on submit) and then live in the URL; the
 * form is re-seeded from the URL whenever it changes (Back/Forward/deep
 * link), which keeps the visible controls and the URL in lock-step.
 */

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || isBusinessDay(value), {
    message: t.filters.invalidDate,
  });

const documentsFilterSchema = z.object({
  search: z.string().trim(),
  /** Exactly the enum values the endpoint's `state` parameter accepts. */
  state: z.enum(['', 'draft', 'temporary', 'final']),
  /** Exactly the enum values the endpoint's `origin` parameter accepts. */
  origin: z.enum(['', 'manual', 'system']),
  financialAreaId: z.string(),
  fiscalYearId: z.string(),
  accountingPeriodId: z.string(),
  documentNumber: z.string().trim(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export type DocumentsFilterValues = z.infer<typeof documentsFilterSchema>;

export function documentsFilterValuesFromUrl(
  state: DocumentsUrlState,
): DocumentsFilterValues {
  return {
    search: state.search,
    state: state.state,
    origin: state.origin,
    financialAreaId: state.financialAreaId,
    fiscalYearId: state.fiscalYearId,
    accountingPeriodId: state.accountingPeriodId,
    documentNumber: state.documentNumber,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
  };
}

export function isEmptyDocumentsFilter(values: DocumentsFilterValues): boolean {
  return (
    values.search === '' &&
    values.state === '' &&
    values.origin === '' &&
    values.financialAreaId === '' &&
    values.fiscalYearId === '' &&
    values.accountingPeriodId === '' &&
    values.documentNumber === '' &&
    values.dateFrom === '' &&
    values.dateTo === ''
  );
}

export interface DocumentsFilterBarProps {
  organizationId: string | null;
  /** URL-owned values the form is seeded with (a change remounts the form). */
  values: DocumentsFilterValues;
  synchronizationKey: string;
  isFetching: boolean;
  onApply: (values: DocumentsFilterValues) => void;
  onClear: () => void;
}

export function DocumentsFilterBar({
  organizationId,
  values,
  synchronizationKey,
  isFetching,
  onApply,
  onClear,
}: DocumentsFilterBarProps) {
  const form = useForm<DocumentsFilterValues>({
    resolver: zodResolver(documentsFilterSchema),
    defaultValues: values,
    mode: 'onSubmit',
  });
  const { register, watch, setValue, formState } = form;

  const financialAreaId = watch('financialAreaId');
  const fiscalYearId = watch('fiscalYearId');

  const areasQuery = useFinancialAreas(organizationId);
  const yearsQuery = useFiscalYears(
    organizationId,
    financialAreaId === '' ? null : financialAreaId,
  );
  const periodsQuery = useAccountingPeriods(
    organizationId,
    fiscalYearId === '' ? null : fiscalYearId,
  );

  const areas = useMemo(() => areasQuery.data?.items ?? [], [areasQuery.data]);
  const years = useMemo(() => yearsQuery.data?.items ?? [], [yearsQuery.data]);
  const periods = useMemo(
    () => periodsQuery.data?.items ?? [],
    [periodsQuery.data],
  );

  // Changing a scope level invalidates the levels below it (the server owns
  // the area → year → period consistency; a stale child value would be a
  // filter the API cannot honor).
  useEffect(() => {
    if (
      financialAreaId !== '' &&
      years.length > 0 &&
      !years.some((year) => year.id === fiscalYearId)
    ) {
      setValue('fiscalYearId', '');
      setValue('accountingPeriodId', '');
    }
  }, [financialAreaId, fiscalYearId, setValue, years]);

  return (
    <form
      key={synchronizationKey}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
      onSubmit={form.handleSubmit(onApply)}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField id="documents-search" label={t.app.search}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...form.register('search')}
              className="h-9"
            />
          )}
        </FormField>

        <FormField id="documents-filter-state" label={t.documents.filterState}>
          {(fieldProps) => (
            <Select {...fieldProps} className="h-9" {...form.register('state')}>
              <option value="">{t.documents.allStates}</option>
              <option value="draft">{t.documents.stateDraft}</option>
              <option value="temporary">{t.documents.stateTemporary}</option>
              <option value="final">{t.documents.stateFinal}</option>
            </Select>
          )}
        </FormField>

        <FormField
          id="documents-filter-origin"
          label={t.documents.filterOrigin}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              className="h-9"
              {...form.register('origin')}
            >
              <option value="">{t.documents.allOrigins}</option>
              <option value="manual">{t.documents.originManual}</option>
              <option value="system">{t.documents.originSystem}</option>
            </Select>
          )}
        </FormField>

        <FormField
          id="documents-filter-number"
          label={t.documents.filterNumber}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...form.register('documentNumber')}
              dir="ltr"
              inputMode="numeric"
              className="h-9"
            />
          )}
        </FormField>

        <FormField id="documents-filter-area" label={t.documents.filterArea}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              className="h-9"
              {...register('financialAreaId', {
                onChange: () => {
                  setValue('fiscalYearId', '');
                  setValue('accountingPeriodId', '');
                },
              })}
            >
              <option value="">{t.documents.allAreas}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.code} — {area.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="documents-filter-year" label={t.documents.filterYear}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              className="h-9"
              disabled={financialAreaId === ''}
              {...register('fiscalYearId', {
                onChange: () => setValue('accountingPeriodId', ''),
              })}
            >
              <option value="">{t.documents.allYears}</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.code} — {year.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id="documents-filter-period"
          label={t.documents.filterPeriod}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              className="h-9"
              disabled={fiscalYearId === ''}
              {...form.register('accountingPeriodId')}
            >
              <option value="">{t.documents.allPeriods}</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.sequence} — {period.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField
            id="documents-filter-date-from"
            label={t.filters.dateFrom}
            error={formState.errors.dateFrom?.message}
          >
            {(fieldProps) => (
              <Controller
                control={form.control}
                name="dateFrom"
                render={({ field }) => (
                  <DateInput
                    {...fieldProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="h-9"
                  />
                )}
              />
            )}
          </FormField>
          <FormField
            id="documents-filter-date-to"
            label={t.filters.dateTo}
            error={formState.errors.dateTo?.message}
          >
            {(fieldProps) => (
              <Controller
                control={form.control}
                name="dateTo"
                render={({ field }) => (
                  <DateInput
                    {...fieldProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="h-9"
                  />
                )}
              />
            )}
          </FormField>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {t.documents.clear}
        </Button>
        <Button type="submit" size="sm" disabled={isFetching}>
          {t.documents.apply}
        </Button>
      </div>
    </form>
  );
}
