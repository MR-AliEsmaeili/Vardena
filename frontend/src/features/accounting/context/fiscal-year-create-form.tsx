import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createFiscalYear } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
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
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';

const MAX_CODE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const fiscalYearSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, t.financialContext.codeRequired)
      .max(MAX_CODE_LENGTH),
    title: z
      .string()
      .trim()
      .min(1, t.financialContext.titleRequired)
      .max(MAX_TITLE_LENGTH),
    startDate: z
      .string()
      .trim()
      .min(1, t.financialContext.startDateRequired)
      .regex(DATE_ONLY, t.financialContext.dateFormat),
    endDate: z
      .string()
      .trim()
      .min(1, t.financialContext.endDateRequired)
      .regex(DATE_ONLY, t.financialContext.dateFormat),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: t.financialContext.dateRange,
    path: ['endDate'],
  });

type FiscalYearFormValues = z.infer<typeof fiscalYearSchema>;

/**
 * Explicit first-fiscal-year creation for a selected Financial Area. The
 * backend remains authoritative for date validity, overlap, lifecycle,
 * organization/area ownership, permission and licensing.
 */
export function FiscalYearCreateForm({
  organizationId,
  financialAreaId,
}: {
  organizationId: string;
  financialAreaId: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FiscalYearFormValues>({
    resolver: zodResolver(fiscalYearSchema),
    defaultValues: { code: '', title: '', startDate: '', endDate: '' },
    mode: 'onSubmit',
  });
  const mutation = useMutation({
    mutationFn: (values: FiscalYearFormValues) =>
      createFiscalYear({
        organizationId,
        financialAreaId,
        code: values.code.trim(),
        title: values.title.trim(),
        startDate: values.startDate.trim(),
        endDate: values.endDate.trim(),
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.financialContextFiscalYears(
          organizationId,
          financialAreaId,
        ),
      });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.financialContext.createFiscalYearTitle}</CardTitle>
        <CardDescription>
          {t.financialContext.createFiscalYearBody}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={onSubmit}>
          <FormField
            id="fiscal-year-code"
            label={t.financialContext.code}
            error={form.formState.errors.code?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('code')}
                dir="ltr"
                disabled={mutation.isPending}
              />
            )}
          </FormField>
          <FormField
            id="fiscal-year-title"
            label={t.financialContext.title}
            error={form.formState.errors.title?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('title')}
                disabled={mutation.isPending}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="fiscal-year-start-date"
              label={t.financialContext.startDate}
              hint={t.financialContext.dateHint}
              error={form.formState.errors.startDate?.message}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('startDate')}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
            <FormField
              id="fiscal-year-end-date"
              label={t.financialContext.endDate}
              hint={t.financialContext.dateHint}
              error={form.formState.errors.endDate?.message}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('endDate')}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
          </div>
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? t.financialContext.creating
              : t.financialContext.createFiscalYear}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
