import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import type { FinancialArea } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { useWorkspaceWindowDirty } from '@/app/workspace/workspace-context';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  applyFinancialAreaServerValidation,
  financialAreaErrorMessage,
  type FinancialAreaErrorMessage,
} from './financial-area-error-messages';
import {
  useCreateFinancialAreaMutation,
  useFinancialAreaDetail,
  useUpdateFinancialAreaMutation,
} from './financial-area-hooks';
import {
  financialAreaSchema,
  type FinancialAreaFormValues,
} from './financial-area-schema';

/**
 * Create / edit a financial area (ACC-01: `POST /financial-areas`,
 * `PATCH /financial-areas/:id`).
 *
 * One component, two modes — the same shape as
 * `organization/admin/branches/branch-form-page.tsx`. The create route is
 * gated by `Accounting.FinancialArea.Create` only (the endpoint requires
 * nothing else); the edit route additionally requires
 * `Accounting.FinancialArea.View` because the screen first reads the record
 * (`GET /financial-areas/:id`). There is no detail route for financial
 * areas, so a confirmed save returns to the administration list, whose
 * queries are invalidated by the mutation hooks.
 *
 * The form carries ONLY `code` and `title`. In particular it never sends
 * `isDefault: false` — "un-defaulting" is not a surface of this page; the
 * default moves only by flagging another area `true` from the list, and the
 * backend clears the previous default atomically.
 */

const LIST_PATH = '/app/accounting/financial-areas';

export function FinancialAreaFormPage({
  mode,
}: {
  mode: 'create' | 'edit';
}): ReactElement {
  const organizationId = useOrganizationId();
  const { financialAreaId } = useParams<{ financialAreaId: string }>();
  const query = useFinancialAreaDetail(
    mode === 'edit' ? organizationId : null,
    mode === 'edit' ? financialAreaId : undefined,
  );

  if (organizationId === null) {
    return <LoadingState rows={5} label={t.financialArea.loading} />;
  }

  if (mode === 'edit') {
    if (query.isPending) {
      return <LoadingState rows={5} label={t.financialArea.loading} />;
    }
    if (query.isError) {
      return (
        <div className="space-y-4">
          <FormPageHeader title={t.financialArea.editTitle} />
          <ApiErrorAlert
            error={query.error}
            title={t.table.errorTitle}
            description={t.financialArea.loadFailed}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return (
      <FinancialAreaForm
        organizationId={organizationId}
        mode="edit"
        area={query.data}
      />
    );
  }

  return <FinancialAreaForm organizationId={organizationId} mode="create" />;
}

interface SubmitFailure {
  source: unknown;
  mapped: FinancialAreaErrorMessage;
}

function FinancialAreaForm({
  organizationId,
  mode,
  area,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  area?: FinancialArea;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [submitFailure, setSubmitFailure] = useState<SubmitFailure | null>(
    null,
  );
  const [confirmLeave, setConfirmLeave] = useState(false);

  const form = useForm<FinancialAreaFormValues>({
    resolver: zodResolver(financialAreaSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: area?.code ?? '',
      title: area?.title ?? '',
    },
  });
  const isDirty = form.formState.isDirty;

  const createMutation = useCreateFinancialAreaMutation(organizationId);
  const updateMutation = useUpdateFinancialAreaMutation(
    organizationId,
    area?.id ?? 'none',
  );
  const submitting = createMutation.isPending || updateMutation.isPending;

  // Dirty-leave guard at the browser level (standards.md §9); in-app cancel
  // is confirmed through the dialog below.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  // ADR-0054 (§4.7): the workspace dock shows this form's dirty
  // state and guards window close — the page's own leave-confirm
  // guards stay untouched (no double dialog: the dock dialog only
  // runs from dock/reset flows).
  useWorkspaceWindowDirty(isDirty);

  const leave = () => {
    if (isDirty) setConfirmLeave(true);
    else navigate(LIST_PATH);
  };

  const onError = (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.isUnauthorized) return; // owned by the session flow
    const validation = applyFinancialAreaServerValidation(error, form);
    setSubmitFailure({
      source: error,
      mapped:
        validation !== null
          ? {
              message: validation.summary,
              ...(normalized.correlationId !== undefined
                ? { correlationId: normalized.correlationId }
                : {}),
            }
          : financialAreaErrorMessage(
              mode === 'create' ? 'create' : 'update',
              error,
            ),
    });
  };

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return; // duplicate-submit protection
    setSubmitFailure(null);
    const body = { code: values.code.trim(), title: values.title.trim() };
    if (mode === 'create') {
      createMutation.mutate(body, {
        onSuccess: () => {
          showToast({ kind: 'success', message: t.financialArea.created });
          navigate(LIST_PATH);
        },
        onError,
      });
      return;
    }
    updateMutation.mutate(body, {
      onSuccess: () => {
        showToast({ kind: 'success', message: t.financialArea.updated });
        navigate(LIST_PATH);
      },
      onError,
    });
  });

  return (
    <div className="space-y-4">
      <FormPageHeader
        title={
          mode === 'create'
            ? t.financialArea.createTitle
            : t.financialArea.editTitle
        }
        description={t.financialArea.subtitle}
      />

      {/* The failed submit is announced politely and stays on screen. */}
      <div aria-live="polite">
        {submitFailure !== null && (
          <ApiErrorAlert
            error={submitFailure.source}
            description={submitFailure.mapped.message}
          />
        )}
      </div>

      <Card>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={onSubmit}
            noValidate
            data-testid="financial-area-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="financial-area-form-code"
                label={t.financialArea.code}
                required
                error={form.formState.errors.code?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="text"
                    dir="ltr"
                    disabled={submitting}
                    {...form.register('code')}
                  />
                )}
              </FormField>

              <FormField
                id="financial-area-form-title"
                label={t.financialArea.name}
                required
                error={form.formState.errors.title?.message}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="text"
                    disabled={submitting}
                    {...form.register('title')}
                  />
                )}
              </FormField>
            </div>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button
                type="submit"
                disabled={submitting}
                loading={submitting}
                data-testid="financial-area-form-submit"
              >
                {submitting ? t.financialArea.saving : t.financialArea.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
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
        onConfirm={() => {
          setConfirmLeave(false);
          navigate(LIST_PATH);
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
