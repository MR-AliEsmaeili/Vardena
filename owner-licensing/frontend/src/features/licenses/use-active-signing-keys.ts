import { useQuery } from '@tanstack/react-query';
import * as owner from '@/api/owner.api';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * Active Owner signing keys, from the administrative record (OQ-74).
 *
 * The picker only offers keys the Owner has marked `ACTIVE`; whether the key is
 * also present in the signer's trust list is a backend decision
 * (`OWNER_LICENSE_TRUSTED_PUBLIC_KEYS`), and preparation refuses otherwise.
 * Reading keys needs `customers.view`, so a session without it simply gets an
 * empty list and the fallback free-text field in the form.
 */
export function useActiveSigningKeys() {
  const permissions = usePermissions();
  return useQuery({
    queryKey: ['owner', 'signing-keys', 'active', 'licensing-picker'],
    queryFn: ({ signal }) =>
      owner.signingKeys('', 1, { status: 'ACTIVE' }, signal),
    enabled: permissions.has('customers.view'),
    staleTime: 60_000,
  });
}
