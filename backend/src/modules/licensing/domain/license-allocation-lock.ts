/**
 * One canonical name for each installation-scoped licensed allocation lock.
 * The same transaction-scoped key is held by the owning write path and by the
 * signed-license import's §8.6 usage read, so a concurrent allocation cannot
 * slip between a count and the license-version commit.
 */
export type LicenseAllocationResource =
  'organizations' | 'active-users' | 'devices';

export function licenseAllocationLockKey(
  installationId: string,
  resource: LicenseAllocationResource,
): string {
  return `vardena:license:${installationId}:${resource}`;
}
