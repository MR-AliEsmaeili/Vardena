import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  FileStack,
  FolderTree,
  Package,
  Receipt,
  Ruler,
  Scale,
  ScrollText,
  Settings2,
  Warehouse,
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

interface InventorySurface {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: string;
}

const OPERATIONS_SURFACES: readonly InventorySurface[] = [
  {
    to: '/app/inventory/movements/new?type=receipt',
    label: t.inventory.newReceipt,
    description: t.inventory.newReceiptDescription,
    icon: ArrowDownToLine,
    permission: PERMISSIONS.inventory.movementCreate,
  },
  {
    to: '/app/inventory/movements/new?type=issue',
    label: t.inventory.newIssue,
    description: t.inventory.newIssueDescription,
    icon: ArrowUpFromLine,
    permission: PERMISSIONS.inventory.movementCreate,
  },
  {
    to: '/app/inventory/transfers/new',
    label: t.inventory.newTransfer,
    description: t.inventory.newTransferDescription,
    icon: ArrowLeftRight,
    permission: PERMISSIONS.inventory.transferCreate,
  },
  {
    to: '/app/inventory/reservations/new',
    label: t.reservations.newReservation,
    description: t.reservations.createDescription,
    icon: ClipboardCheck,
    permission: PERMISSIONS.inventory.reservationCreate,
  },
  {
    to: '/app/inventory/reservations',
    label: t.reservations.title,
    description: t.reservations.subtitle,
    icon: ClipboardCheck,
    permission: PERMISSIONS.inventory.reservationView,
  },
  {
    to: '/app/inventory/documents',
    label: t.nav.inventoryDocuments,
    description: t.inventoryDocuments.subtitle,
    icon: FileStack,
    permission: PERMISSIONS.inventory.documentView,
  },
  {
    to: '/app/inventory/document-lines',
    label: t.nav.inventoryDocumentLines,
    description: t.documentLines.inventorySubtitle,
    icon: FileSpreadsheet,
    permission: PERMISSIONS.inventory.documentView,
  },
  {
    to: '/app/inventory/movements',
    label: t.inventory.movementsTitle,
    description: t.inventory.movementsDescription,
    icon: Receipt,
    permission: PERMISSIONS.inventory.movementView,
  },
  {
    to: '/app/inventory/kardex',
    label: t.inventory.kardexTitle,
    description: t.inventory.kardexDescription,
    icon: ScrollText,
    permission: PERMISSIONS.inventory.movementView,
  },
  {
    to: '/app/inventory/valuation',
    label: t.inventory.valuationTitle,
    description: t.inventory.valuationDescription,
    icon: Scale,
    permission: PERMISSIONS.inventory.valuationView,
  },
  {
    to: '/app/inventory/valuation-methods',
    label: t.inventoryValuationMethods.title,
    description: t.inventoryValuationMethods.description,
    icon: Settings2,
    permission: PERMISSIONS.inventory.valuationView,
  },
];

const MASTER_SURFACES: readonly InventorySurface[] = [
  {
    to: '/app/inventory/balances',
    label: t.inventoryMaster.balances,
    description: t.inventoryMaster.balancesDescription,
    icon: Boxes,
    permission: PERMISSIONS.inventory.balanceView,
  },
  {
    to: '/app/inventory/items',
    label: t.inventoryMaster.items,
    description: t.inventoryMaster.itemsDescription,
    icon: Package,
    permission: PERMISSIONS.inventory.itemView,
  },
  {
    to: '/app/inventory/item-groups',
    label: t.inventoryMaster.itemGroups,
    description: t.inventoryMaster.itemGroupsDescription,
    icon: FolderTree,
    permission: PERMISSIONS.inventory.itemGroupView,
  },
  {
    to: '/app/inventory/units',
    label: t.inventoryMaster.units,
    description: t.inventoryMaster.unitsDescription,
    icon: Ruler,
    permission: PERMISSIONS.inventory.unitView,
  },
  {
    to: '/app/inventory/warehouses',
    label: t.inventoryMaster.warehouses,
    description: t.inventoryMaster.warehousesDescription,
    icon: Warehouse,
    permission: PERMISSIONS.inventory.warehouseView,
  },
  {
    to: '/app/inventory/unit-conversions',
    label: t.inventoryMaster.unitConversions,
    description: t.inventoryMaster.unitConversionsDescription,
    icon: ArrowLeftRight,
    permission: PERMISSIONS.inventory.unitConversionView,
  },
];

/** Inventory landing hub: categorized minimal cards gated by exact permissions. */
export function InventoryHomePage() {
  const permissions = usePermissions();

  const groups = useMemo<WorkspaceCardGroup[]>(() => {
    if (!permissions.loaded) return [];
    const filterPermitted = (list: readonly InventorySurface[]) =>
      list.filter((item) => permissions.has(item.permission));

    return [
      {
        id: 'operations',
        label: t.workspace.inventoryOperationsGroup,
        items: filterPermitted(OPERATIONS_SURFACES),
      },
      {
        id: 'master',
        label: t.workspace.inventoryMasterGroup,
        items: filterPermitted(MASTER_SURFACES),
      },
    ].filter((group) => group.items.length > 0);
  }, [permissions]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.inventory.title}
        description={t.inventory.subtitle}
      />
      <WorkspaceCardGrid groups={groups} />
    </div>
  );
}
