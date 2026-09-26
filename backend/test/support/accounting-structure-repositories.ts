/**
 * In-memory stand-ins for the Task 10.3 repositories (coding structure +
 * chart of accounts) and Task 11 (accounting configuration).
 * Final per D1-D7: both accounting_configuration_id and coding_structure_version_id NOT NULL.
 */

import type {
  CodingStructureLevel,
  CodingStructureVersion,
} from '../../src/modules/accounting/domain/coding-structure.js';
import {
  isAccountLevelKind,
  planCodingStructure,
} from '../../src/modules/accounting/domain/coding-structure.js';
import type {
  AccountingConfiguration,
  AccountingConfigurationLevel,
} from '../../src/modules/accounting/domain/accounting-configuration.js';
import { planAccountingConfiguration } from '../../src/modules/accounting/domain/accounting-configuration.js';
import type { Account } from '../../src/modules/accounting/domain/account.js';
import {
  planAccountEdit,
  planAccountMovePin,
  planAccountPlacement,
  planPinCoherence,
  planPostabilityChange,
  planRootAccountPin,
} from '../../src/modules/accounting/domain/account.js';
import { collectDescendantIds } from '../../src/modules/accounting/domain/hierarchy.js';
import {
  AccountImmutableAfterUseError,
  AccountPinsIncoherentError,
  AccountPlacementRejectedError,
  AccountPostabilityRejectedError,
  AccountingConfigurationNotActiveError,
  AccountingConfigurationNotDraftError,
  AccountingConfigurationPlanRejectedError,
  CodingStructureNotDraftError,
  CodingStructurePlanRejectedError,
  CodingStructureVersionNotActiveError,
} from '../../src/modules/accounting/data/accounting-structure-errors.js';
import type { AccountStructureSnapshot } from '../../src/modules/accounting/data/accounts.repository.js';
import type { LevelWrite } from '../../src/modules/accounting/data/coding-structures.repository.js';
import type { CodingStructuresRepository } from '../../src/modules/accounting/data/coding-structures.repository.js';
import type { AccountsRepository } from '../../src/modules/accounting/data/accounts.repository.js';
import type {
  AccountingConfigurationsRepository,
  ConfigurationLevelWrite,
} from '../../src/modules/accounting/data/accounting-configurations.repository.js';
import { InMemoryTable, type Row } from './master-data-repositories.js';

type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

interface ListParams {
  where: Record<string, unknown>;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

export interface CodingStructureVersionRecord extends Row {
  id: string;
  organizationId: string;
  code: string;
  name?: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  separator: string;
  effectiveFrom?: Date | null;
  operationallyUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

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
  codingStructureVersionId: string | null;
  accountingConfigurationId: string | null;
  accountNature: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface AccountingConfigurationRecord extends Row {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
  operationallyUsedAt: Date | null;
  codingStructureVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface AccountingConfigurationLevelRecord extends Row {
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
  updatedBy: string | null;
}

export interface StructureState {
  versions: InMemoryTable<CodingStructureVersionRecord>;
  levels: InMemoryTable<CodingStructureLevelRecord>;
  accountingConfigurations: InMemoryTable<AccountingConfigurationRecord>;
  accountingConfigurationLevels: InMemoryTable<AccountingConfigurationLevelRecord>;
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
    accountingConfigurations: new InMemoryTable<AccountingConfigurationRecord>([
      ['organizationId', 'code', 'versionNumber'],
    ]),
    accountingConfigurationLevels:
      new InMemoryTable<AccountingConfigurationLevelRecord>([
        ['configurationId', 'levelIndex'],
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
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

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
        const name = record['name'];
        const title = record['title'];
        const hit =
          (typeof code === 'string' && code.toLowerCase().includes(search)) ||
          (typeof name === 'string' && name.toLowerCase().includes(search)) ||
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
// Accounting configurations (Task 11)
// ---------------------------------------------------------------------------

export class InMemoryAccountingConfigurationsRepository {
  constructor(private readonly state: StructureState) {}

  private levelsOf(configurationId: string): AccountingConfigurationLevel[] {
    return this.state.accountingConfigurationLevels
      .findMany((level) => level.configurationId === configurationId)
      .sort((a, b) => a.levelIndex - b.levelIndex)
      .map((level) => ({
        id: level.id,
        configurationId: level.configurationId,
        levelIndex: level.levelIndex,
        title: level.title,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
        levelKind: level.levelKind,
      })) as AccountingConfigurationLevel[];
  }

  private withLevels(
    row: AccountingConfigurationRecord,
  ): AccountingConfiguration & { levels: AccountingConfigurationLevel[] } {
    const levels = this.levelsOf(row.id);
    return {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      name: row.name,
      versionNumber: row.versionNumber,
      status: row.status as AccountingConfiguration['status'],
      effectiveFrom: row.effectiveFrom,
      operationallyUsedAt: row.operationallyUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      levels,
    } as any;
  }

  async findById(
    id: string,
  ): Promise<
    | (AccountingConfiguration & { levels: AccountingConfigurationLevel[] })
    | null
  > {
    const row = this.state.accountingConfigurations.findById(id);
    return row === null ? null : this.withLevels(row);
  }

  async findActiveForOrganization(
    organizationId: string,
  ): Promise<
    | (AccountingConfiguration & { levels: AccountingConfigurationLevel[] })
    | null
  > {
    const row = this.state.accountingConfigurations.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.status === 'ACTIVE',
    );
    return row === null ? null : this.withLevels(row);
  }

  async findLatestForCode(
    organizationId: string,
    code: string,
  ): Promise<{ versionNumber: number } | null> {
    const rows = this.state.accountingConfigurations.findMany(
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
    items: (AccountingConfiguration & {
      levels: AccountingConfigurationLevel[];
    })[];
    total: number;
  }> {
    const { items, total } = listPage(
      this.state.accountingConfigurations,
      params,
    );
    return { items: items.map((row) => this.withLevels(row)), total };
  }

  async createDraftWithLevels(input: {
    id: string;
    organizationId: string;
    code: string;
    name: string;
    versionNumber: number;
    effectiveFrom: Date | null;
    codingStructureVersionId?: string | null;
    levels: readonly ConfigurationLevelWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<
    AccountingConfiguration & { levels: AccountingConfigurationLevel[] }
  > {
    const now = input.createdAt;
    const row: AccountingConfigurationRecord = {
      id: input.id,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      versionNumber: input.versionNumber,
      status: 'DRAFT',
      effectiveFrom: input.effectiveFrom,
      operationallyUsedAt: null,
      codingStructureVersionId: input.codingStructureVersionId ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
    this.state.accountingConfigurations.insert(row);
    for (const level of input.levels) {
      this.state.accountingConfigurationLevels.insert(
        configurationLevelRecord(
          level,
          input.id,
          input.organizationId,
          now,
          input.actorId,
        ),
      );
    }
    return this.withLevels(row);
  }

  async updateDraftChecked(input: {
    id: string;
    name?: string | undefined;
    effectiveFrom?: Date | null | undefined;
    levels?: readonly ConfigurationLevelWrite[] | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<
    AccountingConfiguration & { levels: AccountingConfigurationLevel[] }
  > {
    const stored = this.state.accountingConfigurations.findById(input.id);
    if (stored === null) {
      throw new Error(
        `Accounting configuration "${input.id}" no longer exists.`,
      );
    }
    if (stored.status !== 'DRAFT') {
      throw new AccountingConfigurationNotDraftError(stored.status);
    }
    if (stored.operationallyUsedAt !== null) {
      throw new AccountingConfigurationNotDraftError('operationally_used');
    }
    const candidateName = input.name ?? stored.name;
    const candidateEffectiveFrom =
      input.effectiveFrom !== undefined
        ? input.effectiveFrom
        : stored.effectiveFrom;

    const existing = this.levelsOf(input.id);
    const candidates: readonly ConfigurationLevelWrite[] =
      input.levels ??
      existing.map((level) => ({
        id: level.id,
        levelIndex: level.levelIndex,
        title: level.title,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
        levelKind: level.levelKind,
      }));

    const plan = planAccountingConfiguration({
      code: stored.code,
      name: candidateName,
      effectiveFrom: candidateEffectiveFrom,
      maxDepth: candidates.length,
      levels: candidates,
    });
    if (plan.problem !== null) {
      throw new AccountingConfigurationPlanRejectedError(
        plan.problem,
        plan.subject,
      );
    }

    this.state.accountingConfigurations.patch(input.id, {
      name: candidateName,
      effectiveFrom: candidateEffectiveFrom,
      updatedAt: input.updatedAt,
      updatedBy: input.actorId,
    });

    if (input.levels !== undefined) {
      for (const level of existing)
        this.state.accountingConfigurationLevels.delete(level.id);
      for (const level of input.levels) {
        this.state.accountingConfigurationLevels.insert(
          configurationLevelRecord(
            level,
            input.id,
            stored.organizationId,
            input.updatedAt,
            input.actorId,
          ),
        );
      }
    }
    const updated = this.state.accountingConfigurations.findById(input.id);
    if (updated === null) {
      throw new Error(
        `Accounting configuration "${input.id}" no longer exists.`,
      );
    }
    return this.withLevels(updated);
  }

  async publishChecked(input: {
    configurationId: string;
    organizationId: string;
    now: Date;
    actorId: string | null;
  }): Promise<{
    configuration: AccountingConfiguration & {
      levels: AccountingConfigurationLevel[];
    };
    supersededId: string | null;
  } | null> {
    const target = this.state.accountingConfigurations.findById(
      input.configurationId,
    );
    if (target === null || target.organizationId !== input.organizationId) {
      return null;
    }
    if (target.status !== 'DRAFT') {
      throw new AccountingConfigurationNotDraftError(target.status);
    }
    if (target.operationallyUsedAt !== null) {
      throw new AccountingConfigurationNotDraftError('operationally_used');
    }
    const levels = this.levelsOf(input.configurationId);
    const plan = planAccountingConfiguration({
      code: target.code,
      name: target.name,
      effectiveFrom: target.effectiveFrom,
      maxDepth: levels.length,
      levels,
    });
    if (plan.problem !== null) {
      throw new AccountingConfigurationPlanRejectedError(
        plan.problem,
        plan.subject,
      );
    }
    let supersededId: string | null = null;
    for (const row of this.state.accountingConfigurations.findMany(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.status === 'ACTIVE' &&
        candidate.id !== input.configurationId,
    )) {
      supersededId = row.id;
      this.state.accountingConfigurations.patch(row.id, {
        status: 'SUPERSEDED',
        updatedAt: input.now,
        updatedBy: input.actorId,
      });
    }
    this.state.accountingConfigurations.patch(input.configurationId, {
      status: 'ACTIVE',
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    const activeConfigs = this.state.accountingConfigurations.findMany(
      (c) => c.organizationId === input.organizationId && c.status === 'ACTIVE',
    );
    if (activeConfigs.length > 1) {
      throw new Error(
        `Partial unique index violation: uq_accounting_configurations_org_active — organization ${input.organizationId} has ${activeConfigs.length} ACTIVE configs`,
      );
    }
    const published = this.state.accountingConfigurations.findById(
      input.configurationId,
    );
    if (published === null) {
      throw new Error(
        `Accounting configuration "${input.configurationId}" no longer exists.`,
      );
    }
    return { configuration: this.withLevels(published), supersededId };
  }

  /**
   * Mirrors the real repository's Task 13 shape: organization-scoped and
   * first-use-wins (the guarded `WHERE operationally_used_at IS NULL`), so a
   * second call never moves the original timestamp.
   */
  async markOperationallyUsed(input: {
    id: string;
    organizationId: string;
    now: Date;
    actorId?: string | null;
  }): Promise<
    | (AccountingConfiguration & { levels: AccountingConfigurationLevel[] })
    | null
  > {
    const existing = this.state.accountingConfigurations.findById(input.id);
    if (existing === null || existing.organizationId !== input.organizationId) {
      return null;
    }
    if (existing.operationallyUsedAt !== null) {
      return this.withLevels(existing);
    }
    this.state.accountingConfigurations.patch(input.id, {
      operationallyUsedAt: input.now,
      updatedAt: input.now,
      updatedBy: input.actorId ?? null,
    });
    const updated = this.state.accountingConfigurations.findById(input.id);
    return updated === null ? null : this.withLevels(updated);
  }

  async deleteDraft(input: { id: string }): Promise<boolean> {
    const existing = this.state.accountingConfigurations.findById(input.id);
    if (existing === null) return false;
    if (existing.status !== 'DRAFT') {
      throw new AccountingConfigurationNotDraftError(existing.status);
    }
    if (existing.operationallyUsedAt !== null) {
      throw new AccountingConfigurationNotDraftError('operationally_used');
    }
    for (const level of this.levelsOf(input.id)) {
      this.state.accountingConfigurationLevels.delete(level.id);
    }
    this.state.accountingConfigurations.delete(input.id);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountLineUsage {
  countForAccount(accountId: string): number;
}

const NO_LINE_USAGE: AccountLineUsage = {
  countForAccount: () => 0,
};

export class InMemoryAccountsRepository {
  constructor(
    private readonly state: StructureState,
    private readonly lineUsage: AccountLineUsage = NO_LINE_USAGE,
  ) {}

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

    // Task 11 Final D1/D2/D3 — both NOT NULL
    const configId = input.structure.accountingConfigurationId;
    if (!configId) {
      throw new Error(
        `FK violation: accounting_configuration_id is required (D1) — got ${String(configId)}`,
      );
    }
    const configRow = this.state.accountingConfigurations.findById(configId);
    if (configRow === null) {
      throw new Error(
        `FK violation: accounting_configuration_id "${configId}" does not exist`,
      );
    }
    const versionId = input.structure.versionId;
    if (!versionId) {
      throw new Error(
        `FK violation: coding_structure_version_id is required (D2) — got ${String(versionId)}`,
      );
    }
    const maybeConfig = this.state.accountingConfigurations.findById(versionId);
    if (maybeConfig !== null) {
      throw new Error(
        `FK mismatch: coding_structure_version_id "${versionId}" is actually an AccountingConfiguration.id`,
      );
    }
    const codingRow = this.state.versions.findById(versionId);
    if (codingRow === null) {
      throw new Error(
        `FK violation: coding_structure_version_id "${versionId}" does not exist`,
      );
    }
    if (configRow.id === versionId) {
      throw new Error(`FK mismatch: ids identical "${configRow.id}"`);
    }

    if (input.parentId === null) {
      // The SAME write-boundary decision the real repository applies under its
      // locks (`planRootAccountPin`): a root is pinned only to an ACTIVE
      // accounting configuration AND an `active` coding-structure version.
      const pinProblem = planRootAccountPin({
        organizationId: input.organizationId,
        snapshot: {
          accountingConfigurationId: configId,
          versionId,
        },
        configuration: configRow,
        version: codingRow,
      });
      if (pinProblem === 'configuration_missing') {
        throw new AccountingConfigurationNotActiveError('missing');
      }
      if (pinProblem === 'configuration_not_active') {
        throw new AccountingConfigurationNotActiveError(configRow.status);
      }
      if (pinProblem === 'coding_version_missing') {
        throw new CodingStructureVersionNotActiveError('missing');
      }
      if (pinProblem === 'coding_version_not_active') {
        throw new CodingStructureVersionNotActiveError(codingRow.status);
      }
    } else {
      if (
        parentRow !== null &&
        parentRow.accountingConfigurationId !== configId
      ) {
        throw new AccountPlacementRejectedError('version_mismatch');
      }
      if (
        parentRow !== null &&
        parentRow.codingStructureVersionId !== versionId
      ) {
        throw new AccountPlacementRejectedError('version_mismatch');
      }
    }
    // ODR-1 (Task 19): same write-boundary decision as the real repository's
    // locked transaction — the pinned pair must describe one code shape.
    const coherenceProblem = planPinCoherence({
      codingLevels: input.structure.codingLevels,
      configurationLevels: input.structure.levels.map((level) => ({
        levelIndex: level.levelIndex,
        digitLength: level.digitLength,
      })),
    });
    if (coherenceProblem !== null) {
      throw new AccountPinsIncoherentError(coherenceProblem);
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
      accountingConfigurationId: input.structure.accountingConfigurationId,
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
      referencedByDocumentLine: this.lineUsage.countForAccount(node.id) > 0,
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
      if (input.structure === null) {
        throw new Error(
          'Account move requires the pinned configuration snapshot.',
        );
      }
      // The SAME write-boundary decision the real repository applies under its
      // locks (`planAccountMovePin`): a move is validated only against the
      // configuration/version the account is ALREADY pinned to.
      const pinProblem = planAccountMovePin({
        pinned: {
          accountingConfigurationId: node.accountingConfigurationId,
          codingStructureVersionId: node.codingStructureVersionId,
        },
        snapshot: input.structure,
      });
      if (pinProblem !== null) {
        throw new AccountPlacementRejectedError('version_mismatch');
      }
      // ODR-1 (Task 19): same write-boundary decision as the real repository's
      // locked transaction — a move re-validates the pinned pair, so that pair
      // must describe one code shape.
      const coherenceProblem = planPinCoherence({
        codingLevels: input.structure.codingLevels,
        configurationLevels: input.structure.levels.map((level) => ({
          levelIndex: level.levelIndex,
          digitLength: level.digitLength,
        })),
      });
      if (coherenceProblem !== null) {
        throw new AccountPinsIncoherentError(coherenceProblem);
      }
      const edges = this.state.accounts
        .findMany((row) => row.organizationId === node.organizationId)
        .map((row) => ({ id: row.id, parentId: row.parentId }));
      const plan = planAccountPlacement({
        id: node.id,
        organizationId: node.organizationId,
        parentId: requestedParentId,
        code: node.code,
        parent: parentRow === null ? null : (placementParent(parentRow) as any),
        descendantIds: collectDescendantIds(edges, node.id),
        current: {
          level: node.level,
          codingStructureVersionId: node.codingStructureVersionId,
          accountingConfigurationId: node.accountingConfigurationId,
          hasChildren: children.length > 0,
        } as any,
        levels: input.structure.levels,
        maxDepth: input.structure.maxDepth,
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

function configurationLevelRecord(
  level: ConfigurationLevelWrite,
  configurationId: string,
  organizationId: string,
  now: Date,
  actorId: string | null,
): AccountingConfigurationLevelRecord {
  return {
    id: level.id,
    configurationId,
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
    accountingConfigurationId: row.accountingConfigurationId,
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
    accountingConfigurationId: row.accountingConfigurationId,
    accountNature: row.accountNature as Account['accountNature'],
    isPostable: row.isPostable,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface StructureStores {
  structures: CodingStructuresRepository;
  configurations: AccountingConfigurationsRepository;
  accounts: AccountsRepository;
  raw: {
    structures: InMemoryCodingStructuresRepository;
    configurations: InMemoryAccountingConfigurationsRepository;
    accounts: InMemoryAccountsRepository;
    state: StructureState;
  };
}

export function createStructureStores(
  options: { lineUsage?: AccountLineUsage } = {},
): StructureStores {
  const state = createStructureState();
  const structures = new InMemoryCodingStructuresRepository(state);
  const configurations = new InMemoryAccountingConfigurationsRepository(state);
  const accounts = new InMemoryAccountsRepository(
    state,
    options.lineUsage ?? NO_LINE_USAGE,
  );
  return {
    structures: structures as unknown as CodingStructuresRepository,
    configurations:
      configurations as unknown as AccountingConfigurationsRepository,
    accounts: accounts as unknown as AccountsRepository,
    raw: { structures, configurations, accounts, state },
  };
}
