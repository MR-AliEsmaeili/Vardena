import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreatePartyRequest,
  Party,
  PartyListQuery,
  PartyType,
  UpdatePartyRequest,
} from '@/api/contracts';
import {
  createParty,
  disableParty,
  enableParty,
  getParty,
  listParties,
  updateParty,
} from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '../admin-list-state';

/**
 * Party queries and mutations (`PartiesController`).
 *
 * There is exactly ONE party concept: customer and supplier are capability
 * booleans on the same record, not separate resources (domain `party.ts`,
 * ADR-0020 §2). The list filters mirror that — `isCustomer` / `isSupplier`
 * narrow the same collection.
 */

export const PARTY_DEFAULT_SORT = 'code:asc';

export interface PartyExtraFilters {
  partyType: PartyType | '';
  /** `''` = no capability filter; otherwise exactly one of the two. */
  capability: 'customer' | 'supplier' | '';
}

export function buildPartyListQuery(
  organizationId: string,
  state: AdminListState,
  filters: PartyExtraFilters,
): PartyListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    ...(filters.partyType !== '' ? { partyType: filters.partyType } : {}),
    ...(filters.capability === 'customer' ? { isCustomer: true } : {}),
    ...(filters.capability === 'supplier' ? { isSupplier: true } : {}),
  };
}

export function usePartyList(
  organizationId: string | null,
  state: AdminListState,
  filters: PartyExtraFilters,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildPartyListQuery(organizationId as string, state, filters)
    : null;

  return useQuery({
    queryKey: queryKeys.organizations.partyList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) => listParties(query as PartyListQuery, signal),
    enabled,
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      !isOtherOrganizationScope(
        previousQuery.queryKey,
        organizationId ?? 'none',
      )
        ? previous
        : undefined,
  });
}

export function usePartyDetail(
  organizationId: string | null,
  partyId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.organizations.partyDetail(
      organizationId ?? 'none',
      partyId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getParty(organizationId as string, partyId as string, signal),
    enabled: organizationId !== null && partyId !== undefined,
  });
}

function usePartyInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.organizations.parties(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function usePartyCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (party: Party) => {
    queryClient.setQueryData(
      queryKeys.organizations.partyDetail(organizationId, party.id),
      party,
    );
  };
}

export function useCreatePartyMutation(
  organizationId: string,
): UseMutationResult<Party, Error, Omit<CreatePartyRequest, 'organizationId'>> {
  const invalidate = usePartyInvalidation(organizationId);
  const cache = usePartyCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'parties', 'create'],
    mutationFn: (values: Omit<CreatePartyRequest, 'organizationId'>) =>
      createParty({ organizationId, ...values }),
    onSuccess: (party) => {
      cache(party);
      invalidate();
    },
  });
}

export interface UpdatePartyVariables {
  partyId: string;
  values: UpdatePartyRequest;
}

export function useUpdatePartyMutation(
  organizationId: string,
): UseMutationResult<Party, Error, UpdatePartyVariables> {
  const invalidate = usePartyInvalidation(organizationId);
  const cache = usePartyCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'parties', 'update'],
    mutationFn: ({ partyId, values }: UpdatePartyVariables) =>
      updateParty(organizationId, partyId, values),
    onSuccess: (party) => {
      cache(party);
      invalidate();
    },
  });
}

export function usePartyLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  Party,
  Error,
  { partyId: string; action: 'enable' | 'disable' }
> {
  const invalidate = usePartyInvalidation(organizationId);
  const cache = usePartyCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'parties', 'lifecycle'],
    mutationFn: ({
      partyId,
      action,
    }: {
      partyId: string;
      action: 'enable' | 'disable';
    }) =>
      action === 'enable'
        ? enableParty(organizationId, partyId)
        : disableParty(organizationId, partyId),
    onSuccess: (party) => {
      cache(party);
      invalidate();
    },
  });
}
