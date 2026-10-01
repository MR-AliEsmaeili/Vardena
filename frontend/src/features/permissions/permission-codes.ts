/**
 * Permission codes the UI reacts to.
 *
 * Every code below is copied from the backend permission REGISTRY — the only
 * place codes may be defined (AR-22, `docs/security.md` §3):
 * - `backend/src/modules/accounting/domain/accounting-permissions.ts`
 * - `backend/src/modules/organization/domain/organization-permissions.ts`
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
    fiscalYearView: 'Accounting.FiscalYear.View',
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
  },
  workflow: {
    instanceView: 'Workflow.Instance.View',
  },
} as const;

export type PermissionCode =
  | (typeof PERMISSIONS.organization)[keyof typeof PERMISSIONS.organization]
  | (typeof PERMISSIONS.accounting)[keyof typeof PERMISSIONS.accounting]
  | (typeof PERMISSIONS.inventory)[keyof typeof PERMISSIONS.inventory]
  | (typeof PERMISSIONS.workflow)[keyof typeof PERMISSIONS.workflow];
