import {
  BookOpenCheck,
  LayoutDashboard,
  ListTree,
  Scale,
  ScrollText,
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
      { to: '/app', label: t.nav.dashboard, icon: LayoutDashboard, end: true },
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
        to: '/app/accounting/chart',
        label: t.nav.chartTree,
        icon: ListTree,
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
];
