import { Navigate, Route, Routes } from 'react-router-dom';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { AppShell } from './layouts/app-shell';
import { RequireAuth } from './routes/require-auth';
import { workspaceRouteTree } from './routes/workspace-route-tree';

/**
 * Application routes.
 *
 * `/login` is the only public route; everything under `/app` requires an
 * authenticated session, and each accounting surface additionally sits behind
 * the backend permission of its endpoint (UX gating, AR-21). Any unknown path
 * lands on the 404 page.
 *
 * ADR-0054: `router.tsx` keeps ONLY the `/app` shell. The full subtree lives
 * in `routes/workspace-route-tree.tsx`; registering it here makes deep-link
 * and refresh URLs resolve to `AppShell`, while the pages themselves render
 * inside workspace windows (each under its own `MemoryRouter`) — `AppShell`
 * no longer renders an `<Outlet />`.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          {workspaceRouteTree}
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
