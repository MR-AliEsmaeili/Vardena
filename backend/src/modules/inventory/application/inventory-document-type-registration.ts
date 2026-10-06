import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DocumentTypeRegistry } from '../../documents/application/document-type-registry.js';
import { INVENTORY_DOCUMENT_TYPE_DEFINITIONS } from '../domain/inventory-document-types.js';

/**
 * Registers the three Inventory Business Document types (C-58) in the
 * Documents Foundation registry at startup, the same mechanism Material
 * Request and Accounting use. Registration exists SOLELY so an organization
 * can configure a numbering series per type — see
 * `domain/inventory-document-types.ts`.
 */
@Injectable()
export class InventoryDocumentTypeRegistration implements OnModuleInit {
  constructor(private readonly registry: DocumentTypeRegistry) {}

  onModuleInit(): void {
    this.registry.register([...INVENTORY_DOCUMENT_TYPE_DEFINITIONS]);
  }
}
