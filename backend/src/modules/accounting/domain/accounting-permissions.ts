import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Accounting module's permissions for the Task 10.2 foundation
 * (AR-22, ADR-0006, docs/security.md §3, contract §22 / AC-D-34).
 *
 * Codes follow the established `Module.Entity.Action` form. ONLY the codes
 * Task 10.2 enforces are registered: any code not enforced by code must
 * not exist (`docs/security.md` §3), so the remaining contract §22
 * vocabulary (CodingStructure, Account, Document, …) arrives with the
 * tasks that enforce it.
 *
 * Two deliberate readings of the contract vocabulary:
 * - periods have no `Create` code: creating a period IS opening it (the
 *   row is born `open`, and the contract §21 event is `Opened`, not
 *   `Created`), so creation is authorized by `AccountingPeriod.Open`;
 * - periods have no `Edit` code, so Task 10.2 offers no period update
 *   endpoint at all (contract §22 lists `View, Open, Close, Reopen, Seal`
 *   only). Fiscal years DO have `Edit` (their dates stay editable while
 *   no document references them — contract §6.5).
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

export const ACCOUNTING_PERIOD_PERMISSIONS = {
  VIEW: 'Accounting.AccountingPeriod.View',
  OPEN: 'Accounting.AccountingPeriod.Open',
  CLOSE: 'Accounting.AccountingPeriod.Close',
  REOPEN: 'Accounting.AccountingPeriod.Reopen',
  SEAL: 'Accounting.AccountingPeriod.Seal',
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
  ];
