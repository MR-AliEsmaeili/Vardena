import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryReservationInput,
  InventoryReservation,
  InventoryReservationListQuery,
  ReleaseInventoryReservationInput,
} from '@/api/contracts';
import {
  createReservation,
  getReservation,
  listReservations,
  releaseReservation,
} from '@/api/inventory.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { ReservationsUrlState } from './reservation-url-state';

/** Exact request query supported by `InventoryReservationsController.list`. */
export function buildReservationsQuery(
  organizationId: string,
  state: ReservationsUrlState,
): InventoryReservationListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.warehouseId !== '' ? { warehouseId: state.warehouseId } : {}),
    ...(state.itemId !== '' ? { itemId: state.itemId } : {}),
    ...(state.status !== '' ? { status: state.status } : {}),
  };
}

/** Server-paged reservation list, isolated by organization and URL filters. */
export function useReservations(
  organizationId: string | null,
  state: ReservationsUrlState,
) {
  const query =
    organizationId === null
      ? null
      : buildReservationsQuery(organizationId, state);

  return useQuery({
    queryKey: queryKeys.inventory.reservations(
      organizationId ?? 'none',
      query ?? {},
    ),
    queryFn: ({ signal }) =>
      listReservations(query as InventoryReservationListQuery, signal),
    enabled: query !== null,
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

/** One reservation, scoped by the active organization. */
export function useReservation(
  organizationId: string | null,
  reservationId: string | undefined,
) {
  const enabled = organizationId !== null && reservationId !== undefined;
  return useQuery({
    queryKey: queryKeys.inventory.reservationDetail(
      organizationId ?? 'none',
      reservationId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getReservation(organizationId as string, reservationId as string, signal),
    enabled,
  });
}

async function invalidateReservationReads(
  organizationId: string,
  reservationId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  const keys = [
    queryKeys.inventory.reservationsPrefix(organizationId),
    queryKeys.inventory.reservationDetail(organizationId, reservationId),
    // Reservations change `reserved`/`available`, not on-hand or the ledger.
    // The current balance list is the only availability-bearing UI query key.
    queryKeys.inventory.balancesPrefix(organizationId),
  ];
  await Promise.all(
    keys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }).then(
        () => undefined,
        () => undefined,
      ),
    ),
  );
}

export type CreateReservationVariables = Omit<
  CreateInventoryReservationInput,
  'organizationId'
>;

/** No optimistic balance change; the server response is authoritative. */
export function useCreateReservationMutation(
  organizationId: string,
): UseMutationResult<InventoryReservation, Error, CreateReservationVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'reservations', 'create'],
    mutationFn: (values) => createReservation({ ...values, organizationId }),
    onSuccess: (reservation) =>
      invalidateReservationReads(organizationId, reservation.id, queryClient),
  });
}

export interface ReleaseReservationVariables {
  reservationId: string;
  body: ReleaseInventoryReservationInput;
}

/** Release is terminal; a retry uses the same operation key in the body. */
export function useReleaseReservationMutation(
  organizationId: string,
): UseMutationResult<InventoryReservation, Error, ReleaseReservationVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'reservations', 'release'],
    mutationFn: ({ reservationId, body }) =>
      releaseReservation(organizationId, reservationId, body),
    onSuccess: (reservation) =>
      invalidateReservationReads(organizationId, reservation.id, queryClient),
  });
}
