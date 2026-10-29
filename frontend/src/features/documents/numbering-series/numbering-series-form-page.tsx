import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { normalizeApiError } from '@/api/errors';
import type {
  CreateNumberingSeriesRequest,
  UpdateNumberingSeriesRequest,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { useDocumentTypes } from '../document-types/use-document-types';
import { numberingSeriesErrorMessage } from './numbering-series-error-messages';
import {
  useCreateNumberingSeriesMutation,
  useNumberingSeriesDetail,
  useUpdateNumberingSeriesMutation,
} from './use-numbering-series';

const LIST_PATH = '/app/documents/numbering-series';
const MAX_NAME_LENGTH = 200;
const MAX_SCOPE_KEY_LENGTH = 64;

const createSchema = z.object({
  documentType: z
    .string()
    .trim()
    .min(1, t.numberingSeries.errorCodes.validationFailed),
  scopeKey: z
    .string()
    .trim()
    .max(MAX_SCOPE_KEY_LENGTH, t.numberingSeries.scopeKeyHint)
    .optional()
    .or(z.literal('')),
  name: z
    .string()
    .trim()
    .min(1, t.numberingSeries.errorCodes.validationFailed)
    .max(MAX_NAME_LENGTH, t.numberingSeries.errorCodes.validationFailed),
  width: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+$/.test(v),
      t.numberingSeries.errorCodes.validationFailed,
    )
    .refine((v) => {
      if (v === '') return true;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 32;
    }, t.numberingSeries.widthHint),
  reusePolicy: z.enum(['never', 'recycle']),
});

type CreateFormValues = z.infer<typeof createSchema>;

const editSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, t.numberingSeries.errorCodes.validationFailed)
    .max(MAX_NAME_LENGTH, t.numberingSeries.errorCodes.validationFailed),
  width: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+$/.test(v),
      t.numberingSeries.errorCodes.validationFailed,
    )
    .refine((v) => {
      if (v === '') return true;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 32;
    }, t.numberingSeries.widthHint),
  reusePolicy: z.enum(['never', 'recycle']),
  isActive: z.boolean(),
});

type EditFormValues = z.infer<typeof editSchema>;

export function NumberingSeriesFormPage({
  mode,
}: {
  mode: 'create' | 'edit';
}): ReactElement {
  const organizationId = useOrganizationId();
  const { seriesId } = useParams<{ seriesId: string }>();
  const detailQuery = useNumberingSeriesDetail(
    mode === 'edit' ? organizationId : null,
    mode === 'edit' ? seriesId : undefined,
  );

  if (organizationId === null) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }

  if (mode === 'edit') {
    if (detailQuery.isPending) {
      return <LoadingState rows={5} label={t.loading.receiving} />;
    }
    if (detailQuery.isError) {
      return (
        <div className="space-y-4">
          <FormPageHeader title={t.numberingSeries.editTitle} />
          <ApiErrorAlert
            error={detailQuery.error}
            title={t.table.errorTitle}
            description={numberingSeriesErrorMessage('load', detailQuery.error)}
            onRetry={() => void detailQuery.refetch()}
          />
        </div>
      );
    }
    return (
      <NumberingSeriesEditForm
        organizationId={organizationId}
        seriesId={seriesId!}
        initial={detailQuery.data}
      />
    );
  }

  return <NumberingSeriesCreateForm organizationId={organizationId} />;
}

function NumberingSeriesCreateForm({
  organizationId,
}: {
  organizationId: string;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);
  const docTypesQuery = useDocumentTypes(organizationId, {
    page: 1,
    pageSize: 200,
    search: '',
  });

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    mode: 'onSubmit',
    defaultValues: {
      documentType: '',
      scopeKey: '',
      name: '',
      width: '0',
      reusePolicy: 'never',
    },
  });

  const isDirty = form.formState.isDirty;
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  useWorkspaceWindowDirty(isDirty);

  const mutation = useCreateNumberingSeriesMutation(organizationId);
  const submitting = mutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setSubmitFailure(null);
    const widthValue = values.width === '' ? undefined : Number(values.width);
    const body: CreateNumberingSeriesRequest = {
      organizationId,
      documentType: values.documentType.trim(),
      name: values.name.trim(),
      ...(values.scopeKey !== undefined && values.scopeKey.trim() !== ''
        ? { scopeKey: values.scopeKey.trim() }
        : {}),
      strategy: 'monotonic',
      ...(widthValue !== undefined ? { width: widthValue } : {}),
      reusePolicy: values.reusePolicy,
    };

    mutation.mutate(body, {
      onSuccess: (created) => {
        showToast({ kind: 'success', message: t.numberingSeries.saved });
        navigate(
          `/app/documents/numbering-series/${encodeURIComponent(created.id)}`,
        );
      },
      onError: (error) => {
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        setSubmitFailure(error);
      },
    });
  });

  return (
    <div className="space-y-4" data-testid="numbering-series-form-page">
      <FormPageHeader
        title={t.numberingSeries.createTitle}
        description={t.numberingSeries.subtitle}
      />

      <div aria-live="polite">
        {submitFailure !== null && (
          <ApiErrorAlert
            error={submitFailure}
            description={numberingSeriesErrorMessage('save', submitFailure)}
          />
        )}
      </div>

      <Card>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={onSubmit}
            noValidate
            data-testid="numbering-series-create-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="numbering-series-document-type"
                label={t.numberingSeries.documentType}
                required
                hint={t.numberingSeries.documentTypeHint}
                error={form.formState.errors.documentType?.message}
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    {...form.register('documentType')}
                    disabled={submitting}
                    data-testid="numbering-series-document-type-input"
                  >
                    <option value="">
                      {t.numberingSeries.documentTypePlaceholder}
                    </option>
                    {(docTypesQuery.data?.items ?? []).map((dt) => (
                      <option key={dt.code} value={dt.code}>
                        {dt.code}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>

              <FormField
                id="numbering-series-scope-key"
                label={t.numberingSeries.scopeKey}
                hint={t.numberingSeries.scopeKeyHint}
                error={form.formState.errors.scopeKey?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="text"
                    dir="ltr"
                    maxLength={MAX_SCOPE_KEY_LENGTH}
                    placeholder={t.numberingSeries.scopeKeyPlaceholder}
                    disabled={submitting}
                    {...form.register('scopeKey')}
                    data-testid="numbering-series-scope-key-input"
                  />
                )}
              </FormField>
            </div>

            <FormField
              id="numbering-series-name"
              label={t.numberingSeries.name}
              required
              error={form.formState.errors.name?.message}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="text"
                  maxLength={MAX_NAME_LENGTH}
                  placeholder={t.numberingSeries.namePlaceholder}
                  disabled={submitting}
                  {...form.register('name')}
                  data-testid="numbering-series-name-input"
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="numbering-series-strategy"
                label={t.numberingSeries.strategy}
                hint={t.numberingSeries.strategyHint}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={t.numberingSeries.strategyMonotonic}
                    readOnly
                    disabled
                    dir="ltr"
                    data-testid="numbering-series-strategy-input"
                  />
                )}
              </FormField>

              <FormField
                id="numbering-series-width"
                label={t.numberingSeries.width}
                hint={t.numberingSeries.widthHint}
                error={form.formState.errors.width?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="number"
                    min={0}
                    max={32}
                    step={1}
                    disabled={submitting}
                    {...form.register('width')}
                    data-testid="numbering-series-width-input"
                  />
                )}
              </FormField>

              <FormField
                id="numbering-series-reuse-policy"
                label={t.numberingSeries.reusePolicy}
                hint={t.numberingSeries.reuseInertNote}
                error={form.formState.errors.reusePolicy?.message}
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    {...form.register('reusePolicy')}
                    disabled={submitting}
                    data-testid="numbering-series-reuse-policy-input"
                  >
                    <option value="never">
                      {t.numberingSeries.reuseNever}
                    </option>
                    <option value="recycle">
                      {t.numberingSeries.reuseRecycle}
                    </option>
                  </Select>
                )}
              </FormField>
            </div>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button
                type="submit"
                disabled={submitting}
                loading={submitting}
                data-testid="numbering-series-form-submit"
              >
                {submitting ? t.numberingSeries.saving : t.numberingSeries.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(LIST_PATH)}
                disabled={submitting}
              >
                {t.app.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NumberingSeriesEditForm({
  organizationId,
  seriesId,
  initial,
}: {
  organizationId: string;
  seriesId: string;
  initial: {
    documentType: string;
    scopeKey: string;
    name: string;
    width: number;
    reusePolicy: string;
    isActive: boolean;
  };
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    mode: 'onSubmit',
    defaultValues: {
      name: initial.name,
      width: String(initial.width),
      reusePolicy: (initial.reusePolicy as 'never' | 'recycle') ?? 'never',
      isActive: initial.isActive,
    },
  });

  const isDirty = form.formState.isDirty;
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  useWorkspaceWindowDirty(isDirty);

  const mutation = useUpdateNumberingSeriesMutation(organizationId, seriesId);
  const submitting = mutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setSubmitFailure(null);
    const widthValue = values.width === '' ? undefined : Number(values.width);
    const body: UpdateNumberingSeriesRequest = {
      name: values.name.trim(),
      strategy: 'monotonic',
      ...(widthValue !== undefined ? { width: widthValue } : {}),
      reusePolicy: values.reusePolicy,
      isActive: values.isActive,
    };
    mutation.mutate(body, {
      onSuccess: () => {
        showToast({ kind: 'success', message: t.numberingSeries.saved });
        navigate(
          `/app/documents/numbering-series/${encodeURIComponent(seriesId)}`,
        );
      },
      onError: (error) => {
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        setSubmitFailure(error);
      },
    });
  });

  return (
    <div className="space-y-4" data-testid="numbering-series-form-page">
      <FormPageHeader
        title={t.numberingSeries.editTitle}
        description={t.numberingSeries.subtitle}
      />

      <div aria-live="polite">
        {submitFailure !== null && (
          <ApiErrorAlert
            error={submitFailure}
            description={numberingSeriesErrorMessage('save', submitFailure)}
          />
        )}
      </div>

      <Card>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={onSubmit}
            noValidate
            data-testid="numbering-series-edit-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="numbering-series-document-type-readonly"
                label={t.numberingSeries.documentType}
                hint={t.numberingSeries.scopeKeyReadOnlyHint}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={initial.documentType}
                    readOnly
                    disabled
                    dir="ltr"
                    data-testid="numbering-series-document-type-readonly"
                  />
                )}
              </FormField>

              <FormField
                id="numbering-series-scope-key-readonly"
                label={t.numberingSeries.scopeKey}
                hint={t.numberingSeries.scopeKeyReadOnlyHint}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={
                      initial.scopeKey === ''
                        ? t.numberingSeries.scopeKeyDefault
                        : initial.scopeKey
                    }
                    readOnly
                    disabled
                    dir="ltr"
                    data-testid="numbering-series-scope-key-readonly"
                  />
                )}
              </FormField>
            </div>

            <FormField
              id="numbering-series-name-edit"
              label={t.numberingSeries.name}
              required
              error={form.formState.errors.name?.message}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="text"
                  maxLength={MAX_NAME_LENGTH}
                  disabled={submitting}
                  {...form.register('name')}
                  data-testid="numbering-series-name-input"
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="numbering-series-strategy-edit"
                label={t.numberingSeries.strategy}
                hint={t.numberingSeries.strategyHint}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={t.numberingSeries.strategyMonotonic}
                    readOnly
                    disabled
                    dir="ltr"
                    data-testid="numbering-series-strategy-input"
                  />
                )}
              </FormField>

              <FormField
                id="numbering-series-width-edit"
                label={t.numberingSeries.width}
                hint={t.numberingSeries.widthHint}
                error={form.formState.errors.width?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="number"
                    min={0}
                    max={32}
                    step={1}
                    disabled={submitting}
                    {...form.register('width')}
                    data-testid="numbering-series-width-input"
                  />
                )}
              </FormField>

              <FormField
                id="numbering-series-reuse-policy-edit"
                label={t.numberingSeries.reusePolicy}
                hint={t.numberingSeries.reuseInertNote}
                error={form.formState.errors.reusePolicy?.message}
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    {...form.register('reusePolicy')}
                    disabled={submitting}
                    data-testid="numbering-series-reuse-policy-input"
                  >
                    <option value="never">
                      {t.numberingSeries.reuseNever}
                    </option>
                    <option value="recycle">
                      {t.numberingSeries.reuseRecycle}
                    </option>
                  </Select>
                )}
              </FormField>
            </div>

            <FormField
              id="numbering-series-is-active"
              label={t.numberingSeries.isActive}
              hint={t.numberingSeries.isActiveHint}
            >
              {(fieldProps) => (
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <Select
                      {...fieldProps}
                      value={field.value ? 'true' : 'false'}
                      onChange={(event) =>
                        field.onChange(event.target.value === 'true')
                      }
                      disabled={submitting}
                      data-testid="numbering-series-is-active-input"
                    >
                      <option value="true">{t.numberingSeries.active}</option>
                      <option value="false">
                        {t.numberingSeries.inactive}
                      </option>
                    </Select>
                  )}
                />
              )}
            </FormField>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button
                type="submit"
                disabled={submitting}
                loading={submitting}
                data-testid="numbering-series-form-submit"
              >
                {submitting ? t.numberingSeries.saving : t.numberingSeries.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(LIST_PATH)}
                disabled={submitting}
              >
                {t.app.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
