/**
 * In-memory stand-ins for the Organization and Inventory master-data
 * repositories (test support).
 *
 * Same purpose as the identity/RBAC fakes in `in-memory-repositories.ts`: the
 * e2e suite runs the FULL HTTP stack — controllers, guards, real application
 * services, the real permission registry and its startup sync — with no
 * Postgres, no Docker and no Prisma codegen.
 *
 * What is faked and what is not:
 * - faked: the ten master-data repositories and `PrismaService`;
 * - NOT faked: authorization checks, cross-module reference resolution,
 *   code-uniqueness handling, hierarchy rules, capability invariants,
 *   conversion versioning, DTO validation.
 *
 * The fakes honour the contracts the real repositories guarantee, including the
 * database failure the services map to 409 (unique violation `P2002`) and the
 * one they map to 404 (missing row `P2025`). The *business* rules they do NOT
 * duplicate — organization consistency, inactive parents, overlapping
 * conversion versions — are enforced by the services, which is what the tests
 * exercise.
 *
 * Sorting mirrors the repositories' `orderBy` handling (an array of
 * single-field directions) and `search` mirrors their case-insensitive
 * `contains` clauses.
 *
 * Note on `Audited`: the domain entities do NOT carry `createdBy`/`updatedBy`
 * (audit actors are deliberately not exposed, AR-24). They are kept here
 * because the repositories accept them on create/update, so the fakes must
 * swallow them exactly like the real columns do.
 */
import type { Organization } from '../../src/modules/organization/domain/organization.js';
import type { Branch } from '../../src/modules/organization/domain/branch.js';
import type { Department } from '../../src/modules/organization/domain/department.js';
import type { Employee } from '../../src/modules/organization/domain/employee.js';
import type { Party } from '../../src/modules/organization/domain/party.js';
import type { Unit } from '../../src/modules/inventory/domain/unit.js';
import type { ItemGroup } from '../../src/modules/inventory/domain/item-group.js';
import type { Item } from '../../src/modules/inventory/domain/item.js';
import type { UnitConversion } from '../../src/modules/inventory/domain/unit-conversion.js';
import type { Warehouse } from '../../src/modules/inventory/domain/warehouse.js';
import type { HierarchyEdge } from '../../src/modules/organization/domain/hierarchy.js';
import type { OrganizationsRepository } from '../../src/modules/organization/data/organizations.repository.js';
import type { OrganizationMembershipsRepository } from '../../src/modules/organization/data/organization-memberships.repository.js';
import type { OrganizationMembershipRow } from '../../src/modules/organization/data/organization-memberships.repository.js';
import type { BranchesRepository } from '../../src/modules/organization/data/branches.repository.js';
import type { DepartmentsRepository } from '../../src/modules/organization/data/departments.repository.js';
import type { EmployeesRepository } from '../../src/modules/organization/data/employees.repository.js';
import type { PartiesRepository } from '../../src/modules/organization/data/parties.repository.js';
import type { UnitsRepository } from '../../src/modules/inventory/data/units.repository.js';
import type { ItemGroupsRepository } from '../../src/modules/inventory/data/item-groups.repository.js';
import type { ItemsRepository } from '../../src/modules/inventory/data/items.repository.js';
import type { UnitConversionsRepository } from '../../src/modules/inventory/data/unit-conversions.repository.js';
import type { WarehousesRepository } from '../../src/modules/inventory/data/warehouses.repository.js';
import { recordNotFound, uniqueViolation } from './in-memory-repositories.js';

export type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

/**
 * The columns every in-memory row is keyed and lifecycle-managed by.
 * Exported with the table: the inventory-core fakes reuse both.
 */
export interface Row {
  id: string;
}

function clone<T>(row: T): T {
  return structuredClone(row);
}

/**
 * Generic in-memory table with the master-data repository surface:
 * find-by-id, find-by-business-key, filtered list + total, create, update.
 *
 * Each entry of `uniqueKeys` is ONE unique index, given as the tuple of columns
 * it covers. The tuples matter: `('organizationId', 'code')` means "the same
 * code may exist in every organization", whereas listing the two columns as
 * separate indexes would wrongly forbid reusing a code in a second
 * organization. A duplicate throws the same `P2002` the Prisma driver would, so
 * the services' unique-violation fallback is exercised for real.
 */
export class InMemoryTable<TRow extends Row> {
  private readonly rows = new Map<string, TRow>();

  constructor(
    private readonly uniqueKeys: readonly (readonly string[])[] = [],
  ) {}

  get size(): number {
    return this.rows.size;
  }

  /** Remove a row; mirrors a `DELETE … WHERE id` (rebuild of phantom rows). */
  delete(id: string): boolean {
    return this.rows.delete(id);
  }

  /** Deep snapshot for transaction rollback in the core fakes. */
  snapshot(): TRow[] {
    return [...this.rows.values()].map(clone);
  }

  /** Restore a snapshot taken by `snapshot` (rollback only, not fixtures). */
  restore(rows: readonly TRow[]): void {
    this.rows.clear();
    for (const row of rows) {
      this.rows.set(row.id, clone(row));
    }
  }

  findById(id: string): TRow | null {
    const row = this.rows.get(id);
    return row === undefined ? null : clone(row);
  }

  findOne(predicate: (row: TRow) => boolean): TRow | null {
    for (const row of this.rows.values()) {
      if (predicate(row)) return clone(row);
    }
    return null;
  }

  findMany(predicate: (row: TRow) => boolean): TRow[] {
    return [...this.rows.values()].filter(predicate).map(clone);
  }

  insert(row: TRow): TRow {
    this.assertUnique(row);
    this.rows.set(row.id, clone(row));
    return clone(row);
  }

  patch(id: string, patch: Record<string, unknown>): TRow | null {
    const row = this.rows.get(id);
    if (row === undefined) throw recordNotFound();
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      (row as Record<string, unknown>)[key] = value;
    }
    this.assertUnique(row);
    return clone(row);
  }

  /** Seed a row bypassing the uniqueness guard (fixtures only). */
  seed(row: TRow): TRow {
    this.rows.set(row.id, clone(row));
    return clone(row);
  }

  private assertUnique(row: TRow): void {
    const record = row as unknown as Record<string, unknown>;
    for (const columns of this.uniqueKeys) {
      // A unique index treats NULL as distinct (SQL semantics), and every
      // indexed column must match for the tuple to clash.
      if (columns.some((column) => record[column] === null)) continue;
      const clash = this.findOne((existing) => {
        if (existing.id === row.id) return false;
        const other = existing as unknown as Record<string, unknown>;
        return columns.every((column) => other[column] === record[column]);
      });
      if (clash !== null) throw uniqueViolation(columns);
    }
  }
}

function matchesSearch(row: Record<string, unknown>, search: string): boolean {
  const needle = search.toLowerCase();
  return ['code', 'name', 'displayName', 'barcode', 'employeeCode'].some(
    (field) => {
      const value = row[field];
      return typeof value === 'string' && value.toLowerCase().includes(needle);
    },
  );
}

function applyOrderBy<T extends object>(rows: T[], orderBy: OrderBy): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const clause of orderBy) {
      const entry = Object.entries(clause)[0];
      if (entry === undefined) continue;
      const [field, direction] = entry;
      const left = (a as Record<string, unknown>)[field];
      const right = (b as Record<string, unknown>)[field];
      const comparison =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left ?? '').localeCompare(String(right ?? ''));
      if (comparison !== 0) {
        return direction === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
  return sorted;
}

/**
 * Equality-filter a table the way the repositories' `where` objects do, then
 * sort and page. `undefined` means "not filtered"; `null` means "is null", so
 * `parentId: null` correctly selects roots.
 */
export function listPage<TRow extends Row, TWhere extends object>(
  table: InMemoryTable<TRow>,
  params: {
    where: TWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  },
  extra: (row: TRow, where: TWhere) => boolean = () => true,
): { items: TRow[]; total: number } {
  const filtered = table.findMany((row) => {
    const record = row as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(params.where)) {
      if (expected === undefined) continue;
      if (key === 'search') {
        if (typeof expected === 'string' && expected !== '') {
          if (!matchesSearch(record, expected)) return false;
        }
        continue;
      }
      if (record[key] !== expected) return false;
    }
    return extra(row, params.where);
  });
  const ordered = applyOrderBy(filtered, params.orderBy);
  return {
    items: ordered.slice(params.skip, params.skip + params.take),
    total: filtered.length,
  };
}

interface ListParams {
  where: Record<string, unknown>;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

type Patch = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Organization module
// ---------------------------------------------------------------------------

/**
 * The five Organization repositories share one shape: `findByCode`,
 * `findByCodeExcludingId`, `list`, `create`, `update`. `Organization` is the
 * exception — its code is unique deployment-wide, so `findByCode` takes no
 * `organizationId`.
 */
class ScopedCodeTable<TRow extends Row & { organizationId: string }> {
  constructor(
    readonly table: InMemoryTable<TRow>,
    private readonly codeField = 'code',
  ) {}

  async findById(id: string): Promise<TRow | null> {
    return this.table.findById(id);
  }

  async findByCode(organizationId: string, code: string): Promise<TRow | null> {
    return this.table.findOne(
      (row) =>
        row.organizationId === organizationId &&
        (row as unknown as Record<string, unknown>)[this.codeField] === code,
    );
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<TRow | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: ListParams): Promise<{ items: TRow[]; total: number }> {
    return listPage(this.table, params);
  }

  async create(input: TRow): Promise<TRow> {
    return this.table.insert(clone(input));
  }

  async update(id: string, patch: Patch): Promise<TRow | null> {
    return this.table.patch(id, patch);
  }
}

export class InMemoryOrganizationsRepository {
  readonly table = new InMemoryTable<Organization>([['code']]);

  async findById(id: string): Promise<Organization | null> {
    return this.table.findById(id);
  }

  async findByCode(code: string): Promise<Organization | null> {
    return this.table.findOne((row) => row.code === code);
  }

  async findByCodeExcludingId(
    code: string,
    excludeId: string,
  ): Promise<Organization | null> {
    const existing = await this.findByCode(code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(
    params: ListParams,
  ): Promise<{ items: Organization[]; total: number }> {
    return listPage(this.table, params);
  }

  async create(input: Organization): Promise<Organization> {
    return this.table.insert(clone(input));
  }

  async update(id: string, patch: Patch): Promise<Organization | null> {
    return this.table.patch(id, patch);
  }
}

export class InMemoryBranchesRepository extends ScopedCodeTable<Branch> {
  constructor() {
    super(new InMemoryTable<Branch>([['organizationId', 'code']]));
  }
}

export class InMemoryDepartmentsRepository extends ScopedCodeTable<Department> {
  constructor() {
    super(new InMemoryTable<Department>([['organizationId', 'code']]));
  }

  async listHierarchyEdges(organizationId: string): Promise<HierarchyEdge[]> {
    return this.table
      .findMany((row) => row.organizationId === organizationId)
      .map((row) => ({ id: row.id, parentId: row.parentDepartmentId }));
  }
}

export class InMemoryEmployeesRepository extends ScopedCodeTable<Employee> {
  constructor() {
    super(new InMemoryTable<Employee>([['organizationId', 'employeeCode']]));
  }

  async findByCode(
    organizationId: string,
    employeeCode: string,
  ): Promise<Employee | null> {
    return super.findByCode(organizationId, employeeCode);
  }

  async list(
    params: ListParams,
  ): Promise<{ items: Employee[]; total: number }> {
    // `employee_code` is the searchable business key for this entity.
    return listPage(this.table, params);
  }
}

export class InMemoryPartiesRepository extends ScopedCodeTable<Party> {
  constructor() {
    super(new InMemoryTable<Party>([['organizationId', 'code']]));
  }
}

// ---------------------------------------------------------------------------
// Inventory module
// ---------------------------------------------------------------------------

export class InMemoryUnitsRepository extends ScopedCodeTable<Unit> {
  constructor() {
    super(new InMemoryTable<Unit>([['organizationId', 'code']]));
  }
}

export class InMemoryItemGroupsRepository extends ScopedCodeTable<ItemGroup> {
  constructor() {
    super(new InMemoryTable<ItemGroup>([['organizationId', 'code']]));
  }

  async listHierarchyEdges(organizationId: string): Promise<HierarchyEdge[]> {
    return this.table
      .findMany((row) => row.organizationId === organizationId)
      .map((row) => ({ id: row.id, parentId: row.parentId }));
  }
}

export class InMemoryItemsRepository extends ScopedCodeTable<Item> {
  constructor() {
    super(new InMemoryTable<Item>([['organizationId', 'code']]));
  }
}

export class InMemoryWarehousesRepository extends ScopedCodeTable<Warehouse> {
  constructor() {
    super(new InMemoryTable<Warehouse>([['organizationId', 'code']]));
  }
}

/**
 * Both conversion tables in one fake, mirroring the two real tables.
 *
 * Uniqueness is per (owner, fromUnit, toUnit, validFrom): global rows key on
 * `organizationId`, item rows on `itemId`.
 */
export class InMemoryUnitConversionsRepository {
  readonly globals = new InMemoryTable<UnitConversion>([
    ['organizationId', 'fromUnitId', 'toUnitId', 'validFrom'],
  ]);

  readonly items = new InMemoryTable<UnitConversion>([
    ['itemId', 'fromUnitId', 'toUnitId', 'validFrom'],
  ]);

  async findGlobalVersions(
    organizationId: string,
    fromUnitId: string,
    toUnitId: string,
  ): Promise<UnitConversion[]> {
    return this.globals.findMany(
      (row) =>
        row.organizationId === organizationId &&
        row.fromUnitId === fromUnitId &&
        row.toUnitId === toUnitId,
    );
  }

  async findItemVersions(
    itemId: string,
    fromUnitId: string,
    toUnitId: string,
  ): Promise<UnitConversion[]> {
    return this.items.findMany(
      (row) =>
        row.itemId === itemId &&
        row.fromUnitId === fromUnitId &&
        row.toUnitId === toUnitId,
    );
  }

  async findGlobalById(id: string): Promise<UnitConversion | null> {
    return this.globals.findById(id);
  }

  async findItemById(id: string): Promise<UnitConversion | null> {
    return this.items.findById(id);
  }

  async findStoredById(
    id: string,
  ): Promise<{ scope: 'global' | 'item'; conversion: UnitConversion } | null> {
    const global = this.globals.findById(id);
    if (global !== null) return { scope: 'global', conversion: global };
    const item = this.items.findById(id);
    if (item !== null) return { scope: 'item', conversion: item };
    return null;
  }

  async listGlobal(
    params: ListParams,
  ): Promise<{ items: UnitConversion[]; total: number }> {
    return listPage(this.globals, params, matchesConversionFilters);
  }

  async listForItem(
    params: ListParams,
  ): Promise<{ items: UnitConversion[]; total: number }> {
    return listPage(this.items, params, matchesConversionFilters);
  }

  /**
   * Close the superseded version and insert the new one together, mirroring the
   * real repository's single `$transaction`: a unit pair is never observable
   * with two open-ended versions.
   *
   * The signature matches the real repository exactly (`create` / `supersededId`
   * / `close`) so a drift in that contract fails to compile here rather than
   * silently passing in a test.
   */
  async createGlobalVersion(input: {
    create: UnitConversion;
    supersededId: string | null;
    close: { validTo: Date; updatedAt: Date; updatedBy: string | null };
  }): Promise<UnitConversion> {
    // `inventory.unit_conversions` has no `item_id` column; the real
    // repository's row→domain mapping fills `itemId: null`. Without this the
    // fake would return `undefined` and a global conversion would be
    // indistinguishable from a malformed one.
    return this.writeVersion(this.globals, {
      ...input,
      create: { ...input.create, itemId: null },
    });
  }

  async createItemVersion(input: {
    create: UnitConversion;
    supersededId: string | null;
    close: { validTo: Date; updatedAt: Date; updatedBy: string | null };
  }): Promise<UnitConversion> {
    return this.writeVersion(this.items, input);
  }

  private writeVersion(
    table: InMemoryTable<UnitConversion>,
    input: {
      create: UnitConversion;
      supersededId: string | null;
      close: { validTo: Date; updatedAt: Date; updatedBy: string | null };
    },
  ): UnitConversion {
    if (input.supersededId !== null) {
      table.patch(input.supersededId, { ...input.close });
    }
    return table.insert(clone(input.create));
  }
}

/** Unit-pair and validity-window filters shared by both conversion tables. */
function matchesConversionFilters(
  row: UnitConversion,
  where: Record<string, unknown>,
): boolean {
  const fromUnitId = where['fromUnitId'];
  if (typeof fromUnitId === 'string' && row.fromUnitId !== fromUnitId) {
    return false;
  }
  const toUnitId = where['toUnitId'];
  if (typeof toUnitId === 'string' && row.toUnitId !== toUnitId) return false;
  const activeAt = where['activeAt'];
  if (activeAt instanceof Date) {
    if (row.validFrom.getTime() > activeAt.getTime()) return false;
    if (row.validTo !== null && row.validTo.getTime() <= activeAt.getTime()) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Organization memberships (Task 19, ODR-3)
// ---------------------------------------------------------------------------

/**
 * In-memory stand-in for `OrganizationMembershipsRepository`. The composite
 * (userId, organizationId) key throws the same `P2002` the real table's
 * primary key would, so the service's duplicate-grant mapping is exercised
 * for real. FK violations are NOT simulated: the service's user-existence
 * mapping is covered by the real-database suites.
 */
export class InMemoryOrganizationMembershipsRepository {
  private readonly rows = new Map<string, OrganizationMembershipRow>();

  private key(userId: string, organizationId: string): string {
    return `${userId}:${organizationId}`;
  }

  async findMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembershipRow | null> {
    return this.rows.get(this.key(userId, organizationId)) ?? null;
  }

  /** The bootstrap predicate: does this organization have ANY member? */
  async hasAnyMember(organizationId: string): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (row.organizationId === organizationId) return true;
    }
    return false;
  }

  async listForOrganization(params: {
    organizationId: string;
    skip: number;
    take: number;
  }): Promise<{ items: OrganizationMembershipRow[]; total: number }> {
    const items = [...this.rows.values()]
      .filter((row) => row.organizationId === params.organizationId)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.userId < b.userId ? -1 : 1),
      );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    userId: string;
    organizationId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<OrganizationMembershipRow> {
    const key = this.key(input.userId, input.organizationId);
    if (this.rows.has(key)) {
      throw uniqueViolation(['user_id', 'organization_id']);
    }
    const row: OrganizationMembershipRow = {
      userId: input.userId,
      organizationId: input.organizationId,
      createdAt: input.now,
      createdBy: input.createdBy,
    };
    this.rows.set(key, row);
    return { ...row };
  }

  async remove(userId: string, organizationId: string): Promise<boolean> {
    return this.rows.delete(this.key(userId, organizationId));
  }

  /** Test-only direct seed (the API path is exercised elsewhere). */
  seed(userId: string, organizationId: string, now = new Date()): void {
    this.rows.set(this.key(userId, organizationId), {
      userId,
      organizationId,
      createdAt: now,
      createdBy: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface MasterDataStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  organizations: OrganizationsRepository;
  memberships: OrganizationMembershipsRepository;
  branches: BranchesRepository;
  departments: DepartmentsRepository;
  employees: EmployeesRepository;
  parties: PartiesRepository;
  units: UnitsRepository;
  itemGroups: ItemGroupsRepository;
  items: ItemsRepository;
  unitConversions: UnitConversionsRepository;
  warehouses: WarehousesRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    organizations: InMemoryOrganizationsRepository;
    memberships: InMemoryOrganizationMembershipsRepository;
    branches: InMemoryBranchesRepository;
    departments: InMemoryDepartmentsRepository;
    employees: InMemoryEmployeesRepository;
    parties: InMemoryPartiesRepository;
    units: InMemoryUnitsRepository;
    itemGroups: InMemoryItemGroupsRepository;
    items: InMemoryItemsRepository;
    unitConversions: InMemoryUnitConversionsRepository;
    warehouses: InMemoryWarehousesRepository;
  };
}

/**
 * Build one coherent in-memory "database" for the master-data modules. Every
 * store is independent (as the real tables are) — cross-table consistency is
 * enforced by the services, not by the fakes.
 */
export function createMasterDataStores(): MasterDataStores {
  const organizations = new InMemoryOrganizationsRepository();
  const memberships = new InMemoryOrganizationMembershipsRepository();
  const branches = new InMemoryBranchesRepository();
  const departments = new InMemoryDepartmentsRepository();
  const employees = new InMemoryEmployeesRepository();
  const parties = new InMemoryPartiesRepository();
  const units = new InMemoryUnitsRepository();
  const itemGroups = new InMemoryItemGroupsRepository();
  const items = new InMemoryItemsRepository();
  const unitConversions = new InMemoryUnitConversionsRepository();
  const warehouses = new InMemoryWarehousesRepository();
  return {
    organizations: organizations as unknown as OrganizationsRepository,
    memberships: memberships as unknown as OrganizationMembershipsRepository,
    branches: branches as unknown as BranchesRepository,
    departments: departments as unknown as DepartmentsRepository,
    employees: employees as unknown as EmployeesRepository,
    parties: parties as unknown as PartiesRepository,
    units: units as unknown as UnitsRepository,
    itemGroups: itemGroups as unknown as ItemGroupsRepository,
    items: items as unknown as ItemsRepository,
    unitConversions: unitConversions as unknown as UnitConversionsRepository,
    warehouses: warehouses as unknown as WarehousesRepository,
    raw: {
      organizations,
      memberships,
      branches,
      departments,
      employees,
      parties,
      units,
      itemGroups,
      items,
      unitConversions,
      warehouses,
    },
  };
}
