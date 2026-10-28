import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  createReservation,
  getReservation,
  listReservations,
  releaseReservation,
  type CreateReservationInput,
  type InventoryReservation,
  type ListInventoryReservationsQuery,
} from '@/api/inventory.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';

/** Sort fields the reservations service allow-lists. */
export const RESERVATION_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
] as const;
export const RESERVATIONS_DEFAULT_SORT = 'createdAt:desc';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

export interface ReservationsUrlState {
  page: number;
  pageSize: number;
  sort: string;
  warehouseId: string;
  itemId: string;
  status: string;
}

export function parseReservationsUrlState(
  params: URLSearchParams,
): ReservationsUrlState {
  const pageValue = Number(params.get('page'));
  const page =
    Number.isInteger(pageValue) && pageValue >= 1 ? Math.trunc(pageValue) : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    pageSizeValue,
  )
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;

  const sortRaw = params.get('sort');
  const sort =
    sortRaw !== null &&
    (RESERVATION_SORT_FIELDS as readonly string[]).some(
      (f) => sortRaw === f || sortRaw === `${f}:asc` || sortRaw === `${f}:desc`,
    )
      ? sortRaw
      : RESERVATIONS_DEFAULT_SORT;

  return {
    page,
    pageSize,
    sort,
    warehouseId: params.get('warehouseId') ?? '',
    itemId: params.get('itemId') ?? '',
    status: params.get('status') ?? '',
  };
}

export type ReservationsUrlUpdate = Partial<
  Omit<ReservationsUrlState, 'page' | 'pageSize' | 'sort'>
> & {
  page?: number | null;
  pageSize?: number;
  sort?: string;
};

export function useReservationsUrlState() {
  const [params, setParams] = useSearchParams();
  const state = parseReservationsUrlState(params);

  const update = useCallback(
    (changes: ReservationsUrlUpdate) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        const apply = (
          key: string,
          value: string | number | null | undefined,
        ) => {
          if (value === null || value === undefined || value === '') {
            next.delete(key);
          } else {
            next.set(key, String(value));
          }
        };
        const resetPage = 'page' in changes;
        for (const [key, value] of Object.entries(changes)) {
          if (key === 'page') continue;
          apply(
            key,
            key === 'sort' && value === RESERVATIONS_DEFAULT_SORT
              ? null
              : value,
          );
        }
        if (resetPage) {
          const page = changes.page;
          if (page === null || page === undefined || page === 1) {
            next.delete('page');
          } else {
            next.set('page', String(page));
          }
        }
        return next;
      });
    },
    [setParams],
  );

  const clearFilters = useCallback(() => {
    setParams(() => new URLSearchParams());
  }, [setParams]);

  return { state, update, clearFilters };
}

export function buildReservationsQuery(
  organizationId: string,
  state: ReservationsUrlState,
): ListInventoryReservationsQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.warehouseId !== '' ? { warehouseId: state.warehouseId } : {}),
    ...(state.itemId !== '' ? { itemId: state.itemId } : {}),
    ...(state.status !== ''
      ? { status: state.status as 'active' | 'released' }
      : {}),
  };
}

/** Reservations list of the active organization. */
export function useReservationsList(
  organizationId: string | null,
  state: ReservationsUrlState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildReservationsQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.reservations(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listReservations(query as ListInventoryReservationsQuery, signal),
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

/** One reservation of the active organization. */
export function useReservation(
  organizationId: string | null,
  reservationId: string | null,
) {
  const enabled = organizationId !== null && reservationId !== null;
  return useQuery({
    queryKey: queryKeys.inventory.reservation(
      organizationId ?? 'none',
      reservationId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getReservation(organizationId as string, reservationId as string, signal),
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

function reservationInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const prefixes = [
      queryKeys.inventory.reservationsPrefix(organizationId),
      queryKeys.inventory.balancesPrefix(organizationId),
    ];
    void Promise.all(
      prefixes.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
  };
}

export interface CreateReservationVariables {
  values: Omit<CreateReservationInput, 'organizationId' | 'operationKey'>;
  operationKey: string;
}

export function useCreateReservationMutation(
  organizationId: string,
): UseMutationResult<InventoryReservation, Error, CreateReservationVariables> {
  const invalidate = reservationInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'reservations', 'create'],
    mutationFn: ({ values, operationKey }: CreateReservationVariables) =>
      createReservation({
        organizationId,
        operationKey,
        ...values,
      }),
    onSuccess: () => invalidate(),
  });
}

export interface ReleaseReservationVariables {
  reservationId: string;
  operationKey: string;
}

export function useReleaseReservationMutation(
  organizationId: string,
): UseMutationResult<InventoryReservation, Error, ReleaseReservationVariables> {
  const invalidate = reservationInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'reservations', 'release'],
    mutationFn: ({ reservationId, operationKey }) =>
      releaseReservation(organizationId, reservationId, { operationKey }),
    onSuccess: () => invalidate(),
  });
}
