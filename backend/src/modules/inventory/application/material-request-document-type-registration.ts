import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DocumentTypeRegistry } from '../../documents/application/document-type-registry.js';
import { MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION } from '../domain/material-request-document-type.js';

/**
 * Registers Material Request's document type in the Documents Foundation's
 * registry at startup (C-50), the same mechanism
 * `AccountingDocumentTypeRegistration` uses — see
 * `domain/material-request-document-type.ts` for why this registration
 * exists (numbering only) and what it deliberately does NOT do.
 *
 * `InventoryModule` imports `DocumentsModule` directly, so Nest's
 * dependency-graph initialization order guarantees `DocumentTypeRegistry`
 * exists before this runs, regardless of `AppModule`'s own import order.
 */
@Injectable()
export class MaterialRequestDocumentTypeRegistration implements OnModuleInit {
  constructor(private readonly registry: DocumentTypeRegistry) {}

  onModuleInit(): void {
    this.registry.register([MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION]);
  }
}
