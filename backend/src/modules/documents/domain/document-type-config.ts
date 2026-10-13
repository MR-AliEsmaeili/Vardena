/**
 * Document type configuration — the organization's selection over a
 * code-registered document type (Task 8 §6/§8).
 *
 * The type itself is code; this is the per-organization data row: today just
 * `draft_required`. Lifecycle/transition selection stays with Workflow
 * (Task 9, ADR-0018).
 *
 * Framework-free (AR-05).
 */

export interface DocumentTypeConfig {
  id: string;
  organizationId: string;
  documentType: string;
  draftRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentTypeConfigDto {
  organizationId: string;
  documentType: string;
  draftRequired: boolean;
}

export function toDocumentTypeConfigDto(
  config: DocumentTypeConfig,
): DocumentTypeConfigDto {
  return {
    organizationId: config.organizationId,
    documentType: config.documentType,
    draftRequired: config.draftRequired,
  };
}
