import { Navigate, Route, Routes } from 'react-router-dom';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { CustomersPage } from '@/features/customers/customers-page';
import { CustomerPage } from '@/features/customers/customer-page';
import { UsersPage } from '@/features/users/users-page';
import { AuditPage } from '@/features/audit/audit-page';
import { AppShell, OwnerHome, LifecyclePage } from './layouts/app-shell';
import { NotFoundPage } from './routes/not-found-page';
import { RequireAuth } from './routes/require-auth';
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<OwnerHome />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/new" element={<CustomerPage mode="new" />} />
          <Route
            path="customers/:id"
            element={<CustomerPage mode="detail" />}
          />
          <Route
            path="customers/:id/edit"
            element={<CustomerPage mode="edit" />}
          />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="lifecycle" element={<LifecyclePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
