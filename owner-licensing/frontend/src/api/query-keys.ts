import type { AuditQuery } from './contracts';

export const queryKeys = {
  session: () => ['owner', 'session'] as const,
  effectivePermissions: () => ['owner', 'permissions'] as const,
  /** The full normalized query is part of the key so each filter/page is cached separately. */
  auditEvents: (query: AuditQuery) => ['owner', 'audit', query] as const,
  auditArchiveStatus: () => ['owner', 'audit-archive', 'status'] as const,
  auditArchiveBatches: (page = 1) =>
    ['owner', 'audit-archive', 'batches', page] as const,
};
