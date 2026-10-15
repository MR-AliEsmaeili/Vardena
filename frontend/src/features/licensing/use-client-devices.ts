import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  ClientDeviceHistory,
  ClientDeviceInventory,
  CreateDeviceEnrollmentChallengeRequest,
  CreateDeviceReplacementChallengeRequest,
  DeviceEnrollmentChallenge,
  DeviceReplacementChallenge,
  DeviceReplacementCompletion,
  DeviceReplacementRequestExport,
  DeviceReplacementResult,
  ImportDeviceReplacementResponseRequest,
  ProveDeviceEnrollmentRequest,
  ProveDeviceReplacementRequest,
} from '@/api/contracts';
import {
  activateDeviceEnrollment,
  cancelDeviceReplacement,
  createDeviceEnrollmentChallenge,
  createDeviceReplacementChallenge,
  deactivateClientDevice,
  exportDeviceReplacementRequest,
  getClientDeviceHistory,
  getClientDeviceInventory,
  importDeviceReplacementResponse,
  proveDeviceReplacement,
} from '@/api/licensing.api';
import { queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/** One backend-owned source for device state and authoritative signed quota. */
export function useClientDeviceInventory() {
  const { status: sessionStatus } = useSession();
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.clientDeviceInventory(),
    queryFn: ({ signal }) => getClientDeviceInventory(signal),
    enabled:
      sessionStatus === 'authenticated' &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.licensing.deviceView),
    retry: false,
    staleTime: 20_000,
  });
}

export function useClientDeviceHistory(deviceId: string | null) {
  const { status: sessionStatus } = useSession();
  const permissions = usePermissions();
  return useQuery<ClientDeviceHistory>({
    queryKey:
      deviceId === null
        ? ['licensing', 'devices', 'history', 'none']
        : queryKeys.clientDeviceHistory(deviceId),
    queryFn: ({ signal }) => getClientDeviceHistory(deviceId!, signal),
    enabled:
      deviceId !== null &&
      sessionStatus === 'authenticated' &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.licensing.deviceView),
    retry: false,
  });
}

function useLifecycleMutation<TData, TVariables>(
  action: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
): UseMutationResult<TData, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['licensing', 'devices', action],
    mutationFn: (variables) => mutationFn(variables),
    retry: false,
    // No device key or signed exchange document is retained in a mutation
    // cache after the request settles; no persistence provider is configured.
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.clientDevicesPrefix(),
        refetchType: 'all',
      });
    },
  });
}

export function useCreateEnrollmentChallengeMutation(): UseMutationResult<
  DeviceEnrollmentChallenge,
  Error,
  CreateDeviceEnrollmentChallengeRequest
> {
  return useLifecycleMutation(
    'enrollment-challenge',
    createDeviceEnrollmentChallenge,
  );
}

export interface ActivateEnrollmentVariables {
  challengeId: string;
  request: ProveDeviceEnrollmentRequest;
}

export function useActivateEnrollmentMutation(): UseMutationResult<
  Awaited<ReturnType<typeof activateDeviceEnrollment>>,
  Error,
  ActivateEnrollmentVariables
> {
  return useLifecycleMutation('activate', ({ challengeId, request }) =>
    activateDeviceEnrollment(challengeId, request),
  );
}

export interface DeactivateDeviceVariables {
  deviceId: string;
}

export function useDeactivateDeviceMutation(): UseMutationResult<
  Awaited<ReturnType<typeof deactivateClientDevice>>,
  Error,
  DeactivateDeviceVariables
> {
  return useLifecycleMutation('deactivate', ({ deviceId }) =>
    deactivateClientDevice(deviceId),
  );
}

export interface CreateReplacementChallengeVariables {
  oldDeviceId: string;
  request: CreateDeviceReplacementChallengeRequest;
}

export function useCreateReplacementChallengeMutation(): UseMutationResult<
  DeviceReplacementChallenge,
  Error,
  CreateReplacementChallengeVariables
> {
  return useLifecycleMutation(
    'replacement-challenge',
    ({ oldDeviceId, request }) =>
      createDeviceReplacementChallenge(oldDeviceId, request),
  );
}

export interface ProveReplacementVariables {
  requestId: string;
  request: ProveDeviceReplacementRequest;
}

export function useProveReplacementMutation(): UseMutationResult<
  DeviceReplacementRequestExport,
  Error,
  ProveReplacementVariables
> {
  return useLifecycleMutation('replacement-proof', ({ requestId, request }) =>
    proveDeviceReplacement(requestId, request),
  );
}

export function useExportReplacementRequestMutation(): UseMutationResult<
  DeviceReplacementRequestExport,
  Error,
  { requestId: string }
> {
  return useLifecycleMutation('replacement-export', ({ requestId }) =>
    exportDeviceReplacementRequest(requestId),
  );
}

export function useImportReplacementResponseMutation(): UseMutationResult<
  DeviceReplacementCompletion,
  Error,
  ImportDeviceReplacementResponseRequest
> {
  return useLifecycleMutation(
    'replacement-import',
    importDeviceReplacementResponse,
  );
}

export function useCancelReplacementMutation(): UseMutationResult<
  DeviceReplacementResult,
  Error,
  { requestId: string }
> {
  return useLifecycleMutation('replacement-cancel', ({ requestId }) =>
    cancelDeviceReplacement(requestId),
  );
}

/** Re-exported for pages that render the inventory's signed quota snapshot. */
export type { ClientDeviceInventory };
