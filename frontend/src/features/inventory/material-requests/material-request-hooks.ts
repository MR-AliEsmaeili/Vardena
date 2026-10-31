import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateMaterialRequestInput,
  MaterialRequestDetail,
  MaterialRequestListQuery,
  UpdateMaterialRequestInput,
} from '@/api/contracts';
import {
  approveMaterialRequest,
  cancelMaterialRequest,
  createMaterialRequest,
  deleteMaterialRequest,
  getMaterialRequest,
  listMaterialRequestEvents,
  listMaterialRequests,
  rejectMaterialRequest,
  returnMaterialRequestForCorrection,
  reverseMaterialRequestApproval,
  submitMaterialRequest,
  updateMaterialRequest,
} from '@/api/inventory.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { MaterialRequestsUrlState } from './material-request-url-state';

/** Exact request query supported by `MaterialRequestsController.list`. */
export function buildMaterialRequestsQuery(
  organizationId: string,
  state: MaterialRequestsUrlState,
): MaterialRequestListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.status !== '' ? { status: state.status } : {}),
    ...(state.requestedBy !== '' ? { requestedBy: state.requestedBy } : {}),
  };
}

/** Server-paged request list, isolated by organization and URL filters. */
export function useMaterialRequests(
  organizationId: string | null,
  state: MaterialRequestsUrlState,
) {
  const query =
    organizationId === null
      ? null
      : buildMaterialRequestsQuery(organizationId, state);

  return useQuery({
    queryKey: queryKeys.inventory.materialRequests(
      organizationId ?? 'none',
      query ?? {},
    ),
    queryFn: ({ signal }) =>
      listMaterialRequests(query as MaterialRequestListQuery, signal),
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

/** One request with its lines, scoped by the active organization. */
export function useMaterialRequest(
  organizationId: string | null,
  requestId: string | undefined,
) {
  const enabled = organizationId !== null && requestId !== undefined;
  return useQuery({
    queryKey: queryKeys.inventory.materialRequestDetail(
      organizationId ?? 'none',
      requestId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getMaterialRequest(organizationId as string, requestId as string, signal),
    enabled,
  });
}

/** The append-only event narrative (unpaged, `occurredAt asc`). */
export function useMaterialRequestEvents(
  organizationId: string | null,
  requestId: string | undefined,
) {
  const enabled = organizationId !== null && requestId !== undefined;
  return useQuery({
    queryKey: queryKeys.inventory.materialRequestEvents(
      organizationId ?? 'none',
      requestId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      listMaterialRequestEvents(
        organizationId as string,
        requestId as string,
        signal,
      ),
    enabled,
  });
}

/**
 * Every read a write can invalidate: the paged list prefix, the request's own
 * detail and its event narrative.
 *
 * `touchesStock` adds the availability-bearing reads. Approval creates a
 * reservation for every flagged line and reversal/cancellation releases those
 * reservations, so `reserved`/`available` move — but `on_hand` never does
 * (a Material Request is demand, never a movement). No optimistic update
 * anywhere: the server response is the only authority.
 */
async function invalidateMaterialRequestReads(
  organizationId: string,
  requestId: string,
  queryClient: ReturnType<typeof useQueryClient>,
  options: { touchesStock?: boolean } = {},
): Promise<void> {
  const keys = [
    queryKeys.inventory.materialRequestsPrefix(organizationId),
    queryKeys.inventory.materialRequestDetail(organizationId, requestId),
    queryKeys.inventory.materialRequestEvents(organizationId, requestId),
    ...(options.touchesStock === true
      ? [
          queryKeys.inventory.balancesPrefix(organizationId),
          queryKeys.inventory.reservationsPrefix(organizationId),
        ]
      : []),
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

export type CreateMaterialRequestVariables = Omit<
  CreateMaterialRequestInput,
  'organizationId'
>;

/** No optimistic row: the server response is the only authority. */
export function useCreateMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  CreateMaterialRequestVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'create'],
    mutationFn: (values) =>
      createMaterialRequest({ ...values, organizationId }),
    onSuccess: (created) =>
      invalidateMaterialRequestReads(organizationId, created.id, queryClient),
  });
}

export interface UpdateMaterialRequestVariables {
  requestId: string;
  body: UpdateMaterialRequestInput;
}

export function useUpdateMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  UpdateMaterialRequestVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'update'],
    mutationFn: ({ requestId, body }) =>
      updateMaterialRequest(organizationId, requestId, body),
    onSuccess: (updated) =>
      invalidateMaterialRequestReads(organizationId, updated.id, queryClient),
  });
}

export function useDeleteMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'delete'],
    mutationFn: (requestId) => deleteMaterialRequest(organizationId, requestId),
    onSuccess: (_result, requestId) =>
      invalidateMaterialRequestReads(organizationId, requestId, queryClient),
  });
}

export function useSubmitMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<MaterialRequestDetail, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'submit'],
    mutationFn: (requestId) => submitMaterialRequest(organizationId, requestId),
    onSuccess: (submitted) =>
      invalidateMaterialRequestReads(organizationId, submitted.id, queryClient),
  });
}

// ---------------------------------------------------------------------------
// Approval cycle (INV-07) — five decision commands
//
// Each mutation answers the full detail DTO, so the page re-reads status,
// decision timestamps and lines from the server. No optimistic update: these
// commands create/release reservations atomically on the backend.
// ---------------------------------------------------------------------------

export interface MaterialRequestReasonVariables {
  requestId: string;
  /** Trimmed reason, or `null`/omitted for the optional-reason commands. */
  reason?: string | null;
}

function stockAwareInvalidation(
  organizationId: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return (updated: MaterialRequestDetail) =>
    invalidateMaterialRequestReads(organizationId, updated.id, queryClient, {
      touchesStock: true,
    });
}

function plainInvalidation(
  organizationId: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return (updated: MaterialRequestDetail) =>
    invalidateMaterialRequestReads(organizationId, updated.id, queryClient);
}

/** Approve (no body); reserves every flagged line, so stock reads move too. */
export function useApproveMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<MaterialRequestDetail, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'approve'],
    mutationFn: (requestId) =>
      approveMaterialRequest(organizationId, requestId),
    onSuccess: stockAwareInvalidation(organizationId, queryClient),
  });
}

/** Reject with a REQUIRED reason; no reservation exists, so stock is untouched. */
export function useRejectMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  MaterialRequestReasonVariables & { reason: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'reject'],
    mutationFn: ({ requestId, reason }) =>
      rejectMaterialRequest(organizationId, requestId, { reason }),
    onSuccess: plainInvalidation(organizationId, queryClient),
  });
}

/** Return for correction with a REQUIRED reason. */
export function useReturnMaterialRequestForCorrectionMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  MaterialRequestReasonVariables & { reason: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [
      'inventory',
      organizationId,
      'material-requests',
      'return-for-correction',
    ],
    mutationFn: ({ requestId, reason }) =>
      returnMaterialRequestForCorrection(organizationId, requestId, { reason }),
    onSuccess: plainInvalidation(organizationId, queryClient),
  });
}

/** Reverse an approval with an OPTIONAL reason; released reservations move stock. */
export function useReverseMaterialRequestApprovalMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  MaterialRequestReasonVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [
      'inventory',
      organizationId,
      'material-requests',
      'reverse-approval',
    ],
    mutationFn: ({ requestId, reason }) =>
      reverseMaterialRequestApproval(organizationId, requestId, {
        reason: reason ?? null,
      }),
    onSuccess: stockAwareInvalidation(organizationId, queryClient),
  });
}

/** Cancel an approved request (terminal) with an OPTIONAL reason. */
export function useCancelMaterialRequestMutation(
  organizationId: string,
): UseMutationResult<
  MaterialRequestDetail,
  Error,
  MaterialRequestReasonVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'material-requests', 'cancel'],
    mutationFn: ({ requestId, reason }) =>
      cancelMaterialRequest(organizationId, requestId, {
        reason: reason ?? null,
      }),
    onSuccess: stockAwareInvalidation(organizationId, queryClient),
  });
}
