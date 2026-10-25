/**
 * TanStack Query key factory.
 *
 * Rules enforced here:
 * - keys are namespaced per module (AR-28: `['accounting', …]`);
 * - **every organization-scoped key carries the organization id**, so data of
 *   one organization can never be served from the cache of another after an
 *   organization switch;
 * - filter identity is part of the key, so a changed filter is a different
 *   query (and an in-flight one is cancelled/ignored by the query layer)
 *   instead of a silently reused page.
 */

export const queryKeys = {
  session: () => ['identity', 'session'] as const,
  effectivePermissions: () => ['rbac', 'permissions', 'effective'] as const,

  /**
   * User administration (`UsersController`). Session-global data — user
   * accounts are NOT organization-scoped (a user belongs to the
   * installation, memberships bind them to organizations), so these keys
   * deliberately carry no organization id and survive a scope switch.
   */
  users: {
    prefix: () => ['users'] as const,
    list: (filters: Record<string, unknown>) =>
      ['users', 'list', filters] as const,
    detail: (userId: string) => ['users', 'detail', userId] as const,
  },

  /**
   * Role administration and the permission registry (`RolesController`,
   * `PermissionsController`) — session-global like the users above.
   */
  rbac: {
    rolesPrefix: () => ['rbac', 'roles'] as const,
    roleList: (filters: Record<string, unknown>) =>
      ['rbac', 'roles', 'list', filters] as const,
    roleDetail: (roleId: string) =>
      ['rbac', 'roles', 'detail', roleId] as const,
    permissionsPrefix: () => ['rbac', 'permissions', 'registry'] as const,
    permissionList: (filters: Record<string, unknown>) =>
      ['rbac', 'permissions', 'registry', filters] as const,
  },

  licenseState: () => ['licensing', 'license', 'current'] as const,
  clientDevicesPrefix: () => ['licensing', 'devices'] as const,
  clientDeviceInventory: () => ['licensing', 'devices', 'inventory'] as const,
  clientDeviceHistory: (deviceId: string) =>
    ['licensing', 'devices', 'history', deviceId] as const,

  organizations: {
    all: () => ['organization', 'organizations'] as const,

    /**
     * The organization BOOTSTRAP read (`GET /organizations/mine`) — the
     * Organization Context's own query key. Session-global, not filtered:
     * one key for the one call the context ever makes.
     */
    mine: () => ['organization', 'organizations', 'mine'] as const,

    list: (filters: Record<string, unknown>) =>
      ['organization', 'organizations', 'list', filters] as const,

    /**
     * The ACTIVE organization's own record (`GET /organizations/:id`).
     * Organization-scoped by construction: the id sits at index 1, so an
     * organization switch evicts it like every other scoped read.
     */
    detail: (organizationId: string) =>
      ['organization', organizationId, 'organization', 'detail'] as const,

    branches: (organizationId: string) =>
      ['organization', organizationId, 'branches'] as const,
    branchList: (organizationId: string, filters: Record<string, unknown>) =>
      ['organization', organizationId, 'branches', 'list', filters] as const,
    branchDetail: (organizationId: string, branchId: string) =>
      ['organization', organizationId, 'branches', 'detail', branchId] as const,

    departments: (organizationId: string) =>
      ['organization', organizationId, 'departments'] as const,
    departmentList: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      ['organization', organizationId, 'departments', 'list', filters] as const,
    departmentDetail: (organizationId: string, departmentId: string) =>
      [
        'organization',
        organizationId,
        'departments',
        'detail',
        departmentId,
      ] as const,

    employees: (organizationId: string) =>
      ['organization', organizationId, 'employees'] as const,
    employeeList: (organizationId: string, filters: Record<string, unknown>) =>
      ['organization', organizationId, 'employees', 'list', filters] as const,
    employeeDetail: (organizationId: string, employeeId: string) =>
      [
        'organization',
        organizationId,
        'employees',
        'detail',
        employeeId,
      ] as const,

    parties: (organizationId: string) =>
      ['organization', organizationId, 'parties'] as const,
    partyList: (organizationId: string, filters: Record<string, unknown>) =>
      ['organization', organizationId, 'parties', 'list', filters] as const,
    partyDetail: (organizationId: string, partyId: string) =>
      ['organization', organizationId, 'parties', 'detail', partyId] as const,

    /**
     * Organization memberships (`OrganizationMembershipsController`).
     * Organization-scoped by construction: the id sits at index 1 like every
     * other scoped read of this root.
     */
    members: (organizationId: string) =>
      ['organization', organizationId, 'members'] as const,
    memberList: (organizationId: string, filters: Record<string, unknown>) =>
      ['organization', organizationId, 'members', 'list', filters] as const,
  },

  accounting: {
    all: (organizationId: string) => ['accounting', organizationId] as const,

    financialAreas: (organizationId: string) =>
      ['accounting', organizationId, 'financial-areas'] as const,

    /**
     * Bootstrap selection data, kept separate from report/master-data reads
     * so changing the active area can evict only its dependent context cache.
     */
    financialContextAreas: (organizationId: string) =>
      ['accounting', organizationId, 'financial-context', 'areas'] as const,

    financialContextFiscalYears: (
      organizationId: string,
      financialAreaId: string,
    ) =>
      [
        'accounting',
        organizationId,
        'financial-context',
        'fiscal-years',
        financialAreaId,
      ] as const,

    fiscalYears: (organizationId: string, financialAreaId: string | null) =>
      [
        'accounting',
        organizationId,
        'fiscal-years',
        financialAreaId ?? 'all',
      ] as const,

    accountingPeriods: (organizationId: string, fiscalYearId: string | null) =>
      [
        'accounting',
        organizationId,
        'accounting-periods',
        fiscalYearId ?? 'all',
      ] as const,

    postableAccounts: (organizationId: string, search: string) =>
      ['accounting', organizationId, 'accounts', 'postable', search] as const,

    activeAccounts: (organizationId: string, search: string) =>
      ['accounting', organizationId, 'accounts', 'active', search] as const,

    financialAreaList: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      [
        'accounting',
        organizationId,
        'financial-areas',
        'list',
        filters,
      ] as const,

    /**
     * Prefix shared by every financial-area LIST query, every DETAIL query
     * and the `financialAreas` reference read of one organization — the
     * invalidation scope after a financial-area mutation (ACC-01).
     */
    financialAreaPrefix: (organizationId: string) =>
      ['accounting', organizationId, 'financial-areas'] as const,

    financialAreaDetail: (organizationId: string, financialAreaId: string) =>
      [
        'accounting',
        organizationId,
        'financial-areas',
        'detail',
        financialAreaId,
      ] as const,

    fiscalYearList: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      ['accounting', organizationId, 'fiscal-years', 'list', filters] as const,

    accountingPeriodList: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      [
        'accounting',
        organizationId,
        'accounting-periods',
        'list',
        filters,
      ] as const,

    accountList: (organizationId: string, filters: Record<string, unknown>) =>
      ['accounting', organizationId, 'accounts', 'list', filters] as const,

    accountDetail: (organizationId: string, accountId: string) =>
      ['accounting', organizationId, 'accounts', 'detail', accountId] as const,

    codingStructureActive: (organizationId: string) =>
      ['accounting', organizationId, 'coding-structures', 'active'] as const,
    codingStructureDrafts: (organizationId: string) =>
      ['accounting', organizationId, 'coding-structures', 'drafts'] as const,
    accountingConfigurationActive: (organizationId: string) =>
      [
        'accounting',
        organizationId,
        'accounting-configurations',
        'active',
      ] as const,
    accountingConfigurationDrafts: (organizationId: string) =>
      [
        'accounting',
        organizationId,
        'accounting-configurations',
        'drafts',
      ] as const,

    chartTree: (organizationId: string) =>
      ['accounting', organizationId, 'chart-tree'] as const,

    accountStatement: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) => ['accounting', organizationId, 'account-statement', filters] as const,

    generalLedger: (organizationId: string, filters: Record<string, unknown>) =>
      ['accounting', organizationId, 'general-ledger', filters] as const,

    trialBalance: (organizationId: string, filters: Record<string, unknown>) =>
      ['accounting', organizationId, 'trial-balance', filters] as const,

    accountingDocuments: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      ['accounting', organizationId, 'accounting-documents', filters] as const,

    /**
     * Prefix shared by every accounting-documents LIST query and every DETAIL
     * query of one organization — the invalidation scope after a lifecycle
     * mutation. (The list keys append a filters object and the detail keys
     * append `'detail', id`, so this raw prefix is what covers both.)
     */
    accountingDocumentsPrefix: (organizationId: string) =>
      ['accounting', organizationId, 'accounting-documents'] as const,

    generalLedgerPrefix: (organizationId: string) =>
      ['accounting', organizationId, 'general-ledger'] as const,

    trialBalancePrefix: (organizationId: string) =>
      ['accounting', organizationId, 'trial-balance'] as const,

    accountStatementPrefix: (organizationId: string) =>
      ['accounting', organizationId, 'account-statement'] as const,

    accountBalancesPrefix: (organizationId: string) =>
      ['accounting', organizationId, 'account-balances'] as const,

    accountingDocumentDetail: (organizationId: string, documentId: string) =>
      [
        'accounting',
        organizationId,
        'accounting-documents',
        'detail',
        documentId,
      ] as const,

    postableDetails: (organizationId: string, search: string) =>
      ['accounting', organizationId, 'details', 'postable', search] as const,

    detailRecord: (organizationId: string, detailId: string) =>
      ['accounting', organizationId, 'details', 'detail', detailId] as const,

    accountBalances: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) => ['accounting', organizationId, 'account-balances', filters] as const,
  },

  inventory: {
    balances: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'balances', filters] as const,

    /** Every balances LIST of one organization (mutation invalidation scope). */
    balancesPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'balances'] as const,

    movements: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'movements', 'list', filters] as const,

    /** Every movements LIST of one organization (mutation invalidation scope). */
    movementsPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'movements'] as const,

    kardex: (
      organizationId: string,
      filters: Record<string, unknown>,
      /** The backend's opaque ledger snapshot — part of the page identity. */
      snapshot?: string,
    ) =>
      [
        'inventory',
        organizationId,
        'kardex',
        filters,
        ...(snapshot !== undefined ? [snapshot] : []),
      ] as const,

    kardexPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'kardex'] as const,

    valuationStates: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      [
        'inventory',
        organizationId,
        'valuation-states',
        'list',
        filters,
      ] as const,

    valuationStatesPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'valuation-states'] as const,

    /** Business-document workspace (filtered list). */
    documents: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'documents', 'list', filters] as const,

    /** Every business-document read of one organization (invalidation scope). */
    documentsPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'documents'] as const,

    document: (organizationId: string, documentId: string) =>
      ['inventory', organizationId, 'documents', 'detail', documentId] as const,

    // Reference reads (active warehouses / stockable items / units). Kept as
    // ONE key per entity per organization — they are small, slow-moving
    // master-data lists, not filtered workspaces.
    warehouses: (organizationId: string) =>
      ['inventory', organizationId, 'warehouses'] as const,

    items: (organizationId: string) =>
      ['inventory', organizationId, 'items'] as const,

    units: (organizationId: string) =>
      ['inventory', organizationId, 'units'] as const,

    // Master-data administration lists and details. The admin keys are
    // children of the reference-read prefix above on purpose: invalidating
    // `['inventory', orgId, 'items']` after a mutation refreshes the admin
    // list, the detail AND the pickers together.
    warehouseList: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'warehouses', 'admin', filters] as const,
    warehouseDetail: (organizationId: string, warehouseId: string) =>
      [
        'inventory',
        organizationId,
        'warehouses',
        'detail',
        warehouseId,
      ] as const,
    warehousePrefix: (organizationId: string) =>
      ['inventory', organizationId, 'warehouses'] as const,

    unitList: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'units', 'admin', filters] as const,
    unitDetail: (organizationId: string, unitId: string) =>
      ['inventory', organizationId, 'units', 'detail', unitId] as const,
    unitPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'units'] as const,

    itemGroupList: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'item-groups', 'list', filters] as const,
    itemGroupDetail: (organizationId: string, itemGroupId: string) =>
      [
        'inventory',
        organizationId,
        'item-groups',
        'detail',
        itemGroupId,
      ] as const,
    itemGroupPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'item-groups'] as const,

    itemList: (organizationId: string, filters: Record<string, unknown>) =>
      ['inventory', organizationId, 'items', 'admin', filters] as const,
    itemDetail: (organizationId: string, itemId: string) =>
      ['inventory', organizationId, 'items', 'detail', itemId] as const,
    itemPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'items'] as const,

    unitConversionList: (
      organizationId: string,
      filters: Record<string, unknown>,
    ) =>
      [
        'inventory',
        organizationId,
        'unit-conversions',
        'list',
        filters,
      ] as const,
    unitConversionPrefix: (organizationId: string) =>
      ['inventory', organizationId, 'unit-conversions'] as const,
  },

  workflow: {
    instances: (organizationId: string, filters: Record<string, unknown>) =>
      ['workflow', organizationId, 'instances', filters] as const,
  },
} as const;

/**
 * Query-key roots whose data is organization-scoped. By construction every
 * such key carries the organization id at index 1 (`['accounting', orgId, …]`,
 * `['inventory', orgId, …]`, `['workflow', orgId, …]`).
 */
const ORGANIZATION_SCOPED_ROOTS: readonly unknown[] = [
  'accounting',
  'inventory',
  'workflow',
];

/**
 * The `organization` root mixes two kinds of keys: the session-global
 * organization LIST (`['organization', 'organizations', …]` — not scoped to
 * any one organization, it must survive a scope switch) and organization-
 * SCOPED reference reads such as a branch detail
 * (`['organization', orgId, 'branches', …]`). Only the latter carry an
 * organization id at index 1, so the scope check for this root is exact.
 */
const ORGANIZATION_GLOBAL_NAMESPACES = new Set(['organizations']);

/**
 * Whether a query key holds server data that belongs to an organization
 * OTHER than `organizationId`. Used to evict the previous organization's
 * cache when the effective organization changes, and to gate
 * `placeholderData` so the previous page is only kept within the SAME
 * organization — a plain `(previous) => previous` would otherwise render
 * organization A's rows as if they were organization B's while B loads.
 */
export function isOtherOrganizationScope(
  queryKey: readonly unknown[],
  organizationId: string,
): boolean {
  if (queryKey[0] === 'organization') {
    const scope = queryKey[1];
    return (
      typeof scope === 'string' &&
      !ORGANIZATION_GLOBAL_NAMESPACES.has(scope) &&
      scope !== organizationId
    );
  }
  return (
    ORGANIZATION_SCOPED_ROOTS.includes(queryKey[0]) &&
    queryKey[1] !== organizationId
  );
}
