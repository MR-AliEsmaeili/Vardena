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
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { InventoryDocumentDetailPage } from '@/features/inventory/documents/inventory-document-detail-page';
import { InventoryDocumentFormPage } from '@/features/inventory/documents/inventory-document-form-page';
import { InventoryDocumentsPage } from '@/features/inventory/documents/inventory-documents-page';
import { InventoryHomePage } from '@/features/inventory/inventory-home-page';
import { KardexPage } from '@/features/inventory/kardex-page';
import { MovementFormPage } from '@/features/inventory/movement-form-page';
import { MovementsPage } from '@/features/inventory/movements-page';
import { ValuationStatesPage } from '@/features/inventory/valuation-states-page';
import { TransferFormPage } from '@/features/inventory/transfer-form-page';
import { BranchDetailPage } from '@/features/organization/admin/branches/branch-detail-page';
import {
  BranchCreatePage,
  BranchEditPage,
} from '@/features/organization/admin/branches/branch-form-page';
import { BranchesPage } from '@/features/organization/admin/branches/branches-page';
import { DepartmentDetailPage } from '@/features/organization/admin/departments/department-detail-page';
import {
  DepartmentCreatePage,
  DepartmentEditPage,
} from '@/features/organization/admin/departments/department-form-page';
import { DepartmentsPage } from '@/features/organization/admin/departments/departments-page';
import { EmployeeDetailPage } from '@/features/organization/admin/employees/employee-detail-page';
import {
  EmployeeCreatePage,
  EmployeeEditPage,
} from '@/features/organization/admin/employees/employee-form-page';
import { EmployeesPage } from '@/features/organization/admin/employees/employees-page';
import { OrganizationAdminHomePage } from '@/features/organization/admin/organization-admin-home-page';
import { OrganizationProfilePage } from '@/features/organization/admin/organization-profile-page';
import { PartiesPage } from '@/features/organization/admin/parties/parties-page';
import { PartyDetailPage } from '@/features/organization/admin/parties/party-detail-page';
import {
  PartyCreatePage,
  PartyEditPage,
} from '@/features/organization/admin/parties/party-form-page';
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
      <Route path="/change-password" element={<ChangePasswordPage />} />

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

          {/*
            Organization & master-data administration (FE-ORG-01).

            Each group is gated by the exact permission its endpoints
            enforce (`backend/src/modules/organization/domain/
            organization-permissions.ts`). Two shapes matter:

            - `…/new` is a SIBLING of the View-gated group, because
              `POST /branches|departments|employees|parties` enforces only
              `*.Create` — a Create-only principal must not be blocked;
            - `…/:id/edit` requires View **and** Edit, because the edit
              screen first reads the record (`GET /…/:id`, `*.View`) before
              it can submit the change (`PATCH /…/:id`, `*.Edit`).

            There is no delete route anywhere: the organization module
            exposes no DELETE endpoint (lifecycle = enable/disable).
          */}
          <Route path="organization">
            <Route index element={<OrganizationAdminHomePage />} />

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.view]}
                />
              }
            >
              <Route path="profile" element={<OrganizationProfilePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.branchView]}
                />
              }
            >
              <Route path="branches" element={<BranchesPage />} />
              <Route path="branches/:branchId" element={<BranchDetailPage />} />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.organization.branchEdit]}
                  />
                }
              >
                <Route
                  path="branches/:branchId/edit"
                  element={<BranchEditPage />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.branchCreate]}
                />
              }
            >
              <Route path="branches/new" element={<BranchCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.departmentView]}
                />
              }
            >
              <Route path="departments" element={<DepartmentsPage />} />
              <Route
                path="departments/:departmentId"
                element={<DepartmentDetailPage />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.organization.departmentEdit]}
                  />
                }
              >
                <Route
                  path="departments/:departmentId/edit"
                  element={<DepartmentEditPage />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.departmentCreate]}
                />
              }
            >
              <Route
                path="departments/new"
                element={<DepartmentCreatePage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.employeeView]}
                />
              }
            >
              <Route path="employees" element={<EmployeesPage />} />
              <Route
                path="employees/:employeeId"
                element={<EmployeeDetailPage />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.organization.employeeEdit]}
                  />
                }
              >
                <Route
                  path="employees/:employeeId/edit"
                  element={<EmployeeEditPage />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.employeeCreate]}
                />
              }
            >
              <Route path="employees/new" element={<EmployeeCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.partyView]}
                />
              }
            >
              <Route path="parties" element={<PartiesPage />} />
              <Route path="parties/:partyId" element={<PartyDetailPage />} />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.organization.partyEdit]}
                  />
                }
              >
                <Route
                  path="parties/:partyId/edit"
                  element={<PartyEditPage />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.organization.partyCreate]}
                />
              }
            >
              <Route path="parties/new" element={<PartyCreatePage />} />
            </Route>
          </Route>

          {/*
            Inventory — warehouse operations & valuation (the vertical slice
            over `backend/src/modules/inventory`).

            Route gates mirror the EXACT permissions the gated endpoints
            enforce (UX only, AR-21; the backend re-authorizes every call):

            - the posting forms sit behind their CREATE code only, because
              `POST /inventory/movements|transfers` enforces exactly that —
              a Create-only principal must not be blocked by a View gate;
            - the ledger/Kardex reads sit behind `Inventory.Movement.View`
              (the permission both controllers enforce);
            - the valuation worklist sits behind `Inventory.Valuation.View`.

            Licensing needs no separate gate: an installation without the
            `inventory` module entitlement gets every `Inventory.*` code
            filtered from the effective permission set server-side, so these
            routes stay blocked exactly like the navigation entries.
          */}
          <Route path="inventory">
            <Route index element={<InventoryHomePage />} />

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.movementView]}
                />
              }
            >
              <Route path="movements" element={<MovementsPage />} />
              <Route path="kardex" element={<KardexPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.movementCreate]}
                />
              }
            >
              <Route path="movements/new" element={<MovementFormPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.transferCreate]}
                />
              }
            >
              <Route path="transfers/new" element={<TransferFormPage />} />
            </Route>

            {/*
              Business documents (C-58). The list/detail gate is the document
              VIEW code; the create/edit routes sit behind their own codes,
              because a principal allowed to draft a document is not thereby
              allowed to finalize it — the lifecycle commands are authorized
              individually, server-side, on every call.
            */}
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.documentView]}
                />
              }
            >
              <Route path="documents" element={<InventoryDocumentsPage />} />
              <Route
                path="documents/:documentId"
                element={<InventoryDocumentDetailPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.documentCreate]}
                />
              }
            >
              <Route
                path="documents/new"
                element={<InventoryDocumentFormPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.documentEdit]}
                />
              }
            >
              <Route
                path="documents/:documentId/edit"
                element={<InventoryDocumentFormPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.valuationView]}
                />
              }
            >
              <Route path="valuation" element={<ValuationStatesPage />} />
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
