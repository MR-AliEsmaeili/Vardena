import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Accounting module's permissions for the Task 10.2 foundation (areas,
 * years, periods), the Task 10.3 chart foundation (coding structure, accounts)
 * and the Task 10.4 accounting documents — AR-22, ADR-0006, docs/security.md
 * §3, contract §22 / AC-D-34.
 *
 * Codes follow the established `Module.Entity.Action` form. ONLY the codes the
 * module enforces are registered: any code not enforced by code must not exist
 * (`docs/security.md` §3), so the remaining contract §22 vocabulary (Detail
 * Dimension, PostingRule, YearTransition, Balance, …) arrives with the tasks
 * that enforce it.
 *
 * Two deliberate readings of the contract vocabulary:
 * - periods have no `Create` code: creating a period IS opening it (the
 *   row is born `open`, and the contract §21 event is `Opened`, not
 *   `Created`), so creation is authorized by `AccountingPeriod.Open`;
 * - periods have no `Edit` code, so Task 10.2 offers no period update
 *   endpoint at all (contract §22 lists `View, Open, Close, Reopen, Seal`
 *   only). Fiscal years DO have `Edit` (their dates stay editable while
 *   no document references them — contract §6.5);
 * - the coding structure gets `View` + `Configure` ONLY (§22: "versioned
 *   configuration; no free-text structure editing"), so drafting, editing a
 *   draft and publishing all run under `Configure` — splitting them would
 *   invent authorities the contract does not define;
 * - accounts get `View/Create/Edit/Enable/Disable` and deliberately NO `Delete`
 *   (§22, §8.6: accounts are never deleted, so a delete permission could only
 *   ever be a lie);
 * - documents get the five codes of the IMPLEMENTED surface —
 *   `View/Create/Edit/Delete/Finalize`. `Delete` applies only to
 *   `draft`/`temporary` (§15.3, AC-D-21) and is refused for `final`;
 *   `Finalize` is deliberately NOT `Approve` (the contract keeps them
 *   distinct, and approval is the Workflow Foundation's authority);
 *   `Print`/`Export` are read capabilities with no reader in this task, and
 *   `Approve`/`Reverse`/`Correct`/`Replace` belong to the correction and
 *   posting tasks (AC-D-22), so none of them is registered here.
 *
 * No wildcards, no superuser, no implicit bypass (OQ-21).
 */

export const FINANCIAL_AREA_PERMISSIONS = {
  VIEW: 'Accounting.FinancialArea.View',
  CREATE: 'Accounting.FinancialArea.Create',
  EDIT: 'Accounting.FinancialArea.Edit',
  ENABLE: 'Accounting.FinancialArea.Enable',
  DISABLE: 'Accounting.FinancialArea.Disable',
} as const;

export const FISCAL_YEAR_PERMISSIONS = {
  VIEW: 'Accounting.FiscalYear.View',
  CREATE: 'Accounting.FiscalYear.Create',
  EDIT: 'Accounting.FiscalYear.Edit',
  CLOSE: 'Accounting.FiscalYear.Close',
  REOPEN: 'Accounting.FiscalYear.Reopen',
  SEAL: 'Accounting.FiscalYear.Seal',
  UNSEAL: 'Accounting.FiscalYear.Unseal',
} as const;

export const CODING_STRUCTURE_PERMISSIONS = {
  VIEW: 'Accounting.CodingStructure.View',
  CONFIGURE: 'Accounting.CodingStructure.Configure',
} as const;

export const ACCOUNT_PERMISSIONS = {
  VIEW: 'Accounting.Account.View',
  CREATE: 'Accounting.Account.Create',
  EDIT: 'Accounting.Account.Edit',
  ENABLE: 'Accounting.Account.Enable',
  DISABLE: 'Accounting.Account.Disable',
} as const;

export const ACCOUNTING_PERIOD_PERMISSIONS = {
  VIEW: 'Accounting.AccountingPeriod.View',
  OPEN: 'Accounting.AccountingPeriod.Open',
  CLOSE: 'Accounting.AccountingPeriod.Close',
  REOPEN: 'Accounting.AccountingPeriod.Reopen',
  SEAL: 'Accounting.AccountingPeriod.Seal',
} as const;

export const ACCOUNTING_DOCUMENT_PERMISSIONS = {
  VIEW: 'Accounting.Document.View',
  CREATE: 'Accounting.Document.Create',
  EDIT: 'Accounting.Document.Edit',
  DELETE: 'Accounting.Document.Delete',
  FINALIZE: 'Accounting.Document.Finalize',
} as const;

export const ACCOUNTING_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    {
      code: FINANCIAL_AREA_PERMISSIONS.VIEW,
      description: 'View financial area records and lists.',
    },
    {
      code: FINANCIAL_AREA_PERMISSIONS.CREATE,
      description: 'Create financial areas.',
    },
    {
      code: FINANCIAL_AREA_PERMISSIONS.EDIT,
      description: 'Edit financial areas.',
    },
    {
      code: FINANCIAL_AREA_PERMISSIONS.ENABLE,
      description: 'Re-enable a disabled financial area.',
    },
    {
      code: FINANCIAL_AREA_PERMISSIONS.DISABLE,
      description:
        'Disable a financial area (blocks new years in it, keeps history readable).',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.VIEW,
      description: 'View fiscal year records and lists.',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.CREATE,
      description: 'Create fiscal years.',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.EDIT,
      description: 'Edit fiscal years.',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.CLOSE,
      description: 'Close an open fiscal year (also closes its open periods).',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.REOPEN,
      description: 'Reopen a closed fiscal year.',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.SEAL,
      description: 'Seal a closed fiscal year.',
    },
    {
      code: FISCAL_YEAR_PERMISSIONS.UNSEAL,
      description: 'Unseal a sealed fiscal year back to closed.',
    },
    {
      code: ACCOUNTING_PERIOD_PERMISSIONS.VIEW,
      description: 'View accounting period records and lists.',
    },
    {
      code: ACCOUNTING_PERIOD_PERMISSIONS.OPEN,
      description: 'Open (create) an accounting period.',
    },
    {
      code: ACCOUNTING_PERIOD_PERMISSIONS.CLOSE,
      description: 'Close an open accounting period.',
    },
    {
      code: ACCOUNTING_PERIOD_PERMISSIONS.REOPEN,
      description: 'Reopen a closed or sealed accounting period.',
    },
    {
      code: ACCOUNTING_PERIOD_PERMISSIONS.SEAL,
      description: 'Seal a closed accounting period.',
    },
    {
      code: CODING_STRUCTURE_PERMISSIONS.VIEW,
      description: 'View coding structures, their versions and levels.',
    },
    {
      code: CODING_STRUCTURE_PERMISSIONS.CONFIGURE,
      description:
        'Draft, edit and publish a coding structure version (the only structure authority — there is no free-text structure editing).',
    },
    {
      code: ACCOUNT_PERMISSIONS.VIEW,
      description: 'View accounts and the chart of accounts.',
    },
    {
      code: ACCOUNT_PERMISSIONS.CREATE,
      description: 'Create accounts in the chart of accounts.',
    },
    {
      code: ACCOUNT_PERMISSIONS.EDIT,
      description:
        'Edit an account (titles; and structure while the account is unreferenced).',
    },
    {
      code: ACCOUNT_PERMISSIONS.ENABLE,
      description: 'Re-enable a disabled account.',
    },
    {
      code: ACCOUNT_PERMISSIONS.DISABLE,
      description:
        'Disable an account (blocks new postings and new children, keeps history readable). There is no delete.',
    },
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.VIEW,
      description: 'View accounting documents and their lines.',
    },
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.CREATE,
      description: 'Compose a draft accounting document.',
    },
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.EDIT,
      description:
        'Edit an editable accounting document (draft or temporary) and issue it (draft to temporary).',
    },
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.DELETE,
      description:
        'Discard a pre-final accounting document (draft or temporary). Final documents are never deletable.',
    },
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.FINALIZE,
      description:
        'Finalize a temporary accounting document, making it part of the books. Distinct from approval (the Workflow authority).',
    },
  ];
