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

export const ACCOUNTING_CONFIGURATION_PERMISSIONS = {
  VIEW: 'Accounting.AccountingConfiguration.View',
  CONFIGURE: 'Accounting.AccountingConfiguration.Configure',
} as const;

export const ACCOUNT_PERMISSIONS = {
  VIEW: 'Accounting.Account.View',
  CREATE: 'Accounting.Account.Create',
  EDIT: 'Accounting.Account.Edit',
  ENABLE: 'Accounting.Account.Enable',
  DISABLE: 'Accounting.Account.Disable',
  UNLINK_DETAIL_GROUP: 'Accounting.Account.UnlinkDetailGroup',
} as const;

export const DETAIL_STRUCTURE_PERMISSIONS = {
  VIEW: 'Accounting.DetailStructure.View',
  CONFIGURE: 'Accounting.DetailStructure.Configure',
} as const;

export const DETAIL_PERMISSIONS = {
  VIEW: 'Accounting.Detail.View',
  CREATE: 'Accounting.Detail.Create',
  EDIT: 'Accounting.Detail.Edit',
  ENABLE: 'Accounting.Detail.Enable',
  DISABLE: 'Accounting.Detail.Disable',
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
  REVERSE: 'Accounting.Document.Reverse',
} as const;

/**
 * Balance projection (Task 12, contract §19.3 AC-D-31, §25 AC-I-19, ADR-0031).
 *
 * TWO codes, mirroring the projection's contract split:
 * - `View` covers every read: `GET /balances`, `GET /balances/:accountId`,
 *   `GET /balances/reconciliation` (the same projection authority, because
 *   reconciliation reads only the projection + ledger aggregate);
 * - `Rebuild` is the ONE write (explicit audited slice replacement) — a
 *   maintenance authority (the Inventory `Reconciliation.Execute` precedent),
 *   kept explicit because rebuild mutates `account_balance_projections`.
 *
 * No wildcards, no superuser, no implicit bypass (OQ-21).
 */
export const BALANCE_PERMISSIONS = {
  VIEW: 'Accounting.Balance.View',
  REBUILD: 'Accounting.Balance.Rebuild',
} as const;

/**
 * Ledger movements — the read source over the immutable posted ledger
 * (`accounting.ledger_entries`, Task 17A).
 *
 * ONE code, and it is a READ code: the movement source is the posted ledger
 * itself, so it has no write action at all — corrections remain
 * counter-documents with new entries (AC-D-22), and there is deliberately no
 * `Rebuild`, `Delete` or `Post` code here, because no such operation exists on
 * ledger entries (they are insert-only, AC-I-05/06).
 *
 * Why a NEW code instead of reusing an existing Accounting read code:
 * - `Accounting.Balance.View` is the authority over the REBUILDABLE turnover
 *   projection (`account_balance_projections`), a derived materialization
 *   (AC-D-31). A ledger entry is the authority itself; granting the immutable
 *   ledger under the projection's code would silently widen that code's
 *   meaning rather than describe a new one.
 * - `Accounting.Document.View` is the authority over the voucher aggregate
 *   (header + lines, `draft → temporary → final`, §12/§15). The posted ledger
 *   is a different fact with a different lifecycle: it exists only for
 *   `final` documents and outlives every editable one.
 *
 * The vocabulary follows §22's `Accounting.<Entity>.<Action>` form with the
 * reporting-facing entity name the read source carries. The contract §22 table
 * does not list a ledger-entry row (the contract's reporting section owns the
 * movement/ledger shapes, §19), so this task registers the ONE code its code
 * enforces — no wildcard, no superuser, no implicit bypass (OQ-21), and no
 * dormant codes.
 */
export const LEDGER_MOVEMENT_PERMISSIONS = {
  VIEW: 'Accounting.LedgerMovement.View',
} as const;

/**
 * Account statement — the bounded, read-only account-movement inquiry
 * (Task 17B Account Statement slice; Owner decision D6).
 *
 * ONE READ code, deliberately independent of both existing reader codes
 * (decision D6: "Use an independent backend-enforced permission … Do not
 * reuse an unrelated permission merely for convenience"):
 *
 * - `Accounting.LedgerMovement.View` governs the raw movement ROW source;
 *   the statement ADDS derived balance semantics (opening, running, closing)
 *   over a fixed one-account/one-year window. One authority per resource —
 *   a movement-lister is not automatically a statement reader.
 * - `Accounting.Balance.View` governs the rebuildable turnover projection,
 *   which the statement does not read at runtime (the ledger is its source).
 *
 * Reusing either would silently widen an approved code's meaning; the §22
 * vocabulary is extended with `Accounting.AccountStatement | View` instead
 * (authorized by decision D6 + gate P-10). Read-only: there is no `Execute`,
 * `Export` or mutation action on the statement — it is computed per request
 * and never persisted. No wildcard, no superuser, no implicit bypass (OQ-21).
 */
export const ACCOUNT_STATEMENT_PERMISSIONS = {
  VIEW: 'Accounting.AccountStatement.View',
} as const;

/** Task 18 — independent General Ledger read permission. */
export const GENERAL_LEDGER_PERMISSIONS = {
  VIEW: 'Accounting.GeneralLedger.View',
} as const;

/** Task 18 — independent Trial Balance read permission. */
export const TRIAL_BALANCE_PERMISSIONS = {
  VIEW: 'Accounting.TrialBalance.View',
} as const;

/**
 * Base Chart — the product-delivered chart template and its explicit
 * organization adoption (Task 23, task §16 = D-R-7).
 *
 * THREE codes map one-to-one onto the three actions the task authorizes:
 *
 * - `View` — every read (template catalog, version content, adoption
 *   records, the adoption preview);
 * - `Configure` — the template lifecycle (create template/version, edit a
 *   draft, approve, publish, supersede): the management authority over the
 *   product asset. The contract §22 table has NO `BaseChart` row (the
 *   template is a product asset, not a tenant entity), so this task extends
 *   the vocabulary with the mapping the task itself fixes (D-R-7) — it
 *   does NOT stretch `Accounting.CodingStructure.Configure` to cover a live
 *   product template (no reuse implied);
 * - `Adopt` — the ONE organization-chart mutation: the explicit adoption
 *   boundary. It sits next to `Accounting.Account.Create` on purpose: both
 *   write `accounts` rows, but the LOCALE of authority differs — account
 *   authoring is organization scope; adoption is the product→tenant
 *   delivery gateway, so it is its own explicit code (never implicit from
 *   `View` or from account authoring).
 *
 * No wildcards, no superuser, no implicit bypass (OQ-21).
 */
export const BASE_CHART_PERMISSIONS = {
  VIEW: 'Accounting.BaseChart.View',
  CONFIGURE: 'Accounting.BaseChart.Configure',
  ADOPT: 'Accounting.BaseChart.Adopt',
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
      code: ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW,
      description: 'View accounting configurations, their versions and levels.',
    },
    {
      code: ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE,
      description:
        'Draft, edit and publish an accounting configuration version (Task 11 foundation — the generic versioned root for all accounting configuration).',
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
      code: ACCOUNT_PERMISSIONS.UNLINK_DETAIL_GROUP,
      description:
        'Controlled destructive unlinking of Account <-> Detail relationship with atomic historical detail allocation clearing.',
    },
    {
      code: DETAIL_STRUCTURE_PERMISSIONS.VIEW,
      description: 'View detail coding structures, their versions and levels.',
    },
    {
      code: DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE,
      description:
        'Draft, edit and publish a detail coding structure version (Task 30 detail foundation).',
    },
    {
      code: DETAIL_PERMISSIONS.VIEW,
      description:
        'View detail records, detail groups, and the detail hierarchy tree.',
    },
    {
      code: DETAIL_PERMISSIONS.CREATE,
      description: 'Create detail records (detail groups or child details).',
    },
    {
      code: DETAIL_PERMISSIONS.EDIT,
      description: 'Edit detail records.',
    },
    {
      code: DETAIL_PERMISSIONS.ENABLE,
      description: 'Re-enable a disabled detail record.',
    },
    {
      code: DETAIL_PERMISSIONS.DISABLE,
      description:
        'Disable a detail record (blocks new postings with this detail, keeps history readable).',
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
    {
      code: ACCOUNTING_DOCUMENT_PERMISSIONS.REVERSE,
      description:
        'Reverse a finalized accounting document by posting a new finalized counter-document (debit/credit swapped). The original stays immutable.',
    },
    {
      code: BALANCE_PERMISSIONS.VIEW,
      description:
        'View balance projections and their reconciliation (rebuildable turnover per period × account, derived opening/closing).',
    },
    {
      code: BALANCE_PERMISSIONS.REBUILD,
      description:
        'Rebuild balance projections from the ledger (explicit audited slice replacement; source of truth stays the ledger).',
    },
    {
      code: LEDGER_MOVEMENT_PERMISSIONS.VIEW,
      description:
        'Read the posted ledger movements of an organization (immutable ledger entries; read-only, no mutation exists).',
    },
    {
      code: ACCOUNT_STATEMENT_PERMISSIONS.VIEW,
      description:
        'Read the account statement of one account within one fiscal year (opening, movements, running balance, closing; read-only, computed per request from the immutable ledger).',
    },
    {
      code: GENERAL_LEDGER_PERMISSIONS.VIEW,
      description:
        'Read the bounded General Ledger from immutable Accounting ledger entries.',
    },
    {
      code: TRIAL_BALANCE_PERMISSIONS.VIEW,
      description:
        'Read the bounded Trial Balance with POSTING/AGGREGATION hierarchy roll-up.',
    },
    {
      code: BASE_CHART_PERMISSIONS.VIEW,
      description:
        'View base chart templates, their versions and organization adoption records (product asset + adoption reads).',
    },
    {
      code: BASE_CHART_PERMISSIONS.CONFIGURE,
      description:
        'Manage the base chart template lifecycle: create templates/versions, edit draft content, approve, publish, supersede.',
    },
    {
      code: BASE_CHART_PERMISSIONS.ADOPT,
      description:
        'Adopt a published base chart version into an organization’s chart (the one template→tenant write boundary).',
    },
  ];
