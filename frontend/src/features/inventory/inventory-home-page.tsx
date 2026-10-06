import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { PageHeader } from '@/ui/patterns/page-header';

interface Surface {
  to: string;
  title: string;
  description: string;
  permission: string;
}

/**
 * Inventory landing page: the warehouse operations this session can open.
 *
 * Each card is gated by the exact backend permission of its target surface
 * (UX only, AR-21) — which is also how module licensing surfaces here: an
 * installation whose license does not include the `inventory` module gets
 * every `Inventory.*` code filtered out of its effective permission set
 * server-side (`LicensingService.filterLicensedPermissions`), so nothing on
 * this page appears and the routes stay blocked without any separate
 * license check in the frontend.
 */
const surfaces: readonly Surface[] = [
  {
    to: '/app/inventory/movements/new?type=receipt',
    title: t.inventory.newReceipt,
    description: t.inventory.newReceiptDescription,
    permission: PERMISSIONS.inventory.movementCreate,
  },
  {
    to: '/app/inventory/movements/new?type=issue',
    title: t.inventory.newIssue,
    description: t.inventory.newIssueDescription,
    permission: PERMISSIONS.inventory.movementCreate,
  },
  {
    to: '/app/inventory/transfers/new',
    title: t.inventory.newTransfer,
    description: t.inventory.newTransferDescription,
    permission: PERMISSIONS.inventory.transferCreate,
  },
  {
    to: '/app/inventory/movements',
    title: t.inventory.movementsTitle,
    description: t.inventory.movementsDescription,
    permission: PERMISSIONS.inventory.movementView,
  },
  {
    to: '/app/inventory/kardex',
    title: t.inventory.kardexTitle,
    description: t.inventory.kardexDescription,
    permission: PERMISSIONS.inventory.movementView,
  },
  {
    to: '/app/inventory/valuation',
    title: t.inventory.valuationTitle,
    description: t.inventory.valuationDescription,
    permission: PERMISSIONS.inventory.valuationView,
  },
];

/** Inventory landing page: the operations and reads this session can open. */
export function InventoryHomePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title={t.inventory.title}
        description={t.inventory.subtitle}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {surfaces.map((surface) => (
          <PermissionGate key={surface.to} permission={surface.permission}>
            <Card>
              <CardHeader>
                <CardTitle>{surface.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{surface.description}</p>
                <Button asChild variant="outline" size="sm">
                  <Link to={surface.to}>
                    {t.home.openSection}
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </PermissionGate>
        ))}
      </div>
    </div>
  );
}
