import { FinancialAreaCreateForm } from '@/features/accounting/context/financial-area-create-form';
import { FinancialAreaSelection } from '@/features/accounting/context/financial-area-selection';
import { FiscalYearCreateForm } from '@/features/accounting/context/fiscal-year-create-form';
import { FiscalYearSelection } from '@/features/accounting/context/fiscal-year-selection';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState } from '@/ui/patterns/states';
import { BlockedState, LogoutButton, ResolvingState } from './bootstrap-states';

/**
 * The Accounting context stage after a confirmed organization and before the
 * workspace. It uses the existing `OrganizationProvider` rather than a
 * competing persisted context, so organization changes clear its dependent
 * selections before any new area/year request is enabled.
 */
export function FinancialContextGate() {
  const context = useOrganization();
  const permissions = usePermissions();

  if (
    context.financialAreaStatus === 'waiting' ||
    context.financialAreaStatus === 'loading'
  ) {
    return <ResolvingState label={t.financialContext.areaResolving} />;
  }

  if (context.financialAreaStatus === 'forbidden') {
    return (
      <BlockedState
        title={t.financialContext.contextForbiddenTitle}
        description={t.financialContext.contextForbiddenBody}
      />
    );
  }

  if (context.financialAreaStatus === 'error') {
    return (
      <div className="space-y-4">
        <ApiErrorAlert
          error={context.financialAreaError}
          title={t.financialContext.areaLoadFailed}
          onRetry={context.refreshFinancialAreas}
        />
        <LogoutButton />
      </div>
    );
  }

  if (
    context.financialAreaStatus === 'selecting' ||
    context.financialAreaStatus === 'invalid'
  ) {
    return (
      <FinancialAreaSelection
        invalid={context.financialAreaStatus === 'invalid'}
      />
    );
  }

  if (context.financialAreaStatus === 'empty') {
    return (
      <div className="space-y-4">
        <EmptyState
          title={t.financialContext.areaEmptyTitle}
          description={t.financialContext.areaEmptyBody}
        />
        {permissions.loaded &&
          permissions.has(PERMISSIONS.accounting.financialAreaCreate) &&
          context.organizationId !== null && (
            <FinancialAreaCreateForm organizationId={context.organizationId} />
          )}
        <LogoutButton />
      </div>
    );
  }

  if (
    context.fiscalYearStatus === 'waiting' ||
    context.fiscalYearStatus === 'loading'
  ) {
    return <ResolvingState label={t.financialContext.yearResolving} />;
  }

  if (context.fiscalYearStatus === 'forbidden') {
    return (
      <BlockedState
        title={t.financialContext.contextForbiddenTitle}
        description={t.financialContext.contextForbiddenBody}
      />
    );
  }

  if (context.fiscalYearStatus === 'error') {
    return (
      <div className="space-y-4">
        <ApiErrorAlert
          error={context.fiscalYearError}
          title={t.financialContext.fiscalYearLoadFailed}
          onRetry={context.refreshFiscalYears}
        />
        <LogoutButton />
      </div>
    );
  }

  if (
    context.fiscalYearStatus === 'selecting' ||
    context.fiscalYearStatus === 'invalid'
  ) {
    return (
      <FiscalYearSelection invalid={context.fiscalYearStatus === 'invalid'} />
    );
  }

  if (context.fiscalYearStatus === 'empty') {
    return (
      <div className="space-y-4">
        <EmptyState
          title={t.financialContext.fiscalYearEmptyTitle}
          description={t.financialContext.fiscalYearEmptyBody}
        />
        {permissions.loaded &&
          permissions.has(PERMISSIONS.accounting.fiscalYearCreate) &&
          context.organizationId !== null &&
          context.financialAreaId !== null && (
            <FiscalYearCreateForm
              organizationId={context.organizationId}
              financialAreaId={context.financialAreaId}
            />
          )}
        <LogoutButton />
      </div>
    );
  }

  // This component is mounted only while the context is not ready. Keeping a
  // no-op fallback avoids fabricating a workspace if a future status is added.
  return <ResolvingState label={t.app.loading} />;
}
