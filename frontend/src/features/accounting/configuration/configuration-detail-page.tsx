import type { ColumnDef } from '@tanstack/react-table';
import { Link, useParams } from 'react-router-dom';
import type { AccountingConfigurationLevel } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { DataTable } from '@/ui/patterns/data-table';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { ConfigurationActions } from './configuration-actions';
import { configurationErrorMessage } from './configuration-error-messages';
import { useAccountingConfigurationDetail } from './configuration-hooks';
import { configurationLevelKindLabel } from './configuration-levels-editor';

const LIST_PATH = '/app/accounting/configurations';

const levelColumns: ColumnDef<AccountingConfigurationLevel, unknown>[] = [
  {
    accessorKey: 'levelIndex',
    header: t.accountingConfig.levelIndex,
    cell: ({ row }) => <span dir="ltr">{row.original.levelIndex}</span>,
  },
  { accessorKey: 'title', header: t.accountingConfig.levelTitle },
  {
    accessorKey: 'digitLength',
    header: t.accountingConfig.digitLength,
    cell: ({ row }) => <span dir="ltr">{row.original.digitLength}</span>,
  },
  {
    accessorKey: 'defaultIsPostable',
    header: t.accountingConfig.defaultPostable,
    cell: ({ row }) =>
      row.original.defaultIsPostable
        ? t.masterData.active
        : t.masterData.inactive,
  },
  {
    accessorKey: 'levelKind',
    header: t.accountingConfig.levelKind,
    cell: ({ row }) => configurationLevelKindLabel(row.original.levelKind),
  },
];

export function ConfigurationDetailPage() {
  const organizationId = useOrganizationId();
  const timeZone = useTimeZone();
  const { configurationId } = useParams<{ configurationId: string }>();
  const query = useAccountingConfigurationDetail(
    organizationId,
    configurationId,
  );

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.accountingConfig.detailTitle} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={configurationErrorMessage('load', query.error)}
          onRetry={() => void query.refetch()}
        />
        <Button asChild variant="outline">
          <Link to={LIST_PATH}>{t.accountingConfig.backToList}</Link>
        </Button>
      </div>
    );
  }

  const configuration = query.data;
  const isDraft = configuration.status === 'DRAFT';

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t.accountingConfig.detailTitle} — ${configuration.code}`}
        description={t.accountingConfig.subtitle}
        actions={
          <ConfigurationActions
            configuration={configuration}
            showView={false}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={LIST_PATH}>{t.accountingConfig.backToList}</Link>
        </Button>
        {!isDraft && (
          <p className="text-xs text-ink-subtle">
            {t.accountingConfig.readOnlyPublished}
          </p>
        )}
      </div>

      <DefinitionList>
        <Definition label={t.accountingConfig.code}>
          <span className="code" dir="ltr">
            {configuration.code}
          </span>
        </Definition>
        <Definition label={t.accountingConfig.name}>
          {configuration.name}
        </Definition>
        <Definition label={t.accountingConfig.versionNumber}>
          <span dir="ltr">{configuration.versionNumber}</span>
        </Definition>
        <Definition label={t.accountingConfig.status}>
          <span className="inline-flex flex-wrap items-center gap-1">
            <Badge
              variant={
                configuration.status === 'ACTIVE'
                  ? 'success'
                  : configuration.status === 'DRAFT'
                    ? 'info'
                    : 'neutral'
              }
            >
              {t.accountingConfig.statusNames[configuration.status]}
            </Badge>
            {configuration.isOperationallyUsed && (
              <Badge variant="warning">
                {t.accountingConfig.operationallyUsed}
              </Badge>
            )}
          </span>
        </Definition>
        <Definition label={t.accountingConfig.pattern}>
          <span className="code" dir="ltr" data-testid="configuration-pattern">
            {configuration.pattern}
          </span>
        </Definition>
        <Definition label={t.accountingConfig.effectiveFrom}>
          <span dir="ltr" title={configuration.effectiveFrom ?? ''}>
            {formatInstant(configuration.effectiveFrom, timeZone)}
          </span>
        </Definition>
        <Definition label={t.accountingConfig.createdAt}>
          <span dir="ltr">
            {formatInstant(configuration.createdAt, timeZone)}
          </span>
        </Definition>
        <Definition label={t.accountingConfig.updatedAt}>
          <span dir="ltr">
            {formatInstant(configuration.updatedAt, timeZone)}
          </span>
        </Definition>
      </DefinitionList>

      <Card>
        <CardContent>
          <DataTable
            columns={levelColumns}
            data={configuration.levels}
            getRowId={(row) => row.id}
            caption={t.accountingConfig.levels}
            emptyTitle={t.accountingConfig.levels}
            emptyDescription={t.accountingConfig.noResults}
          />
        </CardContent>
      </Card>
    </div>
  );
}
