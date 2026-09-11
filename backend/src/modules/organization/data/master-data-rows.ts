/**
 * Shared row/delegate shapes for the Organization module's data layer.
 *
 * Prisma models are private to their module (docs/database-strategy.md §2) and
 * the generated client may not exist yet in a fresh checkout, so repositories
 * declare the *structural* surface they use — the same approach as
 * `modules/users/data/users.repository.ts`. Declaring it once per module
 * instead of once per method keeps the repositories readable.
 *
 * Nothing here is exported outside `data/`: services work with domain
 * entities, never with row shapes.
 */

/** `created_at`/`updated_at`/`created_by`/`updated_by` (AR-12). */
export interface AuditColumns {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Row shape shared by branch/department/party (id + org + code + name). */
export interface ScopedCodeRow extends AuditColumns {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Prisma `orderBy` accepts an array of single-field directions. */
export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

export interface ListArgs<TWhere> {
  where: TWhere;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

/**
 * The delegate operations every master-data repository in this module needs.
 * `findUnique` is by primary key; `findFirst` is the flexible lookup used for
 * business-key and organization-consistency checks.
 */
export interface MasterDataDelegate<TRow, TWhere, TCreate, TUpdate> {
  findUnique(args: { where: { id: string } }): Promise<TRow | null>;
  findFirst(args: { where: TWhere }): Promise<TRow | null>;
  findMany(args: ListArgs<TWhere>): Promise<TRow[]>;
  count(args: { where: TWhere }): Promise<number>;
  create(args: { data: TCreate }): Promise<TRow>;
  update(args: { where: { id: string }; data: TUpdate }): Promise<TRow>;
}

/** Insert payload shared by the code/name entities. */
export interface ScopedCodeCreate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/** Update payload: only the columns a service is allowed to change. */
export interface ScopedCodeUpdate {
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}
