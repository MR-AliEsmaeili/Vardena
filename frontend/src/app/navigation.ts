import {
  ArrowLeftRight,
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarDays,
  Contact,
  FileSpreadsheet,
  FileStack,
  FolderKanban,
  FolderTree,
  Handshake,
  LayoutDashboard,
  List,
  ListTree,
  Network,
  Package,
  Receipt,
  Ruler,
  Scale,
  ScrollText,
  Settings2,
  ShieldCheck,
  Smartphone,
  TableProperties,
  UserCheck,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import type { PermissionChecks } from '@/features/permissions/use-permissions';
import type { NavTone } from '@/ui/nav-glyph';

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Backend permission codes ALL required to see the entry (UX only, AR-21). */
  permissions?: readonly string[];
  /** Backend permission codes where AT LEAST ONE is required to see the entry. */
  anyPermissions?: readonly string[];
  /** Match exact path only when marking active. */
  end?: boolean;
  /**
   * True when the route exists as a domain landing hub for breadcrumbs and
   * direct URL navigation, without repeating the section header as a child
   * item inside the sidebar.
   */
  hubOnly?: boolean;
}

export interface NavigationSection {
  id: string;
  label: string;
  /** Domain glyph of the section; the sidebar shows it as the group marker. */
  icon: LucideIcon;
  /** Domain tint shared by the section marker and every glyph inside it. */
  tone: NavTone;
  /** Top-level standalone section (rendered without a collapsible group header). */
  standalone?: boolean;
  items: readonly NavigationItem[];
}

/** Shared permission evaluator for sidebar, global search, and workspace cards. */
export function isNavigationItemVisible(
  item: NavigationItem,
  permissions: PermissionChecks,
): boolean {
  if (item.hubOnly === true) return false;
  if (item.permissions !== undefined) {
    return permissions.loaded && permissions.hasAll(item.permissions);
  }
  if (item.anyPermissions !== undefined) {
    return permissions.loaded && permissions.hasAny(item.anyPermissions);
  }
  return true;
}

/**
 * The menu as this session may see it: entries are permission-filtered and a
 * domain whose every entry is hidden disappears with its category header. The
 * sidebar, global search and workspace cards all read the same structure, so a
 * new gate cannot appear in one surface and be forgotten in another.
 */
export function visibleNavigationSections(
  permissions: PermissionChecks,
): readonly NavigationSection[] {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        isNavigationItemVisible(item, permissions),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * The application menu.
 *
 * Categorized by ERP domain, deduplicated of redundant section-title links,
 * and strictly permission-filtered (UX only — the routes and backend
 * re-authorize every request per AR-21).
 */
export const navigationSections: readonly NavigationSection[] = [
  {
    id: 'workspace',
    label: t.nav.dashboard,
    icon: LayoutDashboard,
    tone: 'workspace',
    standalone: true,
    items: [
      {
        to: '/app',
        label: t.nav.dashboard,
        icon: LayoutDashboard,
        end: true,
      },
    ],
  },
  {
    id: 'accounting',
    label: t.nav.accounting,
    icon: BookOpenCheck,
    tone: 'accounting',
    items: [
      {
        to: '/app/accounting',
        label: t.accounting.title,
        icon: BookOpenCheck,
        end: true,
        hubOnly: true,
      },
      {
        to: '/app/accounting/documents',
        label: t.nav.documents,
        icon: Receipt,
        permissions: [PERMISSIONS.accounting.documentView],
      },
      {
        to: '/app/accounting/document-lines',
        label: t.nav.accountingDocumentLines,
        icon: TableProperties,
        permissions: [PERMISSIONS.accounting.documentView],
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
        to: '/app/accounting/configurations',
        label: t.accountingConfig.nav,
        icon: Settings2,
        permissions: [PERMISSIONS.accounting.accountingConfigurationView],
      },
    ],
  },
  {
    id: 'inventory',
    label: t.nav.inventory,
    icon: Warehouse,
    tone: 'inventory',
    items: [
      {
        to: '/app/inventory',
        label: t.inventory.title,
        icon: Warehouse,
        end: true,
        anyPermissions: [
          PERMISSIONS.inventory.movementCreate,
          PERMISSIONS.inventory.transferCreate,
          PERMISSIONS.inventory.movementView,
          PERMISSIONS.inventory.valuationView,
        ],
      },
      {
        to: '/app/inventory/documents',
        label: t.nav.inventoryDocuments,
        icon: FileStack,
        permissions: [PERMISSIONS.inventory.documentView],
      },
      {
        to: '/app/inventory/document-lines',
        label: t.nav.inventoryDocumentLines,
        icon: FileSpreadsheet,
        permissions: [PERMISSIONS.inventory.documentView],
      },
      {
        to: '/app/inventory/movements',
        label: t.nav.inventoryMovements,
        icon: Receipt,
        permissions: [PERMISSIONS.inventory.movementView],
      },
      {
        to: '/app/inventory/kardex',
        label: t.nav.inventoryKardex,
        icon: ScrollText,
        permissions: [PERMISSIONS.inventory.movementView],
      },
      {
        to: '/app/inventory/valuation',
        label: t.nav.inventoryValuation,
        icon: Scale,
        permissions: [PERMISSIONS.inventory.valuationView],
      },
      {
        to: '/app/inventory/balances',
        label: t.inventoryMaster.balances,
        icon: Boxes,
        permissions: [PERMISSIONS.inventory.balanceView],
      },
      {
        to: '/app/inventory/items',
        label: t.inventoryMaster.items,
        icon: Package,
        permissions: [PERMISSIONS.inventory.itemView],
      },
      {
        to: '/app/inventory/item-groups',
        label: t.inventoryMaster.itemGroups,
        icon: FolderTree,
        permissions: [PERMISSIONS.inventory.itemGroupView],
      },
      {
        to: '/app/inventory/units',
        label: t.inventoryMaster.units,
        icon: Ruler,
        permissions: [PERMISSIONS.inventory.unitView],
      },
      {
        to: '/app/inventory/warehouses',
        label: t.inventoryMaster.warehouses,
        icon: Warehouse,
        permissions: [PERMISSIONS.inventory.warehouseView],
      },
      {
        to: '/app/inventory/unit-conversions',
        label: t.inventoryMaster.unitConversions,
        icon: ArrowLeftRight,
        permissions: [PERMISSIONS.inventory.unitConversionView],
      },
    ],
  },
  {
    id: 'organization',
    label: t.orgAdmin.title,
    icon: Building2,
    tone: 'organization',
    items: [
      {
        to: '/app/organization',
        label: t.orgAdmin.title,
        icon: Building2,
        end: true,
        hubOnly: true,
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
      {
        to: '/app/organization/members',
        label: t.orgAdmin.members,
        icon: UserCheck,
        permissions: [PERMISSIONS.organization.membershipView],
      },
    ],
  },
  {
    id: 'licensing',
    label: t.deviceLicensing.title,
    icon: Smartphone,
    tone: 'licensing',
    items: [
      {
        to: '/app/licensing/devices',
        label: t.nav.clientDevices,
        icon: Smartphone,
        permissions: [PERMISSIONS.licensing.deviceView],
      },
    ],
  },
  {
    id: 'admin',
    label: t.nav.admin,
    icon: ShieldCheck,
    tone: 'admin',
    items: [
      {
        to: '/app/admin/users',
        label: t.nav.users,
        icon: UserCog,
        permissions: [PERMISSIONS.users.view],
      },
      {
        to: '/app/admin/roles',
        label: t.nav.roles,
        icon: ShieldCheck,
        permissions: [PERMISSIONS.rbac.roleView],
      },
    ],
  },
];
