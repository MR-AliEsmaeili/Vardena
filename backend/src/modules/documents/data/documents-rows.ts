/**
 * Shared row/delegate shapes for the Document Foundation's data layer
 * (Task 8, ADR-0023).
 *
 * Prisma models are private to their module (docs/database-strategy.md §2) and
 * codegen may not have run in a fresh checkout, so — like the Organization and
 * Inventory data layers — the repositories declare the *structural* surface
 * they use. Services work with domain entities, never with these shapes.
 *
 * The numbering allocation path is the module's documented concurrency-critical
 * SQL (docs/database-strategy.md §13, AR-11): the series counter is locked with
 * `SELECT … FOR UPDATE` (Prisma cannot express it) and the counter increment
 * is applied in the same transaction as the allocation insert.
 */

/** `created_at`/`updated_at`/`created_by`/`updated_by` (AR-12). */
export interface AuditColumns {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

/** Prisma `numeric` arrives as a `Decimal` (or string through some adapters). */
export type DecimalLike = string | number | { toString(): string };

export function decimalToString(value: DecimalLike): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// Document type configs
// ---------------------------------------------------------------------------

export type DocumentTypeConfigRow = {
  id: string;
  organizationId: string;
  documentType: string;
  draftRequired: boolean;
} & AuditColumns;

export interface DocumentTypeConfigWhere {
  organizationId?: string;
  documentType?: string;
}

export interface DocumentTypeConfigCreate {
  id: string;
  organizationId: string;
  documentType: string;
  draftRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DocumentTypeConfigUpdate {
  draftRequired?: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface DocumentTypeConfigDelegate {
  findFirst(args: {
    where: DocumentTypeConfigWhere;
  }): Promise<DocumentTypeConfigRow | null>;
  findMany(args: {
    where: DocumentTypeConfigWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<DocumentTypeConfigRow[]>;
  count(args: { where: DocumentTypeConfigWhere }): Promise<number>;
  create(args: {
    data: DocumentTypeConfigCreate;
  }): Promise<DocumentTypeConfigRow>;
  update(args: {
    where: { id: string };
    data: DocumentTypeConfigUpdate;
  }): Promise<DocumentTypeConfigRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: {
    where: DocumentTypeConfigWhere;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Numbering series
// ---------------------------------------------------------------------------

export type NumberingSeriesRow = {
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
} & AuditColumns;

export interface NumberingSeriesWhere {
  id?: string;
  organizationId?: string;
  documentType?: string;
  scopeKey?: string;
  isActive?: boolean;
}

export interface NumberingSeriesCreate {
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
  createdBy: string | null;
  updatedBy: string | null;
}

export interface NumberingSeriesUpdate {
  name?: string;
  strategy?: string;
  width?: number;
  reusePolicy?: string;
  isActive?: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface NumberingSeriesCounterUpdate {
  lastValue: bigint;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface NumberingSeriesDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<NumberingSeriesRow | null>;
  findFirst(args: {
    where: NumberingSeriesWhere;
  }): Promise<NumberingSeriesRow | null>;
  findMany(args: {
    where: NumberingSeriesWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<NumberingSeriesRow[]>;
  count(args: { where: NumberingSeriesWhere }): Promise<number>;
  create(args: { data: NumberingSeriesCreate }): Promise<NumberingSeriesRow>;
  update(args: {
    where: { id: string };
    data: NumberingSeriesUpdate | NumberingSeriesCounterUpdate;
  }): Promise<NumberingSeriesRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: NumberingSeriesWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Numbering allocations
// ---------------------------------------------------------------------------

export type NumberingAllocationRow = {
  id: string;
  seriesId: string;
  organizationId: string;
  documentType: string;
  number: string;
  allocationKey: string;
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
} & AuditColumns;

export interface NumberingAllocationWhere {
  organizationId?: string;
  seriesId?: string;
  documentType?: string;
  allocationKey?: string;
  number?: string;
  referenceModule?: string;
  referenceDocumentType?: string;
  referenceDocumentId?: string;
}

export interface NumberingAllocationCreate {
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
  createdBy: string | null;
  updatedBy: string | null;
}

export interface NumberingAllocationDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<NumberingAllocationRow | null>;
  findFirst(args: {
    where: NumberingAllocationWhere;
  }): Promise<NumberingAllocationRow | null>;
  findMany(args: {
    where: NumberingAllocationWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<NumberingAllocationRow[]>;
  count(args: { where: NumberingAllocationWhere }): Promise<number>;
  create(args: {
    data: NumberingAllocationCreate;
  }): Promise<NumberingAllocationRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: {
    where: NumberingAllocationWhere;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Document relations
// ---------------------------------------------------------------------------

export type DocumentRelationRow = {
  id: string;
  organizationId: string;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceLineId: string | null;
  targetModule: string;
  targetDocumentType: string;
  targetDocumentId: string;
  targetLineId: string | null;
  relationKind: string;
  quantity: DecimalLike | null;
  createdByProcess: boolean;
} & AuditColumns;

export interface DocumentRelationWhere {
  id?: string;
  organizationId?: string;
  relationKind?: string;
  sourceModule?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  targetModule?: string;
  targetDocumentType?: string;
  targetDocumentId?: string;
}

export interface DocumentRelationCreate {
  id: string;
  organizationId: string;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceLineId: string | null;
  targetModule: string;
  targetDocumentType: string;
  targetDocumentId: string;
  targetLineId: string | null;
  relationKind: string;
  quantity: string | null;
  createdByProcess: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DocumentRelationDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<DocumentRelationRow | null>;
  findMany(args: {
    where: DocumentRelationWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<DocumentRelationRow[]>;
  count(args: { where: DocumentRelationWhere }): Promise<number>;
  create(args: { data: DocumentRelationCreate }): Promise<DocumentRelationRow>;
  delete(args: { where: { id: string } }): Promise<DocumentRelationRow>;
  /** Test-only cleanup for live-database suites. */
  deleteMany(args: {
    where: DocumentRelationWhere;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Transaction client
// ---------------------------------------------------------------------------

/** Parameterized raw SQL inside a transaction — the numbering lock path. */
export type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

/** The delegates the numbering allocation transaction works with. */
export interface DocumentsTxClient {
  $queryRaw: RawQuery;
  numberingAllocation: NumberingAllocationDelegate;
  numberingSeries: {
    update(args: {
      where: { id: string };
      data: NumberingSeriesCounterUpdate;
    }): Promise<NumberingSeriesRow>;
  };
}

export interface DocumentsTransactionalClient {
  $transaction: <T>(fn: (tx: DocumentsTxClient) => Promise<T>) => Promise<T>;
}
