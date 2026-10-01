import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  listAccountingPeriods,
  listFinancialAreas,
  listFiscalYears,
} from '@/api/accounting.api';
import type {
  AccountingPeriod,
  FinancialArea,
  FiscalYear,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * The selected operational accounting scope. It is deliberately a UI choice,
 * not a session claim, cookie, or authorization grant. Every API call still
 * carries the organization and the Accounting backend independently checks
 * membership, ownership, permissions, and licensing.
 *
 * Accounting's governed hierarchy is one level more precise than the generic
 * "financial period" wording: Organization → Financial Area → Fiscal Year →
 * Accounting Period. A Fiscal Year is never skipped or fabricated because an
 * Accounting Period belongs to exactly one Fiscal Year in the existing
 * Accounting bounded context.
 */
interface FinancialContextSelection {
  userId: string;
  organizationId: string;
  financialAreaId: string | null;
  fiscalYearId: string | null;
  accountingPeriodId: string | null;
}

export type FinancialContextStatus =
  | 'idle'
  | 'loading'
  | 'unavailable'
  | 'error'
  | 'empty-financial-area'
  | 'selecting-financial-area'
  | 'invalid-financial-area'
  | 'empty-fiscal-year'
  | 'selecting-fiscal-year'
  | 'invalid-fiscal-year'
  | 'empty-accounting-period'
  | 'selecting-accounting-period'
  | 'invalid-accounting-period'
  | 'ready';

export interface FinancialContextValue {
  organizationId: string | null;
  financialArea: FinancialArea | null;
  fiscalYear: FiscalYear | null;
  accountingPeriod: AccountingPeriod | null;
  /** Active financial areas returned by the server for the current organization. */
  financialAreas: readonly FinancialArea[];
  /** All years of the selected area; unavailable ones are included for honest UI. */
  fiscalYears: readonly FiscalYear[];
  /** All periods of the selected year; closed/sealed rows remain visible but unselectable. */
  accountingPeriods: readonly AccountingPeriod[];
  status: FinancialContextStatus;
  error: unknown;
  /** The session can read the complete context chain. */
  isAvailable: boolean;
  selectFinancialArea: (financialAreaId: string) => void;
  selectFiscalYear: (fiscalYearId: string) => void;
  selectAccountingPeriod: (accountingPeriodId: string) => void;
  refresh: () => void;
}

export const FinancialContext = createContext<FinancialContextValue | null>(
  null,
);

/**
 * Financial workspace context, kept beside OrganizationContext rather than
 * extending it. OrganizationContext remains the owner of tenant membership
 * and selected organization; this provider owns only the Accounting-specific,
 * in-memory navigation choice beneath that established boundary.
 *
 * No selection is persisted. A reload revalidates all server data, and a
 * changed organization, user, area or year clears every dependent id. The
 * sole automatic behavior mirrors OrganizationContext: exactly one *usable*
 * candidate may be used without asking; two or more always require an
 * explicit click. A once-selected value that becomes stale never falls back
 * silently to another row.
 */
export function FinancialContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const organization = useOrganization();
  const permissions = usePermissions();
  const organizationId =
    organization.status === 'ready' ? organization.organizationId : null;
  const [selected, setSelected] = useState<FinancialContextSelection | null>(
    null,
  );
  const priorScope = useRef<{
    userId: string | null;
    organizationId: string | null;
  }>({
    userId: null,
    organizationId: null,
  });

  const canReadContext =
    permissions.loaded &&
    permissions.hasAll([
      PERMISSIONS.accounting.financialAreaView,
      PERMISSIONS.accounting.fiscalYearView,
      PERMISSIONS.accounting.accountingPeriodView,
    ]);

  // Scope changes are external changes from the Organization/Session providers.
  // Drop client-owned dependent choices rather than ever reusing them if a user
  // returns to an old organization later in this browser session.
  useEffect(() => {
    const nextScope = { userId: user?.id ?? null, organizationId };
    const previous = priorScope.current;
    if (
      previous.userId !== nextScope.userId ||
      previous.organizationId !== nextScope.organizationId
    ) {
      setSelected(null);
      priorScope.current = nextScope;
    }
  }, [organizationId, user?.id]);

  const areasQuery = useQuery({
    queryKey: queryKeys.accounting.financialContextAreas(
      organizationId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listFinancialAreas(
        { organizationId: organizationId as string, isActive: true },
        signal,
      ),
    enabled: organizationId !== null && canReadContext,
    staleTime: 30_000,
  });

  // The server is authoritative for organization scope and the active filter.
  // Preserve both conditions defensively before a returned row becomes a
  // selectable parent for dependent requests.
  const financialAreas = useMemo<readonly FinancialArea[]>(
    () =>
      (areasQuery.data?.items ?? []).filter(
        (area) => area.organizationId === organizationId && area.isActive,
      ),
    [areasQuery.data, organizationId],
  );
  const selectionForScope =
    selected !== null &&
    selected.userId === user?.id &&
    selected.organizationId === organizationId
      ? selected
      : null;
  const selectedAreaId = selectionForScope?.financialAreaId ?? null;
  const explicitlySelectedArea = selectedAreaId !== null;
  const selectedArea =
    financialAreas.find((area) => area.id === selectedAreaId) ?? null;
  const financialArea =
    selectedArea ??
    (!explicitlySelectedArea && financialAreas.length === 1
      ? (financialAreas[0] ?? null)
      : null);
  const invalidFinancialArea =
    explicitlySelectedArea && selectedArea === null && !areasQuery.isPending;

  const yearsQuery = useQuery({
    queryKey: queryKeys.accounting.financialContextFiscalYears(
      organizationId ?? 'none',
      financialArea?.id ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listFiscalYears(
        {
          organizationId: organizationId as string,
          financialAreaId: financialArea?.id,
        },
        signal,
      ),
    enabled:
      organizationId !== null && financialArea !== null && canReadContext,
    staleTime: 30_000,
  });

  const fiscalYears = useMemo<readonly FiscalYear[]>(
    () => yearsQuery.data?.items ?? [],
    [yearsQuery.data],
  );
  // The API already receives the Area id, but retain the returned child's
  // parent check locally too. A mismatched row is never usable or displayed as
  // if it belonged to the selected Area.
  const fiscalYearsForArea = useMemo(
    () =>
      fiscalYears.filter((year) => year.financialAreaId === financialArea?.id),
    [financialArea?.id, fiscalYears],
  );
  const usableFiscalYears = useMemo(
    () =>
      fiscalYearsForArea.filter(
        (year) => year.isActive && year.status === 'open',
      ),
    [fiscalYearsForArea],
  );
  const selectedYearId = selectionForScope?.fiscalYearId ?? null;
  const explicitlySelectedYear = selectedYearId !== null;
  const selectedYear =
    usableFiscalYears.find(
      (year) =>
        year.id === selectedYearId &&
        year.financialAreaId === financialArea?.id,
    ) ?? null;
  const fiscalYear =
    selectedYear ??
    (!explicitlySelectedYear && usableFiscalYears.length === 1
      ? (usableFiscalYears[0] ?? null)
      : null);
  const invalidFiscalYear =
    financialArea !== null &&
    explicitlySelectedYear &&
    selectedYear === null &&
    !yearsQuery.isPending;

  const periodsQuery = useQuery({
    queryKey: queryKeys.accounting.financialContextPeriods(
      organizationId ?? 'none',
      financialArea?.id ?? 'none',
      fiscalYear?.id ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listAccountingPeriods(
        {
          organizationId: organizationId as string,
          fiscalYearId: fiscalYear?.id as string,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      financialArea !== null &&
      fiscalYear !== null &&
      canReadContext,
    staleTime: 30_000,
  });

  const accountingPeriods = useMemo<readonly AccountingPeriod[]>(
    () => periodsQuery.data?.items ?? [],
    [periodsQuery.data],
  );
  const accountingPeriodsForYear = useMemo(
    () =>
      accountingPeriods.filter(
        (period) =>
          period.financialAreaId === financialArea?.id &&
          period.fiscalYearId === fiscalYear?.id,
      ),
    [accountingPeriods, financialArea?.id, fiscalYear?.id],
  );
  const usableAccountingPeriods = useMemo(
    () => accountingPeriodsForYear.filter((period) => period.status === 'open'),
    [accountingPeriodsForYear],
  );
  const selectedPeriodId = selectionForScope?.accountingPeriodId ?? null;
  const explicitlySelectedPeriod = selectedPeriodId !== null;
  const selectedPeriod =
    usableAccountingPeriods.find((period) => period.id === selectedPeriodId) ??
    null;
  const accountingPeriod =
    selectedPeriod ??
    (!explicitlySelectedPeriod && usableAccountingPeriods.length === 1
      ? (usableAccountingPeriods[0] ?? null)
      : null);
  const invalidAccountingPeriod =
    fiscalYear !== null &&
    explicitlySelectedPeriod &&
    selectedPeriod === null &&
    !periodsQuery.isPending;

  const selectFinancialArea = useCallback(
    (financialAreaId: string) => {
      if (user === null || organizationId === null) return;
      const oldAreaId = selectionForScope?.financialAreaId ?? financialArea?.id;
      if (
        oldAreaId !== undefined &&
        oldAreaId !== null &&
        oldAreaId !== financialAreaId
      ) {
        queryClient.removeQueries({
          queryKey: queryKeys.accounting.financialContextFiscalYears(
            organizationId,
            oldAreaId,
          ),
        });
      }
      // The selector only calls this with a server-returned row. We retain the
      // id here, then resolve it again from the query result above; that lets a
      // just-created, server-authoritative row be chosen before its background
      // revalidation completes without turning this UI state into authority.
      setSelected({
        userId: user.id,
        organizationId,
        financialAreaId,
        fiscalYearId: null,
        accountingPeriodId: null,
      });
    },
    [
      financialArea?.id,
      organizationId,
      queryClient,
      selectionForScope?.financialAreaId,
      user,
    ],
  );

  const selectFiscalYear = useCallback(
    (fiscalYearId: string) => {
      if (user === null || organizationId === null || financialArea === null) {
        return;
      }
      const oldYearId = selectionForScope?.fiscalYearId ?? fiscalYear?.id;
      if (
        oldYearId !== undefined &&
        oldYearId !== null &&
        oldYearId !== fiscalYearId
      ) {
        queryClient.removeQueries({
          queryKey: queryKeys.accounting.financialContextPeriods(
            organizationId,
            financialArea.id,
            oldYearId,
          ),
        });
      }
      setSelected({
        userId: user.id,
        organizationId,
        financialAreaId: financialArea.id,
        fiscalYearId,
        accountingPeriodId: null,
      });
    },
    [
      financialArea,
      fiscalYear?.id,
      organizationId,
      queryClient,
      selectionForScope?.fiscalYearId,
      user,
    ],
  );

  const selectAccountingPeriod = useCallback(
    (accountingPeriodId: string) => {
      if (
        user === null ||
        organizationId === null ||
        financialArea === null ||
        fiscalYear === null
      ) {
        return;
      }
      setSelected({
        userId: user.id,
        organizationId,
        financialAreaId: financialArea.id,
        fiscalYearId: fiscalYear.id,
        accountingPeriodId,
      });
    },
    [financialArea, fiscalYear, organizationId, user],
  );

  const refresh = useCallback(() => {
    void areasQuery.refetch();
    if (financialArea !== null) void yearsQuery.refetch();
    if (fiscalYear !== null) void periodsQuery.refetch();
  }, [areasQuery, financialArea, fiscalYear, periodsQuery, yearsQuery]);

  let status: FinancialContextStatus;
  let error: unknown = null;
  if (organizationId === null) {
    status = 'idle';
  } else if (!permissions.loaded) {
    status = 'loading';
  } else if (!canReadContext) {
    status = 'unavailable';
  } else if (areasQuery.isPending) {
    status = 'loading';
  } else if (areasQuery.isError) {
    status = 'error';
    error = areasQuery.error;
  } else if (financialAreas.length === 0) {
    status = 'empty-financial-area';
  } else if (invalidFinancialArea) {
    status = 'invalid-financial-area';
  } else if (financialArea === null) {
    status = 'selecting-financial-area';
  } else if (yearsQuery.isPending) {
    status = 'loading';
  } else if (yearsQuery.isError) {
    status = 'error';
    error = yearsQuery.error;
  } else if (usableFiscalYears.length === 0) {
    status = 'empty-fiscal-year';
  } else if (invalidFiscalYear) {
    status = 'invalid-fiscal-year';
  } else if (fiscalYear === null) {
    status = 'selecting-fiscal-year';
  } else if (periodsQuery.isPending) {
    status = 'loading';
  } else if (periodsQuery.isError) {
    status = 'error';
    error = periodsQuery.error;
  } else if (usableAccountingPeriods.length === 0) {
    status = 'empty-accounting-period';
  } else if (invalidAccountingPeriod) {
    status = 'invalid-accounting-period';
  } else if (accountingPeriod === null) {
    status = 'selecting-accounting-period';
  } else {
    status = 'ready';
  }

  const value = useMemo<FinancialContextValue>(
    () => ({
      organizationId,
      financialArea,
      fiscalYear,
      accountingPeriod,
      financialAreas,
      fiscalYears: fiscalYearsForArea,
      accountingPeriods: accountingPeriodsForYear,
      status,
      error,
      isAvailable: canReadContext,
      selectFinancialArea,
      selectFiscalYear,
      selectAccountingPeriod,
      refresh,
    }),
    [
      accountingPeriod,
      accountingPeriodsForYear,
      canReadContext,
      error,
      financialArea,
      financialAreas,
      fiscalYear,
      fiscalYearsForArea,
      organizationId,
      refresh,
      selectAccountingPeriod,
      selectFinancialArea,
      selectFiscalYear,
      status,
    ],
  );

  return (
    <FinancialContext.Provider value={value}>
      {children}
    </FinancialContext.Provider>
  );
}
