/**
 * Permission codes the UI reacts to.
 *
 * Every code below is copied from the backend permission REGISTRY — the only
 * place codes may be defined (AR-22, `docs/security.md` §3):
 * - `backend/src/modules/accounting/domain/accounting-permissions.ts`
 * - `backend/src/modules/organization/domain/organization-permissions.ts`
 * - `backend/src/modules/inventory/domain/inventory-permissions.ts`
 *   and `inventory-core-permissions.ts` / `inventory-valuation-permissions.ts`
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
   * Installation licensing (`backend/src/modules/licensing/domain/
   * licensing-permissions.ts`). The single code of the module: it authorizes
   * `POST /api/v1/license/activate`. Reading the license state needs no
   * permission at all (authenticated bootstrap self-read, ADR-0030).
   *
   * Like every entry here it is a UX check only (AR-21): the backend
   * re-authorizes activation, and holding an administrative role is NOT a
   * license bypass — an installation without an active license stays blocked
   * for every user, administrator or not.
   */
  licensing: {
    licenseActivate: 'Licensing.License.Activate',
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

    membershipGrant: 'Organization.Membership.Grant',
  },
  accounting: {
    accountView: 'Accounting.Account.View',
    financialAreaView: 'Accounting.FinancialArea.View',
    financialAreaCreate: 'Accounting.FinancialArea.Create',
    fiscalYearView: 'Accounting.FiscalYear.View',
    fiscalYearCreate: 'Accounting.FiscalYear.Create',
    accountingPeriodView: 'Accounting.AccountingPeriod.View',
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

    // Movement ledger (post/read) and transfers
    // (`inventory-core-permissions.ts`).
    movementView: 'Inventory.Movement.View',
    movementCreate: 'Inventory.Movement.Create',
    movementReverse: 'Inventory.Movement.Reverse',
    transferCreate: 'Inventory.Transfer.Create',

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
    valuationAssignCost: 'Inventory.Valuation.AssignCost',
    valuationRecalculate: 'Inventory.Valuation.Recalculate',
  },
  workflow: {
    instanceView: 'Workflow.Instance.View',
  },
} as const;

export type PermissionCode =
  | (typeof PERMISSIONS.licensing)[keyof typeof PERMISSIONS.licensing]
  | (typeof PERMISSIONS.organization)[keyof typeof PERMISSIONS.organization]
  | (typeof PERMISSIONS.accounting)[keyof typeof PERMISSIONS.accounting]
  | (typeof PERMISSIONS.inventory)[keyof typeof PERMISSIONS.inventory]
  | (typeof PERMISSIONS.workflow)[keyof typeof PERMISSIONS.workflow];
