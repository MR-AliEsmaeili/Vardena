import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DocumentTypeRegistry } from '../../documents/application/document-type-registry.js';
import {
  ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
  ACCOUNTING_VOUCHER_TYPE_DEFINITION,
} from '../domain/accounting-document.js';

/**
 * Registers Accounting's document type in the Document Foundation's registry
 * at startup (ADR-0023 §2, contract §12.1 `AC-D-16`) — the same mechanism the
 * Documents module uses for the vocabulary it owns, and the reason the type is
 * CODE rather than a row (`docs/adr/0018`).
 *
 * Exactly ONE type is registered: `accounting_voucher`. The year-transition
 * types (`accounting_opening_balance`, `accounting_closing_balance`,
 * `accounting_temporary_close`) are `planned, not invented here` (§12.1/§6.4)
 * and arrive with the closing task; registering them now would advertise a
 * lifecycle nothing implements.
 *
 * The registration runs AFTER DocumentsModule has booted (AccountingModule
 * imports it, and AppModule lists Documents first), so the registry's
 * duplicate/malformed checks always see a stable vocabulary.
 */
@Injectable()
export class AccountingDocumentTypeRegistration implements OnModuleInit {
  constructor(private readonly registry: DocumentTypeRegistry) {}

  onModuleInit(): void {
    this.registry.register([ACCOUNTING_VOUCHER_TYPE_DEFINITION]);
  }
}

/** Re-exported so the module wiring and tests name the type once. */
export { ACCOUNTING_VOUCHER_DOCUMENT_TYPE };
