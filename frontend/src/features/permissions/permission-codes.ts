/**
 * Permission codes the UI reacts to.
 *
 * Every code below is copied from the backend permission REGISTRY — the only
 * place codes may be defined (AR-22, `docs/security.md` §3):
 * - `backend/src/modules/accounting/domain/accounting-permissions.ts`
 * - `backend/src/modules/organization/domain/organization-permissions.ts`
 * - `backend/src/modules/inventory/domain/inventory-permissions.ts`
 *   and `inventory-core-permissions.ts` / `inventory-valuation-permissions.ts`
 * - `backend/src/modules/documents/domain/document-permissions.ts`
 *
 * No wildcard, no superuser, no invented code: an entry that no backend
 * endpoint enforces must not exist here either. These checks are UX only —
 * the backend authorizes every request (AR-21, ADR-0006).
 *
 * Document lifecycle codes (`Accounting.Document.*`) are the five codes the
 * `AccountingDocumentsController` actually enforces: `View` (list/get),
 * `Create` (compose), `Edit` (edit + issue), `Delete` (discard draft or
 * temporary) and `Finalize`/`Reverse` (the lifecycle transitions).
 */
export const PERMISSIONS = {
  /**
   * Installation licensing and retained client devices
   * (`backend/src/modules/licensing/domain/licensing-permissions.ts`). Exact
   * codes authorize license activation and each device lifecycle operation;
   * `GET /api/v1/license/current` remains an authenticated self-read with no
   * permission (ADR-0030).
   *
   * Like every entry here it is a UX check only (AR-21): the backend
   * re-authorizes activation, and holding an administrative role is NOT a
   * license bypass — an installation without an active license stays blocked
   * for every user, administrator or not.
   */
  licensing: {
    licenseActivate: 'Licensing.License.Activate',
    /**
     * Import a signed revocation artifact (OD-LIC-17). A distinct act from
     * activation: the backend route requires this exact code and re-checks it,
     * so the UI check only decides whether the surface is offered.
     */
    licenseRevoke: 'Licensing.License.Revoke',
    deviceView: 'Licensing.Device.View',
    deviceActivate: 'Licensing.Device.Activate',
    deviceDeactivate: 'Licensing.Device.Deactivate',
    deviceReplace: 'Licensing.Device.Replace',
    deviceCancelReplacement: 'Licensing.Device.CancelReplacement',
    deviceCompleteReplacement: 'Licensing.Device.CompleteReplacement',
  },
  organization: {
    view: 'Organization.Organization.View',
    create: 'Organization.Organization.Create',
    edit: 'Organization.Organization.Edit',
    enable: 'Organization.Organization.Enable',
    disable: 'Organization.Organization.Disable',

    branchView: 'Organization.Branch.View',
    branchCreate: 'Organization.Branch.Create',
    branchEdit: 'Organization.Branch.Edit',
    branchEnable: 'Organization.Branch.Enable',
    branchDisable: 'Organization.Branch.Disable',

    departmentView: 'Organization.Department.View',
    departmentCreate: 'Organization.Department.Create',
    departmentEdit: 'Organization.Department.Edit',
    departmentEnable: 'Organization.Department.Enable',
    departmentDisable: 'Organization.Department.Disable',

    employeeView: 'Organization.Employee.View',
    employeeCreate: 'Organization.Employee.Create',
    employeeEdit: 'Organization.Employee.Edit',
    employeeEnable: 'Organization.Employee.Enable',
    employeeDisable: 'Organization.Employee.Disable',

    partyView: 'Organization.Party.View',
    partyCreate: 'Organization.Party.Create',
    partyEdit: 'Organization.Party.Edit',
    partyEnable: 'Organization.Party.Enable',
    partyDisable: 'Organization.Party.Disable',

    membershipView: 'Organization.Membership.View',
    membershipGrant: 'Organization.Membership.Grant',
    membershipRevoke: 'Organization.Membership.Revoke',
  },
  /**
   * User account administration
   * (`backend/src/modules/users/domain/user-permissions.ts`). There is
   * deliberately no `Users.User.Delete` — the backend registers no such code
   * and offers no delete endpoint.
   */
  users: {
    view: 'Users.User.View',
    create: 'Users.User.Create',
    edit: 'Users.User.Edit',
    enable: 'Users.User.Enable',
    disable: 'Users.User.Disable',
    resetPassword: 'Users.User.ResetPassword',
  },
  /**
   * Role administration and the permission registry
   * (`backend/src/modules/rbac/domain/rbac-permissions.ts`).
   */
  rbac: {
    permissionView: 'Rbac.Permission.View',
    roleView: 'Rbac.Role.View',
    roleCreate: 'Rbac.Role.Create',
    roleEdit: 'Rbac.Role.Edit',
    rolePermissionAssign: 'Rbac.RolePermission.Assign',
    rolePermissionRemove: 'Rbac.RolePermission.Remove',
    userRoleAssign: 'Rbac.UserRole.Assign',
    userRoleRemove: 'Rbac.UserRole.Remove',
  },
  accounting: {
    accountView: 'Accounting.Account.View',
    financialAreaView: 'Accounting.FinancialArea.View',
    financialAreaCreate: 'Accounting.FinancialArea.Create',
    financialAreaEdit: 'Accounting.FinancialArea.Edit',
    financialAreaEnable: 'Accounting.FinancialArea.Enable',
    financialAreaDisable: 'Accounting.FinancialArea.Disable',
    fiscalYearView: 'Accounting.FiscalYear.View',
    fiscalYearCreate: 'Accounting.FiscalYear.Create',
    fiscalYearEdit: 'Accounting.FiscalYear.Edit',
    fiscalYearClose: 'Accounting.FiscalYear.Close',
    fiscalYearReopen: 'Accounting.FiscalYear.Reopen',
    fiscalYearSeal: 'Accounting.FiscalYear.Seal',
    fiscalYearUnseal: 'Accounting.FiscalYear.Unseal',
    accountingPeriodView: 'Accounting.AccountingPeriod.View',
    accountingPeriodOpen: 'Accounting.AccountingPeriod.Open',
    accountingPeriodClose: 'Accounting.AccountingPeriod.Close',
    accountingPeriodReopen: 'Accounting.AccountingPeriod.Reopen',
    accountingPeriodSeal: 'Accounting.AccountingPeriod.Seal',
    accountCreate: 'Accounting.Account.Create',
    accountEdit: 'Accounting.Account.Edit',
    accountEnable: 'Accounting.Account.Enable',
    accountDisable: 'Accounting.Account.Disable',
    accountUnlinkDetailGroup: 'Accounting.Account.UnlinkDetailGroup',
    codingStructureView: 'Accounting.CodingStructure.View',
    codingStructureConfigure: 'Accounting.CodingStructure.Configure',
    detailStructureView: 'Accounting.DetailStructure.View',
    detailStructureConfigure: 'Accounting.DetailStructure.Configure',
    detailCreate: 'Accounting.Detail.Create',
    detailEdit: 'Accounting.Detail.Edit',
    detailEnable: 'Accounting.Detail.Enable',
    detailDisable: 'Accounting.Detail.Disable',
    accountingConfigurationView: 'Accounting.AccountingConfiguration.View',
    accountingConfigurationConfigure:
      'Accounting.AccountingConfiguration.Configure',
    accountStatementView: 'Accounting.AccountStatement.View',
    generalLedgerView: 'Accounting.GeneralLedger.View',
    trialBalanceView: 'Accounting.TrialBalance.View',
    documentView: 'Accounting.Document.View',
    documentCreate: 'Accounting.Document.Create',
    documentEdit: 'Accounting.Document.Edit',
    documentDelete: 'Accounting.Document.Delete',
    documentFinalize: 'Accounting.Document.Finalize',
    documentReverse: 'Accounting.Document.Reverse',
    detailView: 'Accounting.Detail.View',
    balanceView: 'Accounting.Balance.View',
  },
  inventory: {
    balanceView: 'Inventory.Balance.View',

    // Master-data reads the warehouse operations UI needs for its pickers
    // (`backend/src/modules/inventory/domain/inventory-permissions.ts`).
    itemView: 'Inventory.Item.View',
    warehouseView: 'Inventory.Warehouse.View',
    unitView: 'Inventory.Unit.View',

    // Master-data administration — each lifecycle mirrors the backend
    // registry exactly: five codes per entity except UnitConversion, which
    // has only View+Create because conversions are effective-dated versions
    // that are never edited in place (ADR-0020 §4).
    itemCreate: 'Inventory.Item.Create',
    itemEdit: 'Inventory.Item.Edit',
    itemEnable: 'Inventory.Item.Enable',
    itemDisable: 'Inventory.Item.Disable',

    itemGroupView: 'Inventory.ItemGroup.View',
    itemGroupCreate: 'Inventory.ItemGroup.Create',
    itemGroupEdit: 'Inventory.ItemGroup.Edit',
    itemGroupEnable: 'Inventory.ItemGroup.Enable',
    itemGroupDisable: 'Inventory.ItemGroup.Disable',

    unitCreate: 'Inventory.Unit.Create',
    unitEdit: 'Inventory.Unit.Edit',
    unitEnable: 'Inventory.Unit.Enable',
    unitDisable: 'Inventory.Unit.Disable',

    unitConversionView: 'Inventory.UnitConversion.View',
    unitConversionCreate: 'Inventory.UnitConversion.Create',

    warehouseCreate: 'Inventory.Warehouse.Create',
    warehouseEdit: 'Inventory.Warehouse.Edit',
    warehouseEnable: 'Inventory.Warehouse.Enable',
    warehouseDisable: 'Inventory.Warehouse.Disable',

    // Movement ledger (post/read), transfers and reservation lifecycle
    // (`inventory-core-permissions.ts`).
    movementView: 'Inventory.Movement.View',
    movementCreate: 'Inventory.Movement.Create',
    movementReverse: 'Inventory.Movement.Reverse',
    transferCreate: 'Inventory.Transfer.Create',
    reservationView: 'Inventory.Reservation.View',
    reservationCreate: 'Inventory.Reservation.Create',
    reservationRelease: 'Inventory.Reservation.Release',

    // Business documents — receipt / issue / transfer (C-58,
    // `inventory-document-permissions.ts`). These authorize the DOCUMENT
    // operation only: finalize and cancel additionally require the ledger
    // authority above, exactly as the backend enforces it.
    documentView: 'Inventory.Document.View',
    documentCreate: 'Inventory.Document.Create',
    documentEdit: 'Inventory.Document.Edit',
    documentDelete: 'Inventory.Document.Delete',
    documentFinalize: 'Inventory.Document.Finalize',
    documentAccountingPost: 'Inventory.Document.AccountingPost',
    documentSeal: 'Inventory.Document.Seal',
    documentCancel: 'Inventory.Document.Cancel',

    // Valuation workspace (`inventory-valuation-permissions.ts`).
    valuationView: 'Inventory.Valuation.View',
    valuationConfigure: 'Inventory.Valuation.Configure',
    valuationAssignCost: 'Inventory.Valuation.AssignCost',
    valuationRecalculate: 'Inventory.Valuation.Recalculate',
  },
  workflow: {
    instanceView: 'Workflow.Instance.View',
  },
  /**
   * Document Foundation (`document-permissions.ts`, DOC-01/DOC-02). The four
   * additional codes below are the exact permissions
   * `NumberingSeriesController` and the `GET :id/allocations` handler enforce
   * (DOC-02): there is deliberately no generic `Document.*` code — the backend
   * has no such permission and no `POST /documents` endpoint.
   */
  documents: {
    documentTypeView: 'Document.DocumentType.View',
    documentTypeConfigure: 'Document.DocumentType.Configure',
    numberingSeriesView: 'Document.NumberingSeries.View',
    numberingSeriesCreate: 'Document.NumberingSeries.Create',
    numberingSeriesEdit: 'Document.NumberingSeries.Edit',
    numberingAllocationView: 'Document.Numbering.View',
  },
} as const;

export type PermissionCode =
  | (typeof PERMISSIONS.licensing)[keyof typeof PERMISSIONS.licensing]
  | (typeof PERMISSIONS.organization)[keyof typeof PERMISSIONS.organization]
  | (typeof PERMISSIONS.users)[keyof typeof PERMISSIONS.users]
  | (typeof PERMISSIONS.rbac)[keyof typeof PERMISSIONS.rbac]
  | (typeof PERMISSIONS.accounting)[keyof typeof PERMISSIONS.accounting]
  | (typeof PERMISSIONS.inventory)[keyof typeof PERMISSIONS.inventory]
  | (typeof PERMISSIONS.workflow)[keyof typeof PERMISSIONS.workflow]
  | (typeof PERMISSIONS.documents)[keyof typeof PERMISSIONS.documents];
