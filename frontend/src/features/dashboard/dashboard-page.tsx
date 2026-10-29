import { useCallback, useEffect, useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import {
  BookOpenCheck,
  Boxes,
  Building2,
  FileSpreadsheet,
  FileStack,
  Handshake,
  Plus,
  Receipt,
  ShieldCheck,
  TableProperties,
  UserCog,
} from 'lucide-react';
import { LicenseStatusCard } from '@/features/licensing/license-status-card';
import { useOrganizationId } from '@/features/organization/use-organization';
import { useWorkspace } from '@/app/workspace/workspace-context';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { useQuery } from '@tanstack/react-query';
import { listAccountingPeriods } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import { todayBusinessDay, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { sortingFromParam, sortingToParam } from '@/lib/sort-param';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  WorkspaceCardGrid,
  type WorkspaceCardGroup,
} from '@/ui/patterns/workspace-cards';
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

const DEFAULT_PAGE_SIZE = 9;
const PAGE_SIZE_OPTIONS = [9, 25, 50];

/**
 * The Vardena Workspace (`میزکار`) — combines categorized minimal domain cards
 * (icon on top, title below, permission-filtered) with real-time financial &
 * operational KPIs, charts, recent documents, and status widgets.
 */
export function DashboardPage(): ReactElement {
  const organizationId = useOrganizationId();
  const timeZone = useTimeZone();
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
  const today = todayBusinessDay(timeZone);
  const currentPeriod =
    periods.find(
      (period) => today >= period.startDate && today <= period.endDate,
    ) ?? periods[0];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ADR-0054: quick-access cards open workspace windows (reuse by basePath;
  // `/new` targets always create). Outside the provider (isolated tests,
  // home-page) the cards keep their native links.
  const workspace = useWorkspace();
  const handleCardNavigate = useCallback(
    (to: string) => {
      workspace?.open(to);
    },
    [workspace],
  );

  const quickAccessGroups = useMemo<WorkspaceCardGroup[]>(() => {
    if (!permissions.loaded) return [];
    const accountingItems = [
      permissions.hasAny([
        PERMISSIONS.accounting.documentView,
        PERMISSIONS.accounting.accountView,
        PERMISSIONS.accounting.generalLedgerView,
        PERMISSIONS.accounting.trialBalanceView,
      ])
        ? {
            to: '/app/accounting',
            label: t.accounting.title,
            icon: BookOpenCheck,
          }
        : null,
      permissions.has(PERMISSIONS.accounting.documentCreate)
        ? {
            to: '/app/accounting/documents/new',
            label: t.documents.create,
            icon: Plus,
          }
        : null,
      permissions.has(PERMISSIONS.accounting.documentView)
        ? {
            to: '/app/accounting/documents',
            label: t.nav.documents,
            icon: Receipt,
          }
        : null,
      permissions.has(PERMISSIONS.accounting.documentView)
        ? {
            to: '/app/accounting/document-lines',
            label: t.nav.accountingDocumentLines,
            icon: TableProperties,
          }
        : null,
    ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const inventoryItems = [
      permissions.hasAny([
        PERMISSIONS.inventory.movementCreate,
        PERMISSIONS.inventory.transferCreate,
        PERMISSIONS.inventory.movementView,
        PERMISSIONS.inventory.documentView,
      ])
        ? {
            to: '/app/inventory',
            label: t.inventory.title,
            icon: Boxes,
          }
        : null,
      permissions.has(PERMISSIONS.inventory.documentCreate)
        ? {
            to: '/app/inventory/documents/new?kind=receipt',
            label: t.inventoryDocuments.newReceipt,
            icon: Plus,
          }
        : null,
      permissions.has(PERMISSIONS.inventory.documentView)
        ? {
            to: '/app/inventory/documents',
            label: t.nav.inventoryDocuments,
            icon: FileStack,
          }
        : null,
      permissions.has(PERMISSIONS.inventory.documentView)
        ? {
            to: '/app/inventory/document-lines',
            label: t.nav.inventoryDocumentLines,
            icon: FileSpreadsheet,
          }
        : null,
    ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const orgAdminItems = [
      permissions.hasAny([
        PERMISSIONS.organization.view,
        PERMISSIONS.organization.branchView,
        PERMISSIONS.organization.departmentView,
        PERMISSIONS.organization.employeeView,
        PERMISSIONS.organization.partyView,
      ])
        ? {
            to: '/app/organization',
            label: t.orgAdmin.title,
            icon: Building2,
          }
        : null,
      permissions.has(PERMISSIONS.organization.partyView)
        ? {
            to: '/app/organization/parties',
            label: t.orgAdmin.parties,
            icon: Handshake,
          }
        : null,
      permissions.has(PERMISSIONS.users.view)
        ? {
            to: '/app/admin/users',
            label: t.nav.users,
            icon: UserCog,
          }
        : null,
      permissions.has(PERMISSIONS.rbac.roleView)
        ? {
            to: '/app/admin/roles',
            label: t.nav.roles,
            icon: ShieldCheck,
          }
        : null,
    ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return [
      {
        id: 'accounting',
        label: t.nav.accounting,
        items: accountingItems,
      },
      {
        id: 'inventory',
        label: t.nav.inventory,
        items: inventoryItems,
      },
      {
        id: 'organization',
        label: t.workspace.organizationGroup,
        items: orgAdminItems,
      },
    ].filter((group) => group.items.length > 0);
  }, [permissions]);

  const documentTotal = documentsQuery.data?.total ?? 0;
  const canOpenTrialBalance = permissions.has(
    PERMISSIONS.accounting.trialBalanceView,
  );

  return (
    <div className="w-full min-w-0 space-y-5">
      <PageHeader
        title={t.dashboard.title}
        description={t.dashboard.subtitle}
      />

      {quickAccessGroups.length > 0 && (
        <section
          aria-label={t.workspace.quickAccessTitle}
          className="space-y-3"
        >
          <WorkspaceCardGrid
            groups={quickAccessGroups}
            compact
            onNavigate={handleCardNavigate}
          />
        </section>
      )}

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

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
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

        <div className="flex min-w-0 flex-col gap-4">
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
          <LicenseStatusCard />
        </div>
      </div>
    </div>
  );
}
