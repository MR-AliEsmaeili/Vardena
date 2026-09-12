/**
 * Numbering allocation — one issued serial (Task 8 §11/§17).
 *
 * Append-only ledger row: `(series_id, number)` is unique (the hard
 * no-duplicate guarantee) and `(series_id, allocation_key)` makes allocation
 * idempotent. The receiving document is a logical reference, never a foreign
 * key.
 *
 * Framework-free (AR-05).
 */

export interface NumberingAllocation {
  id: string;
  seriesId: string;
  organizationId: string;
  documentType: string;
  number: string;
  allocationKey: string;
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NumberingAllocationDto {
  id: string;
  seriesId: string;
  organizationId: string;
  documentType: string;
  number: string;
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
  createdAt: string;
}

export function toNumberingAllocationDto(
  allocation: NumberingAllocation,
): NumberingAllocationDto {
  return {
    id: allocation.id,
    seriesId: allocation.seriesId,
    organizationId: allocation.organizationId,
    documentType: allocation.documentType,
    number: allocation.number,
    referenceModule: allocation.referenceModule,
    referenceDocumentType: allocation.referenceDocumentType,
    referenceDocumentId: allocation.referenceDocumentId,
    createdAt: allocation.createdAt.toISOString(),
  };
}
