import {
  BookOpenCheck,
  CalendarDays,
  FolderKanban,
  List,
  ListTree,
  Receipt,
  Scale,
  ScrollText,
  TableProperties,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  WorkspaceCardGrid,
  type WorkspaceCardGroup,
} from '@/ui/patterns/workspace-cards';

interface AccountingSurface {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: string;
}

const OPERATIONS_SURFACES: readonly AccountingSurface[] = [
  {
    to: '/app/accounting/documents',
    label: t.nav.documents,
    description: t.accounting.documentsDescription,
    icon: Receipt,
    permission: PERMISSIONS.accounting.documentView,
  },
  {
    to: '/app/accounting/document-lines',
    label: t.nav.accountingDocumentLines,
    description: t.documentLines.accountingSubtitle,
    icon: TableProperties,
    permission: PERMISSIONS.accounting.documentView,
  },
];

const REPORT_SURFACES: readonly AccountingSurface[] = [
  {
    to: '/app/accounting/account-statements',
    label: t.nav.accountStatements,
    description: t.accounting.accountStatementsDescription,
    icon: ScrollText,
    permission: PERMISSIONS.accounting.accountStatementView,
  },
  {
    to: '/app/accounting/general-ledger',
    label: t.nav.generalLedger,
    description: t.accounting.generalLedgerDescription,
    icon: BookOpenCheck,
    permission: PERMISSIONS.accounting.generalLedgerView,
  },
  {
    to: '/app/accounting/trial-balance',
    label: t.nav.trialBalance,
    description: t.accounting.trialBalanceDescription,
    icon: Scale,
    permission: PERMISSIONS.accounting.trialBalanceView,
  },
];

const MASTER_SURFACES: readonly AccountingSurface[] = [
  {
    to: '/app/accounting/chart',
    label: t.nav.chartTree,
    description: t.accounting.chartTreeDescription,
    icon: ListTree,
    permission: PERMISSIONS.accounting.accountView,
  },
  {
    to: '/app/accounting/accounts',
    label: t.masterData.accounts,
    description: t.masterData.accountsDescription,
    icon: List,
    permission: PERMISSIONS.accounting.accountView,
  },
  {
    to: '/app/accounting/financial-areas',
    label: t.masterData.financialAreas,
    description: t.masterData.financialAreasDescription,
    icon: FolderKanban,
    permission: PERMISSIONS.accounting.financialAreaView,
  },
  {
    to: '/app/accounting/fiscal-years',
    label: t.masterData.fiscalYears,
    description: t.masterData.fiscalYearsDescription,
    icon: CalendarDays,
    permission: PERMISSIONS.accounting.fiscalYearView,
  },
  {
    to: '/app/accounting/periods',
    label: t.masterData.periods,
    description: t.masterData.periodsDescription,
    icon: CalendarDays,
    permission: PERMISSIONS.accounting.accountingPeriodView,
  },
];

/** Accounting landing hub: categorized minimal cards gated by exact permissions. */
export function AccountingHomePage() {
  const permissions = usePermissions();

  const groups = useMemo<WorkspaceCardGroup[]>(() => {
    if (!permissions.loaded) return [];
    const filterPermitted = (list: readonly AccountingSurface[]) =>
      list.filter((item) => permissions.has(item.permission));

    return [
      {
        id: 'operations',
        label: t.workspace.accountingOperationsGroup,
        items: filterPermitted(OPERATIONS_SURFACES),
      },
      {
        id: 'reports',
        label: t.workspace.accountingReportsGroup,
        items: filterPermitted(REPORT_SURFACES),
      },
      {
        id: 'master',
        label: t.masterData.title,
        items: filterPermitted(MASTER_SURFACES),
      },
    ].filter((group) => group.items.length > 0);
  }, [permissions]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.accounting.title}
        description={t.accounting.subtitle}
      />
      <WorkspaceCardGrid groups={groups} />
    </div>
  );
}
