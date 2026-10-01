import {
  Building2,
  BookOpenCheck,
  CalendarDays,
  Contact,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  List,
  ListTree,
  Network,
  Receipt,
  Scale,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Backend permission codes required to see the entry (UX only, AR-21). */
  permissions?: readonly string[];
  /** Match nested routes as active. */
  end?: boolean;
}

export interface NavigationSection {
  id: string;
  label: string;
  items: readonly NavigationItem[];
}

/**
 * The application menu.
 *
 * Entries are hidden when the session clearly lacks the backend permission of
 * the target surface. This is presentation only: the routes are also guarded
 * and, above all, the backend authorizes every request (AR-21).
 */
export const navigationSections: readonly NavigationSection[] = [
  {
    id: 'workspace',
    label: t.nav.dashboard,
    items: [
      {
        to: '/app',
        label: t.nav.dashboard,
        icon: LayoutDashboard,
        end: true,
        permissions: [PERMISSIONS.accounting.documentView],
      },
    ],
  },
  {
    id: 'accounting',
    label: t.nav.accounting,
    items: [
      {
        to: '/app/accounting',
        label: t.accounting.title,
        icon: BookOpenCheck,
        end: true,
      },
      {
        to: '/app/accounting/documents',
        label: t.nav.documents,
        icon: Receipt,
        permissions: [PERMISSIONS.accounting.documentView],
      },
      {
        to: '/app/accounting/context',
        label: t.nav.financialContext,
        icon: FolderKanban,
        permissions: [
          PERMISSIONS.accounting.financialAreaView,
          PERMISSIONS.accounting.fiscalYearView,
          PERMISSIONS.accounting.accountingPeriodView,
        ],
      },
      {
        to: '/app/accounting/financial-areas',
        label: t.masterData.financialAreas,
        icon: FolderKanban,
        permissions: [PERMISSIONS.accounting.financialAreaView],
      },
      {
        to: '/app/accounting/fiscal-years',
        label: t.masterData.fiscalYears,
        icon: CalendarDays,
        permissions: [PERMISSIONS.accounting.fiscalYearView],
      },
      {
        to: '/app/accounting/periods',
        label: t.masterData.periods,
        icon: CalendarDays,
        permissions: [PERMISSIONS.accounting.accountingPeriodView],
      },
      {
        to: '/app/accounting/chart',
        label: t.nav.chartTree,
        icon: ListTree,
        permissions: [PERMISSIONS.accounting.accountView],
      },
      {
        to: '/app/accounting/accounts',
        label: t.masterData.accounts,
        icon: List,
        permissions: [PERMISSIONS.accounting.accountView],
      },
      {
        to: '/app/accounting/account-statements',
        label: t.nav.accountStatements,
        icon: ScrollText,
        permissions: [PERMISSIONS.accounting.accountStatementView],
      },
      {
        to: '/app/accounting/general-ledger',
        label: t.nav.generalLedger,
        icon: BookOpenCheck,
        permissions: [PERMISSIONS.accounting.generalLedgerView],
      },
      {
        to: '/app/accounting/trial-balance',
        label: t.nav.trialBalance,
        icon: Scale,
        permissions: [PERMISSIONS.accounting.trialBalanceView],
      },
    ],
  },
  {
    id: 'organization',
    label: t.orgAdmin.title,
    items: [
      {
        to: '/app/organization',
        label: t.orgAdmin.title,
        icon: Building2,
        end: true,
      },
      {
        to: '/app/organization/profile',
        label: t.orgAdmin.profile,
        icon: Building2,
        permissions: [PERMISSIONS.organization.view],
      },
      {
        to: '/app/organization/branches',
        label: t.orgAdmin.branches,
        icon: Network,
        permissions: [PERMISSIONS.organization.branchView],
      },
      {
        to: '/app/organization/departments',
        label: t.orgAdmin.departments,
        icon: Contact,
        permissions: [PERMISSIONS.organization.departmentView],
      },
      {
        to: '/app/organization/employees',
        label: t.orgAdmin.employees,
        icon: Users,
        permissions: [PERMISSIONS.organization.employeeView],
      },
      {
        to: '/app/organization/parties',
        label: t.orgAdmin.parties,
        icon: Handshake,
        permissions: [PERMISSIONS.organization.partyView],
      },
    ],
  },
];
