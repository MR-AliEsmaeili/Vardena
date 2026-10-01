import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { z } from 'zod';
import * as accountingApi from '@/api/accounting.api';
import type {
  AccountingPeriod,
  FinancialArea,
  FiscalYear,
  Paginated,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { useFinancialContext } from './use-financial-context';

const codeSchema = z
  .string()
  .trim()
  .min(1, t.masterData.financialContext.codeRequired);
const titleSchema = z
  .string()
  .trim()
  .min(1, t.masterData.financialContext.titleRequired);
const dateSchema = z
  .string()
  .min(1, t.masterData.financialContext.dateRequired)
  .regex(/^\d{4}-\d{2}-\d{2}$/, t.filters.invalidDate);

const financialAreaSchema = z.object({ code: codeSchema, title: titleSchema });
const fiscalYearSchema = z.object({
  code: codeSchema,
  title: titleSchema,
  startDate: dateSchema,
  endDate: dateSchema,
});
const accountingPeriodSchema = z.object({
  sequence: z
    .number()
    .int()
    .min(1, t.masterData.financialContext.sequenceRequired),
  title: titleSchema,
  startDate: dateSchema,
  endDate: dateSchema,
});

type FinancialAreaFormValues = z.infer<typeof financialAreaSchema>;
type FiscalYearFormValues = z.infer<typeof fiscalYearSchema>;
type AccountingPeriodFormValues = z.infer<typeof accountingPeriodSchema>;

/**
 * Make a successful POST visible to the current selector immediately, then
 * revalidate the full server list. The POST response is server-authoritative;
 * this is not a client-side default or fabricated context.
 */
function includeCreatedItem<TItem extends { id: string }>(
  current: Paginated<TItem> | undefined,
  item: TItem,
): Paginated<TItem> {
  const existingItems = current?.items ?? [];
  const items = [
    ...existingItems.filter((existing) => existing.id !== item.id),
    item,
  ];

  return {
    items,
    total:
      current === undefined
        ? 1
        : current.total + (items.length - existingItems.length),
    page: current?.page ?? 1,
    pageSize: current?.pageSize ?? items.length,
  };
}

function StatusBadge({ status }: { status: 'open' | 'closed' | 'sealed' }) {
  const label =
    status === 'open'
      ? t.masterData.open
      : status === 'closed'
        ? t.masterData.closed
        : t.masterData.sealed;
  return (
    <Badge variant={status === 'open' ? 'success' : 'neutral'}>{label}</Badge>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message === undefined ? null : (
    <p className="mt-1 text-xs text-red-700" role="alert">
      {message}
    </p>
  );
}

function FinancialAreaCreateForm() {
  const queryClient = useQueryClient();
  const { organizationId, selectFinancialArea } = useFinancialContext();
  const form = useForm<FinancialAreaFormValues>({
    resolver: zodResolver(financialAreaSchema),
    mode: 'onSubmit',
    defaultValues: { code: '', title: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: FinancialAreaFormValues) =>
      accountingApi.createFinancialArea({
        organizationId: organizationId as string,
        code: values.code,
        title: values.title,
      }),
    onSuccess: (area) => {
      // A response arriving after an organization switch must not seed or
      // select the new organization's cache with a row from the old one.
      if (organizationId === null || area.organizationId !== organizationId) {
        return;
      }
      const queryKey =
        queryKeys.accounting.financialContextAreas(organizationId);
      queryClient.setQueryData<Paginated<FinancialArea>>(queryKey, (current) =>
        includeCreatedItem(current, area),
      );
      selectFinancialArea(area.id);
      void queryClient.invalidateQueries({ queryKey });
      form.reset({ code: '', title: '' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t.masterData.financialContext.createFinancialArea}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div>
            <Label htmlFor="financial-area-code">
              {t.masterData.financialContext.code}
            </Label>
            <Input id="financial-area-code" {...form.register('code')} />
            <FieldError message={form.formState.errors.code?.message} />
          </div>
          <div>
            <Label htmlFor="financial-area-title">
              {t.masterData.financialContext.titleField}
            </Label>
            <Input id="financial-area-title" {...form.register('title')} />
            <FieldError message={form.formState.errors.title?.message} />
          </div>
          {mutation.isError && (
            <div className="sm:col-span-2">
              <ApiErrorAlert
                error={mutation.error}
                title={t.masterData.financialContext.createFailed}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t.masterData.financialContext.creating
                : t.masterData.financialContext.create}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FiscalYearCreateForm() {
  const queryClient = useQueryClient();
  const { organizationId, financialArea, selectFiscalYear } =
    useFinancialContext();
  const form = useForm<FiscalYearFormValues>({
    resolver: zodResolver(fiscalYearSchema),
    mode: 'onSubmit',
    defaultValues: { code: '', title: '', startDate: '', endDate: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: FiscalYearFormValues) =>
      accountingApi.createFiscalYear({
        organizationId: organizationId as string,
        financialAreaId: financialArea?.id as string,
        code: values.code,
        title: values.title,
        startDate: values.startDate,
        endDate: values.endDate,
      }),
    onSuccess: (year) => {
      if (
        organizationId === null ||
        financialArea === null ||
        year.organizationId !== organizationId ||
        year.financialAreaId !== financialArea.id
      ) {
        return;
      }
      const queryKey = queryKeys.accounting.financialContextFiscalYears(
        organizationId,
        financialArea.id,
      );
      queryClient.setQueryData<Paginated<FiscalYear>>(queryKey, (current) =>
        includeCreatedItem(current, year),
      );
      selectFiscalYear(year.id);
      void queryClient.invalidateQueries({ queryKey });
      form.reset({ code: '', title: '', startDate: '', endDate: '' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.financialContext.createFiscalYear}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div>
            <Label htmlFor="fiscal-year-code">
              {t.masterData.financialContext.code}
            </Label>
            <Input id="fiscal-year-code" {...form.register('code')} />
            <FieldError message={form.formState.errors.code?.message} />
          </div>
          <div>
            <Label htmlFor="fiscal-year-title">
              {t.masterData.financialContext.titleField}
            </Label>
            <Input id="fiscal-year-title" {...form.register('title')} />
            <FieldError message={form.formState.errors.title?.message} />
          </div>
          <div>
            <Label htmlFor="fiscal-year-start-date">
              {t.masterData.financialContext.startDateField}
            </Label>
            <Input
              id="fiscal-year-start-date"
              type="date"
              dir="ltr"
              {...form.register('startDate')}
            />
            <FieldError message={form.formState.errors.startDate?.message} />
          </div>
          <div>
            <Label htmlFor="fiscal-year-end-date">
              {t.masterData.financialContext.endDateField}
            </Label>
            <Input
              id="fiscal-year-end-date"
              type="date"
              dir="ltr"
              {...form.register('endDate')}
            />
            <FieldError message={form.formState.errors.endDate?.message} />
          </div>
          {mutation.isError && (
            <div className="sm:col-span-2">
              <ApiErrorAlert
                error={mutation.error}
                title={t.masterData.financialContext.createFailed}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t.masterData.financialContext.creating
                : t.masterData.financialContext.create}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AccountingPeriodCreateForm() {
  const queryClient = useQueryClient();
  const { organizationId, financialArea, fiscalYear, selectAccountingPeriod } =
    useFinancialContext();
  const form = useForm<AccountingPeriodFormValues>({
    resolver: zodResolver(accountingPeriodSchema),
    mode: 'onSubmit',
    defaultValues: { sequence: 1, title: '', startDate: '', endDate: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: AccountingPeriodFormValues) =>
      accountingApi.createAccountingPeriod({
        organizationId: organizationId as string,
        fiscalYearId: fiscalYear?.id as string,
        sequence: values.sequence,
        title: values.title,
        startDate: values.startDate,
        endDate: values.endDate,
      }),
    onSuccess: (period) => {
      if (
        organizationId === null ||
        financialArea === null ||
        fiscalYear === null ||
        period.organizationId !== organizationId ||
        period.financialAreaId !== financialArea.id ||
        period.fiscalYearId !== fiscalYear.id
      ) {
        return;
      }
      const queryKey = queryKeys.accounting.financialContextPeriods(
        organizationId,
        financialArea.id,
        fiscalYear.id,
      );
      queryClient.setQueryData<Paginated<AccountingPeriod>>(
        queryKey,
        (current) => includeCreatedItem(current, period),
      );
      selectAccountingPeriod(period.id);
      void queryClient.invalidateQueries({ queryKey });
      form.reset({ sequence: 1, title: '', startDate: '', endDate: '' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t.masterData.financialContext.createAccountingPeriod}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div>
            <Label htmlFor="accounting-period-sequence">
              {t.masterData.financialContext.sequenceField}
            </Label>
            <Input
              id="accounting-period-sequence"
              type="number"
              min="1"
              dir="ltr"
              {...form.register('sequence', { valueAsNumber: true })}
            />
            <FieldError message={form.formState.errors.sequence?.message} />
          </div>
          <div>
            <Label htmlFor="accounting-period-title">
              {t.masterData.financialContext.titleField}
            </Label>
            <Input id="accounting-period-title" {...form.register('title')} />
            <FieldError message={form.formState.errors.title?.message} />
          </div>
          <div>
            <Label htmlFor="accounting-period-start-date">
              {t.masterData.financialContext.startDateField}
            </Label>
            <Input
              id="accounting-period-start-date"
              type="date"
              dir="ltr"
              {...form.register('startDate')}
            />
            <FieldError message={form.formState.errors.startDate?.message} />
          </div>
          <div>
            <Label htmlFor="accounting-period-end-date">
              {t.masterData.financialContext.endDateField}
            </Label>
            <Input
              id="accounting-period-end-date"
              type="date"
              dir="ltr"
              {...form.register('endDate')}
            />
            <FieldError message={form.formState.errors.endDate?.message} />
          </div>
          {mutation.isError && (
            <div className="sm:col-span-2">
              <ApiErrorAlert
                error={mutation.error}
                title={t.masterData.financialContext.createFailed}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t.masterData.financialContext.creating
                : t.masterData.financialContext.create}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ChoiceList({ children }: { children: ReactNode }) {
  return <div className="grid gap-2">{children}</div>;
}

/**
 * The same explicit selector serves the bootstrap gate and the later
 * "change context" page. Inactive areas and closed/sealed years or periods
 * are never selectable as a writable workspace context; years and periods
 * are still rendered with their state on the change page so their omission is
 * not misleading.
 */
export function FinancialContextSelection({
  full = false,
}: {
  full?: boolean;
}) {
  const context = useFinancialContext();
  const permissions = usePermissions();
  const stage = context.status;
  const showAreas =
    full ||
    stage === 'selecting-financial-area' ||
    stage === 'invalid-financial-area' ||
    stage === 'empty-financial-area';
  const showYears =
    context.financialArea !== null &&
    (full ||
      stage === 'selecting-fiscal-year' ||
      stage === 'invalid-fiscal-year' ||
      stage === 'empty-fiscal-year');
  const showPeriods =
    context.fiscalYear !== null &&
    (full ||
      stage === 'selecting-accounting-period' ||
      stage === 'invalid-accounting-period' ||
      stage === 'empty-accounting-period');

  const canCreateArea = permissions.has(
    PERMISSIONS.accounting.financialAreaCreate,
  );
  const canCreateYear = permissions.has(
    PERMISSIONS.accounting.fiscalYearCreate,
  );
  const canOpenPeriod = permissions.has(
    PERMISSIONS.accounting.accountingPeriodOpen,
  );

  return (
    <div className="w-full space-y-4">
      {(stage === 'invalid-financial-area' ||
        stage === 'invalid-fiscal-year' ||
        stage === 'invalid-accounting-period') && (
        <Alert variant="warning">
          <AlertTitle>{t.masterData.financialContext.invalidTitle}</AlertTitle>
          <AlertBody>{t.masterData.financialContext.invalidBody}</AlertBody>
        </Alert>
      )}

      {showAreas && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t.masterData.financialContext.selectFinancialArea}
            </CardTitle>
            <CardDescription>
              {t.masterData.financialAreasDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {context.financialAreas.length > 0 ? (
              <ChoiceList>
                {context.financialAreas.map((area) => {
                  const selected = context.financialArea?.id === area.id;
                  return (
                    <Button
                      key={area.id}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      className="justify-between"
                      aria-pressed={selected}
                      onClick={() => context.selectFinancialArea(area.id)}
                    >
                      <span>{`${area.code} — ${area.title}`}</span>
                      {selected && (
                        <Badge variant="info">
                          {t.masterData.financialContext.selected}
                        </Badge>
                      )}
                    </Button>
                  );
                })}
              </ChoiceList>
            ) : (
              <Alert variant="info">
                <AlertTitle>
                  {t.masterData.financialContext.emptyFinancialAreaTitle}
                </AlertTitle>
                <AlertBody>
                  {t.masterData.financialContext.emptyFinancialAreaBody}
                </AlertBody>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      {stage === 'empty-financial-area' && canCreateArea && (
        <FinancialAreaCreateForm />
      )}

      {showYears && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t.masterData.financialContext.selectFiscalYear}
            </CardTitle>
            <CardDescription>
              {t.masterData.fiscalYearsDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {context.fiscalYears.length > 0 ? (
              <ChoiceList>
                {context.fiscalYears.map((year) => {
                  const usable = year.isActive && year.status === 'open';
                  const selected = context.fiscalYear?.id === year.id;
                  return (
                    <Button
                      key={year.id}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      className="justify-between"
                      disabled={!usable}
                      aria-pressed={selected}
                      onClick={() => context.selectFiscalYear(year.id)}
                    >
                      <span>{`${year.code} — ${year.title}`}</span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={year.status} />
                        {!usable && (
                          <span className="text-xs">
                            {t.masterData.financialContext.unavailablePeriod}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </ChoiceList>
            ) : (
              <Alert variant="info">
                <AlertTitle>
                  {t.masterData.financialContext.emptyFiscalYearTitle}
                </AlertTitle>
                <AlertBody>
                  {t.masterData.financialContext.emptyFiscalYearBody}
                </AlertBody>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      {stage === 'empty-fiscal-year' && canCreateYear && (
        <FiscalYearCreateForm />
      )}

      {showPeriods && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t.masterData.financialContext.selectAccountingPeriod}
            </CardTitle>
            <CardDescription>{t.masterData.periodsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {context.accountingPeriods.length > 0 ? (
              <ChoiceList>
                {context.accountingPeriods.map((period) => {
                  const usable = period.status === 'open';
                  const selected = context.accountingPeriod?.id === period.id;
                  return (
                    <Button
                      key={period.id}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      className="justify-between"
                      disabled={!usable}
                      aria-pressed={selected}
                      onClick={() => context.selectAccountingPeriod(period.id)}
                    >
                      <span>{`${period.sequence} — ${period.title}`}</span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={period.status} />
                        {!usable && (
                          <span className="text-xs">
                            {t.masterData.financialContext.unavailablePeriod}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </ChoiceList>
            ) : (
              <Alert variant="info">
                <AlertTitle>
                  {t.masterData.financialContext.emptyAccountingPeriodTitle}
                </AlertTitle>
                <AlertBody>
                  {t.masterData.financialContext.emptyAccountingPeriodBody}
                </AlertBody>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      {stage === 'empty-accounting-period' && canOpenPeriod && (
        <AccountingPeriodCreateForm />
      )}
    </div>
  );
}
