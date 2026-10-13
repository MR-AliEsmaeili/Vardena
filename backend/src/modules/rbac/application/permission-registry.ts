import { Injectable } from '@nestjs/common';
import {
  assertValidPermissionDefinitions,
  type PermissionDefinition,
} from '../domain/permission-definition.js';

/**
 * In-code permission registry (ADR-0006, AR-22).
 *
 * Each module registers its permission definitions once at startup; RBAC
 * mirrors the registry into `rbac.permissions` so roles can be administered
 * without free-text permission entry. This class is the RBAC module's public
 * surface for *registration* — modules declare their vocabulary here and
 * nowhere else.
 *
 * Guarantees:
 * - a code registered twice (by the same or another module) is a startup
 *   error — two modules must never race for one security identifier;
 * - malformed codes (`Module.Entity.Action` violations) are rejected before
 *   they can reach the database.
 *
 * The registry is held in memory because it is static code-defined data;
 * correctness of *authorization* never depends on it (the evaluator reads the
 * assignment tables), so a stale registry cannot grant access.
 */
@Injectable()
export class PermissionRegistry {
  private readonly definitions = new Map<string, PermissionDefinition>();

  /**
   * Register a module's permission definitions.
   *
   * @throws Error on a malformed code, a missing description, or a code that
   * was already registered (programmer error — fail fast at startup).
   */
  register(definitions: readonly PermissionDefinition[]): void {
    assertValidPermissionDefinitions(definitions);
    for (const definition of definitions) {
      if (this.definitions.has(definition.code)) {
        throw new Error(
          `Permission "${definition.code}" is already registered by another module.`,
        );
      }
    }
    for (const definition of definitions) {
      this.definitions.set(definition.code, { ...definition });
    }
  }

  /** All registered definitions, ordered by code. */
  all(): PermissionDefinition[] {
    return [...this.definitions.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
  }

  /** True when the code is part of the code-defined registry. */
  has(code: string): boolean {
    return this.definitions.has(code);
  }

  get size(): number {
    return this.definitions.size;
  }
}
