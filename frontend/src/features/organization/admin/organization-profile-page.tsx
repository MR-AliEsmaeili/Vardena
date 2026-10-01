import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Organization } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  adminErrorMessage,
  applyServerValidation,
  type AdminErrorMessage,
} from './admin-error-messages';
import { AdminLifecycleActions } from './admin-lifecycle-actions';
import {
  organizationProfileSchema,
  type OrganizationProfileFormValues,
} from './admin-schemas';
import { ActiveBadge, Definition, DefinitionList } from './admin-ui';
import {
  useOrganizationLifecycleMutation,
  useOrganizationProfile,
  useUpdateOrganizationMutation,
} from './organization-profile-hooks';

/**
 * Profile of the CURRENT organization: identity, status and the two writes
 * the backend exposes for it (edit code/name, enable/disable).
 *
 * The organization is always the one in `OrganizationContext`; there is no
 * id input and no organization browser here, so this screen cannot be used
 * to reach outside the active scope.
 */
export function OrganizationProfilePage() {
  const organizationId = useOrganizationId();
  const query = useOrganizationProfile(organizationId);

  if (query.isPending) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.profile} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.organizationLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <OrganizationProfileView
      organizationId={organizationId as string}
      organization={query.data}
    />
  );
}

function OrganizationProfileView({
  organizationId,
  organization,
}: {
  organizationId: string;
  organization: Organization;
}) {
  const permissions = usePermissions();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<AdminErrorMessage | null>(
    null,
  );

  const lifecycle = useOrganizationLifecycleMutation(organizationId);
  const updateMutation = useUpdateOrganizationMutation(organizationId);
  const canEdit = permissions.has(PERMISSIONS.organization.edit);

  const form = useForm<OrganizationProfileFormValues>({
    resolver: zodResolver(organizationProfileSchema),
    mode: 'onSubmit',
    defaultValues: { code: organization.code, name: organization.name },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (updateMutation.isPending) return;
    setServerError(null);
    updateMutation.mutate(values, {
      onSuccess: (updated) => {
        showToast({ kind: 'success', message: t.orgAdmin.organizationUpdated });
        form.reset({ code: updated.code, name: updated.name });
      },
      onError: (error: unknown) => {
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        const validation = applyServerValidation(error, form, ['code', 'name']);
        setServerError(
          validation !== null
            ? {
                message: validation.summary,
                ...(normalized.correlationId !== undefined
                  ? { correlationId: normalized.correlationId }
                  : {}),
              }
            : adminErrorMessage('organization', 'update', error),
        );
      },
    });
  });

  return (
    <div className="space-y-4" data-testid="organization-profile-page">
      <PageHeader
        title={t.orgAdmin.profile}
        description={t.orgAdmin.profileDescription}
        actions={
          <AdminLifecycleActions
            isActive={organization.isActive}
            canEnable={permissions.has(PERMISSIONS.organization.enable)}
            canDisable={permissions.has(PERMISSIONS.organization.disable)}
            pending={lifecycle.isPending}
            onEnable={() => lifecycle.mutateAsync({ action: 'enable' })}
            onDisable={() => lifecycle.mutateAsync({ action: 'disable' })}
            errorMessage={(action, error) =>
              adminErrorMessage('organization', action, error)
            }
            onConfirmed={(action) =>
              showToast({
                kind: 'success',
                message:
                  action === 'enable'
                    ? t.orgAdmin.organizationEnabled
                    : t.orgAdmin.organizationDisabled,
              })
            }
            enableTitle={t.orgAdmin.organizationEnableTitle}
            enableBody={t.orgAdmin.organizationEnableBody}
            disableTitle={t.orgAdmin.organizationDisableTitle}
            disableBody={t.orgAdmin.organizationDisableBody}
          />
        }
      />

      {!organization.isActive && (
        <Alert variant="warning">
          <AlertTitle>{t.orgAdmin.inactive}</AlertTitle>
          <AlertBody>{t.orgAdmin.organizationDisableBody}</AlertBody>
        </Alert>
      )}

      <DefinitionList>
        <Definition label={t.orgAdmin.organizationCode}>
          <span className="code">{organization.code}</span>
        </Definition>
        <Definition label={t.orgAdmin.organizationName}>
          {organization.name}
        </Definition>
        <Definition label={t.orgAdmin.status}>
          <ActiveBadge active={organization.isActive} />
        </Definition>
        <Definition label={t.orgAdmin.identity}>
          <span className="code">{organization.id}</span>
        </Definition>
        <Definition label={t.orgAdmin.createdAt}>
          <span className="num">{formatDateTime(organization.createdAt)}</span>
        </Definition>
        <Definition label={t.orgAdmin.updatedAt}>
          <span className="num">{formatDateTime(organization.updatedAt)}</span>
        </Definition>
      </DefinitionList>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t.orgAdmin.edit}</CardTitle>
          </CardHeader>
          <CardContent>
            <div aria-live="polite">
              {serverError !== null && (
                <Alert variant="danger" role="alert" className="mb-4">
                  <AlertTitle>{t.errors.title}</AlertTitle>
                  <AlertBody>
                    <p>{serverError.message}</p>
                    {serverError.correlationId !== undefined && (
                      <p className="mt-2 text-xs text-rose-800/80">
                        {t.errors.correlationId}:{' '}
                        <span className="code">
                          {serverError.correlationId}
                        </span>
                      </p>
                    )}
                  </AlertBody>
                </Alert>
              )}
            </div>
            <form
              className="space-y-4"
              onSubmit={onSubmit}
              noValidate
              data-testid="organization-profile-form"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="organization-profile-code"
                  label={t.orgAdmin.organizationCode}
                  error={form.formState.errors.code?.message}
                >
                  {(fieldProps) => (
                    <Input
                      {...fieldProps}
                      type="text"
                      dir="ltr"
                      required
                      aria-required="true"
                      disabled={updateMutation.isPending}
                      {...form.register('code')}
                    />
                  )}
                </FormField>
                <FormField
                  id="organization-profile-name"
                  label={t.orgAdmin.organizationName}
                  error={form.formState.errors.name?.message}
                >
                  {(fieldProps) => (
                    <Input
                      {...fieldProps}
                      type="text"
                      required
                      aria-required="true"
                      disabled={updateMutation.isPending}
                      {...form.register('name')}
                    />
                  )}
                </FormField>
              </div>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="organization-profile-submit"
              >
                {updateMutation.isPending ? t.orgAdmin.saving : t.orgAdmin.save}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
