/**
 * Numbering series — configuration for one (organization, document type,
 * scope) run of numeric serials (Task 8 §11, ADR-0019 §7).
 *
 * Framework-free (AR-05).
 */

export interface NumberingSeries {
  id: string;
  organizationId: string;
  documentType: string;
  scopeKey: string;
  name: string;
  strategy: string;
  width: number;
  reusePolicy: string;
  lastValue: bigint;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NumberingSeriesDto {
  id: string;
  organizationId: string;
  documentType: string;
  scopeKey: string;
  name: string;
  strategy: string;
  width: number;
  reusePolicy: string;
  /** Highest serial allocated so far. Serialized as a string: BigInt has no
   * lossless JSON representation. */
  lastValue: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toNumberingSeriesDto(
  series: NumberingSeries,
): NumberingSeriesDto {
  return {
    id: series.id,
    organizationId: series.organizationId,
    documentType: series.documentType,
    scopeKey: series.scopeKey,
    name: series.name,
    strategy: series.strategy,
    width: series.width,
    reusePolicy: series.reusePolicy,
    lastValue: series.lastValue.toString(),
    isActive: series.isActive,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
  };
}
