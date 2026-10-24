import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { createAccountingPeriod } from '@/api/accounting.api';
import type { FiscalYear } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { isBusinessDay, toBusinessDateInput } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';

const schema = z
  .object({
    fiscalYearId: z.string().min(1, t.masterData.fiscalYearRequired),
    sequence: z.number().int().min(1, t.masterData.sequenceRequired),
    title: z.string().trim().min(1, t.masterData.titleRequired).max(200),
    startDate: z
      .string()
      .min(1, t.masterData.startDateRequired)
      .refine(isBusinessDay, t.masterData.dateFormat),
    endDate: z
      .string()
      .min(1, t.masterData.endDateRequired)
      .refine(isBusinessDay, t.masterData.dateFormat),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: t.masterData.dateRange,
    path: ['endDate'],
  });
type Values = z.infer<typeof schema>;

/** Open (create) an accounting period — POST /accounting-periods, `Accounting.AccountingPeriod.Open`. Backend re-validates year bounds, overlap and organization ownership. */
export function PeriodCreateForm({
  organizationId,
  fiscalYears,
}: {
  organizationId: string;
  fiscalYears: readonly FiscalYear[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fiscalYearId: '',
      sequence: 1,
      title: '',
      startDate: '',
      endDate: '',
    },
    mode: 'onSubmit',
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      createAccountingPeriod({
        organizationId,
        fiscalYearId: values.fiscalYearId,
        sequence: values.sequence,
        title: values.title.trim(),
        startDate: toBusinessDateInput(values.startDate),
        endDate: toBusinessDateInput(values.endDate),
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.all(organizationId),
      });
    },
  });
  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.openPeriodTitle}</CardTitle>
        <CardDescription>{t.masterData.openPeriodBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              id="period-fiscal-year"
              label={t.masterData.fiscalYear}
              required
              error={errors.fiscalYearId?.message}
            >
              {(p) => (
                <Select
                  {...p}
                  {...form.register('fiscalYearId')}
                  disabled={mutation.isPending}
                >
                  <option value="">
                    {t.masterData.selectFiscalYearOption}
                  </option>
                  {fiscalYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code} — {y.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              id="period-sequence"
              label={t.masterData.sequence}
              required
              error={errors.sequence?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  dir="ltr"
                  {...form.register('sequence', { valueAsNumber: true })}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
            <FormField
              id="period-title"
              label={t.masterData.periodTitle}
              required
              error={errors.title?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  {...form.register('title')}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['startDate', 'endDate'] as const).map((name) => (
              <FormField
                key={name}
                id={`period-${name}`}
                label={
                  name === 'startDate'
                    ? t.masterData.startDate
                    : t.masterData.endDate
                }
                required
                hint={t.filters.dateFormatHintJalali}
                error={errors[name]?.message}
              >
                {(p) => (
                  <Controller
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <DateInput
                        {...p}
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={mutation.isPending}
                      />
                    )}
                  />
                )}
              </FormField>
            ))}
          </div>
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          {mutation.isSuccess && (
            <output className="block text-sm text-success">
              {t.masterData.openPeriod}
            </output>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending
              ? t.masterData.opening
              : t.masterData.openPeriod}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
