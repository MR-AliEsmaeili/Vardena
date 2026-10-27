import { Navigate, Route, Routes } from 'react-router-dom';
import { AccountStatementPage } from '@/features/accounting/account-statement/account-statement-page';
import { AccountingHomePage } from '@/features/accounting/accounting-home-page';
import { ChartTreePage } from '@/features/accounting/chart-tree/chart-tree-page';
import { DocumentDetailPage } from '@/features/accounting/documents/document-detail-page';
import {
  DocumentCreatePage,
  DocumentEditPage,
} from '@/features/accounting/documents/document-form-page';
import { AccountingDocumentLinesPage } from '@/features/accounting/documents/document-lines-page';
import { DocumentsPage } from '@/features/accounting/documents/documents-page';
import { GeneralLedgerPage } from '@/features/accounting/general-ledger/general-ledger-page';
import { AccountDetailPage } from '@/features/accounting/master-data/account-detail-page';
import { AccountEditPage } from '@/features/accounting/master-data/account-edit-page';
import { AccountCreatePage } from '@/features/accounting/master-data/account-create-page';
import { AccountingPeriodsPage } from '@/features/accounting/master-data/accounting-periods-page';
import { AccountingPeriodFormPage } from '@/features/accounting/master-data/accounting-period-form-page';
import { AccountsPage } from '@/features/accounting/master-data/accounts-page';
import { ConfigurationDetailPage } from '@/features/accounting/configuration/configuration-detail-page';
import { ConfigurationFormPage } from '@/features/accounting/configuration/configuration-form-page';
import { ConfigurationListPage } from '@/features/accounting/configuration/configuration-list-page';
import {
  DetailsListPage,
  DetailFormPage,
} from '@/features/accounting/details/details-admin-page';
import {
  StructureDetailPage,
  StructureFormPage,
  StructureListPage,
} from '@/features/accounting/structures/structure-admin-page';
import { FinancialAreaFormPage } from '@/features/accounting/master-data/financial-area-form-page';
import { FinancialAreasPage } from '@/features/accounting/master-data/financial-areas-page';
import { FiscalYearsPage } from '@/features/accounting/master-data/fiscal-years-page';
import { FiscalYearFormPage } from '@/features/accounting/master-data/fiscal-year-form-page';
import { TrialBalancePage } from '@/features/accounting/trial-balance/trial-balance-page';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { ProfilePage } from '@/features/auth/profile-page';
import { InventoryDocumentDetailPage } from '@/features/inventory/documents/inventory-document-detail-page';
import { InventoryDocumentFormPage } from '@/features/inventory/documents/inventory-document-form-page';
import { InventoryDocumentLinesPage } from '@/features/inventory/documents/inventory-document-lines-page';
import { InventoryDocumentsPage } from '@/features/inventory/documents/inventory-documents-page';
import { InventoryHomePage } from '@/features/inventory/inventory-home-page';
import { BalancesPage } from '@/features/inventory/master-data/balances/balances-page';
import { ItemGroupDetailPage } from '@/features/inventory/master-data/item-groups/item-group-detail-page';
import {
  ItemGroupCreatePage,
  ItemGroupEditPage,
} from '@/features/inventory/master-data/item-groups/item-group-form-page';
import { ItemGroupsPage } from '@/features/inventory/master-data/item-groups/item-groups-page';
import { ItemDetailPage } from '@/features/inventory/master-data/items/item-detail-page';
import {
  ItemCreatePage,
  ItemEditPage,
} from '@/features/inventory/master-data/items/item-form-page';
import { ItemsPage } from '@/features/inventory/master-data/items/items-page';
import { UnitConversionCreatePage } from '@/features/inventory/master-data/unit-conversions/unit-conversion-create-page';
import { UnitConversionsPage } from '@/features/inventory/master-data/unit-conversions/unit-conversions-page';
import { UnitDetailPage } from '@/features/inventory/master-data/units/unit-detail-page';
import {
  UnitCreatePage,
  UnitEditPage,
} from '@/features/inventory/master-data/units/unit-form-page';
import { UnitsPage } from '@/features/inventory/master-data/units/units-page';
import { WarehouseDetailPage } from '@/features/inventory/master-data/warehouses/warehouse-detail-page';
import {
  WarehouseCreatePage,
  WarehouseEditPage,
} from '@/features/inventory/master-data/warehouses/warehouse-form-page';
import { WarehousesPage } from '@/features/inventory/master-data/warehouses/warehouses-page';
import { ClientDevicesPage } from '@/features/licensing/client-devices-page';
import { DocumentTypeDetailPage } from '@/features/documents/document-types/document-type-detail-page';
import { DocumentTypesPage } from '@/features/documents/document-types/document-types-page';
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
import { MembersPage } from '@/features/organization/admin/members/members-page';
import { RoleCreatePage } from '@/features/administration/roles/role-create-page';
import { RoleDetailPage } from '@/features/administration/roles/role-detail-page';
import { RoleEditPage } from '@/features/administration/roles/role-edit-page';
import { RolesPage } from '@/features/administration/roles/roles-page';
import { UserCreatePage } from '@/features/administration/users/user-create-page';
import { UserDetailPage } from '@/features/administration/users/user-detail-page';
import { UserEditPage } from '@/features/administration/users/user-edit-page';
import { UsersPage } from '@/features/administration/users/users-page';
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
          <Route index element={<DashboardRoute />} />
          <Route path="profile" element={<ProfilePage />} />

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
                path="document-lines"
                element={<AccountingDocumentLinesPage />}
              />
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
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.accounting.financialAreaEdit]}
                  />
                }
              >
                <Route
                  path="financial-areas/:financialAreaId/edit"
                  element={<FinancialAreaFormPage mode="edit" />}
                />
              </Route>
            </Route>

            {/*
              `POST /financial-areas` enforces exactly
              `Accounting.FinancialArea.Create` — it does not require
              `Accounting.FinancialArea.View`. The create route is therefore
              a SIBLING of the View-gated group above, never nested inside
              it, so a Create-only principal is not blocked here (ACC-01).
            */}
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.financialAreaCreate]}
                />
              }
            >
              <Route
                path="financial-areas/new"
                element={<FinancialAreaFormPage mode="create" />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.fiscalYearView]}
                />
              }
            >
              <Route path="fiscal-years" element={<FiscalYearsPage />} />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.accounting.fiscalYearEdit]}
                  />
                }
              >
                <Route
                  path="fiscal-years/:fiscalYearId/edit"
                  element={<FiscalYearFormPage mode="edit" />}
                />
              </Route>
            </Route>

            {/* Fiscal-year creation is authorized independently of View. */}
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.fiscalYearCreate]}
                />
              }
            >
              <Route
                path="fiscal-years/new"
                element={<FiscalYearFormPage mode="create" />}
              />
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
                  permissions={[PERMISSIONS.accounting.accountingPeriodOpen]}
                />
              }
            >
              <Route
                path="periods/new"
                element={<AccountingPeriodFormPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.accounting.accountingConfigurationView,
                  ]}
                />
              }
            >
              <Route
                path="configurations"
                element={<ConfigurationListPage />}
              />
              <Route
                path="configurations/:configurationId"
                element={<ConfigurationDetailPage />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[
                      PERMISSIONS.accounting.accountingConfigurationConfigure,
                    ]}
                  />
                }
              >
                <Route
                  path="configurations/:configurationId/edit"
                  element={<ConfigurationFormPage mode="edit" />}
                />
              </Route>
            </Route>

            {/*
              `POST /accounting-configurations` enforces exactly
              `Accounting.AccountingConfiguration.Configure` and does not
              require `.View`, so the create route is a SIBLING of the
              View-gated group (ACC-06) — a Configure-only principal is never
              blocked here.
            */}
            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.accounting.accountingConfigurationConfigure,
                  ]}
                />
              }
            >
              <Route
                path="configurations/new"
                element={<ConfigurationFormPage mode="create" />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.detailView]}
                />
              }
            >
              <Route path="details" element={<DetailsListPage />} />
              <Route
                path="details/:detailId"
                element={<DetailFormPage mode="view" />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.accounting.detailEdit]}
                  />
                }
              >
                <Route
                  path="details/:detailId/edit"
                  element={<DetailFormPage mode="edit" />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.detailCreate]}
                />
              }
            >
              <Route
                path="details/new"
                element={<DetailFormPage mode="create" />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.codingStructureView]}
                />
              }
            >
              <Route
                path="coding-structures"
                element={<StructureListPage kind="coding" />}
              />
              <Route
                path="coding-structures/:structureId"
                element={<StructureDetailPage kind="coding" />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[
                      PERMISSIONS.accounting.codingStructureConfigure,
                    ]}
                  />
                }
              >
                <Route
                  path="coding-structures/:structureId/edit"
                  element={<StructureFormPage kind="coding" mode="edit" />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.accounting.codingStructureConfigure,
                  ]}
                />
              }
            >
              <Route
                path="coding-structures/new"
                element={<StructureFormPage kind="coding" mode="create" />}
              />
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.detailStructureView]}
                />
              }
            >
              <Route
                path="detail-structures"
                element={<StructureListPage kind="detail" />}
              />
              <Route
                path="detail-structures/:structureId"
                element={<StructureDetailPage kind="detail" />}
              />
              <Route
                element={
                  <RequirePermission
                    permissions={[
                      PERMISSIONS.accounting.detailStructureConfigure,
                    ]}
                  />
                }
              >
                <Route
                  path="detail-structures/:structureId/edit"
                  element={<StructureFormPage kind="detail" mode="edit" />}
                />
              </Route>
            </Route>
            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.accounting.detailStructureConfigure,
                  ]}
                />
              }
            >
              <Route
                path="detail-structures/new"
                element={<StructureFormPage kind="detail" mode="create" />}
              />
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
              <Route
                element={
                  <RequirePermission
                    permissions={[PERMISSIONS.accounting.accountEdit]}
                  />
                }
              >
                <Route
                  path="accounts/:accountId/edit"
                  element={<AccountEditPage />}
                />
              </Route>
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.accounting.accountCreate]}
                />
              }
            >
              <Route path="accounts/new" element={<AccountCreatePage />} />
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
                  permissions={[PERMISSIONS.organization.membershipView]}
                />
              }
            >
              <Route path="members" element={<MembersPage />} />
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
                path="document-lines"
                element={<InventoryDocumentLinesPage />}
              />
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

            {/*
              Inventory master data (master-data-strategy.md §3). Every list
              and detail route is gated by the resource's own VIEW code and
              every create/edit route by its CREATE/EDIT code — the exact
              codes the controllers require. The edit routes need VIEW as
              well because the form loads the record first. Unit conversions
              have no edit route at all: versions are immutable and a change
              is a new effective-dated version (ADR-0020 §4). Balances are a
              read-time projection — list only.
            */}
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.itemView]}
                />
              }
            >
              <Route path="items" element={<ItemsPage />} />
              <Route path="items/:itemId" element={<ItemDetailPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.itemCreate]}
                />
              }
            >
              <Route path="items/new" element={<ItemCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.inventory.itemView,
                    PERMISSIONS.inventory.itemEdit,
                  ]}
                />
              }
            >
              <Route path="items/:itemId/edit" element={<ItemEditPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.itemGroupView]}
                />
              }
            >
              <Route path="item-groups" element={<ItemGroupsPage />} />
              <Route
                path="item-groups/:itemGroupId"
                element={<ItemGroupDetailPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.itemGroupCreate]}
                />
              }
            >
              <Route path="item-groups/new" element={<ItemGroupCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.inventory.itemGroupView,
                    PERMISSIONS.inventory.itemGroupEdit,
                  ]}
                />
              }
            >
              <Route
                path="item-groups/:itemGroupId/edit"
                element={<ItemGroupEditPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.unitView]}
                />
              }
            >
              <Route path="units" element={<UnitsPage />} />
              <Route path="units/:unitId" element={<UnitDetailPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.unitCreate]}
                />
              }
            >
              <Route path="units/new" element={<UnitCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.inventory.unitView,
                    PERMISSIONS.inventory.unitEdit,
                  ]}
                />
              }
            >
              <Route path="units/:unitId/edit" element={<UnitEditPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.warehouseView]}
                />
              }
            >
              <Route path="warehouses" element={<WarehousesPage />} />
              <Route
                path="warehouses/:warehouseId"
                element={<WarehouseDetailPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.warehouseCreate]}
                />
              }
            >
              <Route path="warehouses/new" element={<WarehouseCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.inventory.warehouseView,
                    PERMISSIONS.inventory.warehouseEdit,
                  ]}
                />
              }
            >
              <Route
                path="warehouses/:warehouseId/edit"
                element={<WarehouseEditPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.unitConversionView]}
                />
              }
            >
              <Route
                path="unit-conversions"
                element={<UnitConversionsPage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.unitConversionCreate]}
                />
              }
            >
              <Route
                path="unit-conversions/new"
                element={<UnitConversionCreatePage />}
              />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.inventory.balanceView]}
                />
              }
            >
              <Route path="balances" element={<BalancesPage />} />
            </Route>
          </Route>

          <Route
            path="licensing/devices"
            element={
              <RequirePermission
                permissions={[PERMISSIONS.licensing.deviceView]}
              />
            }
          >
            <Route index element={<ClientDevicesPage />} />
          </Route>

          {/*
            Document Foundation (DOC-01). Both surfaces are reads of the
            backend's CODE registry plus the organization's configuration;
            the single write (`PUT …/configuration`) lives on the detail page.
            There is no create/delete route: the controller has no POST/DELETE.
          */}
          <Route path="documents">
            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.documents.documentTypeView]}
                />
              }
            >
              {/* A bare /app/documents must not render an empty shell. */}
              <Route index element={<Navigate to="types" replace />} />
              <Route path="types" element={<DocumentTypesPage />} />
              <Route path="types/:code" element={<DocumentTypeDetailPage />} />
            </Route>
          </Route>

          {/*
            System administration: user accounts and roles.

            Same shapes as the organization groups: `…/new` is a sibling of
            the View-gated group (the POST enforces only `*.Create`), and
            `…/:id/edit` requires View **and** Edit (the edit screen first
            reads the record). The password reset and enable/disable
            operations live ON the user detail page, gated per operation.
          */}
          <Route path="admin">
            <Route
              element={
                <RequirePermission permissions={[PERMISSIONS.users.view]} />
              }
            >
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:userId" element={<UserDetailPage />} />
            </Route>

            <Route
              element={
                <RequirePermission permissions={[PERMISSIONS.users.create]} />
              }
            >
              <Route path="users/new" element={<UserCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.users.view, PERMISSIONS.users.edit]}
                />
              }
            >
              <Route path="users/:userId/edit" element={<UserEditPage />} />
            </Route>

            <Route
              element={
                <RequirePermission permissions={[PERMISSIONS.rbac.roleView]} />
              }
            >
              <Route path="roles" element={<RolesPage />} />
              <Route path="roles/:roleId" element={<RoleDetailPage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[PERMISSIONS.rbac.roleCreate]}
                />
              }
            >
              <Route path="roles/new" element={<RoleCreatePage />} />
            </Route>

            <Route
              element={
                <RequirePermission
                  permissions={[
                    PERMISSIONS.rbac.roleView,
                    PERMISSIONS.rbac.roleEdit,
                  ]}
                />
              }
            >
              <Route path="roles/:roleId/edit" element={<RoleEditPage />} />
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
