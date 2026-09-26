import { useEffect, useMemo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import { AccountPicker } from './account-picker';
import type { LedgerScopeValues } from './report-filters';
import {
  useAccountingPeriods,
  useFinancialAreas,
  useFiscalYears,
} from './use-accounting-references';

export interface LedgerScopeFieldsProps {
  form: UseFormReturn<LedgerScopeValues>;
  organizationId: string | null;
  disabled?: boolean;
}

/**
 * The filter fields shared by General Ledger and Trial Balance — both
 * endpoints declare the same scope contract (organization + financial area +
 * fiscal year required; period, account, code/name substrings and a date
 * range optional).
 *
 * Dependent lists are narrowed server-side: fiscal years are requested for
 * the selected financial area and periods for the selected fiscal year, which
 * mirrors the backend's own consistency rules (a mismatched scope answers
 * 422).
 */
export function LedgerScopeFields({
  form,
  organizationId,
  disabled = false,
}: LedgerScopeFieldsProps) {
  const { register, watch, setValue, formState } = form;
  const financialAreaId = watch('financialAreaId');
  const fiscalYearId = watch('fiscalYearId');
  const accountId = watch('accountId');

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

  // A single available area/year is preselected; anything else stays an
  // explicit user choice (the report scope is never guessed).
  useEffect(() => {
    const onlyArea = areas.length === 1 ? areas[0] : undefined;
    if (onlyArea !== undefined && financialAreaId === '') {
      setValue('financialAreaId', onlyArea.id, { shouldDirty: false });
    }
  }, [areas, financialAreaId, setValue]);

  useEffect(() => {
    const onlyYear = years.length === 1 ? years[0] : undefined;
    if (onlyYear !== undefined && fiscalYearId === '') {
      setValue('fiscalYearId', onlyYear.id, { shouldDirty: false });
    }
  }, [years, fiscalYearId, setValue]);

  return (
    <>
      <FormField
        id="financialAreaId"
        label={t.filters.financialArea}
        error={formState.errors.financialAreaId?.message}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            {...register('financialAreaId', {
              onChange: () => {
                setValue('fiscalYearId', '');
                setValue('accountingPeriodId', '');
              },
            })}
            disabled={disabled || areasQuery.isPending}
          >
            <option value="">{t.filters.select}</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.code} — {area.title}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="fiscalYearId"
        label={t.filters.fiscalYear}
        error={formState.errors.fiscalYearId?.message}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            {...register('fiscalYearId', {
              onChange: () => setValue('accountingPeriodId', ''),
            })}
            disabled={disabled || yearsQuery.isPending}
          >
            <option value="">{t.filters.select}</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.code} — {year.title}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="accountingPeriodId" label={t.filters.accountingPeriod}>
        {(fieldProps) => (
          <Select
            {...fieldProps}
            {...register('accountingPeriodId')}
            disabled={disabled || fiscalYearId === '' || periodsQuery.isPending}
          >
            <option value="">{t.filters.allPeriods}</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.sequence} — {period.title}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <AccountPicker
        id="accountId"
        label={t.filters.account}
        organizationId={organizationId}
        value={accountId}
        disabled={disabled}
        onChange={(value) => setValue('accountId', value)}
      />

      <FormField id="accountCode" label={t.filters.accountCode}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('accountCode')}
            dir="ltr"
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField id="accountName" label={t.filters.accountName}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('accountName')}
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField
        id="dateFrom"
        label={t.filters.dateFrom}
        hint={t.filters.dateFormatHint}
        error={formState.errors.dateFrom?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('dateFrom')}
            dir="ltr"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField
        id="dateTo"
        label={t.filters.dateTo}
        hint={t.filters.dateFormatHint}
        error={formState.errors.dateTo?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('dateTo')}
            dir="ltr"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            disabled={disabled}
          />
        )}
      </FormField>
    </>
  );
}
