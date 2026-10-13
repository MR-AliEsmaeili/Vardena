import { Injectable } from '@nestjs/common';
import {
  assertValidDocumentTypeDefinitions,
  type DocumentTypeDefinition,
} from '../domain/document-type.js';

/**
 * In-code document type registry (Task 8 §6, ADR-0019 §4).
 *
 * The controlled mechanism through which modules declare their document types.
 * Document types are CODE — this registry is the single source of truth for
 * "which document types exist", exactly like `PermissionRegistry` is for
 * permissions. There is no `document_types` table and no way for a client to
 * invent a type.
 *
 * Registration is a startup side effect of the owning module (future
 * Inventory/Sales/Purchasing/Accounting modules register their types here).
 * Task 8 registers none: no future module type is hard-coded into the
 * Foundation, so the registry starts empty and the mechanism is exercised by
 * tests. A registered code is never removed at runtime (like permission codes,
 * OQ-20 pattern) — removing a type from code is a code change with its own
 * migration story, not a runtime operation.
 */

@Injectable()
export class DocumentTypeRegistry {
  private readonly definitions = new Map<string, DocumentTypeDefinition>();

  /**
   * Register a module's document types.
   *
   * @throws Error on a malformed definition or a code already registered
   *   (programmer error — fail fast at startup, like the permission registry).
   */
  register(definitions: readonly DocumentTypeDefinition[]): void {
    assertValidDocumentTypeDefinitions(definitions);
    for (const definition of definitions) {
      if (this.definitions.has(definition.code)) {
        throw new Error(
          `Document type "${definition.code}" is already registered by another module.`,
        );
      }
    }
    for (const definition of definitions) {
      this.definitions.set(definition.code, { ...definition });
    }
  }

  get(code: string): DocumentTypeDefinition | undefined {
    return this.definitions.get(code);
  }

  has(code: string): boolean {
    return this.definitions.has(code);
  }

  all(): DocumentTypeDefinition[] {
    return [...this.definitions.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
  }

  get size(): number {
    return this.definitions.size;
  }
}
