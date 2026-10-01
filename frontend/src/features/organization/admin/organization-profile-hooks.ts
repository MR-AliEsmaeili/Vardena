import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { Organization, UpdateOrganizationRequest } from '@/api/contracts';
import {
  disableOrganization,
  enableOrganization,
  getOrganization,
  updateOrganization,
} from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';

/**
 * The ACTIVE organization's own record (`OrganizationsController`).
 *
 * The id always comes from `OrganizationContext` — never from the URL, a
 * form field or a stored preference — so these screens cannot be pointed at
 * an arbitrary organization to escape the current scope. A pinned deployment
 * (ADR-0025) refuses any other id anyway, and a non-member is answered 404.
 *
 * A successful write invalidates both the organization-scoped detail AND the
 * session-global organization list (`['organization','organizations',…]`),
 * because the switcher renders the name this mutation just changed.
 */

export function useOrganizationProfile(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.organizations.detail(organizationId ?? 'none'),
    queryFn: ({ signal }) => getOrganization(organizationId as string, signal),
    enabled: organizationId !== null,
  });
}

function useOrganizationInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return (organization: Organization) => {
    queryClient.setQueryData(
      queryKeys.organizations.detail(organizationId),
      organization,
    );
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.organizations.all() })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

export function useUpdateOrganizationMutation(
  organizationId: string,
): UseMutationResult<Organization, Error, UpdateOrganizationRequest> {
  const settle = useOrganizationInvalidation(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'organization', 'update'],
    mutationFn: (values: UpdateOrganizationRequest) =>
      updateOrganization(organizationId, values),
    onSuccess: settle,
  });
}

/**
 * Enable / disable the organization. There is no delete endpoint: a disabled
 * organization blocks the creation of new organization-scoped records and
 * keeps existing ones readable (`OrganizationResponseDto.isActive`).
 */
export function useOrganizationLifecycleMutation(
  organizationId: string,
): UseMutationResult<Organization, Error, { action: 'enable' | 'disable' }> {
  const settle = useOrganizationInvalidation(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'organization', 'lifecycle'],
    mutationFn: ({ action }: { action: 'enable' | 'disable' }) =>
      action === 'enable'
        ? enableOrganization(organizationId)
        : disableOrganization(organizationId),
    onSuccess: settle,
  });
}
