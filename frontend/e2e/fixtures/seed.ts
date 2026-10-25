import type {
  Account,
  AccountingPeriod,
  AdminRole,
  AdminUser,
  AuthenticatedUser,
  EffectivePermissions,
  FinancialArea,
  FiscalYear,
  InventoryItem,
  InventoryItemGroup,
  LicenseState,
  Organization,
} from '../../src/api/contracts';
import { PERMISSIONS } from '../../src/features/permissions/permission-codes';

/**
 * Deterministic API fixtures for the browser suite
 * (`docs/frontend/e2e-testing.md`).
 *
 * They are typed with the REAL contracts (`src/api/contracts.ts`), so a DTO
 * change breaks `npm run typecheck` here instead of producing a green browser
 * test against a payload the backend no longer sends. The data is bilingual on
 * purpose: Persian names exercise the normalizer, Latin usernames keep the
 * selectors readable, and one username is written with an Arabic `ي` so the
 * standards' «ي/ی» normalization is covered end-to-end.
 */

export const SESSION_USER: AuthenticatedUser = {
  id: 'usr-1',
  username: 'مدیر',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const ORGANIZATION: Organization = {
  id: 'org-1',
  code: 'ORG-1',
  name: 'سازمان نمونه',
  isActive: true,
  calendarSystem: 'JALALI',
  timeZone: 'Asia/Tehran',
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

/** One active area + one open fiscal year: the shell resolves without a picker. */
export const FINANCIAL_AREA: FinancialArea = {
  id: 'area-1',
  organizationId: ORGANIZATION.id,
  code: 'MAIN',
  title: 'حساب‌های اصلی',
  isDefault: true,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const FISCAL_YEAR: FiscalYear = {
  id: 'fy-1',
  organizationId: ORGANIZATION.id,
  financialAreaId: FINANCIAL_AREA.id,
  code: 'FY-1405',
  title: 'سال مالی ۱۴۰۵',
  startDate: '2026-03-21',
  endDate: '2027-03-20',
  status: 'open',
  isActive: true,
  priorYearId: null,
  createdAt: '2026-03-21T08:00:00.000Z',
  updatedAt: '2026-03-21T08:00:00.000Z',
};

export const ACCOUNTING_PERIOD: AccountingPeriod = {
  id: 'period-1',
  organizationId: ORGANIZATION.id,
  financialAreaId: FINANCIAL_AREA.id,
  fiscalYearId: FISCAL_YEAR.id,
  sequence: 7,
  title: 'مهر ۱۴۰۵',
  startDate: '2026-09-23',
  endDate: '2026-10-22',
  status: 'open',
  periodKind: 'normal',
  createdAt: '2026-09-23T08:00:00.000Z',
  updatedAt: '2026-09-23T08:00:00.000Z',
};

/** Active license: the shell must not fall into the Grace/Read-Only gate. */
export const LICENSE_STATE: LicenseState = {
  licensed: true,
  licenseType: 'COMMERCIAL',
  status: 'ACTIVE',
  active: true,
  inactiveReason: null,
  accessMode: 'ACTIVE',
  graceEndsAt: null,
  revokedAt: null,
  installationId: 'inst-1',
  customerId: 'cust-1',
  customerCode: 'CUST-1',
  developerId: null,
  developerName: null,
  licenseId: 'lic-1',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2028-01-01T00:00:00.000Z',
  coverageEnd: '2028-01-01T00:00:00.000Z',
  organizationLimit: null,
  userLimit: null,
  deviceLimit: 3,
  deviceLimitSpecified: true,
  entitlements: [],
  provider: 'e2e',
  effectiveVersionId: null,
  scheduledVersion: null,
  versions: [],
};

/** Every permission the touched pages read. */
export const PERMISSIONS_ALL: EffectivePermissions = {
  userId: SESSION_USER.id,
  permissions: [
    PERMISSIONS.users.view,
    PERMISSIONS.users.create,
    PERMISSIONS.users.edit,
    PERMISSIONS.rbac.roleView,
    PERMISSIONS.rbac.roleCreate,
    PERMISSIONS.inventory.itemView,
    PERMISSIONS.inventory.itemCreate,
    PERMISSIONS.inventory.itemEdit,
    PERMISSIONS.inventory.itemGroupView,
    PERMISSIONS.accounting.accountView,
    PERMISSIONS.accounting.documentView,
    PERMISSIONS.accounting.documentCreate,
    PERMISSIONS.accounting.documentEdit,
    PERMISSIONS.accounting.financialAreaView,
    PERMISSIONS.accounting.fiscalYearView,
    PERMISSIONS.accounting.accountingPeriodView,
    PERMISSIONS.accounting.trialBalanceView,
    PERMISSIONS.accounting.balanceView,
    PERMISSIONS.inventory.balanceView,
    PERMISSIONS.workflow.instanceView,
  ],
};

function timestamps(day: string): { createdAt: string; updatedAt: string } {
  return {
    createdAt: `${day}T08:00:00.000Z`,
    updatedAt: `${day}T08:00:00.000Z`,
  };
}

/**
 * The users grid fixture.
 *
 * `علي` is written with an ARABIC YEH on purpose: searching `علی` (Persian
 * yeh) must still find it, which is exactly the normalization the shared grid
 * promises.
 */
export const USERS: AdminUser[] = [
  {
    id: 'usr-1',
    username: 'مدیر',
    isActive: true,
    mustChangePassword: false,
    ...timestamps('2026-01-01'),
  },
  {
    id: 'usr-2',
    username: 'alice',
    isActive: true,
    mustChangePassword: false,
    ...timestamps('2026-02-01'),
  },
  {
    id: 'usr-3',
    username: 'bob',
    isActive: false,
    mustChangePassword: true,
    ...timestamps('2026-03-01'),
  },
  {
    id: 'usr-4',
    username: 'علي',
    isActive: true,
    mustChangePassword: false,
    ...timestamps('2026-04-01'),
  },
  {
    id: 'usr-5',
    username: 'carol',
    isActive: true,
    mustChangePassword: true,
    ...timestamps('2026-05-01'),
  },
  {
    id: 'usr-6',
    username: 'dave',
    isActive: false,
    mustChangePassword: false,
    ...timestamps('2026-06-01'),
  },
];

export const ROLES: AdminRole[] = [
  {
    id: 'role-1',
    name: 'System Administrator',
    description: 'دسترسی کامل',
    permissionCount: 12,
    ...timestamps('2026-01-01'),
  },
  {
    id: 'role-2',
    name: 'Accountant',
    description: 'ثبت و مشاهده اسناد',
    permissionCount: 6,
    ...timestamps('2026-02-01'),
  },
  {
    id: 'role-3',
    name: 'Warehouse Clerk',
    description: null,
    permissionCount: 3,
    ...timestamps('2026-03-01'),
  },
];

export const ITEM_GROUPS: InventoryItemGroup[] = [
  {
    id: 'grp-1',
    organizationId: ORGANIZATION.id,
    parentId: null,
    code: 'FASTENERS',
    name: 'بست‌ها',
    isActive: true,
    ...timestamps('2026-01-01'),
  },
  {
    id: 'grp-2',
    organizationId: ORGANIZATION.id,
    parentId: null,
    code: 'PAPER',
    name: 'کاغذ',
    isActive: true,
    ...timestamps('2026-01-01'),
  },
];

function item(
  id: string,
  code: string,
  name: string,
  itemKind: InventoryItem['itemKind'],
  itemGroupId: string | null,
  isActive: boolean,
): InventoryItem {
  return {
    id,
    organizationId: ORGANIZATION.id,
    code,
    name,
    description: null,
    itemKind,
    itemGroupId,
    baseUnitId: 'unit-1',
    isStockable: true,
    isPurchasable: true,
    isSellable: true,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
    allowNegativeStock: null,
    barcode: null,
    isActive,
    ...timestamps('2026-01-01'),
  };
}

export const ITEMS: InventoryItem[] = [
  item('item-1', 'ITM-0001', 'پیچ شش‌گوش M8', 'goods', 'grp-1', true),
  item('item-2', 'ITM-0002', 'مهره M8', 'goods', 'grp-1', true),
  item('item-3', 'ITM-0003', 'کاغذ A4', 'consumable', 'grp-2', false),
  item('item-4', 'ITM-0004', 'خدمات نصب', 'service', null, true),
];

function account(
  id: string,
  code: string,
  title: string,
  isPostable: boolean,
): Account {
  return {
    id,
    organizationId: ORGANIZATION.id,
    code,
    // Roots in this fixture: the local segment is the whole code.
    localCode: code,
    title,
    parentId: null,
    level: 2,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature: 'DEBIT',
    accountType: 'BALANCE_SHEET',
    detailGroupId: null,
    isPostable,
    isActive: true,
    ...timestamps('2026-01-01'),
  };
}

/**
 * Chart fixture for the linked account field.
 *
 * `1010` and `2020` are posting leaves; `1` is the aggregate parent an
 * operator can find in the picker but must not be able to post to.
 */
export const ACCOUNTS: Account[] = [
  account('acc-1', '1', 'دارایی‌ها', false),
  account('acc-2', '1010', 'موجودی نقد', true),
  account('acc-3', '2020', 'حساب‌های پرداختنی', true),
  account('acc-4', '5010', 'هزینه اجاره', true),
];

export interface E2eSeed {
  user: AuthenticatedUser;
  permissions: EffectivePermissions;
  organization: Organization;
  financialArea: FinancialArea;
  fiscalYear: FiscalYear;
  accountingPeriod: AccountingPeriod;
  license: LicenseState;
  users: AdminUser[];
  roles: AdminRole[];
  itemGroups: InventoryItemGroup[];
  items: InventoryItem[];
  accounts: Account[];
}

export function createSeed(): E2eSeed {
  return {
    user: SESSION_USER,
    permissions: PERMISSIONS_ALL,
    organization: ORGANIZATION,
    financialArea: FINANCIAL_AREA,
    fiscalYear: FISCAL_YEAR,
    accountingPeriod: ACCOUNTING_PERIOD,
    license: LICENSE_STATE,
    users: USERS,
    roles: ROLES,
    itemGroups: ITEM_GROUPS,
    items: ITEMS,
    accounts: ACCOUNTS,
  };
}
