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
 */
export const PERMISSIONS = {
  organization: {
    view: 'Organization.Organization.View',
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
