/**
 * workspace-route-tree — the extraction parity suite (spec §10.3).
 *
 * The tree moved VERBATIM out of `router.tsx`; these tests pin that fact:
 *  - the inventory snapshot (leaf routes + RequirePermission gates) fails if
 *    any route or gate silently disappeared in the move — intentional route
 *    changes must update the numbers consciously;
 *  - key paths resolve to the SAME leaf component and the SAME permission
 *    gate as before;
 *  - `matchWorkspaceRoute` (lenient — used for live deep links) and
 *    `matchRestorableWorkspaceRoute` (strict — a `*`-only match is not a
 *    restorable route, FDR-01 §3.1) agree with §6.3 rules a–e.
 */

import { describe, expect, it } from 'vitest';
import { matchRoutes, type RouteObject } from 'react-router-dom';
import { DocumentsPage } from '@/features/accounting/documents/documents-page';
import { DocumentCreatePage } from '@/features/accounting/documents/document-form-page';
import { AccountingHomePage } from '@/features/accounting/accounting-home-page';
import { ProfilePage } from '@/features/auth/profile-page';
import { MovementFormPage } from '@/features/inventory/movement-form-page';
import { MaterialRequestDetailPage } from '@/features/inventory/material-requests/material-request-detail-page';
import { MaterialRequestFormPage } from '@/features/inventory/material-requests/material-request-form-page';
import { MaterialRequestsPage } from '@/features/inventory/material-requests/material-requests-page';
import { ReservationDetailPage } from '@/features/inventory/reservations/reservation-detail-page';
import { ReservationFormPage } from '@/features/inventory/reservations/reservation-form-page';
import { ReservationsPage } from '@/features/inventory/reservations/reservations-page';
import { UsersPage } from '@/features/administration/users/users-page';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { DashboardRoute } from './dashboard-route';
import { DocumentTypeDetailPage } from '@/features/documents/document-types/document-type-detail-page';
import { DocumentTypesPage } from '@/features/documents/document-types/document-types-page';
import { NumberingSeriesPage } from '@/features/documents/numbering-series/numbering-series-page';
import { NumberingSeriesDetailPage } from '@/features/documents/numbering-series/numbering-series-detail-page';
import { NumberingSeriesFormPage } from '@/features/documents/numbering-series/numbering-series-form-page';
import { NotFoundPage } from './not-found-page';
import { RequirePermission } from './require-permission';
import {
  matchRestorableWorkspaceRoute,
  matchWorkspaceRoute,
  WORKSPACE_ROUTES,
} from './workspace-route-tree';

interface RouteElementLike {
  type?: unknown;
  props?: { permissions?: readonly string[] };
}

function elementOf(route: RouteObject): RouteElementLike | null {
  return (route.element as RouteElementLike | undefined) ?? null;
}

function chainFor(pathname: string) {
  const matches = matchRoutes(WORKSPACE_ROUTES, pathname);
  expect(matches).not.toBeNull();
  return matches!;
}

function leafType(pathname: string): unknown {
  const matches = chainFor(pathname);
  return elementOf(matches[matches.length - 1]!.route)?.type;
}

function gatePermissions(pathname: string): readonly string[] | null {
  for (const match of chainFor(pathname)) {
    const element = elementOf(match.route);
    if (element?.type === RequirePermission) {
      return element.props?.permissions ?? null;
    }
  }
  return null;
}

function allGatePermissions(pathname: string): readonly string[] {
  const perms: string[] = [];
  for (const match of chainFor(pathname)) {
    const element = elementOf(match.route);
    if (
      element?.type === RequirePermission &&
      element.props?.permissions !== undefined
    ) {
      perms.push(...element.props.permissions);
    }
  }
  return perms;
}

function inventory(routes: readonly RouteObject[]): {
  leaves: number;
  gates: number;
} {
  let leaves = 0;
  let gates = 0;
  const walk = (list: readonly RouteObject[]) => {
    for (const route of list) {
      if (elementOf(route as RouteObject)?.type === RequirePermission) {
        gates += 1;
      }
      if (route.children !== undefined && route.children.length > 0) {
        walk(route.children);
      } else {
        leaves += 1;
      }
    }
  };
  walk(routes);
  return { leaves, gates };
}

describe('tree inventory — verbatim extraction snapshot (§10.3)', () => {
  it('has exactly the expected number of leaf routes and permission gates', () => {
    // The whole /app subtree as it stood in router.tsx at extraction time
    // (99 leaves / 72 gates) PLUS the DOC-01 document-types block merged
    // from main afterwards (+3 leaves, +1 gate) PLUS DOC-02 numbering-series
    // (+4 leaves, +3 gates) PLUS INV-04 valuation-methods (+2 leaves, +1 gate),
    // INV-08 reservations (+3 leaves, +2 gates) and INV-06 material requests
    // (+4 leaves, +3 gates) PLUS DOC-03 document-relations (+3 leaves, +2 gates):
    // 118 leaf routes behind 84 RequirePermission gates (+ the pathless shells).
    // Update ONLY together with a deliberate route change.
    expect(inventory(WORKSPACE_ROUTES)).toEqual({ leaves: 118, gates: 84 });
  });

  it('is rooted at /app with a single top-level route object', () => {
    expect(WORKSPACE_ROUTES).toHaveLength(1);
    expect(WORKSPACE_ROUTES[0]?.path).toBe('/app');
  });
});

describe('leaf parity — same component as the old inline tree', () => {
  it('resolves the workspace index to the dashboard', () => {
    expect(leafType('/app')).toBe(DashboardRoute);
    expect(leafType('/app/accounting')).toBe(AccountingHomePage);
  });

  it('resolves lists, drafts and detail segments', () => {
    expect(leafType('/app/accounting/documents')).toBe(DocumentsPage);
    expect(leafType('/app/accounting/documents/new')).toBe(DocumentCreatePage);
    expect(leafType('/app/inventory/movements/new')).toBe(MovementFormPage);
    expect(leafType('/app/inventory/reservations')).toBe(ReservationsPage);
    expect(leafType('/app/inventory/reservations/new')).toBe(
      ReservationFormPage,
    );
    expect(leafType('/app/inventory/reservations/rsv-1')).toBe(
      ReservationDetailPage,
    );
    expect(leafType('/app/inventory/material-requests')).toBe(
      MaterialRequestsPage,
    );
    expect(leafType('/app/inventory/material-requests/new')).toBe(
      MaterialRequestFormPage,
    );
    expect(leafType('/app/inventory/material-requests/mr-1')).toBe(
      MaterialRequestDetailPage,
    );
    expect(leafType('/app/inventory/material-requests/mr-1/edit')).toBe(
      MaterialRequestFormPage,
    );
    expect(leafType('/app/profile')).toBe(ProfilePage);
    expect(leafType('/app/admin/users')).toBe(UsersPage);
  });

  it('resolves unmatched /app paths to the in-tree 404', () => {
    expect(leafType('/app/deep/garbage')).toBe(NotFoundPage);
    expect(leafType('/app/accounting/not-a-page')).toBe(NotFoundPage);
  });

  it('resolves the DOC-01 document-types surfaces', () => {
    expect(leafType('/app/documents/types')).toBe(DocumentTypesPage);
    expect(leafType('/app/documents/types/some-code')).toBe(
      DocumentTypeDetailPage,
    );
    expect(gatePermissions('/app/documents/types')).toContain(
      PERMISSIONS.documents.documentTypeView,
    );
  });

  it('resolves the DOC-02 numbering-series surfaces (View sibling Create / View+Edit)', () => {
    expect(leafType('/app/documents/numbering-series')).toBe(
      NumberingSeriesPage,
    );
    expect(leafType('/app/documents/numbering-series/some-series-id')).toBe(
      NumberingSeriesDetailPage,
    );
    expect(leafType('/app/documents/numbering-series/new')).toBe(
      NumberingSeriesFormPage,
    );
    expect(
      leafType('/app/documents/numbering-series/some-series-id/edit'),
    ).toBe(NumberingSeriesFormPage);
    expect(gatePermissions('/app/documents/numbering-series')).toContain(
      PERMISSIONS.documents.numberingSeriesView,
    );
    expect(gatePermissions('/app/documents/numbering-series/new')).toContain(
      PERMISSIONS.documents.numberingSeriesCreate,
    );
    // Edit sits behind View+Edit (the edit screen first reads the record).
    const editPerms = allGatePermissions(
      '/app/documents/numbering-series/some-series-id/edit',
    );
    expect(editPerms).toContain(PERMISSIONS.documents.numberingSeriesView);
    expect(editPerms).toContain(PERMISSIONS.documents.numberingSeriesEdit);
  });

  it('does not match outside /app', () => {
    expect(matchRoutes(WORKSPACE_ROUTES, '/login')).toBeNull();
    expect(matchRoutes(WORKSPACE_ROUTES, '/')).toBeNull();
  });
});

describe('permission gates stayed inside the tree (§6.3 rule b, AR-21)', () => {
  it('document lists sit behind their backend permission', () => {
    expect(gatePermissions('/app/accounting/documents')).toContain(
      PERMISSIONS.accounting.documentView,
    );
  });

  it('draft routes keep their Create gate and detail routes the View gate', () => {
    expect(gatePermissions('/app/accounting/documents/new')).toContain(
      PERMISSIONS.accounting.documentCreate,
    );
    expect(gatePermissions('/app/accounting/documents/some-id-123')).toContain(
      PERMISSIONS.accounting.documentView,
    );
  });

  it('administration routes keep the RBAC gate', () => {
    const permissions = gatePermissions('/app/admin/users');
    expect(permissions).not.toBeNull();
    expect(permissions!.length).toBeGreaterThan(0);
  });

  it('inventory valuation-methods list requires Valuation.View and new requires only Valuation.Configure', () => {
    expect(gatePermissions('/app/inventory/valuation-methods')).toEqual([
      PERMISSIONS.inventory.valuationView,
    ]);
    expect(gatePermissions('/app/inventory/valuation-methods/new')).toEqual([
      PERMISSIONS.inventory.valuationConfigure,
    ]);
  });

  it('reservation list/detail use View and create uses only Create', () => {
    expect(gatePermissions('/app/inventory/reservations')).toEqual([
      PERMISSIONS.inventory.reservationView,
    ]);
    expect(gatePermissions('/app/inventory/reservations/rsv-1')).toEqual([
      PERMISSIONS.inventory.reservationView,
    ]);
    expect(gatePermissions('/app/inventory/reservations/new')).toEqual([
      PERMISSIONS.inventory.reservationCreate,
    ]);
  });

  it('material-request list/detail use View, create only Create, and edit View+Edit', () => {
    expect(gatePermissions('/app/inventory/material-requests')).toEqual([
      PERMISSIONS.inventory.materialRequestView,
    ]);
    expect(gatePermissions('/app/inventory/material-requests/mr-1')).toEqual([
      PERMISSIONS.inventory.materialRequestView,
    ]);
    expect(gatePermissions('/app/inventory/material-requests/new')).toEqual([
      PERMISSIONS.inventory.materialRequestCreate,
    ]);
    expect(
      allGatePermissions('/app/inventory/material-requests/mr-1/edit'),
    ).toEqual([
      PERMISSIONS.inventory.materialRequestView,
      PERMISSIONS.inventory.materialRequestEdit,
    ]);
  });

  it('the profile route needs no permission gate (session only)', () => {
    expect(gatePermissions('/app/profile')).toBeNull();
  });
});

describe('matchWorkspaceRoute — lenient deep-link predicate', () => {
  it('accepts real routes and the in-window 404 alike', () => {
    expect(matchWorkspaceRoute('/app')).toBe(true);
    expect(matchWorkspaceRoute('/app/accounting/documents')).toBe(true);
    expect(matchWorkspaceRoute('/app/inventory/movements/new')).toBe(true);
    // A live deep link to garbage still opens (showing the in-window 404),
    // exactly like the pre-window router did.
    expect(matchWorkspaceRoute('/app/deep/garbage')).toBe(true);
  });

  it('rejects paths outside /app', () => {
    expect(matchWorkspaceRoute('/login')).toBe(false);
    expect(matchWorkspaceRoute('/')).toBe(false);
    expect(matchWorkspaceRoute('/appx')).toBe(false);
  });
});

describe('matchRestorableWorkspaceRoute — strict restore predicate (FDR-01 §3.1)', () => {
  it('accepts real routes', () => {
    expect(matchRestorableWorkspaceRoute('/app')).toBe(true);
    expect(matchRestorableWorkspaceRoute('/app/accounting/documents')).toBe(
      true,
    );
    expect(matchRestorableWorkspaceRoute('/app/accounting/documents/new')).toBe(
      true,
    );
    // The DOC-01 index redirect and its leaves are restorable too.
    expect(matchRestorableWorkspaceRoute('/app/documents')).toBe(true);
    expect(matchRestorableWorkspaceRoute('/app/documents/types')).toBe(true);
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/valuation-methods'),
    ).toBe(true);
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/valuation-methods/new'),
    ).toBe(true);
    expect(matchRestorableWorkspaceRoute('/app/inventory/reservations')).toBe(
      true,
    );
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/reservations/new'),
    ).toBe(true);
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/reservations/rsv-1'),
    ).toBe(true);
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/material-requests'),
    ).toBe(true);
    expect(
      matchRestorableWorkspaceRoute('/app/inventory/material-requests/mr-1'),
    ).toBe(true);
    expect(
      matchRestorableWorkspaceRoute(
        '/app/inventory/material-requests/mr-1/edit',
      ),
    ).toBe(true);
  });

  it('rejects paths that only resolve through the * 404 leaf', () => {
    expect(matchRestorableWorkspaceRoute('/app/deep/garbage')).toBe(false);
    expect(matchRestorableWorkspaceRoute('/app/accounting/not-a-page')).toBe(
      false,
    );
  });

  it('rejects paths outside /app', () => {
    expect(matchRestorableWorkspaceRoute('/login')).toBe(false);
  });
});
