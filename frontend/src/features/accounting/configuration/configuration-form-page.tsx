import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import type {
  AccountingConfiguration,
  CreateAccountingConfigurationRequest,
  UpdateAccountingConfigurationRequest,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import {
  calendarDayStartInstant,
  instantDayInZone,
  useTimeZone,
} from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { configurationErrorMessage } from './configuration-error-messages';
import {
  useAccountingConfigurationDetail,
  useCreateAccountingConfigurationMutation,
  useUpdateAccountingConfigurationMutation,
} from './configuration-hooks';
import {
  appendLevel,
  createLevelDraft,
  levelsFromConfiguration,
  removeLastLevel,
  renumberLevels,
  updateLevel,
  validateLevels,
  type ConfigurationLevelDraft,
  type LevelsValidation,
} from './configuration-levels';
import { ConfigurationLevelsEditor } from './configuration-levels-editor';

const LIST_PATH = '/app/accounting/configurations';
// Mirrors backend/src/modules/accounting/domain/master-data.ts.
const MAX_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;

const headerSchema = z.object({
  code: z.string().trim().max(MAX_CODE_LENGTH, t.accountingConfig.codeRequired),
  name: z
    .string()
    .trim()
    .min(1, t.accountingConfig.nameRequired)
    .max(MAX_NAME_LENGTH, t.accountingConfig.nameRequired),
  /**
   * The canonical Gregorian day of the operator's choice ('' = not set).
   * The wire value is an INSTANT derived in the organization's time zone on
   * submit — a day string is never sent for this field.
   */
  effectiveDay: z.string(),
});
type HeaderValues = z.infer<typeof headerSchema>;

function emptyValidation(): LevelsValidation {
  return { rows: {}, continuity: true, totalLength: false, valid: true };
}

export function ConfigurationFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const organizationId = useOrganizationId();
  const { configurationId } = useParams<{ configurationId: string }>();
  const detail = useAccountingConfigurationDetail(
    mode === 'edit' ? organizationId : null,
    mode === 'edit' ? configurationId : undefined,
  );

  if (organizationId === null) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }
  if (mode === 'create') {
    return <ConfigurationForm mode="create" organizationId={organizationId} />;
  }
  if (detail.isPending) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }
  if (detail.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.accountingConfig.editTitle} />
        <ApiErrorAlert
          error={detail.error}
          title={t.table.errorTitle}
          description={configurationErrorMessage('load', detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }
  return (
    <ConfigurationForm
      mode="edit"
      organizationId={organizationId}
      configuration={detail.data}
    />
  );
}

function ConfigurationForm({
  mode,
  organizationId,
  configuration,
}: {
  mode: 'create' | 'edit';
  organizationId: string;
  configuration?: AccountingConfiguration;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const timeZone = useTimeZone();
  const [failure, setFailure] = useState<unknown>(null);
  const [levels, setLevels] = useState<ConfigurationLevelDraft[]>(() =>
    configuration === undefined
      ? [createLevelDraft(1)]
      : levelsFromConfiguration(configuration.levels),
  );
  const [levelIssues, setLevelIssues] =
    useState<LevelsValidation>(emptyValidation);
  const readOnly = mode === 'edit' && configuration?.status !== 'DRAFT';

  const createMutation =
    useCreateAccountingConfigurationMutation(organizationId);
  const updateMutation = useUpdateAccountingConfigurationMutation(
    organizationId,
    configuration?.id ?? 'none',
  );
  const submitting = createMutation.isPending || updateMutation.isPending;

  const form = useForm<HeaderValues>({
    resolver: zodResolver(headerSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: configuration?.code ?? '',
      name: configuration?.name ?? '',
      effectiveDay:
        configuration?.effectiveFrom === null ||
        configuration?.effectiveFrom === undefined
          ? ''
          : (instantDayInZone(configuration.effectiveFrom, timeZone) ?? ''),
    },
  });

  const submitLevels = (): ConfigurationLevelDraft[] | null => {
    const validation = validateLevels(levels);
    setLevelIssues(validation);
    if (!validation.valid) return null;
    return renumberLevels(levels);
  };

  const onSubmit = form.handleSubmit((values) => {
    if (readOnly || submitting) return;
    setFailure(null);
    const code = values.code.trim();
    if (mode === 'create' && code === '') {
      form.setError('code', { message: t.accountingConfig.codeRequired });
      return;
    }
    const nextLevels = submitLevels();
    if (nextLevels === null) return;

    // An Instant, never a BusinessDate: the chosen day's local midnight in the
    // organization's IANA zone, serialized as ISO UTC by the shared helper.
    const effectiveFrom =
      values.effectiveDay === ''
        ? null
        : (calendarDayStartInstant(values.effectiveDay, timeZone) ?? undefined);
    if (effectiveFrom === undefined) {
      form.setError('effectiveDay', {
        message: t.accountingConfig.effectiveFromInvalid,
      });
      return;
    }

    const levelInputs = nextLevels.map((level) => ({
      levelIndex: level.levelIndex,
      title: level.title.trim(),
      digitLength: level.digitLength,
      defaultIsPostable: level.defaultIsPostable,
      levelKind: level.levelKind.trim() === '' ? null : level.levelKind.trim(),
    }));

    if (mode === 'create') {
      const body: CreateAccountingConfigurationRequest = {
        organizationId,
        code,
        name: values.name.trim(),
        levels: levelInputs,
        ...(effectiveFrom === null ? {} : { effectiveFrom }),
      };
      createMutation.mutate(body, {
        onSuccess: (created) => {
          showToast({ kind: 'success', message: t.accountingConfig.created });
          navigate(`${LIST_PATH}/${encodeURIComponent(created.id)}`);
        },
        onError: setFailure,
      });
      return;
    }

    // `code` is immutable: it is absent from the update contract on purpose.
    const body: UpdateAccountingConfigurationRequest = {
      name: values.name.trim(),
      effectiveFrom,
      levels: levelInputs,
    };
    updateMutation.mutate(body, {
      onSuccess: () => {
        showToast({ kind: 'success', message: t.accountingConfig.updated });
        navigate(LIST_PATH);
      },
      onError: setFailure,
    });
  });

  const changeLevels = (next: ConfigurationLevelDraft[]) => {
    setLevels(next);
    if (Object.keys(levelIssues.rows).length > 0 || !levelIssues.valid) {
      setLevelIssues(validateLevels(next));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          mode === 'create'
            ? t.accountingConfig.createTitle
            : t.accountingConfig.editTitle
        }
        description={t.accountingConfig.subtitle}
      />
      <div aria-live="polite">
        {failure !== null && (
          <ApiErrorAlert
            error={failure}
            description={configurationErrorMessage('save', failure)}
          />
        )}
      </div>
      {readOnly && (
        <ApiErrorAlert
          error={new Error(t.accountingConfig.readOnlyPublished)}
          description={t.accountingConfig.readOnlyPublished}
        />
      )}
      <Card>
        <CardContent>
          <form className="space-y-5" noValidate onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="configuration-code"
                label={t.accountingConfig.code}
                required={mode === 'create'}
                hint={mode === 'create' ? undefined : t.accountingConfig.code}
                error={form.formState.errors.code?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...form.register('code')}
                    dir="ltr"
                    maxLength={MAX_CODE_LENGTH}
                    disabled={submitting || mode === 'edit'}
                    readOnly={mode === 'edit'}
                    autoComplete="off"
                  />
                )}
              </FormField>
              <FormField
                id="configuration-name"
                label={t.accountingConfig.name}
                required
                error={form.formState.errors.name?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...form.register('name')}
                    maxLength={MAX_NAME_LENGTH}
                    disabled={submitting || readOnly}
                    autoComplete="off"
                  />
                )}
              </FormField>
            </div>
            <FormField
              id="configuration-effective-from"
              label={t.accountingConfig.effectiveFrom}
              hint={t.accountingConfig.effectiveFromHint}
              error={form.formState.errors.effectiveDay?.message}
            >
              {(fieldProps) => (
                <Controller
                  control={form.control}
                  name="effectiveDay"
                  render={({ field }) => (
                    <DateInput
                      {...fieldProps}
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={submitting || readOnly}
                    />
                  )}
                />
              )}
            </FormField>

            <ConfigurationLevelsEditor
              levels={levels}
              rows={levelIssues.rows}
              continuityInvalid={!levelIssues.continuity}
              totalLengthInvalid={levelIssues.totalLength}
              disabled={submitting || readOnly}
              onAdd={() => changeLevels(appendLevel(levels))}
              onRemoveLast={() => changeLevels(removeLastLevel(levels))}
              onChange={(index, patch) =>
                changeLevels(updateLevel(levels, index, patch))
              }
            />

            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={submitting || readOnly}
                loading={submitting}
              >
                {submitting
                  ? t.accountingConfig.saving
                  : t.accountingConfig.save}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to={LIST_PATH}>{t.app.cancel}</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
