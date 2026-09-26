import { useContext } from 'react';
import {
  OrganizationContext,
  type OrganizationContextValue,
} from './organization-context';

/** Current organization scope. Throws outside `OrganizationProvider`. */
export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (context === null) {
    throw new Error(
      'useOrganization must be used inside <OrganizationProvider>.',
    );
  }
  return context;
}

/**
 * The organization id for a scoped request, or `null` while it is unknown.
 * Callers must keep their query disabled while it is `null` — a scoped
 * request without an organization is meaningless to the API.
 */
export function useOrganizationId(): string | null {
  return useOrganization().organizationId;
}
