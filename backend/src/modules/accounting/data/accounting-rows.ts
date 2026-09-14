/**
 * Shared row/delegate shapes for the Accounting foundation's data layer
 * (Task 10.2, ADR-0026).
 *
 * Prisma models are private to their module (docs/database-strategy.md §2)
 * and codegen may not have run in a fresh checkout, so — like the
 * Organization, Inventory, Document and Workflow data layers — the
 * repositories declare the *structural* surface they use. Services work
 * with domain entities, never with these shapes.
 *
 * The calendar guards (overlap, year bounds, lifecycle moves) are the
 * module's documented concurrency-critical SQL (docs/modules.md
 * §Accounting, AR-11): parent rows are locked with `SELECT … FOR UPDATE`
 * (Prisma cannot express it) and the guard is re-evaluated inside the same
 * transaction as the write — never check-then-act across the boundary.
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
}

export interface AccountingTransactionalClient {
  $transaction: <T>(fn: (tx: AccountingTxClient) => Promise<T>) => Promise<T>;
}
