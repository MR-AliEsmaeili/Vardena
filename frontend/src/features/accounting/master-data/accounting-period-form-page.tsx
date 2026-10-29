import { Link, useSearchParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useFiscalYears } from '../shared/use-accounting-references';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { PeriodCreateForm } from './period-create-form';

export function AccountingPeriodFormPage() {
  const organizationId = useOrganizationId();
  const [searchParams] = useSearchParams();
  const years = useFiscalYears(organizationId, null);
  const permissions = usePermissions();
  const canReadYears =
    permissions.loaded &&
    permissions.has(PERMISSIONS.accounting.fiscalYearView);
  return (
    <div className="space-y-4">
      <FormPageHeader
        title={t.accountingPeriod.createTitle}
        actions={
          <Button asChild variant="outline">
            <Link to="/app/accounting/periods">{t.accountingPeriod.back}</Link>
          </Button>
        }
      />
      {!permissions.loaded && <LoadingState />}
      {permissions.loaded && !canReadYears && (
        <p className="text-sm text-ink-muted">
          {t.accountingPeriod.yearViewRequired}
        </p>
      )}
      {canReadYears && years.isPending && <LoadingState />}
      {years.isError && (
        <ApiErrorAlert
          error={years.error}
          onRetry={() => void years.refetch()}
        />
      )}
      {years.data?.items.length === 0 && (
        <EmptyState title={t.masterData.noFiscalYears} />
      )}
      {organizationId !== null &&
        permissions.loaded &&
        (canReadYears ? (
          years.data &&
          years.data.items.length > 0 && (
            <PeriodCreateForm
              organizationId={organizationId}
              fiscalYears={years.data.items}
              initialFiscalYearId={searchParams.get('fiscalYearId') ?? ''}
            />
          )
        ) : (
          <PeriodCreateForm
            organizationId={organizationId}
            fiscalYears={[]}
            initialFiscalYearId={searchParams.get('fiscalYearId') ?? ''}
            allowYearIdEntry
          />
        ))}
    </div>
  );
}
