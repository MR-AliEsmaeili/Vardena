/**
 * Permission entity (docs/modules.md §RBAC, ADR-0006).
 *
 * `rbac.permissions` is the DB **mirror** of the code-defined registry: rows
 * are created/updated by the registry sync at startup, never through the API.
 * That is what keeps "a permission no code checks cannot exist" true.
 *
 * Framework-free (AR-05).
 */
export interface Permission {
  id: string;
  /** `Module.Entity.Action` — see `permission-code.ts`. */
  code: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Permission reference used in responses (no internal ids leak out). */
export interface PermissionRef {
  code: string;
  description: string;
}

/**
 * Result of mirroring the code registry into `rbac.permissions`.
 * Reported by the startup sync so operators can see what changed.
 */
export interface PermissionSyncResult {
  created: number;
  updated: number;
  total: number;
}
