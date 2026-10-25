import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { createFiscalYear, listFiscalYearsPage } from '@/api/accounting.api';
import type {
  CreateFiscalYearRequest,
  FinancialArea,
  FiscalYear,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useOrganization } from '@/features/organization/use-organization';
import { isBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { useFinancialAreas } from '../shared/use-accounting-references';
import { fiscalYearErrorMessage } from './fiscal-year-error-messages';
import {
  useFiscalYearDetail,
  useUpdateFiscalYearMutation,
} from './fiscal-year-hooks';

const LIST_PATH = '/app/accounting/fiscal-years';
const MAX_CODE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;

const fiscalYearFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, t.fiscalYear.codeRequired)
      .max(MAX_CODE_LENGTH, t.fiscalYear.codeTooLong),
    title: z
      .string()
      .trim()
      .min(1, t.fiscalYear.nameRequired)
      .max(MAX_TITLE_LENGTH, t.fiscalYear.nameTooLong),
    startDate: z
      .string()
      .min(1, t.masterData.startDateRequired)
      .refine(isBusinessDay, t.fiscalYear.dateFormat),
    endDate: z
      .string()
      .min(1, t.masterData.endDateRequired)
      .refine(isBusinessDay, t.fiscalYear.dateFormat),
    priorYearId: z.string(),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: t.fiscalYear.dateRange,
    path: ['endDate'],
  });
type FiscalYearFormValues = z.infer<typeof fiscalYearFormSchema>;

export function FiscalYearFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const organization = useOrganization();
  const organizationId = organization.organizationId;
  const { fiscalYearId } = useParams<{ fiscalYearId: string }>();
  const detail = useFiscalYearDetail(
    mode === 'edit' ? organizationId : null,
    mode === 'edit' ? fiscalYearId : undefined,
  );

  if (organizationId === null)
    return <LoadingState rows={5} label={t.loading.receiving} />;
  if (mode === 'edit') {
    if (detail.isPending)
      return <LoadingState rows={5} label={t.loading.receiving} />;
    if (detail.isError) {
      return (
        <div className="space-y-4">
          <PageHeader title={t.fiscalYear.editTitle} />
          <ApiErrorAlert
            error={detail.error}
            title={t.table.errorTitle}
            description={fiscalYearErrorMessage('load', detail.error)}
            onRetry={() => void detail.refetch()}
          />
        </div>
      );
    }
    if (detail.data.status === 'sealed') {
      return (
        <div className="space-y-4">
          <PageHeader title={t.fiscalYear.editTitle} />
          <ApiErrorAlert
            error={new Error(t.fiscalYear.sealedEditUnavailable)}
            description={t.fiscalYear.sealedEditUnavailable}
          />
          <Button asChild variant="outline">
            <Link to={LIST_PATH}>{t.app.cancel}</Link>
          </Button>
        </div>
      );
    }
    return (
      <FiscalYearForm
        mode="edit"
        organizationId={organizationId}
        fiscalYear={detail.data}
        financialAreaId={detail.data.financialAreaId}
      />
    );
  }

  return (
    <FiscalYearForm
      mode="create"
      organizationId={organizationId}
      financialAreaId={organization.financialArea?.id ?? null}
    />
  );
}

function FiscalYearForm({
  mode,
  organizationId,
  fiscalYear,
  financialAreaId,
  financialArea,
}: {
  mode: 'create' | 'edit';
  organizationId: string;
  fiscalYear?: FiscalYear;
  financialAreaId: string | null;
  financialArea?: FinancialArea;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const areas = useFinancialAreas(organizationId);
  const [failure, setFailure] = useState<unknown>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const form = useForm<FiscalYearFormValues>({
    resolver: zodResolver(fiscalYearFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: fiscalYear?.code ?? '',
      title: fiscalYear?.title ?? '',
      startDate: fiscalYear?.startDate ?? '',
      endDate: fiscalYear?.endDate ?? '',
      priorYearId: fiscalYear?.priorYearId ?? '',
    },
  });
  const dirty = form.formState.isDirty;

  const priorYears = useQuery({
    queryKey: queryKeys.accounting.fiscalYearList(organizationId, {
      financialAreaId: financialAreaId ?? 'none',
      purpose: 'prior-year-options',
    }),
    queryFn: ({ signal }) =>
      listFiscalYearsPage(
        {
          organizationId,
          financialAreaId: financialAreaId ?? '',
          page: 1,
          pageSize: 500,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: financialAreaId !== null,
  });

  const createMutation = useMutation({
    mutationKey: ['accounting', organizationId, 'fiscal-years', 'create'],
    mutationFn: (values: FiscalYearFormValues) => {
      if (financialAreaId === null)
        throw new Error(t.fiscalYear.areaUnavailable);
      const body: CreateFiscalYearRequest = {
        organizationId,
        financialAreaId,
        code: values.code.trim(),
        title: values.title.trim(),
        startDate: values.startDate,
        endDate: values.endDate,
        ...(values.priorYearId ? { priorYearId: values.priorYearId } : {}),
      };
      return createFiscalYear(body);
    },
    onSuccess: async (year) => {
      queryClient.setQueryData(
        queryKeys.accounting.fiscalYearDetail(organizationId, year.id),
        year,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.accounting.fiscalYearPrefix(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey:
            queryKeys.accounting.accountingPeriodsPrefix(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey:
            queryKeys.accounting.financialContextFiscalYearsPrefix(
              organizationId,
            ),
        }),
      ]);
    },
  });
  const updateMutation = useUpdateFiscalYearMutation(
    organizationId,
    fiscalYear?.id ?? 'none',
  );
  const submitting = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const leave = () => {
    if (dirty) setConfirmLeave(true);
    else navigate(LIST_PATH);
  };

  const onSubmit = form.handleSubmit((values) => {
    setFailure(null);
    if (mode === 'create') {
      createMutation.mutate(values, {
        onSuccess: () => {
          showToast({ kind: 'success', message: t.fiscalYear.created });
          navigate(LIST_PATH);
        },
        onError: setFailure,
      });
      return;
    }
    updateMutation.mutate(
      {
        code: values.code.trim(),
        title: values.title.trim(),
        startDate: values.startDate,
        endDate: values.endDate,
        priorYearId: values.priorYearId || null,
      },
      {
        onSuccess: () => {
          showToast({ kind: 'success', message: t.fiscalYear.updated });
          navigate(LIST_PATH);
        },
        onError: setFailure,
      },
    );
  });

  const areaLabel =
    financialArea ??
    areas.data?.items.find((item) => item.id === financialAreaId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          mode === 'create' ? t.fiscalYear.createTitle : t.fiscalYear.editTitle
        }
        description={t.fiscalYear.subtitle}
      />
      <div aria-live="polite">
        {failure !== null && (
          <ApiErrorAlert
            error={failure}
            description={fiscalYearErrorMessage('save', failure)}
          />
        )}
      </div>
      {mode === 'create' && financialAreaId === null && (
        <ApiErrorAlert
          error={new Error(t.fiscalYear.areaUnavailable)}
          description={t.fiscalYear.areaUnavailable}
        />
      )}
      <Card>
        <CardContent>
          <form className="space-y-4" noValidate onSubmit={onSubmit}>
            {mode === 'create' && (
              <FormField
                id="fiscal-year-area"
                label={t.fiscalYear.financialArea}
                required
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={
                      areaLabel
                        ? `${areaLabel.code} — ${areaLabel.title}`
                        : t.fiscalYear.unavailableArea
                    }
                    readOnly
                    disabled
                  />
                )}
              </FormField>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="fiscal-year-code"
                label={t.fiscalYear.code}
                required
                error={form.formState.errors.code?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...form.register('code')}
                    dir="ltr"
                    maxLength={MAX_CODE_LENGTH}
                    disabled={submitting}
                  />
                )}
              </FormField>
              <FormField
                id="fiscal-year-title"
                label={t.fiscalYear.name}
                required
                error={form.formState.errors.title?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...form.register('title')}
                    maxLength={MAX_TITLE_LENGTH}
                    disabled={submitting}
                  />
                )}
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['startDate', 'endDate'] as const).map((name) => (
                <FormField
                  key={name}
                  id={`fiscal-year-${name}`}
                  label={
                    name === 'startDate'
                      ? t.fiscalYear.startDate
                      : t.fiscalYear.endDate
                  }
                  required
                  hint={t.filters.dateFormatHintJalali}
                  error={form.formState.errors[name]?.message}
                >
                  {(fieldProps) => (
                    <Controller
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <DateInput
                          {...fieldProps}
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={submitting}
                        />
                      )}
                    />
                  )}
                </FormField>
              ))}
            </div>
            <FormField
              id="fiscal-year-prior-year"
              label={t.fiscalYear.priorYear}
            >
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  {...form.register('priorYearId')}
                  disabled={submitting || priorYears.isPending}
                >
                  <option value="">{t.fiscalYear.noPriorYear}</option>
                  {(priorYears.data?.items ?? [])
                    .filter((year) => year.id !== fiscalYear?.id)
                    .map((year) => (
                      <option key={year.id} value={year.id}>
                        {year.code} — {year.title}
                      </option>
                    ))}
                </Select>
              )}
            </FormField>
            {priorYears.isError && (
              <ApiErrorAlert
                error={priorYears.error}
                description={t.fiscalYear.priorYearsLoadFailed}
                onRetry={() => void priorYears.refetch()}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  submitting ||
                  (mode === 'create' && financialAreaId === null) ||
                  (financialAreaId !== null && !priorYears.isSuccess)
                }
                loading={submitting}
              >
                {submitting ? t.fiscalYear.saving : t.fiscalYear.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={leave}
                disabled={submitting}
              >
                {t.app.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmLeave}
        title={t.financialArea.dirtyLeaveTitle}
        description={t.financialArea.dirtyLeaveDescription}
        confirmLabel={t.financialArea.dirtyLeaveConfirm}
        danger
        onConfirm={() => navigate(LIST_PATH)}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
