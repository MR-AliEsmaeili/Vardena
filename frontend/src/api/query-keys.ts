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

  organizations: {
    all: () => ['organization', 'organizations'] as const,
    list: (filters: Record<string, unknown>) =>
      ['organization', 'organizations', 'list', filters] as const,
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
