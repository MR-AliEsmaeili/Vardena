import { lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import { FullPageLoading } from '@/ui/patterns/states';

/**
 * The Dashboard page, route-level lazy (FR-14: every route is lazy; the
 * chart primitives lazy-load one level further inside the page).
 *
 * `router.tsx` composes this element inside `<RequireAuth>` and a
 * `<RequirePermission permissions={[PERMISSIONS.accounting.documentView]}>`
 * route element — the same composition the other guarded surfaces use. The
 * permission boundary matters because the page's primary table is the
 * recent-documents read surface; every widget additionally gates its own
 * query on its own backend permission, so narrower sessions still see the
 * remaining widgets (AR-21: UX gating only, the backend authorizes every
 * request).
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({
    default: m.DashboardPage,
  })),
);

/** The `/app` index route element: the Vardena Dashboard. */
export function DashboardRoute(): ReactElement {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <DashboardPage />
    </Suspense>
  );
}
