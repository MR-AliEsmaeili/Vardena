/**
 * Shared row/delegate shapes for the Accounting data layer (Task 10.2
 * calendar, Task 10.3 coding structure + chart of accounts, ADR-0026).
 *
 * Prisma models are private to their module (docs/database-strategy.md §2)
 * and codegen may not have run in a fresh checkout, so — like the
 * Organization, Inventory, Document and Workflow data layers — the
 * repositories declare the *structural* surface they use. Services work
 * with domain entities, never with these shapes.
 *
 * The guards that need it (calendar overlap and lifecycle moves, "exactly one
 * active coding-structure version", account placement: level derivation, code
 * prefix, cycles, the postable-parent rule) are the module's documented
 * concurrency-critical SQL (docs/modules.md §Accounting, AR-11): the relevant
 * parent rows are locked with `SELECT … FOR UPDATE` (Prisma cannot express it)
 * and the guard is re-evaluated inside the same transaction as the write —
 * never check-then-act across the boundary.
 */

/** `created_at`/`updated_at`/`created_by`/`updated_by` (AR-12). */
export interface AuditColumns {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

// ---------------------------------------------------------------------------
// Financial areas
// ---------------------------------------------------------------------------

export type FinancialAreaRow = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  isDefault: boolean;
  isActive: boolean;
} & AuditColumns;

export interface FinancialAreaWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  isDefault?: boolean;
  isActive?: boolean;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    title?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface FinancialAreaCreate {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface FinancialAreaUpdate {
  code?: string | undefined;
  title?: string | undefined;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface FinancialAreaDelegate {
  findUnique(args: { where: { id: string } }): Promise<FinancialAreaRow | null>;
  findFirst(args: {
    where: FinancialAreaWhere;
  }): Promise<FinancialAreaRow | null>;
  findMany(args: {
    where: FinancialAreaWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<FinancialAreaRow[]>;
  count(args: { where: FinancialAreaWhere }): Promise<number>;
  create(args: { data: FinancialAreaCreate }): Promise<FinancialAreaRow>;
  update(args: {
    where: { id: string };
    data: FinancialAreaUpdate;
  }): Promise<FinancialAreaRow>;
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

export type FiscalYearRow = {
  id: string;
  organizationId: string;
  financialAreaId: string;
  code: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  isActive: boolean;
  priorYearId: string | null;
} & AuditColumns;

export interface FiscalYearWhere {
  id?: string;
  organizationId?: string;
  financialAreaId?: string;
  code?: string;
  status?: string;
  isActive?: boolean;
  /** Inclusive date-only bounds — used to resolve a document's business date. */
  startDate?: { lte?: Date; gte?: Date };
  endDate?: { lte?: Date; gte?: Date };
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    title?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface FiscalYearCreate {
  id: string;
  organizationId: string;
  financialAreaId: string;
  code: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  isActive: boolean;
  priorYearId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface FiscalYearUpdate {
  code?: string | undefined;
  title?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  status?: string | undefined;
  isActive?: boolean | undefined;
  priorYearId?: string | null | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface FiscalYearDelegate {
  findUnique(args: { where: { id: string } }): Promise<FiscalYearRow | null>;
  findFirst(args: { where: FiscalYearWhere }): Promise<FiscalYearRow | null>;
  findMany(args: {
    where: FiscalYearWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<FiscalYearRow[]>;
  count(args: { where: FiscalYearWhere }): Promise<number>;
  create(args: { data: FiscalYearCreate }): Promise<FiscalYearRow>;
  update(args: {
    where: { id: string };
    data: FiscalYearUpdate;
  }): Promise<FiscalYearRow>;
}

// ---------------------------------------------------------------------------
// Accounting periods
// ---------------------------------------------------------------------------

export type AccountingPeriodRow = {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  sequence: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  periodKind: string;
} & AuditColumns;

export interface AccountingPeriodWhere {
  id?: string;
  organizationId?: string;
  financialAreaId?: string;
  fiscalYearId?: string;
  sequence?: number;
  status?: string;
  /** Inclusive date-only bounds — used to resolve a document's business date. */
  startDate?: { lte?: Date; gte?: Date };
  endDate?: { lte?: Date; gte?: Date };
}

export interface AccountingPeriodCreate {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  sequence: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  periodKind: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingPeriodUpdate {
  status?: string | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AccountingPeriodDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<AccountingPeriodRow | null>;
  findFirst(args: {
    where: AccountingPeriodWhere;
  }): Promise<AccountingPeriodRow | null>;
  findMany(args: {
    where: AccountingPeriodWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<AccountingPeriodRow[]>;
  count(args: { where: AccountingPeriodWhere }): Promise<number>;
  create(args: { data: AccountingPeriodCreate }): Promise<AccountingPeriodRow>;
  update(args: {
    where: { id: string };
    data: AccountingPeriodUpdate;
  }): Promise<AccountingPeriodRow>;
}

// ---------------------------------------------------------------------------
// Coding structure versions + levels
// ---------------------------------------------------------------------------

export type CodingStructureVersionRow = {
  id: string;
  organizationId: string;
  code: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  separator: string;
} & AuditColumns;

export interface CodingStructureVersionWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  status?: string;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface CodingStructureVersionCreate {
  id: string;
  organizationId: string;
  code: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  separator: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface CodingStructureVersionUpdate {
  maxDepth?: number | undefined;
  separator?: string | undefined;
  status?: string | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CodingStructureVersionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<CodingStructureVersionRow | null>;
  findFirst(args: {
    where: CodingStructureVersionWhere;
  }): Promise<CodingStructureVersionRow | null>;
  findMany(args: {
    where: CodingStructureVersionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<CodingStructureVersionRow[]>;
  count(args: { where: CodingStructureVersionWhere }): Promise<number>;
  create(args: {
    data: CodingStructureVersionCreate;
  }): Promise<CodingStructureVersionRow>;
  update(args: {
    where: { id: string };
    data: CodingStructureVersionUpdate;
  }): Promise<CodingStructureVersionRow>;
}

export type CodingStructureLevelRow = {
  id: string;
  organizationId: string;
  versionId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
} & AuditColumns;

export interface CodingStructureLevelCreate {
  id: string;
  organizationId: string;
  versionId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface CodingStructureLevelWhere {
  versionId?: string | { in: string[] };
  organizationId?: string;
}

export interface CodingStructureLevelDelegate {
  findMany(args: {
    where: CodingStructureLevelWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<CodingStructureLevelRow[]>;
  create(args: {
    data: CodingStructureLevelCreate;
  }): Promise<CodingStructureLevelRow>;
  /** DRAFT configuration only — see `coding-structures.repository.ts`. */
  deleteMany(args: {
    where: { versionId: string };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Accounting Configuration Foundation (Task 11)
// ---------------------------------------------------------------------------

export type AccountingConfigurationRow = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
  operationallyUsedAt: Date | null;
} & AuditColumns;

export interface AccountingConfigurationWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  status?: string;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    name?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface AccountingConfigurationCreate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
  operationallyUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingConfigurationUpdate {
  name?: string | undefined;
  status?: string | undefined;
  effectiveFrom?: Date | null | undefined;
  operationallyUsedAt?: Date | null | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AccountingConfigurationDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<AccountingConfigurationRow | null>;
  findFirst(args: {
    where: AccountingConfigurationWhere;
  }): Promise<AccountingConfigurationRow | null>;
  findMany(args: {
    where: AccountingConfigurationWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<AccountingConfigurationRow[]>;
  count(args: { where: AccountingConfigurationWhere }): Promise<number>;
  create(args: {
    data: AccountingConfigurationCreate;
  }): Promise<AccountingConfigurationRow>;
  update(args: {
    where: { id: string };
    data: AccountingConfigurationUpdate;
  }): Promise<AccountingConfigurationRow>;
}

export type AccountingConfigurationLevelRow = {
  id: string;
  organizationId: string;
  configurationId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
} & AuditColumns;

export interface AccountingConfigurationLevelCreate {
  id: string;
  organizationId: string;
  configurationId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingConfigurationLevelWhere {
  configurationId?: string | { in: string[] };
  organizationId?: string;
}

export interface AccountingConfigurationLevelDelegate {
  findMany(args: {
    where: AccountingConfigurationLevelWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<AccountingConfigurationLevelRow[]>;
  create(args: {
    data: AccountingConfigurationLevelCreate;
  }): Promise<AccountingConfigurationLevelRow>;
  deleteMany(args: {
    where: { configurationId: string };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Accounts (the chart of accounts tree)
// ---------------------------------------------------------------------------

export type AccountRow = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  codingStructureVersionId: string;
  accountingConfigurationId: string;
  accountNature: string;
  accountType: string;
  detailGroupId: string | null;
  isPostable: boolean;
  isActive: boolean;
} & AuditColumns;

export interface AccountWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  parentId?: string | null;
  level?: number;
  isActive?: boolean;
  isPostable?: boolean;
  codingStructureVersionId?: string;
  accountingConfigurationId?: string;
  detailGroupId?: string | null;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    title?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface AccountCreate {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  codingStructureVersionId: string;
  accountingConfigurationId: string;
  accountNature: string;
  accountType?: string | undefined;
  detailGroupId?: string | null | undefined;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountUpdate {
  title?: string | undefined;
  parentId?: string | null | undefined;
  level?: number | undefined;
  accountNature?: string | undefined;
  accountType?: string | undefined;
  detailGroupId?: string | null | undefined;
  isPostable?: boolean | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AccountDelegate {
  findUnique(args: { where: { id: string } }): Promise<AccountRow | null>;
  findFirst(args: { where: AccountWhere }): Promise<AccountRow | null>;
  findMany(args: {
    where: AccountWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<AccountRow[]>;
  count(args: { where: AccountWhere }): Promise<number>;
  create(args: { data: AccountCreate }): Promise<AccountRow>;
  update(args: {
    where: { id: string };
    data: AccountUpdate;
  }): Promise<AccountRow>;
}

// ---------------------------------------------------------------------------
// Accounting documents (Task 10.4, contract §12/§15/§16/§18)
// ---------------------------------------------------------------------------

export type AccountingDocumentRow = {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: Date;
  description: string;
  state: string;
  origin: string;
  branchId: string | null;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  idempotencyReference: string | null;
  requestHash: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  correctionKind: string | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
  correlationId: string | null;
} & AuditColumns;

/** A header row with its lines loaded (one batched query per page). */
export type AccountingDocumentWithLinesRow = AccountingDocumentRow & {
  lines: AccountingDocumentLineRow[];
};

export interface AccountingDocumentWhere {
  id?: string;
  organizationId?: string;
  financialAreaId?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  documentNumber?: string;
  state?: string;
  origin?: string;
  branchId?: string;
  documentDate?: { gte?: Date; lte?: Date };
  description?: { contains: string; mode: 'insensitive' };
}

export interface AccountingDocumentCreate {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: Date;
  description: string;
  state: string;
  origin: string;
  branchId: string | null;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  idempotencyReference: string | null;
  requestHash: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  correctionKind: string | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingDocumentUpdate {
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  documentNumber?: string | null | undefined;
  documentDate?: Date | undefined;
  description?: string | undefined;
  state?: string | undefined;
  branchId?: string | null | undefined;
  finalizedAt?: Date | null | undefined;
  finalizedBy?: string | null | undefined;
  reversedByDocumentId?: string | null | undefined;
  idempotencyReference?: string | null | undefined;
  requestHash?: string | null | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AccountingDocumentDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<AccountingDocumentRow | null>;
  findFirst(args: {
    where: AccountingDocumentWhere;
  }): Promise<AccountingDocumentRow | null>;
  findMany(args: {
    where: AccountingDocumentWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
    include?: { lines: true };
  }): Promise<AccountingDocumentWithLinesRow[]>;
  count(args: { where: AccountingDocumentWhere }): Promise<number>;
  create(args: {
    data: AccountingDocumentCreate;
  }): Promise<AccountingDocumentRow>;
  update(args: {
    where: { id: string };
    data: AccountingDocumentUpdate;
  }): Promise<AccountingDocumentRow>;
  delete(args: { where: { id: string } }): Promise<AccountingDocumentRow>;
}

export type AccountingDocumentLineRow = {
  id: string;
  documentId: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  lineNo: number;
  accountId: string;
  detailId: string | null;
  /** Prisma `Decimal` at runtime; the repository maps it to a string. */
  debitAmount: unknown;
  creditAmount: unknown;
  description: string | null;
  sourceLineReference: string | null;
} & AuditColumns;

export interface AccountingDocumentLineWhere {
  id?: string;
  documentId?: string | { in: string[] };
  organizationId?: string;
  accountId?: string;
  detailId?: string | null | { not: null };
}

export interface AccountingDocumentLineCreate {
  id: string;
  documentId: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  lineNo: number;
  accountId: string;
  detailId?: string | null | undefined;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  sourceLineReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingDocumentLineDelegate {
  findMany(args: {
    where: AccountingDocumentLineWhere;
    orderBy: OrderBy;
  }): Promise<AccountingDocumentLineRow[]>;
  create(args: {
    data: AccountingDocumentLineCreate;
  }): Promise<AccountingDocumentLineRow>;
  createMany(args: {
    data: AccountingDocumentLineCreate[];
  }): Promise<{ count: number }>;
  updateMany(args: {
    where: AccountingDocumentLineWhere;
    data: { detailId?: string | null };
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: AccountingDocumentLineWhere;
  }): Promise<{ count: number }>;
  count(args: { where: AccountingDocumentLineWhere }): Promise<number>;
}

export type AccountingPostingOperationRow = {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
} & AuditColumns;

export interface AccountingPostingOperationCreate {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingPostingOperationDelegate {
  findFirst(args: {
    where: { organizationId: string; operationKey: string };
  }): Promise<AccountingPostingOperationRow | null>;
  create(args: {
    data: AccountingPostingOperationCreate;
  }): Promise<AccountingPostingOperationRow>;
}

// ---------------------------------------------------------------------------
// Balance projections (Task 12, contract §19.3 AC-D-31, ADR-0031)
// ---------------------------------------------------------------------------

export type AccountBalanceProjectionRow = {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
  /** Prisma `Decimal` at runtime; repository maps to string. */
  periodDebitAmount: unknown;
  periodCreditAmount: unknown;
} & AuditColumns;

export interface AccountBalanceProjectionWhere {
  organizationId?: string;
  financialAreaId?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  accountId?: string;
}

export interface AccountBalanceProjectionCreate {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
  periodDebitAmount: string;
  periodCreditAmount: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface AccountBalanceProjectionUpdate {
  periodDebitAmount: string;
  periodCreditAmount: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Scope-scoped reads + transactional upserts: no free-text cross-org reads.
 * The unique key is (org, area, year, period, account) — every persistence
 * path writes by that key.
 */
export interface AccountBalanceProjectionDelegate {
  findMany(args: {
    where: AccountBalanceProjectionWhere;
    orderBy?: OrderBy;
    skip?: number;
    take?: number;
  }): Promise<AccountBalanceProjectionRow[]>;
  count(args: { where: AccountBalanceProjectionWhere }): Promise<number>;
  /** Distinct `findUnique` is not exposed — key lookups are `findMany` + 1. */
  findFirst(args: {
    where: AccountBalanceProjectionWhere;
  }): Promise<AccountBalanceProjectionRow | null>;
  create(args: {
    data: AccountBalanceProjectionCreate;
  }): Promise<AccountBalanceProjectionRow>;
  update(args: {
    where: { id: string };
    data: AccountBalanceProjectionUpdate;
  }): Promise<AccountBalanceProjectionRow>;
  /** UPSERT used only inside the finalization transaction (see repository). */
  upsert(args: {
    where: {
      organizationId_financialAreaId_fiscalYearId_accountingPeriodId_accountId: {
        organizationId: string;
        financialAreaId: string;
        fiscalYearId: string;
        accountingPeriodId: string;
        accountId: string;
      };
    };
    create: AccountBalanceProjectionCreate;
    update: AccountBalanceProjectionUpdate;
  }): Promise<AccountBalanceProjectionRow>;
  delete(args: { where: { id: string } }): Promise<AccountBalanceProjectionRow>;
  deleteMany(args: {
    where: AccountBalanceProjectionWhere;
  }): Promise<{ count: number }>;
  createMany(args: {
    data: AccountBalanceProjectionCreate[];
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Ledger entries (Task 10.7, contract §12/§13/§15/§19 — immutable)
// ---------------------------------------------------------------------------

export type LedgerEntryRow = {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  voucherId: string;
  voucherNumber: string;
  voucherLineId: string;
  lineNo: number;
  accountId: string;
  detailId: string | null;
  /** Prisma `Decimal` at runtime; the repository maps it to a string. */
  debitAmount: unknown;
  creditAmount: unknown;
  description: string | null;
  documentDate: Date;
  postingTimestamp: Date;
  branchId: string | null;
  origin: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  correlationId: string | null;
  finalizedBy: string | null;
} & AuditColumns;

/**
 * Scoped reads over the immutable ledger. `organizationId` is the tenant
 * boundary every read leads with (AC-I-01); the remaining keys are the Task
 * 17A movement filters and are always evaluated INSIDE that organization, so a
 * foreign scope id can only ever match nothing — never another organization's
 * row.
 */
export interface LedgerEntryWhere {
  organizationId?: string;
  voucherId?: string;
  voucherLineId?: string;
  financialAreaId?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  accountId?: string;
  detailId?: string | null | { not: null };
  voucherNumber?: string;
  /** Inclusive business-date bounds (`DATE` semantics, §12.3). */
  documentDate?: { gte?: Date; lte?: Date };
}

export interface LedgerEntryCreate {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  voucherId: string;
  voucherNumber: string;
  voucherLineId: string;
  lineNo: number;
  accountId: string;
  detailId?: string | null | undefined;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  documentDate: Date;
  postingTimestamp: Date;
  branchId: string | null;
  origin: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  correlationId: string | null;
  finalizedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * Insert-only + scoped reads: there is deliberately no update and no delete
 * (AC-I-05/06 — corrections are future counter-documents with new entries).
 *
 * `count` exists for the Task 17A movement list: the page and its `total` must
 * be answered over the SAME filtered predicate, so pagination never reports a
 * total from a different scope.
 */
export interface LedgerEntryDelegate {
  findMany(args: {
    where: LedgerEntryWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<LedgerEntryRow[]>;
  count(args: { where: LedgerEntryWhere }): Promise<number>;
  createMany(args: { data: LedgerEntryCreate[] }): Promise<{ count: number }>;
  updateMany(args: {
    where: LedgerEntryWhere;
    data: { detailId?: string | null };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Base Chart product template + adoption (Task 23, OD-20-1)
// ---------------------------------------------------------------------------

/** The template identity row (product asset — NO organization_id by design). */
export type BaseChartTemplateRow = {
  id: string;
  code: string;
  title: string;
} & AuditColumns;

export interface BaseChartTemplateWhere {
  id?: string;
  code?: string;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    title?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface BaseChartTemplateDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<BaseChartTemplateRow | null>;
  findFirst(args: {
    where: BaseChartTemplateWhere;
  }): Promise<BaseChartTemplateRow | null>;
  findMany(args: {
    where: BaseChartTemplateWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BaseChartTemplateRow[]>;
  count(args: { where: BaseChartTemplateWhere }): Promise<number>;
  create(args: {
    data: BaseChartTemplateCreate;
  }): Promise<BaseChartTemplateRow>;
  update(args: {
    where: { id: string };
    data: { title: string; updatedAt: Date; updatedBy: string | null };
  }): Promise<BaseChartTemplateRow>;
}

export interface BaseChartTemplateCreate {
  id: string;
  code: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/** One lifecycle row per template version (immutable once published). */
export type BaseChartTemplateVersionRow = {
  id: string;
  templateId: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  approvedAt: Date | null;
  publishedAt: Date | null;
  supersededAt: Date | null;
  supersededByVersionId: string | null;
} & AuditColumns;

export interface BaseChartTemplateVersionWhere {
  id?: string;
  templateId?: string;
  status?: string;
}

export interface BaseChartTemplateVersionCreate {
  id: string;
  templateId: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface BaseChartTemplateVersionUpdate {
  status?: string | undefined;
  maxDepth?: number | undefined;
  approvedAt?: Date | null | undefined;
  publishedAt?: Date | null | undefined;
  supersededAt?: Date | null | undefined;
  supersededByVersionId?: string | null | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface BaseChartTemplateVersionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<BaseChartTemplateVersionRow | null>;
  findMany(args: {
    where: BaseChartTemplateVersionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BaseChartTemplateVersionRow[]>;
  count(args: { where: BaseChartTemplateVersionWhere }): Promise<number>;
  create(args: {
    data: BaseChartTemplateVersionCreate;
  }): Promise<BaseChartTemplateVersionRow>;
  update(args: {
    where: { id: string };
    data: BaseChartTemplateVersionUpdate;
  }): Promise<BaseChartTemplateVersionRow>;
}

/** One level of one template version's own coding shape (no title/kind). */
export type BaseChartTemplateLevelRow = {
  id: string;
  versionId: string;
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
} & AuditColumns;

export interface BaseChartTemplateLevelCreate {
  id: string;
  versionId: string;
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface BaseChartTemplateLevelDelegate {
  findMany(args: {
    where: { versionId: string };
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BaseChartTemplateLevelRow[]>;
  create(args: {
    data: BaseChartTemplateLevelCreate;
  }): Promise<BaseChartTemplateLevelRow>;
  deleteMany(args: {
    where: { versionId: string };
  }): Promise<{ count: number }>;
}

/** One node of the template chart tree (template-internal key space). */
export type BaseChartTemplateNodeRow = {
  id: string;
  versionId: string;
  nodeKey: string;
  parentNodeKey: string | null;
  parentId: string | null;
  code: string;
  title: string;
  accountNature: string;
  accountType: string;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  level: number;
} & AuditColumns;

export interface BaseChartTemplateNodeCreate {
  id: string;
  versionId: string;
  nodeKey: string;
  parentNodeKey: string | null;
  parentId: string | null;
  code: string;
  title: string;
  accountNature: string;
  accountType?: string | undefined;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  level: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface BaseChartTemplateNodeDelegate {
  findMany(args: {
    where: { versionId: string };
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BaseChartTemplateNodeRow[]>;
  create(args: {
    data: BaseChartTemplateNodeCreate;
  }): Promise<BaseChartTemplateNodeRow>;
  deleteMany(args: {
    where: { versionId: string };
  }): Promise<{ count: number }>;
}

/** The tenant-scoped adoption record (created once, never mutated). */
export type BaseChartAdoptionRow = {
  id: string;
  organizationId: string;
  templateVersionId: string;
  accountingConfigurationId: string;
  codingStructureVersionId: string;
  accountCount: number;
} & AuditColumns;

export interface BaseChartAdoptionWhere {
  id?: string;
  organizationId?: string;
  templateVersionId?: string;
}

export interface BaseChartAdoptionCreate {
  id: string;
  organizationId: string;
  templateVersionId: string;
  accountingConfigurationId: string;
  codingStructureVersionId: string;
  accountCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface BaseChartAdoptionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<BaseChartAdoptionRow | null>;
  findFirst(args: {
    where: BaseChartAdoptionWhere;
  }): Promise<BaseChartAdoptionRow | null>;
  findMany(args: {
    where: BaseChartAdoptionWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BaseChartAdoptionRow[]>;
  count(args: { where: BaseChartAdoptionWhere }): Promise<number>;
  create(args: {
    data: BaseChartAdoptionCreate;
  }): Promise<BaseChartAdoptionRow>;
}

// ---------------------------------------------------------------------------
// Detail Hierarchy & Detail Coding Structures (Task 30, OD-29-03)
// ---------------------------------------------------------------------------

export type DetailStructureVersionRow = {
  id: string;
  organizationId: string;
  versionNumber: number;
  status: string;
  title: string | null;
  maxDepth: number;
} & AuditColumns;

export interface DetailStructureVersionWhere {
  id?: string;
  organizationId?: string;
  status?: string;
  versionNumber?: number;
}

export interface DetailStructureVersionCreate {
  id: string;
  organizationId: string;
  versionNumber: number;
  status: string;
  title?: string | null | undefined;
  maxDepth: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface DetailStructureVersionUpdate {
  status?: string | undefined;
  title?: string | null | undefined;
  maxDepth?: number | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface DetailStructureVersionDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<DetailStructureVersionRow | null>;
  findFirst(args: {
    where: DetailStructureVersionWhere;
  }): Promise<DetailStructureVersionRow | null>;
  findMany(args: {
    where: DetailStructureVersionWhere;
    orderBy?: OrderBy;
    skip?: number;
    take?: number;
  }): Promise<DetailStructureVersionRow[]>;
  create(args: {
    data: DetailStructureVersionCreate;
  }): Promise<DetailStructureVersionRow>;
  update(args: {
    where: { id: string };
    data: DetailStructureVersionUpdate;
  }): Promise<DetailStructureVersionRow>;
  count(args: { where: DetailStructureVersionWhere }): Promise<number>;
}

export type DetailStructureLevelRow = {
  id: string;
  organizationId: string;
  versionId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
} & AuditColumns;

export interface DetailStructureLevelWhere {
  id?: string;
  organizationId?: string;
  versionId?: string;
  levelIndex?: number;
}

export interface DetailStructureLevelCreate {
  id: string;
  organizationId: string;
  versionId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface DetailStructureLevelDelegate {
  findMany(args: {
    where: DetailStructureLevelWhere;
    orderBy?: OrderBy;
  }): Promise<DetailStructureLevelRow[]>;
  create(args: {
    data: DetailStructureLevelCreate;
  }): Promise<DetailStructureLevelRow>;
  createMany(args: {
    data: DetailStructureLevelCreate[];
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: DetailStructureLevelWhere;
  }): Promise<{ count: number }>;
}

export type DetailRow = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  detailStructureVersionId: string;
  isPostable: boolean;
  isActive: boolean;
} & AuditColumns;

export interface DetailWhere {
  id?: string;
  organizationId?: string;
  code?: string;
  parentId?: string | null;
  level?: number;
  detailStructureVersionId?: string;
  isPostable?: boolean;
  isActive?: boolean;
  OR?: Array<{
    code?: { contains: string; mode: 'insensitive' };
    title?: { contains: string; mode: 'insensitive' };
  }>;
}

export interface DetailCreate {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  detailStructureVersionId: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface DetailUpdate {
  title?: string | undefined;
  parentId?: string | null | undefined;
  level?: number | undefined;
  isPostable?: boolean | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface DetailDelegate {
  findUnique(args: { where: { id: string } }): Promise<DetailRow | null>;
  findFirst(args: { where: DetailWhere }): Promise<DetailRow | null>;
  findMany(args: {
    where: DetailWhere;
    orderBy?: OrderBy;
    skip?: number;
    take?: number;
  }): Promise<DetailRow[]>;
  create(args: { data: DetailCreate }): Promise<DetailRow>;
  update(args: {
    where: { id: string };
    data: DetailUpdate;
  }): Promise<DetailRow>;
  count(args: { where: DetailWhere }): Promise<number>;
}

// ---------------------------------------------------------------------------
// Transaction client
// ---------------------------------------------------------------------------

/** Parameterized raw SQL inside a transaction — the calendar lock path. */
export type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

/** The delegates the calendar transactions work with. */
export interface AccountingTxClient {
  $queryRaw: RawQuery;
  financialArea: Pick<
    FinancialAreaDelegate,
    'findMany' | 'update' | 'findFirst'
  > & {
    updateMany(args: {
      where: FinancialAreaWhere;
      data: { isDefault: boolean; updatedAt: Date; updatedBy: string | null };
    }): Promise<{ count: number }>;
  };
  fiscalYear: Pick<FiscalYearDelegate, 'findMany' | 'create' | 'update'>;
  accountingPeriod: Pick<
    AccountingPeriodDelegate,
    'findMany' | 'create' | 'update'
  > & {
    updateMany(args: {
      where: AccountingPeriodWhere;
      data: { status: string; updatedAt: Date; updatedBy: string | null };
    }): Promise<{ count: number }>;
  };
  codingStructureVersion: Pick<
    CodingStructureVersionDelegate,
    'findMany' | 'findFirst' | 'create' | 'update'
  >;
  codingStructureLevel: Pick<
    CodingStructureLevelDelegate,
    'findMany' | 'create' | 'deleteMany'
  >;
  accountingConfiguration: Pick<
    AccountingConfigurationDelegate,
    'findMany' | 'findFirst' | 'create' | 'update' | 'count'
  >;
  accountingConfigurationLevel: Pick<
    AccountingConfigurationLevelDelegate,
    'findMany' | 'create' | 'deleteMany'
  >;
  account: Pick<
    AccountDelegate,
    'findMany' | 'findFirst' | 'create' | 'update' | 'count'
  >;
  /** Task 10.4: the voucher header (guarded writes lock it FOR UPDATE). */
  accountingDocument: Pick<
    AccountingDocumentDelegate,
    'findUnique' | 'findFirst' | 'create' | 'update' | 'delete'
  > & {
    updateMany(args: {
      where: AccountingDocumentWhere;
      data: AccountingDocumentUpdate;
    }): Promise<{ count: number }>;
  };
  /**
   * Task 10.4. `accountingDocumentLine.count` is what the account guard
   * transaction asks to answer AC-I-11 ("is this account referenced by a
   * document line?"), and `accountingDocumentLine.createMany` is how a
   * voucher's lines are written in one statement.
   */
  accountingDocumentLine: Pick<
    AccountingDocumentLineDelegate,
    'findMany' | 'createMany' | 'updateMany' | 'deleteMany' | 'count'
  >;
  /**
   * Task 10.4: the posting-operation ledger. The insert happens LAST inside
   * the effect's transaction, so a committed effect always has its key.
   */
  accountingPostingOperation: Pick<
    AccountingPostingOperationDelegate,
    'findFirst' | 'create'
  >;
  /**
   * Task 10.7: the immutable ledger entries. Written only by
   * `finalizeChecked`, between the state update and the operation-ledger
   * insert — a plain `createMany` (never `skipDuplicates`: a second entry for
   * one line must fail the transaction, not vanish silently).
   */
  ledgerEntry: Pick<
    LedgerEntryDelegate,
    'createMany' | 'findMany' | 'updateMany' | 'count'
  >;
  /**
   * Task 12: turnover projection rows, written transactionally by
   * `finalizeChecked` (UPSERT per key, or DELETE when Σ=0) and by the
   * explicit `rebuild` transaction (atomic replace per scope).
   */
  accountBalanceProjection: AccountBalanceProjectionDelegate;
  /**
   * Task 23: the Base Chart template store. Lifecycle writes lock the
   * template's version rows (`FOR UPDATE`, ascending id) and mutate ONLY
   * these delegates; the adoption transaction additionally locks the
   * organization's pinned coding-structure version + accounting
   * configuration (never the reverse order) and writes ordinary `accounts`
   * rows plus ONE `baseChartAdoption` record — nothing else.
   */
  baseChartTemplate: Pick<BaseChartTemplateDelegate, 'findFirst' | 'create'>;
  baseChartTemplateVersion: Pick<
    BaseChartTemplateVersionDelegate,
    'findMany' | 'create' | 'update'
  >;
  baseChartTemplateLevel: Pick<
    BaseChartTemplateLevelDelegate,
    'findMany' | 'create' | 'deleteMany'
  >;
  baseChartTemplateNode: Pick<
    BaseChartTemplateNodeDelegate,
    'findMany' | 'create' | 'deleteMany'
  >;
  baseChartAdoption: Pick<
    BaseChartAdoptionDelegate,
    'findFirst' | 'create' | 'count'
  >;
  detailStructureVersion: Pick<
    DetailStructureVersionDelegate,
    'findMany' | 'findFirst' | 'create' | 'update'
  >;
  detailStructureLevel: Pick<
    DetailStructureLevelDelegate,
    'findMany' | 'create' | 'deleteMany'
  >;
  detail: Pick<
    DetailDelegate,
    'findUnique' | 'findFirst' | 'findMany' | 'create' | 'update' | 'count'
  >;
}

export interface AccountingTransactionalClient {
  $transaction: <T>(fn: (tx: AccountingTxClient) => Promise<T>) => Promise<T>;
}
