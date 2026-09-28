import { PRISMA_UNIQUE_VIOLATION } from '../../src/kernel/prisma/prisma-errors.js';
import type { AccountNature } from '../../src/modules/accounting/domain/account.js';
import {
  planPinCoherence,
  planRootAccountPin,
} from '../../src/modules/accounting/domain/account.js';
import type {
  BaseChartAdoptionView,
  BaseChartTemplate,
  BaseChartTemplateVersion,
  BaseChartVersionStatus,
} from '../../src/modules/accounting/domain/base-chart-template.js';
import { planBaseChartVersionContent } from '../../src/modules/accounting/domain/base-chart-template.js';
import {
  planAdoptionSelection,
  planTemplateCompatibility,
} from '../../src/modules/accounting/domain/base-chart-adoption.js';
import {
  AccountingConfigurationNotActiveError,
  AccountPinsIncoherentError,
  CodingStructureVersionNotActiveError,
} from '../../src/modules/accounting/data/accounting-structure-errors.js';
import {
  BaseChartAlreadyAdoptedError,
  BaseChartContentRejectedError,
  BaseChartIncompatibleError,
  BaseChartSelectionRejectedError,
  BaseChartVersionStatusError,
  OrganizationChartNotEmptyError,
} from '../../src/modules/accounting/data/base-chart-errors.js';
import type { StructureState } from './accounting-structure-repositories.js';

/**
 * In-memory Base Chart stores (Task 23) — spec and e2e support.
 *
 * These fakes are CONTRACT-FAITHFUL to the real guarded repositories: the
 * same domain planners run inside every "guarded" write (the real ones run
 * them under `FOR UPDATE` row locks inside a Prisma transaction; here the
 * state is single-threaded), and the same typed errors from
 * `data/base-chart-errors.ts` are thrown, so services that map them behave
 * identically against fake and real stores. What cannot exist here is the
 * lock race itself — the e2e suite exercises these paths end-to-end, and the
 * live-DB suite exercises the SQL locks.
 */

export interface TemplateRecord {
  id: string;
  code: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionRecord {
  id: string;
  templateId: string;
  versionNumber: number;
  status: BaseChartVersionStatus;
  maxDepth: number;
  approvedAt: Date | null;
  publishedAt: Date | null;
  supersededAt: Date | null;
  supersededByVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface LevelRecord {
  id: string;
  versionId: string;
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
}

export interface NodeRecord {
  id: string;
  versionId: string;
  nodeKey: string;
  parentNodeKey: string | null;
  parentId: string | null;
  code: string;
  title: string;
  accountNature: string;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  level: number;
}

export interface AdoptionRecord {
  id: string;
  organizationId: string;
  templateVersionId: string;
  accountingConfigurationId: string;
  codingStructureVersionId: string;
  accountCount: number;
  createdAt: Date;
  createdBy: string | null;
}

export interface BaseChartState {
  templates: TemplateRecord[];
  versions: VersionRecord[];
  levels: LevelRecord[];
  nodes: NodeRecord[];
  adoptions: AdoptionRecord[];
}

export function createBaseChartState(): BaseChartState {
  return { templates: [], versions: [], levels: [], nodes: [], adoptions: [] };
}

function toTemplate(record: TemplateRecord): BaseChartTemplate {
  return { ...record };
}

function toVersion(
  state: BaseChartState,
  record: VersionRecord,
): BaseChartTemplateVersion {
  return {
    id: record.id,
    templateId: record.templateId,
    versionNumber: record.versionNumber,
    status: record.status,
    maxDepth: record.maxDepth,
    approvedAt: record.approvedAt,
    publishedAt: record.publishedAt,
    supersededAt: record.supersededAt,
    supersededByVersionId: record.supersededByVersionId,
    levels: state.levels
      .filter((row) => row.versionId === record.id)
      .sort((a, b) => a.levelIndex - b.levelIndex)
      .map((row) => ({ ...row })),
    nodes: state.nodes
      .filter((row) => row.versionId === record.id)
      .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))
      .map((row) => ({ ...row })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function versionInput(state: BaseChartState, versionId: string) {
  const version = state.versions.find((row) => row.id === versionId)!;
  return {
    maxDepth: version.maxDepth,
    levels: state.levels
      .filter((row) => row.versionId === versionId)
      .sort((a, b) => a.levelIndex - b.levelIndex),
    nodes: state.nodes.filter((row) => row.versionId === versionId),
    domainNodes: toVersion(state, version).nodes,
  };
}

export class InMemoryBaseChartTemplatesRepository {
  constructor(private readonly state: BaseChartState) {}

  async findTemplateById(id: string): Promise<BaseChartTemplate | null> {
    const row = this.state.templates.find((r) => r.id === id);
    return row === undefined ? null : toTemplate(row);
  }

  async findTemplateByCode(code: string): Promise<BaseChartTemplate | null> {
    const row = this.state.templates.find((r) => r.code === code);
    return row === undefined ? null : toTemplate(row);
  }

  async listTemplates(
    filter: { code?: string | undefined; search?: string | undefined },
    page: { skip: number; take: number },
  ): Promise<{ rows: BaseChartTemplate[]; total: number }> {
    let rows = [...this.state.templates].sort((a, b) =>
      a.code === b.code
        ? a.id.localeCompare(b.id)
        : a.code.localeCompare(b.code),
    );
    if (filter.code !== undefined)
      rows = rows.filter((r) => r.code === filter.code);
    if (filter.search !== undefined && filter.search !== '') {
      const q = filter.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.code.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
      );
    }
    return {
      rows: rows.slice(page.skip, page.skip + page.take).map(toTemplate),
      total: rows.length,
    };
  }

  async findVersionById(id: string): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  } | null> {
    const row = this.state.versions.find((r) => r.id === id);
    if (row === undefined) return null;
    const template = this.state.templates.find((r) => r.id === row.templateId);
    if (template === undefined) {
      throw new Error(`orphan version ${row.id}: store corrupted`);
    }
    return {
      template: toTemplate(template),
      version: toVersion(this.state, row),
    };
  }

  async listVersions(
    filter: { templateId: string; status?: string | undefined },
    take: number,
    skip = 0,
  ): Promise<{ rows: BaseChartTemplateVersion[]; total: number }> {
    let rows = this.state.versions.filter(
      (r) => r.templateId === filter.templateId,
    );
    if (filter.status !== undefined)
      rows = rows.filter((r) => r.status === filter.status);
    rows = rows.sort(
      (a, b) => b.versionNumber - a.versionNumber || a.id.localeCompare(b.id),
    );
    return {
      rows: rows
        .slice(skip, skip + take)
        .map((row) => toVersion(this.state, row)),
      total: rows.length,
    };
  }

  async createTemplateWithVersionContent(input: {
    templateId: string;
    versionId: string;
    code: string;
    title: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly Omit<LevelRecord, 'versionId'>[];
    nodes: readonly Omit<NodeRecord, 'versionId'>[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  }> {
    if (this.state.templates.some((row) => row.code === input.code)) {
      throw Object.assign(new Error('duplicate template code'), {
        code: PRISMA_UNIQUE_VIOLATION,
      });
    }
    const template: TemplateRecord = {
      id: input.templateId,
      code: input.code,
      title: input.title,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.state.templates.push(template);
    this.insertDraft(input);
    return {
      template: toTemplate(template),
      version: toVersion(
        this.state,
        this.state.versions.find((row) => row.id === input.versionId)!,
      ),
    };
  }

  async createDraftVersionWithContent(input: {
    templateId: string;
    versionId: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly Omit<LevelRecord, 'versionId'>[];
    nodes: readonly Omit<NodeRecord, 'versionId'>[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplateVersion | null> {
    if (!this.state.templates.some((row) => row.id === input.templateId)) {
      return null;
    }
    if (
      this.state.versions.some(
        (row) =>
          row.templateId === input.templateId &&
          row.versionNumber === input.versionNumber,
      )
    ) {
      throw Object.assign(new Error('duplicate ordinal'), {
        code: PRISMA_UNIQUE_VIOLATION,
      });
    }
    this.insertDraft(input);
    return toVersion(
      this.state,
      this.state.versions.find((row) => row.id === input.versionId)!,
    );
  }

  async renameTemplate(input: {
    templateId: string;
    title: string;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplate | null> {
    const row = this.state.templates.find((r) => r.id === input.templateId);
    if (row === undefined) return null;
    row.title = input.title;
    row.updatedAt = input.updatedAt;
    return toTemplate(row);
  }

  async updateDraftContentChecked(input: {
    versionId: string;
    maxDepth?: number | undefined;
    levels?: readonly Omit<LevelRecord, 'versionId'>[] | undefined;
    nodes?: readonly Omit<NodeRecord, 'versionId'>[] | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplateVersion | null> {
    const version = this.state.versions.find(
      (row) => row.id === input.versionId,
    );
    if (version === undefined) return null;
    if (version.status !== 'draft') {
      throw new BaseChartVersionStatusError(version.status, 'edit');
    }
    const maxDepth = input.maxDepth ?? version.maxDepth;
    const candidate = {
      maxDepth,
      levels: (
        input.levels ??
        this.state.levels.filter((l) => l.versionId === version.id)
      ).map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
        defaultIsPostable: row.defaultIsPostable,
      })),
      nodes: (
        input.nodes ??
        this.state.nodes.filter((n) => n.versionId === version.id)
      ).map((row) => ({
        nodeKey: row.nodeKey,
        parentNodeKey: row.parentNodeKey,
        code: row.code,
        title: row.title,
        accountNature: row.accountNature,
        isPostable: row.isPostable,
        isMandatory: row.isMandatory,
        defaultIsActive: row.defaultIsActive,
      })),
    };
    const result = planBaseChartVersionContent(candidate);
    if (result.plan.problem !== null) {
      throw new BaseChartContentRejectedError(
        result.plan.problem,
        result.plan.subject,
      );
    }
    version.maxDepth = maxDepth;
    if (input.levels !== undefined) {
      this.state.levels = this.state.levels.filter(
        (l) => l.versionId !== version.id,
      );
      for (const level of input.levels) {
        this.state.levels.push({ ...level, versionId: version.id });
      }
    }
    if (input.nodes !== undefined) {
      this.state.nodes = this.state.nodes.filter(
        (n) => n.versionId !== version.id,
      );
      for (const node of input.nodes) {
        this.state.nodes.push({ ...node, versionId: version.id });
      }
    }
    version.updatedAt = input.updatedAt;
    return toVersion(this.state, version);
  }

  async transitionChecked(input: {
    versionId: string;
    transition: 'approve' | 'publish' | 'supersede';
    supersededByVersionId?: string | null | undefined;
    now: Date;
    actorId: string | null;
  }): Promise<{
    templateId: string;
    version: BaseChartTemplateVersion;
    supersededVersionIds: string[];
  } | null> {
    const version = this.state.versions.find(
      (row) => row.id === input.versionId,
    );
    if (version === undefined) return null;
    const legalFrom: Record<string, BaseChartVersionStatus> = {
      approve: 'draft',
      publish: 'approved',
      supersede: 'published',
    };
    const target: Record<string, BaseChartVersionStatus> = {
      approve: 'approved',
      publish: 'published',
      supersede: 'superseded',
    };
    if (version.status !== legalFrom[input.transition]) {
      throw new BaseChartVersionStatusError(version.status, input.transition);
    }
    const supersededVersionIds: string[] = [];
    if (input.transition === 'publish') {
      // Re-validation under the template-wide lock.
      const content = versionInput(this.state, version.id);
      const result = planBaseChartVersionContent({
        maxDepth: content.maxDepth,
        levels: content.levels,
        nodes: content.nodes,
      });
      if (result.plan.problem !== null) {
        throw new BaseChartContentRejectedError(
          result.plan.problem,
          result.plan.subject,
        );
      }
      for (const other of this.state.versions) {
        if (
          other.templateId === version.templateId &&
          other.id !== version.id &&
          other.status === 'published'
        ) {
          other.status = 'superseded';
          other.supersededAt = input.now;
          other.supersededByVersionId = version.id;
          supersededVersionIds.push(other.id);
        }
      }
    }
    version.status = target[input.transition]!;
    if (input.transition === 'approve') version.approvedAt = input.now;
    if (input.transition === 'publish') version.publishedAt = input.now;
    if (input.transition === 'supersede') {
      version.supersededAt = input.now;
      version.supersededByVersionId = input.supersededByVersionId ?? null;
    }
    version.updatedAt = input.now;
    return {
      templateId: version.templateId,
      version: toVersion(this.state, version),
      supersededVersionIds,
    };
  }

  private insertDraft(input: {
    versionId: string;
    templateId: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly Omit<LevelRecord, 'versionId'>[];
    nodes: readonly Omit<NodeRecord, 'versionId'>[];
    createdAt: Date;
    actorId: string | null;
  }): void {
    this.state.versions.push({
      id: input.versionId,
      templateId: input.templateId,
      versionNumber: input.versionNumber,
      status: 'draft',
      maxDepth: input.maxDepth,
      approvedAt: null,
      publishedAt: null,
      supersededAt: null,
      supersededByVersionId: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdBy: input.actorId,
      updatedBy: null,
    });
    for (const level of input.levels) {
      this.state.levels.push({ ...level, versionId: input.versionId });
    }
    for (const node of input.nodes) {
      this.state.nodes.push({ ...node, versionId: input.versionId });
    }
  }
}

export class InMemoryBaseChartAdoptionsRepository {
  constructor(
    private readonly state: BaseChartState,
    private readonly structure: StructureState,
  ) {}

  async findById(
    organizationId: string,
    adoptionId: string,
  ): Promise<BaseChartAdoptionView | null> {
    const row = this.state.adoptions.find((r) => r.id === adoptionId);
    if (row === undefined || row.organizationId !== organizationId) return null;
    return this.hydrateView(row);
  }

  async listByOrganization(
    organizationId: string,
    page: { skip: number; take: number },
  ): Promise<{ rows: BaseChartAdoptionView[]; total: number }> {
    const rows = this.state.adoptions
      .filter((r) => r.organizationId === organizationId)
      .sort((a, b) =>
        a.createdAt.getTime() === b.createdAt.getTime()
          ? a.id.localeCompare(b.id)
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
    return {
      rows: await Promise.all(
        rows
          .slice(page.skip, page.skip + page.take)
          .map((row) => this.hydrateView(row)),
      ),
      total: rows.length,
    };
  }

  async findByOrganizationAndVersion(
    organizationId: string,
    templateVersionId: string,
  ): Promise<AdoptionRecord | null> {
    return (
      this.state.adoptions.find(
        (r) =>
          r.organizationId === organizationId &&
          r.templateVersionId === templateVersionId,
      ) ?? null
    );
  }

  async countAccounts(organizationId: string): Promise<number> {
    return this.structure.accounts.findMany(
      (row) => row.organizationId === organizationId,
    ).length;
  }

  /** The guarded write, mirrored contract-faithfully (see file header). */
  async adoptChecked(input: {
    adoptionId: string;
    organizationId: string;
    templateVersionId: string;
    selectedNodeKeys: readonly string[] | null;
    accountingConfigurationId: string;
    codingStructureVersionId: string;
    accountIdFor: ReadonlyMap<string, string>;
    now: Date;
    actorId: string | null;
  }): Promise<AdoptionRecord | null> {
    const version = this.state.versions.find(
      (row) => row.id === input.templateVersionId,
    );
    if (version === undefined) return null;
    if (version.status !== 'published') {
      throw new BaseChartVersionStatusError(version.status, 'adopt');
    }
    const content = versionInput(this.state, version.id);

    // Integrity replay.
    const contentResult = planBaseChartVersionContent({
      maxDepth: content.maxDepth,
      levels: content.levels,
      nodes: content.nodes,
    });
    if (contentResult.plan.problem !== null) {
      throw new BaseChartContentRejectedError(
        contentResult.plan.problem,
        contentResult.plan.subject,
      );
    }

    // Pin re-check (planRootAccountPin against the stored rows).
    const pinnedVersion = this.structure.versions.findById(
      input.codingStructureVersionId,
    );
    const pinnedConfiguration =
      this.structure.accountingConfigurations.findById(
        input.accountingConfigurationId,
      );
    const pinProblem = planRootAccountPin({
      organizationId: input.organizationId,
      snapshot: {
        accountingConfigurationId: input.accountingConfigurationId,
        versionId: input.codingStructureVersionId,
      },
      configuration: pinnedConfiguration,
      version: pinnedVersion,
    });
    if (pinProblem === 'configuration_missing') {
      throw new AccountingConfigurationNotActiveError('missing');
    }
    if (pinProblem === 'configuration_not_active') {
      throw new AccountingConfigurationNotActiveError(
        pinnedConfiguration!.status,
      );
    }
    if (pinProblem === 'coding_version_missing') {
      throw new CodingStructureVersionNotActiveError('missing');
    }
    if (pinProblem === 'coding_version_not_active') {
      throw new CodingStructureVersionNotActiveError(pinnedVersion!.status);
    }

    // ODR-1 coherence of the pinned pair.
    const codingLevels = this.structure.levels
      .findMany((row) => row.versionId === input.codingStructureVersionId)
      .map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
      }));
    const configurationLevels = this.structure.accountingConfigurationLevels
      .findMany(
        (row) => row.configurationId === input.accountingConfigurationId,
      )
      .map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
      }));
    const coherenceProblem = planPinCoherence({
      codingLevels,
      configurationLevels,
    });
    if (coherenceProblem !== null) {
      throw new AccountPinsIncoherentError(coherenceProblem);
    }

    // Compatibility + final adoption set.
    const compatibility = planTemplateCompatibility({
      templateMaxDepth: version.maxDepth,
      templateLevels: content.levels,
      nodes: content.domainNodes,
      configurationLevels,
    });
    if (compatibility.problem !== null) {
      throw new BaseChartIncompatibleError(
        compatibility.problem,
        compatibility.subject,
      );
    }
    const selection = planAdoptionSelection({
      nodes: content.domainNodes,
      selectedNodeKeys: input.selectedNodeKeys,
    });
    if (selection.problem !== null) {
      throw new BaseChartSelectionRejectedError(
        selection.problem,
        selection.subject,
      );
    }

    // Non-empty-chart refusal + duplicate check.
    const existing = this.structure.accounts.findMany(
      (row) => row.organizationId === input.organizationId,
    );
    if (existing.length > 0) {
      throw new OrganizationChartNotEmptyError();
    }
    if (
      this.state.adoptions.some(
        (row) =>
          row.organizationId === input.organizationId &&
          row.templateVersionId === input.templateVersionId,
      )
    ) {
      throw new BaseChartAlreadyAdoptedError();
    }

    // The COPY: ordinary account rows, parents first, then ONE adoption row.
    const adoptedAccountIdByKey = new Map<string, string>();
    for (const planned of selection.nodes) {
      const accountId = input.accountIdFor.get(planned.templateNodeId);
      if (accountId === undefined) {
        throw new Error(`unmapped account id for "${planned.nodeKey}" (bug)`);
      }
      const parentId =
        planned.parentNodeKey === null
          ? null
          : (adoptedAccountIdByKey.get(planned.parentNodeKey) ?? null);
      if (planned.parentNodeKey !== null && parentId === null) {
        throw new Error('adoption ordering bug');
      }
      this.structure.accounts.insert({
        id: accountId,
        organizationId: input.organizationId,
        code: planned.code,
        title: planned.title,
        parentId,
        level: planned.level,
        codingStructureVersionId: input.codingStructureVersionId,
        accountingConfigurationId: input.accountingConfigurationId,
        accountNature: planned.accountNature,
        accountType: planned.accountType ?? 'BALANCE_SHEET',
        detailGroupId: null,
        isPostable: planned.isPostable,
        isActive: planned.defaultIsActive,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: null,
      });
      adoptedAccountIdByKey.set(planned.nodeKey, accountId);
    }
    const adoption: AdoptionRecord = {
      id: input.adoptionId,
      organizationId: input.organizationId,
      templateVersionId: input.templateVersionId,
      accountingConfigurationId: input.accountingConfigurationId,
      codingStructureVersionId: input.codingStructureVersionId,
      accountCount: selection.nodes.length,
      createdAt: input.now,
      createdBy: input.actorId,
    };
    this.state.adoptions.push(adoption);
    return adoption;
  }

  private hydrateView(record: AdoptionRecord): Promise<BaseChartAdoptionView> {
    const version = this.state.versions.find(
      (row) => row.id === record.templateVersionId,
    );
    if (version === undefined) throw new Error('adoption version missing');
    const template = this.state.templates.find(
      (row) => row.id === version.templateId,
    );
    if (template === undefined) throw new Error('adoption template missing');
    return Promise.resolve({
      id: record.id,
      organizationId: record.organizationId,
      templateVersionId: record.templateVersionId,
      templateId: template.id,
      templateCode: template.code,
      versionNumber: version.versionNumber,
      accountingConfigurationId: record.accountingConfigurationId,
      codingStructureVersionId: record.codingStructureVersionId,
      accountCount: record.accountCount,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    });
  }
}

export type { AccountNature };
