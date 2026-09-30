import type {
  AccountStatement,
  AuthenticatedUser,
  ChartTreeNode,
  FinancialArea,
  FiscalYear,
  GeneralLedgerRow,
  Organization,
  Paginated,
  TrialBalanceRow,
} from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';

/** Deterministic fixtures shaped exactly like the API responses. */

export const testUser: AuthenticatedUser = {
  id: 'usr-1',
  username: 'accountant',
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const allAccountingPermissions: string[] = [
  PERMISSIONS.organization.view,
  PERMISSIONS.accounting.accountView,
  PERMISSIONS.accounting.financialAreaView,
  PERMISSIONS.accounting.fiscalYearView,
  PERMISSIONS.accounting.accountingPeriodView,
  PERMISSIONS.accounting.accountStatementView,
  PERMISSIONS.accounting.generalLedgerView,
  PERMISSIONS.accounting.trialBalanceView,
];

export const testOrganization: Organization = {
  id: 'org-1',
  code: 'ORG-1',
  name: 'سازمان نمونه',
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const secondOrganization: Organization = {
  ...testOrganization,
  id: 'org-2',
  code: 'ORG-2',
  name: 'سازمان دوم',
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
