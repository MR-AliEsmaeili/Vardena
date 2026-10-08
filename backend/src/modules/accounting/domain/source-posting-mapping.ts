/**
 * Source posting mapping — the Accounting-owned mapping from a source fact to
 * the journal it produces (C-62, PDR-09 PO-01/PO-04, PDR-10 C62-OD-04).
 *
 * Framework-free (AR-05). This is the ONLY account selection that exists for a
 * system-origin posting: the row an accountant configures, resolved by the
 * Accounting-owned application contract and nowhere else. Inventory supplies
 * facts; Accounting owns mapping and journal policy.
 *
 * A missing or unusable mapping is a FAIL-CLOSED refusal — never a guessed
 * account, never a default chart node, never "the first postable account".
 */

import { isNonBlank } from './master-data.js';

/** `accounting.source_posting_mappings.source_module` width. */
export const MAX_SOURCE_MODULE_LENGTH = 64;

/** `accounting.source_posting_mappings.source_document_type` width. */
export const MAX_SOURCE_DOCUMENT_TYPE_LENGTH = 64;

export interface SourcePostingMapping {
  id: string;
  organizationId: string;
  /** Code-defined, lowercase snake_case (`inventory`). */
  sourceModule: string;
  /** Code-defined, lowercase snake_case (`inventory_receipt`). */
  sourceDocumentType: string;
  /** The financial area the produced voucher belongs to. */
  financialAreaId: string;
  /** The account the source value is recognised in. */
  debitAccountId: string;
  /** The offsetting account the accountant chose. */
  creditAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a mapping cannot be used. Closed and code-defined so the refusal the
 * caller sees is the same one the tests assert on.
 */
export type SourcePostingMappingProblem =
  | 'organization_mismatch'
  | 'missing_source_document_type'
  | 'missing_financial_area'
  | 'missing_debit_account'
  | 'missing_credit_account'
  | 'same_debit_and_credit_account';

export function sourcePostingMappingProblemMessage(
  problem: SourcePostingMappingProblem,
): string {
  switch (problem) {
    case 'organization_mismatch':
      return 'The source posting mapping belongs to another organization.';
    case 'missing_source_document_type':
      return 'A source posting mapping requires a source document type.';
    case 'missing_financial_area':
      return 'A source posting mapping requires a financial area.';
    case 'missing_debit_account':
      return 'A source posting mapping requires a debit account.';
    case 'missing_credit_account':
      return 'A source posting mapping requires a credit account.';
    case 'same_debit_and_credit_account':
      return 'A source posting mapping must name two different accounts.';
  }
}

/**
 * Validate a mapping before it is persisted. Existence, organization scope
 * and usability of the area/accounts are the application services' job
 * (`FinancialAreasService.requireUsableFinancialAreaInOrganization`,
 * `AccountsService.requireUsableAccountInOrganization`) — this is the
 * structural half that must hold no matter which surface writes the row.
 */
export function checkSourcePostingMapping(mapping: {
  organizationId: string;
  sourceModule: string;
  sourceDocumentType: string;
  financialAreaId: string;
  debitAccountId: string;
  creditAccountId: string;
}): SourcePostingMappingProblem | null {
  if (!isNonBlank(mapping.organizationId)) {
    return 'organization_mismatch';
  }
  if (!isNonBlank(mapping.sourceDocumentType)) {
    return 'missing_source_document_type';
  }
  if (!isNonBlank(mapping.financialAreaId)) {
    return 'missing_financial_area';
  }
  if (!isNonBlank(mapping.debitAccountId)) {
    return 'missing_debit_account';
  }
  if (!isNonBlank(mapping.creditAccountId)) {
    return 'missing_credit_account';
  }
  if (mapping.debitAccountId === mapping.creditAccountId) {
    return 'same_debit_and_credit_account';
  }
  return null;
}
