import type {
  AccountBalance,
  Branch,
  AccountStatement,
  AccountingDocument,
  AccountingPeriod,
  AuthenticatedUser,
  ChartTreeNode,
  Department,
  Employee,
  FinancialArea,
  FiscalYear,
  GeneralLedgerRow,
  InventoryBalance,
  LicenseState,
  LicenseVersionSummary,
  Organization,
  Paginated,
  Party,
  TrialBalanceRow,
  WorkflowInstance,
} from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

/** Deterministic fixtures shaped exactly like the API responses. */

export const testUser: AuthenticatedUser = {
  id: 'usr-1',
  username: 'accountant',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const testForcedPasswordChangeUser: AuthenticatedUser = {
  ...testUser,
  username: 'مدیر',
  mustChangePassword: true,
};

export const allAccountingPermissions: string[] = [
  PERMISSIONS.organization.view,
  PERMISSIONS.accounting.accountView,
  PERMISSIONS.accounting.financialAreaView,
  PERMISSIONS.accounting.financialAreaCreate,
  PERMISSIONS.accounting.financialAreaEdit,
  PERMISSIONS.accounting.financialAreaEnable,
  PERMISSIONS.accounting.financialAreaDisable,
  PERMISSIONS.accounting.fiscalYearView,
  PERMISSIONS.accounting.fiscalYearCreate,
  PERMISSIONS.accounting.fiscalYearEdit,
  PERMISSIONS.accounting.fiscalYearClose,
  PERMISSIONS.accounting.fiscalYearReopen,
  PERMISSIONS.accounting.fiscalYearSeal,
  PERMISSIONS.accounting.fiscalYearUnseal,
  PERMISSIONS.accounting.accountingPeriodView,
  PERMISSIONS.accounting.accountingPeriodOpen,
  PERMISSIONS.accounting.accountCreate,
  PERMISSIONS.accounting.codingStructureConfigure,
  PERMISSIONS.accounting.accountingConfigurationView,
  PERMISSIONS.accounting.accountingConfigurationConfigure,
  PERMISSIONS.accounting.accountStatementView,
  PERMISSIONS.accounting.generalLedgerView,
  PERMISSIONS.accounting.trialBalanceView,
  PERMISSIONS.accounting.documentView,
  PERMISSIONS.accounting.balanceView,
  PERMISSIONS.inventory.balanceView,
  PERMISSIONS.workflow.instanceView,
];

/**
 * The organization every suite renders with.
 *
 * Its IANA time zone is explicit because timestamp tests require UTC. The
 * read-only `calendarSystem` response field is the fixed MVP value; the UI
 * ignores it and always renders BusinessDates Jalali-first. API date assertions
 * remain canonical Gregorian, with dedicated Jalali display/input coverage in
 * `src/lib/datetime/datetime.test.ts` and `src/ui/patterns/date-input.test.tsx`.
 */
export const testOrganization: Organization = {
  id: 'org-1',
  code: 'ORG-1',
  name: 'سازمان نمونه',
  isActive: true,
  calendarSystem: 'JALALI',
  timeZone: 'UTC',
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const secondOrganization: Organization = {
  ...testOrganization,
  id: 'org-2',
  code: 'ORG-2',
  name: 'سازمان دوم',
};

/** One retained license version (`LicenseVersionSummary`, L-03). */
export const testLicenseVersion: LicenseVersionSummary = {
  versionId: '01K7VERSIONAAAAAAAAAAAAAA',
  licenseId: '01K7LICENSEAAAAAAAAAAAAAAA',
  operationId: '01K7OPERATIONAAAAAAAAAAAAAA',
  status: 'ACTIVE',
  validFrom: '2026-01-01T00:00:00.000Z',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  validUntil: null,
  effective: true,
  supersededAt: null,
  governsUntil: null,
  supersededByVersionId: null,
  importedAt: '2026-01-01T00:00:00.000Z',
  source: 'text',
  deviceLimit: 2,
  deviceLimitSpecified: true,
};

/** A retained but not-yet-effective version: a scheduled renewal (L-03). */
export const testScheduledLicenseVersion: LicenseVersionSummary = {
  ...testLicenseVersion,
  versionId: '01K7SCHEDULEDVERSIONAAAAA',
  operationId: '01K7SCHEDULEDOPERATIONAAAA',
  // A renewal is signed now but governs from the instant the renewed term
  // ends, which is why the two instants differ here (OD-LIC-06 §6).
  validFrom: '2026-06-01T00:00:00.000Z',
  effectiveFrom: '2027-01-01T00:00:00.000Z',
  validUntil: '2028-01-01T00:00:00.000Z',
  effective: false,
  importedAt: '2026-06-01T00:00:00.000Z',
  source: 'file',
};

/** `GET /license/current` under the default, unconfigured local provider. */
export const testActiveLicenseState: LicenseState = {
  licensed: true,
  licenseType: 'COMMERCIAL',
  status: 'ACTIVE',
  active: true,
  inactiveReason: null,
  accessMode: 'ACTIVE',
  graceEndsAt: null,
  revokedAt: null,
  installationId: '01K7INSTALLATIONAAAAAAAAAA',
  customerId: '01K7CUSTOMERAAAAAAAAAAAAAA',
  customerCode: 'CUST-ACME-01',
  developerId: null,
  developerName: null,
  licenseId: '01K7LICENSEAAAAAAAAAAAAAAA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: null,
  // A perpetual governing version inside an unbroken chain: the chain never
  // ends, so coverageEnd is null (PO decision Q-2).
  coverageEnd: null,
  organizationLimit: null,
  userLimit: null,
  deviceLimit: 2,
  deviceLimitSpecified: true,
  entitlements: [{ kind: 'MODULE', code: 'organization' }],
  provider: 'persistent',
  effectiveVersionId: testLicenseVersion.versionId,
  scheduledVersion: null,
  versions: [testLicenseVersion],
};

/** An installation that has never activated a license (L-02). */
export const testUnlicensedLicenseState: LicenseState = {
  ...testActiveLicenseState,
  accessMode: 'BLOCKED',
  graceEndsAt: null,
  licensed: false,
  licenseType: null,
  status: 'UNLICENSED',
  active: false,
  inactiveReason: 'unlicensed',
  customerId: null,
  customerCode: null,
  licenseId: null,
  validFrom: null,
  deviceLimit: null,
  deviceLimitSpecified: false,
  entitlements: [],
  effectiveVersionId: null,
  scheduledVersion: null,
  versions: [],
};

export const testInactiveLicenseState: LicenseState = {
  ...testActiveLicenseState,
  status: 'SUSPENDED',
  active: false,
  inactiveReason: 'status',
  accessMode: 'BLOCKED',
};

export const testGraceLicenseState: LicenseState = {
  ...testActiveLicenseState,
  status: 'ACTIVE',
  active: false,
  inactiveReason: 'expired',
  accessMode: 'GRACE',
  validUntil: '2026-10-08T08:30:00.000Z',
  graceEndsAt: '2026-10-22T08:30:00.000Z',
};

export const testReadOnlyLicenseState: LicenseState = {
  ...testGraceLicenseState,
  accessMode: 'READ_ONLY',
};

/** An active installation that already retained a future-dated renewal. */
export const testScheduledLicenseState: LicenseState = {
  ...testActiveLicenseState,
  // A coherent chain: the governing version ends where the scheduled one
  // starts, and the retained renewal carries coverage to ITS own end. This is
  // the state that must not be read as "the term ends now" (OD-LIC-06 §6).
  validUntil: '2027-01-01T00:00:00.000Z',
  coverageEnd: '2028-01-01T00:00:00.000Z',
  scheduledVersion: testScheduledLicenseVersion,
  versions: [testLicenseVersion, testScheduledLicenseVersion],
};

export const testFinancialArea: FinancialArea = {
  id: 'area-1',
  organizationId: 'org-1',
  code: 'FIN',
  title: 'حوزه مالی اصلی',
  isDefault: true,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const testFiscalYear: FiscalYear = {
  id: 'year-1',
  organizationId: 'org-1',
  financialAreaId: 'area-1',
  code: '1405',
  title: 'سال مالی ۱۴۰۵',
  startDate: '2026-03-21',
  endDate: '2027-03-20',
  status: 'open',
  isActive: true,
  priorYearId: null,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
} as FiscalYear;

export function paginated<TItem>(items: TItem[]): Paginated<TItem> {
  return { items, total: items.length, page: 1, pageSize: 100 };
}

// -------------------------------------------------------------------------
// Dashboard (Task 32) — shapes mirror the generated DTOs exactly.
// -------------------------------------------------------------------------

export const testAccountBalances: AccountBalance[] = [
  {
    id: 'bal-1',
    organizationId: 'org-1',
    financialAreaId: 'area-1',
    fiscalYearId: 'year-1',
    accountingPeriodId: 'period-1',
    periodSequence: 1,
    accountId: 'acc-2',
    periodDebitAmount: '12000.00',
    periodCreditAmount: '3000.50',
    periodNetAmount: '8999.50',
    openingBalanceAmount: '0.00',
    closingBalanceAmount: '8999.50',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  },
  {
    id: 'bal-2',
    organizationId: 'org-1',
    financialAreaId: 'area-1',
    fiscalYearId: 'year-1',
    accountingPeriodId: 'period-1',
    periodSequence: 1,
    accountId: 'acc-3',
    periodDebitAmount: '0.00',
    periodCreditAmount: '0.00',
    periodNetAmount: '0.00',
    openingBalanceAmount: '0.00',
    closingBalanceAmount: '0.00',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  },
] as AccountBalance[];

export const testAccountingDocument: AccountingDocument = {
  id: 'doc-1',
  organizationId: 'org-1',
  financialAreaId: 'area-1',
  fiscalYearId: 'year-1',
  accountingPeriodId: 'period-1',
  documentType: 'accounting_voucher',
  documentNumber: '1001',
  documentDate: '2026-04-05',
  description: 'خرید نرم‌افزار',
  state: 'final',
  origin: 'manual',
  branchId: null,
  lines: [],
  totalDebit: '1250000.00',
  totalCredit: '1250000.00',
  createdAt: '2026-04-05T09:00:00.000Z',
  updatedAt: '2026-04-05T09:30:00.000Z',
} as unknown as AccountingDocument;

export const testInventoryBalance: InventoryBalance = {
  id: 'inv-1',
  organizationId: 'org-1',
  branchId: 'br-1',
  warehouseId: 'wh-1',
  itemId: 'item-1',
  onHand: '100',
  reserved: '5',
  available: '95',
  lastMovementDate: null,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T08:00:00.000Z',
} as InventoryBalance;

export const testWorkflowInstance: WorkflowInstance = {
  id: 'wf-1',
  organizationId: 'org-1',
  definitionId: 'def-1',
  versionId: 'ver-1',
  entityModule: 'inventory',
  entityType: 'inventory_receipt',
  entityId: 'ent-1',
  currentStateId: 'st-1',
  createdAt: '2026-04-02T08:00:00.000Z',
  updatedAt: '2026-04-02T08:00:00.000Z',
} as WorkflowInstance;

export const testAccountingPeriod: AccountingPeriod = {
  id: 'period-1',
  organizationId: 'org-1',
  financialAreaId: 'area-1',
  fiscalYearId: 'year-1',
  sequence: 1,
  title: 'فروردین',
  startDate: '2026-03-21',
  endDate: '2026-04-20',
  status: 'open',
  periodKind: 'normal',
  createdAt: '2026-03-21T00:00:00.000Z',
  updatedAt: '2026-03-21T00:00:00.000Z',
} as AccountingPeriod;

export const chartTreeNodes: ChartTreeNode[] = [
  {
    id: 'acc-1',
    organizationId: 'org-1',
    code: '10',
    title: 'دارایی‌ها',
    parentId: null,
    level: 1,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature: 'DEBIT',
    isPostable: false,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'acc-2',
    organizationId: 'org-1',
    code: '1010',
    title: 'موجودی نقد',
    parentId: 'acc-1',
    level: 2,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature: 'DEBIT',
    isPostable: true,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
] as ChartTreeNode[];

export const generalLedgerRow: GeneralLedgerRow = {
  documentDate: '2026-04-01',
  postingTimestamp: '2026-04-01T10:15:00.000Z',
  documentType: 'JOURNAL',
  documentId: 'doc-1',
  ledgerEntryId: 'entry-1',
  ledgerLineId: 'line-1',
  voucherLineId: 'vline-1',
  accountId: 'acc-2',
  accountCode: '1010',
  accountName: 'موجودی نقد',
  reference: null,
  description: 'ثبت افتتاحیه',
  debit: '1500000.00',
  credit: '0.00',
  net: '1500000.00',
  financialAreaId: 'area-1',
  fiscalYearId: 'year-1',
  accountingPeriodId: 'period-1',
  voucherNumber: '0001',
  lineNo: 1,
  origin: 'MANUAL',
  sourceModule: null,
  sourceEntityType: null,
  sourceEntityId: null,
  sourceOperation: null,
} as GeneralLedgerRow;

export const trialBalanceRow: TrialBalanceRow = {
  accountId: 'acc-2',
  accountCode: '1010',
  accountName: 'موجودی نقد',
  role: 'POSTING',
  opening: '0.00',
  debitTurnover: '1500000.00',
  creditTurnover: '250000.00',
  periodNet: '1250000.00',
  closing: '1250000.00',
} as TrialBalanceRow;

export const accountStatement: AccountStatement = {
  scope: {
    organizationId: 'org-1',
    financialArea: { id: 'area-1', code: 'FIN', title: 'حوزه مالی اصلی' },
    fiscalYear: {
      id: 'year-1',
      code: '1405',
      title: 'سال مالی ۱۴۰۵',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
      status: 'open',
    },
    account: { id: 'acc-2', code: '1010', title: 'موجودی نقد' },
    accountingPeriod: null,
  },
  movements: {
    items: [
      {
        id: 'mov-1',
        organizationId: 'org-1',
        financialAreaId: 'area-1',
        fiscalYearId: 'year-1',
        accountingPeriodId: 'period-1',
        voucherId: 'doc-1',
        voucherNumber: '0001',
        voucherLineId: 'vline-1',
        lineNo: 1,
        accountId: 'acc-2',
        debitAmount: '1500000.00',
        creditAmount: '0.00',
        netAmount: '1500000.00',
        runningBalanceAmount: '1500000.00',
        description: 'ثبت افتتاحیه',
        documentDate: '2026-04-01',
        postingTimestamp: '2026-04-01T10:15:00.000Z',
        origin: 'MANUAL',
        sourceModule: null,
        sourceEntityType: null,
        sourceEntityId: null,
        sourceOperation: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
  },
  totals: {
    openingBalanceAmount: '0.00',
    debitTotalAmount: '1500000.00',
    creditTotalAmount: '0.00',
    netChangeAmount: '1500000.00',
    closingBalanceAmount: '1500000.00',
  },
  signConvention: 'debit-positive',
  openingBasis: 'intra-fiscal-year',
  orderBasis: 'documentDate,voucherNumber,lineNo,id',
} as AccountStatement;

// ---------------------------------------------------------------------------
// Organization master data (FE-ORG-01)
//
// Shaped exactly like `BranchResponseDto`, `DepartmentResponseDto`,
// `EmployeeResponseDto` and `PartyResponseDto`. None of them has a `deletedAt`
// or any other soft-delete marker: the lifecycle of this master data is the
// `isActive` flag.
// ---------------------------------------------------------------------------

/** Every `Organization.*` permission except membership (out of scope). */
export const allOrganizationAdminPermissions: string[] = [
  PERMISSIONS.organization.view,
  PERMISSIONS.organization.edit,
  PERMISSIONS.organization.enable,
  PERMISSIONS.organization.disable,
  PERMISSIONS.organization.branchView,
  PERMISSIONS.organization.branchCreate,
  PERMISSIONS.organization.branchEdit,
  PERMISSIONS.organization.branchEnable,
  PERMISSIONS.organization.branchDisable,
  PERMISSIONS.organization.departmentView,
  PERMISSIONS.organization.departmentCreate,
  PERMISSIONS.organization.departmentEdit,
  PERMISSIONS.organization.departmentEnable,
  PERMISSIONS.organization.departmentDisable,
  PERMISSIONS.organization.employeeView,
  PERMISSIONS.organization.employeeCreate,
  PERMISSIONS.organization.employeeEdit,
  PERMISSIONS.organization.employeeEnable,
  PERMISSIONS.organization.employeeDisable,
  PERMISSIONS.organization.partyView,
  PERMISSIONS.organization.partyCreate,
  PERMISSIONS.organization.partyEdit,
  PERMISSIONS.organization.partyEnable,
  PERMISSIONS.organization.partyDisable,
];

export const testBranch: Branch = {
  id: 'brn-1',
  organizationId: testOrganization.id,
  code: 'BR-01',
  name: 'دفتر مرکزی',
  isActive: true,
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-02T08:00:00.000Z',
};

export const testDepartment: Department = {
  id: 'dep-1',
  organizationId: testOrganization.id,
  code: 'DP-01',
  name: 'مالی',
  parentDepartmentId: null,
  isActive: true,
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-02T08:00:00.000Z',
};

export const testEmployee: Employee = {
  id: 'emp-1',
  organizationId: testOrganization.id,
  employeeCode: 'EMP-01',
  firstName: 'سارا',
  lastName: 'محمدی',
  departmentId: testDepartment.id,
  branchId: testBranch.id,
  isActive: true,
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-02T08:00:00.000Z',
};

export const testParty: Party = {
  id: 'par-1',
  organizationId: testOrganization.id,
  code: 'PT-01',
  displayName: 'بازرگانی آریا',
  legalName: 'شرکت بازرگانی آریا',
  partyType: 'organization',
  isCustomer: true,
  isSupplier: false,
  email: null,
  phone: null,
  isActive: true,
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-02T08:00:00.000Z',
};
