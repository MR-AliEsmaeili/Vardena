import {
  isValidPermissionCode,
  PERMISSION_CODE_RULE,
} from './permission-code.js';

/**
 * A permission as defined by the module that owns it (ADR-0006, AR-22).
 *
 * Modules register their definitions in code; `rbac.permissions` mirrors the
 * registry so roles can be administered without free-text permission entry.
 * A permission that no code checks must not exist.
 *
 * Framework-free (AR-05).
 */
export interface PermissionDefinition {
  /** `Module.Entity.Action` code, e.g. `Users.User.View`. */
  code: string;
  /** Human-readable description shown in the role administration UI. */
  description: string;
}

/**
 * Validate a set of permission definitions at registration time.
 *
 * This is a programmer-error check, not a business rule: a malformed or
 * duplicated code means two modules disagree about the security vocabulary,
 * so the application must fail loudly at startup instead of silently
 * accepting it (and instead of creating a permission nobody can evaluate).
 *
 * @throws Error when a code is malformed or registered twice.
 */
export function assertValidPermissionDefinitions(
  definitions: readonly PermissionDefinition[],
): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!isValidPermissionCode(definition.code)) {
      throw new Error(
        `Invalid permission code "${definition.code}". ${PERMISSION_CODE_RULE}`,
      );
    }
    if (definition.description.trim().length === 0) {
      throw new Error(
        `Permission "${definition.code}" must have a description (the role admin UI shows it).`,
      );
    }
    if (seen.has(definition.code)) {
      throw new Error(
        `Duplicate permission code "${definition.code}" in a single registration.`,
      );
    }
    seen.add(definition.code);
  }
}
