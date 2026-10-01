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
  licenseState: () => ['licensing', 'license', 'current'] as const,

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
  },

  accounting: {
    all: (organizationId: string) => ['accounting', organizationId] as const,

    financialAreas: (organizationId: string) =>
      ['accounting', organizationId, 'financial-areas'] as const,

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
