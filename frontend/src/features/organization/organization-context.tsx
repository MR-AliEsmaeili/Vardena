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
import { listFinancialAreas, listFiscalYears } from '@/api/accounting.api';
import type { FinancialArea, FiscalYear, Organization } from '@/api/contracts';
import { listMyOrganizations } from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { useSession } from '@/features/auth/use-session';
import { setDateTimeSettings } from '@/lib/datetime';

/** The organization-only resolution state machine. */
export type OrganizationContextStatus =
  'loading' | 'selecting' | 'ready' | 'empty' | 'invalid' | 'error';

/**
 * Financial context resolution, deliberately kept in the existing
 * organization context instead of introducing a competing persisted scope.
 * `forbidden` means the session cannot read the server-owned context data;
 * the browser never treats a missing permission as an empty financial area.
 */
export type FinancialContextStatus =
  | 'waiting'
  | 'loading'
  | 'selecting'
  | 'ready'
  | 'empty'
  | 'invalid'
  | 'error'
  | 'forbidden';

export interface OrganizationContextValue {
  /** Organizations the API returned for this session (never invented). */
  organizations: readonly Organization[];
  /** The organization every scoped request is sent with. */
  organization: Organization | null;
  organizationId: string | null;
  status: OrganizationContextStatus;
  error: unknown;
  /** True only when the API actually offers more than one organization. */
  canSwitch: boolean;
  selectOrganization: (organizationId: string) => void;
  refresh: () => void;

  /** Active, server-provided areas of the selected organization. */
  financialAreas: readonly FinancialArea[];
  financialArea: FinancialArea | null;
  financialAreaId: string | null;
  financialAreaStatus: FinancialContextStatus;
  financialAreaError: unknown;
  canSwitchFinancialArea: boolean;
  selectFinancialArea: (financialAreaId: string) => void;
  refreshFinancialAreas: () => void;

  /** Open, active fiscal years of the selected financial area. */
  fiscalYears: readonly FiscalYear[];
  fiscalYear: FiscalYear | null;
  fiscalYearId: string | null;
  fiscalYearStatus: FinancialContextStatus;
  fiscalYearError: unknown;
  canSwitchFiscalYear: boolean;
  selectFiscalYear: (fiscalYearId: string) => void;
  refreshFiscalYears: () => void;

  /** `ready` only after organization → area → fiscal-year is coherent. */
  financialContextStatus: FinancialContextStatus;
}

export const OrganizationContext =
  createContext<OrganizationContextValue | null>(null);

/** A user-confirmed organization selection; never persisted outside memory. */
interface ConfirmedOrganizationSelection {
  userId: string;
  organizationId: string;
}

/**
 * Browser navigation state for the existing Accounting hierarchy. It is not
 * an authorization grant: each API request still carries the organization id
 * and the server independently validates organization membership, parent
 * ownership, permission and licensing.
 */
interface ConfirmedFinancialSelection {
  userId: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string | null;
}

/**
 * Organization and financial-workspace context.
 *
 * The only organization discovery this provider performs is
 * `GET /api/v1/organizations/mine`; areas and fiscal years are then obtained
 * through the Accounting module's existing scope-qualified list contracts.
 * This follows the governed hierarchy already present in the repository:
 *
 * `Organization → FinancialArea → FiscalYear → AccountingPeriod`.
 *
 * The requested "fiscal period" workspace selection is represented by the
 * existing Accounting-owned `FiscalYear` aggregate (the independently
 * selectable dated fiscal range directly under a Financial Area). An
 * `AccountingPeriod` remains a subordinate posting window within that year;
 * no duplicate FiscalPeriod model or parallel context protocol is invented.
 * Only active areas and open, active fiscal years are candidates for ordinary
 * workspace entry. Closed, sealed and inactive history remains available only
 * through its established administration/read surfaces.
 *
 * No selection is stored in localStorage or cookies. A selection is scoped to
 * the current user and organization, and parent changes synchronously clear
 * every dependent selection and the dedicated dependent query cache.
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const {
    status: sessionStatus,
    user,
    mustChangePassword,
    permissions,
    permissionsLoaded,
  } = useSession();
  const [selected, setSelected] =
    useState<ConfirmedOrganizationSelection | null>(null);
  const [financialSelection, setFinancialSelection] =
    useState<ConfirmedFinancialSelection | null>(null);
  const previousFinancialArea = useRef<{
    organizationId: string;
    financialAreaId: string;
  } | null>(null);

  const organizationsQuery = useQuery({
    queryKey: queryKeys.organizations.mine(),
    queryFn: ({ signal }) => listMyOrganizations(signal),
    enabled: sessionStatus === 'authenticated' && !mustChangePassword,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const organizations = useMemo<readonly Organization[]>(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data],
  );

  const isSelectionForCurrentUser =
    selected !== null && selected.userId === user?.id;
  const selectedOrganization = useMemo<Organization | null>(() => {
    if (!isSelectionForCurrentUser) return null;
    return (
      organizations.find((item) => item.id === selected.organizationId) ?? null
    );
  }, [isSelectionForCurrentUser, organizations, selected]);

  const organization = useMemo<Organization | null>(() => {
    if (isSelectionForCurrentUser) return selectedOrganization;
    if (organizations.length === 1) return organizations[0] ?? null;
    return null;
  }, [isSelectionForCurrentUser, selectedOrganization, organizations]);

  // ADR-0044: only the selected organization's IANA time zone is mutable
  // date/time configuration. Jalali presentation is a fixed MVP policy, so
  // legacy calendarSystem response data is deliberately ignored.
  useEffect(() => {
    setDateTimeSettings(
      organization === null ? null : { timeZone: organization.timeZone },
    );
  }, [organization]);

  const status: OrganizationContextStatus =
    sessionStatus !== 'authenticated' ||
    mustChangePassword ||
    organizationsQuery.isPending
      ? 'loading'
      : organizationsQuery.isError
        ? 'error'
        : organizations.length === 0
          ? 'empty'
          : isSelectionForCurrentUser && selectedOrganization === null
            ? 'invalid'
            : organizations.length > 1 && !isSelectionForCurrentUser
              ? 'selecting'
              : 'ready';

  const canReadFinancialAreas = permissions.includes(
    PERMISSIONS.accounting.financialAreaView,
  );
  const canReadFiscalYears = permissions.includes(
    PERMISSIONS.accounting.fiscalYearView,
  );

  const financialAreasQuery = useQuery({
    queryKey: queryKeys.accounting.financialContextAreas(
      organization?.id ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listFinancialAreas(
        { organizationId: organization?.id as string, isActive: true },
        signal,
      ),
    enabled:
      status === 'ready' &&
      organization !== null &&
      permissionsLoaded &&
      canReadFinancialAreas,
    // Context gates surface a retryable state immediately. Background retries
    // would hide an outage and can strand the user behind a loading screen.
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const financialAreas = useMemo<readonly FinancialArea[]>(
    () => financialAreasQuery.data?.items ?? [],
    [financialAreasQuery.data],
  );
  const isFinancialSelectionForCurrentScope =
    financialSelection !== null &&
    financialSelection.userId === user?.id &&
    financialSelection.organizationId === organization?.id;
  const selectedFinancialArea = useMemo<FinancialArea | null>(() => {
    if (!isFinancialSelectionForCurrentScope || financialSelection === null) {
      return null;
    }
    return (
      financialAreas.find(
        (item) => item.id === financialSelection.financialAreaId,
      ) ?? null
    );
  }, [financialAreas, financialSelection, isFinancialSelectionForCurrentScope]);
  const financialArea = useMemo<FinancialArea | null>(() => {
    if (isFinancialSelectionForCurrentScope) return selectedFinancialArea;
    return financialAreas.length === 1 ? (financialAreas[0] ?? null) : null;
  }, [
    financialAreas,
    isFinancialSelectionForCurrentScope,
    selectedFinancialArea,
  ]);

  const financialAreaStatus: FinancialContextStatus =
    status !== 'ready' || organization === null
      ? 'waiting'
      : !permissionsLoaded
        ? 'loading'
        : !canReadFinancialAreas
          ? 'forbidden'
          : financialAreasQuery.isPending
            ? 'loading'
            : financialAreasQuery.isError
              ? 'error'
              : financialAreas.length === 0
                ? 'empty'
                : isFinancialSelectionForCurrentScope &&
                    selectedFinancialArea === null
                  ? 'invalid'
                  : financialAreas.length > 1 &&
                      !isFinancialSelectionForCurrentScope
                    ? 'selecting'
                    : 'ready';

  const fiscalYearsQuery = useQuery({
    queryKey: queryKeys.accounting.financialContextFiscalYears(
      organization?.id ?? 'none',
      financialArea?.id ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listFiscalYears(
        {
          organizationId: organization?.id as string,
          financialAreaId: financialArea?.id,
          isActive: true,
          status: 'open',
        },
        signal,
      ),
    enabled:
      financialAreaStatus === 'ready' &&
      organization !== null &&
      financialArea !== null &&
      permissionsLoaded &&
      canReadFiscalYears,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Remove the *previous* child list only after React has committed the new
  // parent selection. Removing it synchronously in the area click handler can
  // wake the old query observer before the new key is rendered, leaving the
  // switcher on the prior area. Query keys still prevent cross-area reuse.
  useEffect(() => {
    const current =
      organization === null || financialArea === null
        ? null
        : {
            organizationId: organization.id,
            financialAreaId: financialArea.id,
          };
    const previous = previousFinancialArea.current;
    if (
      previous !== null &&
      (current === null ||
        previous.organizationId !== current.organizationId ||
        previous.financialAreaId !== current.financialAreaId)
    ) {
      queryClient.removeQueries({
        queryKey: queryKeys.accounting.financialContextFiscalYears(
          previous.organizationId,
          previous.financialAreaId,
        ),
      });
    }
    previousFinancialArea.current = current;
  }, [financialArea, organization, queryClient]);

  const fiscalYears = useMemo<readonly FiscalYear[]>(
    () =>
      (fiscalYearsQuery.data?.items ?? []).filter(
        (year) => year.financialAreaId === financialArea?.id,
      ),
    [financialArea?.id, fiscalYearsQuery.data],
  );
  const selectedFiscalYear = useMemo<FiscalYear | null>(() => {
    if (!isFinancialSelectionForCurrentScope || financialSelection === null) {
      return null;
    }
    if (financialSelection.fiscalYearId === null) return null;
    return (
      fiscalYears.find((item) => item.id === financialSelection.fiscalYearId) ??
      null
    );
  }, [financialSelection, fiscalYears, isFinancialSelectionForCurrentScope]);
  const fiscalYear = useMemo<FiscalYear | null>(() => {
    if (isFinancialSelectionForCurrentScope && selectedFiscalYear !== null) {
      return selectedFiscalYear;
    }
    return fiscalYears.length === 1 ? (fiscalYears[0] ?? null) : null;
  }, [fiscalYears, isFinancialSelectionForCurrentScope, selectedFiscalYear]);

  const fiscalYearStatus: FinancialContextStatus =
    financialAreaStatus !== 'ready' || financialArea === null
      ? 'waiting'
      : !permissionsLoaded
        ? 'loading'
        : !canReadFiscalYears
          ? 'forbidden'
          : fiscalYearsQuery.isPending
            ? 'loading'
            : fiscalYearsQuery.isError
              ? 'error'
              : fiscalYears.length === 0
                ? 'empty'
                : isFinancialSelectionForCurrentScope &&
                    financialSelection?.fiscalYearId !== null &&
                    selectedFiscalYear === null
                  ? 'invalid'
                  : fiscalYears.length > 1 && fiscalYear === null
                    ? 'selecting'
                    : 'ready';

  const selectOrganization = useCallback(
    (organizationId: string) => {
      if (!organizations.some((item) => item.id === organizationId)) return;
      if (user !== null) {
        setSelected({ userId: user.id, organizationId });
      }
      // Parent context changes invalidate every downstream selection. The
      // organization-scoped cache eviction is defense in depth over key scope.
      setFinancialSelection(null);
      queryClient.removeQueries({
        predicate: (query) =>
          isOtherOrganizationScope(query.queryKey, organizationId),
      });
    },
    [organizations, queryClient, user],
  );

  const selectFinancialArea = useCallback(
    (financialAreaId: string) => {
      if (organization === null || user === null) return;
      if (!financialAreas.some((item) => item.id === financialAreaId)) return;
      // Selecting a parent synchronously clears the child selection. The
      // previous child query is evicted by the committed-selection effect
      // above, avoiding an old-observer race inside the click event.
      setFinancialSelection({
        userId: user.id,
        organizationId: organization.id,
        financialAreaId,
        fiscalYearId: null,
      });
    },
    [financialAreas, organization, user],
  );

  const selectFiscalYear = useCallback(
    (fiscalYearId: string) => {
      if (organization === null || user === null || financialArea === null)
        return;
      if (!fiscalYears.some((item) => item.id === fiscalYearId)) return;
      setFinancialSelection({
        userId: user.id,
        organizationId: organization.id,
        financialAreaId: financialArea.id,
        fiscalYearId,
      });
    },
    [financialArea, fiscalYears, organization, user],
  );

  const refresh = useCallback(() => {
    void organizationsQuery.refetch();
  }, [organizationsQuery]);
  const refreshFinancialAreas = useCallback(() => {
    void financialAreasQuery.refetch();
  }, [financialAreasQuery]);
  const refreshFiscalYears = useCallback(() => {
    void fiscalYearsQuery.refetch();
  }, [fiscalYearsQuery]);

  const financialContextStatus =
    financialAreaStatus !== 'ready' ? financialAreaStatus : fiscalYearStatus;

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      organization,
      organizationId: organization?.id ?? null,
      status,
      error: organizationsQuery.error,
      canSwitch: organizations.length > 1,
      selectOrganization,
      refresh,
      financialAreas,
      financialArea,
      financialAreaId: financialArea?.id ?? null,
      financialAreaStatus,
      financialAreaError: financialAreasQuery.error,
      canSwitchFinancialArea: financialAreas.length > 1,
      selectFinancialArea,
      refreshFinancialAreas,
      fiscalYears,
      fiscalYear,
      fiscalYearId: fiscalYear?.id ?? null,
      fiscalYearStatus,
      fiscalYearError: fiscalYearsQuery.error,
      canSwitchFiscalYear: fiscalYears.length > 1,
      selectFiscalYear,
      refreshFiscalYears,
      financialContextStatus,
    }),
    [
      financialArea,
      financialAreaStatus,
      financialAreas,
      financialAreasQuery.error,
      financialContextStatus,
      fiscalYear,
      fiscalYearStatus,
      fiscalYears,
      fiscalYearsQuery.error,
      organization,
      organizations,
      organizationsQuery.error,
      refresh,
      refreshFinancialAreas,
      refreshFiscalYears,
      selectFinancialArea,
      selectFiscalYear,
      selectOrganization,
      status,
    ],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}
