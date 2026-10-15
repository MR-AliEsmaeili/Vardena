export const queryKeys = {
  session: () => ['owner', 'session'] as const,
  effectivePermissions: () => ['owner', 'permissions'] as const,
};
