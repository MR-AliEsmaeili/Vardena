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

export interface LedgerEntryWhere {
  organizationId?: string;
  voucherId?: string;
  voucherLineId?: string;
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
 */
export interface LedgerEntryDelegate {
  findMany(args: {
    where: LedgerEntryWhere;
    orderBy: OrderBy;
  }): Promise<LedgerEntryRow[]>;
  createMany(args: { data: LedgerEntryCreate[] }): Promise<{ count: number }>;
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
    'findMany' | 'createMany' | 'deleteMany' | 'count'
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
  ledgerEntry: Pick<LedgerEntryDelegate, 'createMany' | 'findMany'>;
  /**
   * Task 12: turnover projection rows, written transactionally by
   * `finalizeChecked` (UPSERT per key, or DELETE when Σ=0) and by the
   * explicit `rebuild` transaction (atomic replace per scope).
   */
  accountBalanceProjection: AccountBalanceProjectionDelegate;
}

export interface AccountingTransactionalClient {
  $transaction: <T>(fn: (tx: AccountingTxClient) => Promise<T>) => Promise<T>;
}
