import { useEffect, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import { useOrganizationId } from '@/features/organization/use-organization';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { useQuery } from '@tanstack/react-query';
import { listAccountingPeriods } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import { t } from '@/lib/i18n';
import { sortingFromParam, sortingToParam } from '@/lib/sort-param';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ChartsSection } from './components/charts-section';
import { DocumentsTable } from './components/documents-table';
import { KpiRow } from './components/kpi-row';
import {
  PeriodStatusBanner,
  ReconciliationEmptyCard,
} from './components/notice-widgets';
import {
  InventoryAlertWidget,
  PeriodStatusWidget,
  WorkflowWidget,
} from './components/side-widgets';
import {
  useDashboardBalances,
  useDashboardDocuments,
  useDashboardInventory,
  useDashboardWorkflow,
} from './api/use-dashboard-data';
import { useDashboardScope } from './api/use-dashboard-scope';

/**
 * The Vardena Dashboard (Task 32) — native implementation of the
 * `simpledashboard.html` visual contract on real backend read models.
 *
 * Every section renders its own loading/empty/error/success state; URL state
 * (page/pageSize/sort of the documents table) lives in the router search
 * params, server state in TanStack Query, and only ephemeral view state
 * (banner dismissal) is `useState`.
 */
const DEFAULT_PAGE_SIZE = 9;
const PAGE_SIZE_OPTIONS = [9, 25, 50];

export function DashboardPage(): ReactElement {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const {
    scope,
    isReady: isScopeReady,
    isPermitted: isScopePermitted,
  } = useDashboardScope(organizationId);

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(
    Number(searchParams.get('pageSize') ?? `${DEFAULT_PAGE_SIZE}`),
  )
    ? Number(searchParams.get('pageSize') ?? `${DEFAULT_PAGE_SIZE}`)
    : DEFAULT_PAGE_SIZE;
  const sortParam = searchParams.get('sort') ?? undefined;
  // URL parameters are untrusted: only the backend's allow-listed sort fields
  // of the documents contract are ever forwarded.
  const sorting: SortingState = sortingFromParam(sortParam, [
    'documentDate',
    'documentNumber',
  ]);
  const effectiveSorting: SortingState =
    sorting.length > 0 ? sorting : [{ id: 'documentDate', desc: true }];

  const updateParams = (
    next: Partial<{ page: number; pageSize: number; sort: string | undefined }>,
  ) => {
    setSearchParams(
      (current) => {
        const merged = new URLSearchParams(current);
        if (next.page !== undefined) merged.set('page', String(next.page));
        if (next.pageSize !== undefined)
          merged.set('pageSize', String(next.pageSize));
        if (next.sort !== undefined) {
          if (next.sort === '') merged.delete('sort');
          else merged.set('sort', next.sort);
        }
        return merged;
      },
      { replace: true },
    );
  };

  const balancesQuery = useDashboardBalances(organizationId, scope);
  const documentsQuery = useDashboardDocuments(
    organizationId,
    page,
    pageSize,
    effectiveSorting.length > 0 ? sortingToParam(effectiveSorting) : undefined,
  );
  const inventoryQuery = useDashboardInventory(organizationId);
  const workflowQuery = useDashboardWorkflow(organizationId);

  const isPeriodsPermitted = permissions.loaded
    ? permissions.has(PERMISSIONS.accounting.accountingPeriodView)
    : true;
  const periodsQuery = useQuery({
    queryKey: queryKeys.accounting.accountingPeriods(
      organizationId ?? 'none',
      scope?.fiscalYearId ?? 'all',
    ),
    queryFn: ({ signal }) =>
      listAccountingPeriods(
        {
          organizationId: organizationId as string,
          fiscalYearId: scope?.fiscalYearId as string,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      scope !== null &&
      permissions.loaded &&
      isPeriodsPermitted,
    staleTime: 60_000,
  });

  const isPeriodsLoading =
    periodsQuery.isPending &&
    isScopeReady &&
    scope !== null &&
    isPeriodsPermitted;

  const periods = periodsQuery.data?.items ?? [];
  const today = new Date();
  const currentPeriod =
    periods.find((period) => {
      const start = new Date(period.startDate);
      const end = new Date(period.endDate);
      return today >= start && today <= end;
    }) ?? periods[0];

  // The reference's Alt+D / Alt+N concept lands on real routes: Alt+D goes to
  // the dashboard (its own page), Alt+N is intentionally NOT bound because no
  // document-creation surface exists yet (fake action forbidden).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const documentTotal = documentsQuery.data?.total ?? 0;
  const canOpenTrialBalance = permissions.has(
    PERMISSIONS.accounting.trialBalanceView,
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[19px] font-extrabold text-slate-900">
            {t.dashboard.title}
          </h1>
          <span className="text-xs text-slate-400">{t.dashboard.subtitle}</span>
        </div>
      </header>

      <PeriodStatusBanner
        visiblePeriods={periods.map((period) => ({
          id: period.id,
          title: period.title,
          status: period.status,
        }))}
      />

      {balancesQuery.isError ? (
        <ApiErrorAlert
          error={balancesQuery.error}
          title={t.dashboardErrors.kpi}
          onRetry={() => void balancesQuery.refetch()}
        />
      ) : (
        <KpiRow
          balances={balancesQuery.data?.items}
          isLoading={balancesQuery.isPending && isScopeReady}
          isPermitted={balancesQuery.isPermitted && isScopePermitted}
          scopeMissing={isScopePermitted && isScopeReady && scope === null}
        />
      )}

      <ChartsSection
        balances={balancesQuery.data?.items}
        error={balancesQuery.isError ? balancesQuery.error : undefined}
        onRetry={() => void balancesQuery.refetch()}
        isPermitted={balancesQuery.isPermitted && isScopePermitted}
        scopeMissing={isScopePermitted && isScopeReady && scope === null}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <DocumentsTable
          documents={documentsQuery.data?.items ?? []}
          total={documentTotal}
          page={documentsQuery.data?.page ?? page}
          pageSize={documentsQuery.data?.pageSize ?? pageSize}
          sorting={effectiveSorting}
          isLoading={documentsQuery.isPending}
          isFetching={documentsQuery.isFetching}
          error={documentsQuery.error}
          onRetry={() => void documentsQuery.refetch()}
          onPageChange={(nextPage) => updateParams({ page: nextPage })}
          onPageSizeChange={(nextSize) =>
            updateParams({ pageSize: nextSize, page: 1 })
          }
          onSortingChange={(nextSorting) => {
            const next = sortingToParam(nextSorting) ?? '';
            updateParams({ sort: next, page: 1 });
          }}
          hasFilter={false}
          isPermitted={documentsQuery.isPermitted}
          canOpenDocument={
            permissions.loaded &&
            permissions.has(PERMISSIONS.accounting.documentView)
          }
        />

        <div className="flex flex-col gap-4">
          <WorkflowWidget
            instances={workflowQuery.data?.items}
            isLoading={workflowQuery.isPending}
            isPermitted={workflowQuery.isPermitted}
            error={workflowQuery.error ?? undefined}
            onRetry={() => void workflowQuery.refetch()}
          />
          <InventoryAlertWidget
            balances={inventoryQuery.data?.items}
            isLoading={inventoryQuery.isPending}
            isPermitted={inventoryQuery.isPermitted}
            error={inventoryQuery.error ?? undefined}
            onRetry={() => void inventoryQuery.refetch()}
          />
          <PeriodStatusWidget
            periods={periods.map((period) => ({
              id: period.id,
              sequence: period.sequence,
              title: period.title,
              status: period.status,
              isCurrent: currentPeriod?.id === period.id,
            }))}
            isLoading={isPeriodsLoading}
            isPermitted={isPeriodsPermitted && isScopePermitted}
            scopeMissing={isScopePermitted && isScopeReady && scope === null}
            error={periodsQuery.error ?? undefined}
            onRetry={() => void periodsQuery.refetch()}
          />
          <ReconciliationEmptyCard canOpenTrialBalance={canOpenTrialBalance} />
        </div>
      </div>
    </div>
  );
}
