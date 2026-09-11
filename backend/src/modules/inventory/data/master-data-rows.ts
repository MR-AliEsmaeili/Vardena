/**
 * Shared row/delegate shapes for the Inventory module's data layer.
 *
 * Mirrors `modules/organization/data/master-data-rows.ts`; see that file (and
 * this module's `domain/master-data.ts`) for why the two copies exist.
 *
 * Prisma models are private to their module (docs/database-strategy.md §2) and
 * codegen may not have run, so repositories declare the structural surface they
 * use — the approach already established by `modules/users/data/`.
 */

/** `created_at`/`updated_at`/`created_by`/`updated_by` (AR-12). */
export interface AuditColumns {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Prisma `orderBy` accepts an array of single-field directions. */
export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

export interface ListArgs<TWhere> {
  where: TWhere;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

/** The delegate operations every master-data repository here needs. */
export interface MasterDataDelegate<TRow, TWhere, TCreate, TUpdate> {
  findUnique(args: { where: { id: string } }): Promise<TRow | null>;
  findFirst(args: { where: TWhere }): Promise<TRow | null>;
  findMany(args: ListArgs<TWhere>): Promise<TRow[]>;
  count(args: { where: TWhere }): Promise<number>;
  create(args: { data: TCreate }): Promise<TRow>;
  update(args: { where: { id: string }; data: TUpdate }): Promise<TRow>;
}
