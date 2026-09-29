import { Navigate, Route, Routes } from 'react-router-dom';
import { AccountStatementPage } from '@/features/accounting/account-statement/account-statement-page';
import { AccountingHomePage } from '@/features/accounting/accounting-home-page';
import { ChartTreePage } from '@/features/accounting/chart-tree/chart-tree-page';
import { DocumentDetailPage } from '@/features/accounting/documents/document-detail-page';
import {
  DocumentCreatePage,
  DocumentEditPage,
} from '@/features/accounting/documents/document-form-page';
import { DocumentsPage } from '@/features/accounting/documents/documents-page';
import { GeneralLedgerPage } from '@/features/accounting/general-ledger/general-ledger-page';
import { AccountDetailPage } from '@/features/accounting/master-data/account-detail-page';
import { AccountingPeriodsPage } from '@/features/accounting/master-data/accounting-periods-page';
import { AccountsPage } from '@/features/accounting/master-data/accounts-page';
import { FinancialAreasPage } from '@/features/accounting/master-data/financial-areas-page';
import { FiscalYearsPage } from '@/features/accounting/master-data/fiscal-years-page';
import { TrialBalancePage } from '@/features/accounting/trial-balance/trial-balance-page';
import { LoginPage } from '@/features/auth/login-page';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { AppShell } from './layouts/app-shell';
import { DashboardRoute } from './routes/dashboard-route';
import { NotFoundPage } from './routes/not-found-page';
import { RequireAuth } from './routes/require-auth';
import { RequirePermission } from './routes/require-permission';

/**
 * Application routes.
 *
 * `/login` is the only public route; everything under `/app` requires an
 * authenticated session, and each accounting surface additionally sits behind
 * the backend permission of its endpoint (UX gating, AR-21). Any unknown path
 * lands on the 404 page.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route
            element={
              <RequirePermission
                permissions={[PERMISSIONS.accounting.documentView]}
              />
            }
          >
            <Route index element={<DashboardRoute />} />
          </Route>

          <Route path="accounting">
            <Route index element={<AccountingHomePage />} />

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.documentView]}
                />
              }
            >
              <Route path="documents" element={<DocumentsPage />} />
              <Route
                path="documents/:documentId"
                element={<DocumentDetailPage />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.accounting.documentEdit]}
                  />
                }
              >
                <Route
                  path="documents/:documentId/edit"
                  element={<DocumentEditPage />}
                />
              </Route>
            </Route>

            {/*
              `POST /accounting-documents` enforces exactly
              `Accounting.Document.Create` (accounting-documents.controller.ts)
              — it does not require `Accounting.Document.View`. Composing the
              create route as a sibling of the View-gated group (rather than
              nesting it inside), keeps the frontend gate aligned with that
              backend contract: a Create-only principal is never blocked here.
            */}
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.documentCreate]}
                />
              }
            >
              <Route path="documents/new" element={<DocumentCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.financialAreaView]}
                />
              }
            >
              <Route path="financial-areas" element={<FinancialAreasPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.fiscalYearView]}
                />
              }
            >
              <Route path="fiscal-years" element={<FiscalYearsPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.accountingPeriodView]}
                />
              }
            >
              <Route path="periods" element={<AccountingPeriodsPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.accountView]}
                />
              }
            >
              <Route path="chart" element={<ChartTreePage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route
                path="accounts/:accountId"
                element={<AccountDetailPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.accountStatementView]}
                />
              }
            >
              <Route
                path="account-statements"
                element={<AccountStatementPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.generalLedgerView]}
                />
              }
            >
              <Route path="general-ledger" element={<GeneralLedgerPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.trialBalanceView]}
                />
              }
            >
              <Route path="trial-balance" element={<TrialBalancePage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
