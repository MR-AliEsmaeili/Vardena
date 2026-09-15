/**
 * In-memory stand-ins for the Task 10.3 repositories (coding structure +
 * chart of accounts).
 *
 * Same contract as the calendar fakes in `accounting-repositories.ts`: the
 * e2e suites run the FULL HTTP stack with no Postgres and no Prisma codegen,
 * so what is faked is data access only — authorization, organization
 * scoping, placement rules, code rules, version semantics and the guard
 * errors are the REAL ones, executed by the real services against these rows.
 *
 * The fakes mirror the guarded transactions' observable effects:
 * - the unique indexes (`(organizationId, code, versionNumber)` for versions,
 *   `(versionId, levelIndex)` for levels, `(organizationId, code)` for
 *   accounts) throw the same `P2002`;
 * - the guard methods (`updateDraftChecked`, `publishChecked`,
 *   `createChecked`, `updateChecked`) re-evaluate the SAME domain decision
 *   tables against the committed rows and throw the SAME plain errors the real
 *   repositories throw, so one service mapping covers both paths.
 *
 * Locking has no observable effect in a single-threaded fake; what matters is
 * that the guard evaluates against committed state and the write applies
 * atomically. True lock contention is covered by the live-database suite.
 */
import type {
  CodingStructureLevel,
  CodingStructureVersion,
} from '../../src/modules/accounting/domain/coding-structure.js';
import {
  isAccountLevelKind,
  planCodingStructure,
} from '../../src/modules/accounting/domain/coding-structure.js';
import type { Account } from '../../src/modules/accounting/domain/account.js';
import {
  isReferencedByDocumentLine,
  planAccountEdit,
  planAccountPlacement,
  planPostabilityChange,
} from '../../src/modules/accounting/domain/account.js';
import { collectDescendantIds } from '../../src/modules/accounting/domain/hierarchy.js';
import {
  AccountImmutableAfterUseError,
  AccountPlacementRejectedError,
  AccountPostabilityRejectedError,
  CodingStructureNotDraftError,
  CodingStructurePlanRejectedError,
  CodingStructureVersionNotActiveError,
} from '../../src/modules/accounting/data/accounting-structure-errors.js';
import type { AccountStructureSnapshot } from '../../src/modules/accounting/data/accounts.repository.js';
import type { LevelWrite } from '../../src/modules/accounting/data/coding-structures.repository.js';
import type { CodingStructuresRepository } from '../../src/modules/accounting/data/coding-structures.repository.js';
import type { AccountsRepository } from '../../src/modules/accounting/data/accounts.repository.js';
import { InMemoryTable, type Row } from './master-data-repositories.js';

type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

interface ListParams {
  where: Record<string, unknown>;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

/** Version row as stored by the fake (levels are attached on read). */
export interface CodingStructureVersionRecord extends Row {
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
  updatedBy: string | null;
}

/** Level row as stored by the fake (the domain entity has no scope columns). */
export interface CodingStructureLevelRecord extends Row {
  id: string;
  versionId: string;
  organizationId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface AccountRecord extends Row {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  codingStructureVersionId: string;
  accountNature: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StructureState {
  versions: InMemoryTable<CodingStructureVersionRecord>;
  levels: InMemoryTable<CodingStructureLevelRecord>;
  accounts: InMemoryTable<AccountRecord>;
}

export function createStructureState(): StructureState {
  return {
    versions: new InMemoryTable<CodingStructureVersionRecord>([
      ['organizationId', 'code', 'versionNumber'],
    ]),
    levels: new InMemoryTable<CodingStructureLevelRecord>([
      ['versionId', 'levelIndex'],
    ]),
    accounts: new InMemoryTable<AccountRecord>([['organizationId', 'code']]),
  };
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}

/** Equality filter + sort + page, like the real repositories' `where`. */
function listPage<TRow extends Row>(
  table: InMemoryTable<TRow>,
  params: ListParams,
  extra?: (row: TRow) => boolean,
): { items: TRow[]; total: number } {
  const filtered = table.findMany((row) => {
    const record = row as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(params.where)) {
      if (expected === undefined) continue;
      if (key === 'search') {
        const search = String(expected).toLowerCase();
        const code = record['code'];
        const title = record['title'];
        const hit =
          (typeof code === 'string' && code.toLowerCase().includes(search)) ||
          (typeof title === 'string' && title.toLowerCase().includes(search));
        if (!hit) return false;
        continue;
      }
      if (key === 'parentId' && expected === null) {
        if (record['parentId'] !== null) return false;
        continue;
      }
      if (record[key] !== expected) return false;
    }
    return extra === undefined ? true : extra(row);
  });
  const ordered = [...filtered].sort((a, b) => {
    for (const clause of params.orderBy) {
      const entry = Object.entries(clause)[0];
      if (entry === undefined) continue;
      const [field, direction] = entry;
      const comparison = compareValues(
        (a as Record<string, unknown>)[field],
        (b as Record<string, unknown>)[field],
      );
      if (comparison !== 0) {
        return direction === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
  return {
    items: ordered.slice(params.skip, params.skip + params.take),
    total: filtered.length,
  };
}

// ---------------------------------------------------------------------------
// Coding structures
// ---------------------------------------------------------------------------

export class InMemoryCodingStructuresRepository {
  constructor(private readonly state: StructureState) {}

  private levelsOf(versionId: string): CodingStructureLevel[] {
    return this.state.levels
      .findMany((level) => level.versionId === versionId)
      .sort((a, b) => a.levelIndex - b.levelIndex)
      .map((level) => ({
        id: level.id,
        versionId: level.versionId,
        levelIndex: level.levelIndex,
        title: level.title,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
        levelKind: isAccountLevelKind(level.levelKind ?? '')
          ? level.levelKind
          : null,
      })) as CodingStructureLevel[];
  }

  private withLevels(
    row: CodingStructureVersionRecord,
  ): CodingStructureVersion {
    const levels = this.levelsOf(row.id);
    return {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      versionNumber: row.versionNumber,
      status: row.status as CodingStructureVersion['status'],
      maxDepth: row.maxDepth,
      separator: row.separator as CodingStructureVersion['separator'],
      levels,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findById(id: string): Promise<CodingStructureVersion | null> {
    const row = this.state.versions.findById(id);
    return row === null ? null : this.withLevels(row);
  }

  async findActiveForOrganization(
    organizationId: string,
  ): Promise<CodingStructureVersion | null> {
    const row = this.state.versions.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.status === 'active',
    );
    return row === null ? null : this.withLevels(row);
  }

  async findLatestForCode(
    organizationId: string,
    code: string,
  ): Promise<{ versionNumber: number } | null> {
    const rows = this.state.versions.findMany(
      (row) => row.organizationId === organizationId && row.code === code,
    );
    if (rows.length === 0) return null;
    const max = rows.reduce(
      (best, row) => (row.versionNumber > best ? row.versionNumber : best),
      0,
    );
    return { versionNumber: max };
  }

  async list(params: ListParams): Promise<{
    items: CodingStructureVersion[];
    total: number;
  }> {
    const { items, total } = listPage(this.state.versions, params);
    return { items: items.map((row) => this.withLevels(row)), total };
  }

  async createDraftWithLevels(input: {
    id: string;
    organizationId: string;
    code: string;
    versionNumber: number;
    maxDepth: number;
    separator: string;
    levels: readonly LevelWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<CodingStructureVersion> {
    const now = input.createdAt;
    const row: CodingStructureVersionRecord = {
      id: input.id,
      organizationId: input.organizationId,
      code: input.code,
      versionNumber: input.versionNumber,
      status: 'draft',
      maxDepth: input.maxDepth,
      separator: input.separator,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
    // `insert` enforces the unique tuple and throws `P2002`, exactly like the
    // index does, so the service's retry loop is exercised for real.
    this.state.versions.insert(row);
    for (const level of input.levels) {
      this.state.levels.insert(
        levelRecord(level, input.id, input.organizationId, now, input.actorId),
      );
    }
    return this.withLevels(row);
  }

  async updateDraftChecked(input: {
    id: string;
    maxDepth?: number | undefined;
    separator?: string | undefined;
    levels?: readonly LevelWrite[] | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<CodingStructureVersion> {
    const stored = this.state.versions.findById(input.id);
    if (stored === null) {
      throw new Error(
        `Coding structure version "${input.id}" no longer exists.`,
      );
    }
    if (stored.status !== 'draft') {
      throw new CodingStructureNotDraftError(stored.status);
    }
    const maxDepth = input.maxDepth ?? stored.maxDepth;
    const separator = input.separator ?? stored.separator;
    const existing = this.levelsOf(input.id);
    const candidates: readonly LevelWrite[] =
      input.levels ??
      existing.map((level) => ({
        id: level.id,
        levelIndex: level.levelIndex,
        title: level.title,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
        levelKind: level.levelKind,
      }));
    const plan = planCodingStructure({
      code: stored.code,
      maxDepth,
      separator,
      levels: candidates,
    });
    if (plan.problem !== null) {
      throw new CodingStructurePlanRejectedError(plan.problem, plan.subject);
    }
    this.state.versions.patch(input.id, {
      maxDepth,
      separator,
      updatedAt: input.updatedAt,
      updatedBy: input.actorId,
    });
    if (input.levels !== undefined) {
      for (const level of existing) this.state.levels.delete(level.id);
      for (const level of input.levels) {
        this.state.levels.insert(
          levelRecord(
            level,
            input.id,
            stored.organizationId,
            input.updatedAt,
            input.actorId,
          ),
        );
      }
    }
    const updated = this.state.versions.findById(input.id);
    if (updated === null) {
      throw new Error(
        `Coding structure version "${input.id}" no longer exists.`,
      );
    }
    return this.withLevels(updated);
  }

  async publishChecked(input: {
    versionId: string;
    organizationId: string;
    now: Date;
    actorId: string | null;
  }): Promise<{
    version: CodingStructureVersion;
    supersededVersionId: string | null;
  } | null> {
    const target = this.state.versions.findById(input.versionId);
    if (target === null || target.organizationId !== input.organizationId) {
      return null;
    }
    if (target.status !== 'draft') {
      throw new CodingStructureNotDraftError(target.status);
    }
    const levels = this.levelsOf(input.versionId);
    const plan = planCodingStructure({
      code: target.code,
      maxDepth: target.maxDepth,
      separator: target.separator,
      levels,
    });
    if (plan.problem !== null) {
      throw new CodingStructurePlanRejectedError(plan.problem, plan.subject);
    }
    let supersededVersionId: string | null = null;
    for (const row of this.state.versions.findMany(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.status === 'active' &&
        candidate.id !== input.versionId,
    )) {
      supersededVersionId = row.id;
      this.state.versions.patch(row.id, {
        status: 'superseded',
        updatedAt: input.now,
        updatedBy: input.actorId,
      });
    }
    this.state.versions.patch(input.versionId, {
      status: 'active',
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    const published = this.state.versions.findById(input.versionId);
    if (published === null) {
      throw new Error(
        `Coding structure version "${input.versionId}" no longer exists.`,
      );
    }
    return { version: this.withLevels(published), supersededVersionId };
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export class InMemoryAccountsRepository {
  constructor(private readonly state: StructureState) {}

  async findById(id: string): Promise<Account | null> {
    return toAccount(this.state.accounts.findById(id));
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Account | null> {
    return toAccount(
      this.state.accounts.findOne(
        (row) => row.organizationId === organizationId && row.code === code,
      ),
    );
  }

  async findChild(
    organizationId: string,
    parentId: string,
  ): Promise<Account | null> {
    return toAccount(
      this.state.accounts.findOne(
        (row) =>
          row.organizationId === organizationId && row.parentId === parentId,
      ),
    );
  }

  async listHierarchyEdges(organizationId: string) {
    return this.state.accounts
      .findMany((row) => row.organizationId === organizationId)
      .map((row) => ({ id: row.id, parentId: row.parentId }));
  }

  async list(params: ListParams): Promise<{ items: Account[]; total: number }> {
    const { items, total } = listPage(this.state.accounts, params);
    return { items: items.map(toAccount) as Account[], total };
  }

  async createChecked(input: {
    id: string;
    organizationId: string;
    code: string;
    title: string;
    parentId: string | null;
    accountNature: string;
    isPostable: boolean;
    structure: AccountStructureSnapshot;
    now: Date;
    actorId: string | null;
  }): Promise<Account> {
    const parentRow =
      input.parentId === null
        ? null
        : this.state.accounts.findById(input.parentId);
    if (input.parentId !== null && parentRow === null) {
      throw new AccountPlacementRejectedError('parent_not_found');
    }
    if (input.parentId === null) {
      const version = this.state.versions.findById(input.structure.versionId);
      if (version === null || version.status !== 'active') {
        throw new CodingStructureVersionNotActiveError(
          version?.status ?? 'missing',
        );
      }
    }
    const plan = planAccountPlacement({
      id: '',
      organizationId: input.organizationId,
      parentId: input.parentId,
      code: input.code,
      parent: parentRow === null ? null : placementParent(parentRow),
      descendantIds: [],
      current: null,
      levels: input.structure.levels,
      maxDepth: input.structure.maxDepth,
    });
    if (plan.problem !== null) {
      throw new AccountPlacementRejectedError(plan.problem);
    }
    const created: AccountRecord = {
      id: input.id,
      organizationId: input.organizationId,
      code: input.code,
      title: input.title,
      parentId: input.parentId,
      level: plan.level,
      codingStructureVersionId: input.structure.versionId,
      accountNature: input.accountNature,
      isPostable: input.isPostable,
      isActive: true,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
    this.state.accounts.insert(created);
    return toAccount(created) as Account;
  }

  async updateChecked(input: {
    id: string;
    title?: string | undefined;
    accountNature?: string | undefined;
    isPostable?: boolean | undefined;
    parentId?: string | null | undefined;
    structure: AccountStructureSnapshot | null;
    now: Date;
    actorId: string | null;
  }): Promise<Account> {
    const node = this.state.accounts.findById(input.id);
    if (node === null) {
      throw new Error(`Account "${input.id}" no longer exists.`);
    }
    const requestedParentId =
      input.parentId === undefined ? node.parentId : input.parentId;
    const parentChanged = requestedParentId !== node.parentId;
    let parentRow: AccountRecord | null = null;
    if (parentChanged && requestedParentId !== null) {
      parentRow = this.state.accounts.findById(requestedParentId);
      if (parentRow === null) {
        throw new AccountPlacementRejectedError('parent_not_found');
      }
    }

    const refused = planAccountEdit({
      referencedByDocumentLine: isReferencedByDocumentLine(node),
      changes: {
        parentId: parentChanged,
        level: parentChanged,
        accountNature:
          input.accountNature !== undefined &&
          input.accountNature !== node.accountNature,
        isPostable:
          input.isPostable !== undefined &&
          input.isPostable !== node.isPostable,
      },
    }).refused;
    if (refused.length > 0) {
      throw new AccountImmutableAfterUseError(refused);
    }

    const children = this.state.accounts.findMany(
      (row) => row.parentId === node.id,
    );
    if (input.isPostable !== undefined) {
      const problem = planPostabilityChange({
        isPostable: input.isPostable,
        hasChildren: children.length > 0,
      });
      if (problem !== null) {
        throw new AccountPostabilityRejectedError(children[0]?.id ?? '');
      }
    }

    let level = node.level;
    if (parentChanged) {
      const edges = this.state.accounts
        .findMany((row) => row.organizationId === node.organizationId)
        .map((row) => ({ id: row.id, parentId: row.parentId }));
      const plan = planAccountPlacement({
        id: node.id,
        organizationId: node.organizationId,
        parentId: requestedParentId,
        code: node.code,
        parent: parentRow === null ? null : placementParent(parentRow),
        descendantIds: collectDescendantIds(edges, node.id),
        current: {
          level: node.level,
          codingStructureVersionId: node.codingStructureVersionId,
          hasChildren: children.length > 0,
        },
        levels: input.structure?.levels ?? [],
        maxDepth: input.structure?.maxDepth ?? 0,
      });
      if (plan.problem !== null) {
        throw new AccountPlacementRejectedError(plan.problem);
      }
      level = plan.level;
    }

    this.state.accounts.patch(node.id, {
      title: input.title,
      accountNature: input.accountNature,
      isPostable: input.isPostable,
      parentId: parentChanged ? requestedParentId : undefined,
      level: parentChanged ? level : undefined,
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    const updated = this.state.accounts.findById(node.id);
    if (updated === null) {
      throw new Error(`Account "${node.id}" no longer exists.`);
    }
    return toAccount(updated) as Account;
  }

  async update(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Account | null> {
    if (this.state.accounts.findById(id) === null) return null;
    const patched = this.state.accounts.patch(id, patch);
    return toAccount(patched) as Account;
  }
}

// ---- helpers ----

function levelRecord(
  level: LevelWrite,
  versionId: string,
  organizationId: string,
  now: Date,
  actorId: string | null,
): CodingStructureLevelRecord {
  return {
    id: level.id,
    versionId,
    organizationId,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
  };
}

function placementParent(row: AccountRecord) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    level: row.level,
    isPostable: row.isPostable,
    isActive: row.isActive,
    codingStructureVersionId: row.codingStructureVersionId,
  };
}

function toAccount(row: AccountRecord | null | undefined): Account | null {
  if (row === null || row === undefined) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    parentId: row.parentId,
    level: row.level,
    codingStructureVersionId: row.codingStructureVersionId,
    accountNature: row.accountNature as Account['accountNature'],
    isPostable: row.isPostable,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Bundle exported through `createAccountingStores` (see that file). */
export interface StructureStores {
  structures: CodingStructuresRepository;
  accounts: AccountsRepository;
  raw: {
    structures: InMemoryCodingStructuresRepository;
    accounts: InMemoryAccountsRepository;
    state: StructureState;
  };
}

export function createStructureStores(): StructureStores {
  const state = createStructureState();
  const structures = new InMemoryCodingStructuresRepository(state);
  const accounts = new InMemoryAccountsRepository(state);
  return {
    structures: structures as unknown as CodingStructuresRepository,
    accounts: accounts as unknown as AccountsRepository,
    raw: { structures, accounts, state },
  };
}
