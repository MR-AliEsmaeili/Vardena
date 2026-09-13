import { Injectable } from '@nestjs/common';
import {
  isValidWorkflowCode,
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
} from '../domain/workflow-codes.js';

/**
 * In-code automation action catalogue (Task 9 §18, ADR-0018 §4).
 *
 * The controlled mechanism through which application code declares the
 * automation actions workflow transitions may bind to. Actions are CODE —
 * this registry is the single source of truth for "which actions exist",
 * exactly like `PermissionRegistry` is for permissions and
 * `DocumentTypeRegistry` is for document types. There is no action table
 * and no way for a client to invent an action: no user scripts, no stored
 * code, no generic expressions.
 *
 * Registration is a startup side effect of the owning module (the future
 * automation dispatcher registers its actions here with their handlers).
 * Task 9 registers NONE: executing external effects through the
 * outbox/worker is future work, so the registry starts empty and the
 * mechanism is exercised by tests. A registered action is never removed at
 * runtime (OQ-20 pattern) — removing an action from code is a code change
 * with its own migration story, not a runtime operation.
 *
 * v1 REPORTS bound actions on the transition event; it runs none.
 */
export interface AutomationActionDefinition {
  /** Stable snake_case code, e.g. `notify`. */
  action: string;
  /** Human-readable name for UIs and configuration screens. */
  name: string;
  description?: string | undefined;
}

@Injectable()
export class AutomationActionRegistry {
  private readonly definitions = new Map<string, AutomationActionDefinition>();

  /**
   * Register automation actions.
   *
   * @throws Error on a malformed definition or an action already registered
   *   (programmer error — fail fast at startup, like the permission registry).
   */
  register(definitions: readonly AutomationActionDefinition[]): void {
    for (const definition of definitions) {
      assertValidActionDefinition(definition);
      if (this.definitions.has(definition.action)) {
        throw new Error(
          `Automation action "${definition.action}" is already registered by another module.`,
        );
      }
    }
    for (const definition of definitions) {
      this.definitions.set(definition.action, { ...definition });
    }
  }

  get(action: string): AutomationActionDefinition | undefined {
    return this.definitions.get(action);
  }

  has(action: string): boolean {
    return this.definitions.has(action);
  }

  all(): AutomationActionDefinition[] {
    return [...this.definitions.values()].sort((a, b) =>
      a.action.localeCompare(b.action),
    );
  }

  get size(): number {
    return this.definitions.size;
  }
}

function assertValidActionDefinition(
  definition: AutomationActionDefinition,
): void {
  if (!isValidWorkflowCode(definition.action)) {
    throw new Error(
      `Invalid automation action "${definition.action}". Actions must be lowercase snake_case (1–${MAX_WORKFLOW_CODE_LENGTH} characters).`,
    );
  }
  if (definition.name.trim().length === 0) {
    throw new Error(
      `Automation action "${definition.action}" must have a name.`,
    );
  }
  if (definition.name.length > MAX_WORKFLOW_NAME_LENGTH) {
    throw new Error(
      `Automation action "${definition.action}" name is too long (max ${MAX_WORKFLOW_NAME_LENGTH}).`,
    );
  }
}
