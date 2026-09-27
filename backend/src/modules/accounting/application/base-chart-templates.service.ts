import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import {
  BaseChartTemplatesRepository,
  type TemplateListFilter,
  type TemplateNodeWrite,
} from '../data/base-chart-templates.repository.js';
import {
  BaseChartContentRejectedError,
  BaseChartVersionStatusError,
} from '../data/base-chart-errors.js';
import type { AccountNature } from '../domain/account.js';
import {
  baseChartContentProblemMessage,
  planBaseChartVersionContent,
  toBaseChartTemplateDto,
  toBaseChartTemplateVersionDto,
  type BaseChartLevelInput,
  type BaseChartNodeInput,
  type BaseChartTemplateDto,
  type BaseChartTemplateVersionDto,
} from '../domain/base-chart-template.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';

/**
 * Base Chart template lifecycle (Task 23; Task 21 §8 lifecycle, task §17).
 *
 * The template store is a PRODUCT asset: templates and their versions carry
 * no organization, are identical for every tenant, and are delivered by
 * explicit adoption — never by implicit inheritance (OD-20-1/2/3). Write
 * surface:
 *
 *   create template (version 1 as DRAFT) → edit draft content → approve →
 *   publish → [adoption by organizations] → supersede (publish supersedes the
 *   previously published version automatically; a standalone supersede
 *   retires a published version without a replacement).
 *
 * Guardrails this service applies BEFORE delegating to the repository (the
 * repository re-applies the same decision functions UNDER its row locks —
 * one planner set, two call sites, the module-wide discipline):
 *
 * - shape normalization is trim-only (master-data convention); the content
 *   planner validates the level shape and the whole node tree; a draft that
 *   cannot become publishable is rejected AT AUTHORING (the fail-fast gate —
 *   the same validation replayed at publish and inside the guarded write
 *   transactions);
 * - there are NO invented accounting semantics anywhere: no account codes or
 *   titles are ever delivered by this service (task §12), no Control Role /
 *   Dimension vocabulary exists in the payload, and postability/activity
 *   authored here are DEFAULTS the adoption re-derives (OD-20-5);
 * - version numbering is server-side `max + 1` with retry on the ordinal
 *   unique index (the Workflow assignment precedent);
 * - NO events exist for the template lifecycle in the contract vocabulary, so
 *   none are invented (task §21: never emit an event that has no consumer);
 *   audit rides on the AR-12 audit columns every write carries.
 */

const MAX_VERSION_ASSIGNMENT_RETRIES = 3;

export interface CreateTemplateInput {
  code: string;
  title: string;
  maxDepth: number;
  levels: readonly BaseChartLevelInput[];
  nodes: readonly BaseChartNodeInput[];
}

export interface CreateVersionInput {
  templateId: string;
  maxDepth: number;
  levels: readonly BaseChartLevelInput[];
  nodes: readonly BaseChartNodeInput[];
}

export interface UpdateVersionContentInput {
  maxDepth?: number | undefined;
  levels?: readonly BaseChartLevelInput[] | undefined;
  nodes?: readonly BaseChartNodeInput[] | undefined;
}

export interface ListTemplatesQuery {
  page: number;
  pageSize: number;
  code?: string | undefined;
  search?: string | undefined;
}

export interface ListVersionsQuery {
  templateId: string;
  page: number;
  pageSize: number;
  status?: string | undefined;
}

export interface TemplateDetailDto {
  template: BaseChartTemplateDto;
  versions: BaseChartTemplateVersionDto[];
}

@Injectable()
export class BaseChartTemplatesService {
  constructor(
    private readonly repository: BaseChartTemplatesRepository,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ------------------------------------------------------------------ reads

  async listTemplates(
    query: ListTemplatesQuery,
  ): Promise<PaginatedResult<BaseChartTemplateDto>> {
    const filter: TemplateListFilter = {};
    if (query.code !== undefined) filter.code = normalizeCode(query.code);
    if (query.search !== undefined && query.search.trim() !== '') {
      filter.search = query.search.trim();
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { rows, total } = await this.repository.listTemplates(filter, {
      skip,
      take,
    });
    return toPaginatedResult(
      rows.map(toBaseChartTemplateDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** Template + all its versions (version summaries carry full content; the store is product-owned, so templates are few and small here). */
  async getTemplate(templateId: string): Promise<TemplateDetailDto> {
    const template = await this.repository.findTemplateById(templateId);
    if (template === null)
      throw AppException.notFound('Base chart template', templateId);
    const { rows: versions } = await this.repository.listVersions(
      { templateId },
      100,
    );
    return {
      template: toBaseChartTemplateDto(template),
      versions: versions.map((version) =>
        toBaseChartTemplateVersionDto(template, version),
      ),
    };
  }

  async getVersion(versionId: string): Promise<BaseChartTemplateVersionDto> {
    const resolved = await this.repository.findVersionById(versionId);
    if (resolved === null) {
      throw AppException.notFound('Base chart template version', versionId);
    }
    return toBaseChartTemplateVersionDto(resolved.template, resolved.version);
  }

  async listVersions(
    query: ListVersionsQuery,
  ): Promise<PaginatedResult<BaseChartTemplateVersionDto>> {
    const template = await this.repository.findTemplateById(query.templateId);
    if (template === null) {
      throw AppException.notFound('Base chart template', query.templateId);
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { rows, total } = await this.repository.listVersions(
      { templateId: query.templateId, status: query.status },
      take,
      skip,
    );
    return toPaginatedResult(
      rows.map((version) => toBaseChartTemplateVersionDto(template, version)),
      total,
      query.page,
      query.pageSize,
    );
  }

  // ----------------------------------------------------------------- writes

  async createTemplate(input: CreateTemplateInput): Promise<TemplateDetailDto> {
    const code = normalizeCode(input.code);
    const title = normalizeTitle(input.title);
    if (code === '' || code.length > 64) {
      throw AppException.badRequest('Template code is required.');
    }
    if (title === '') {
      throw AppException.badRequest('Template title is required.');
    }
    // Fail-fast author gate (the repository re-runs the planner under its row
    // lock before insert — one plan, two sites).
    this.assertContent(input.maxDepth, input.levels, input.nodes);

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const templateId = generateId();
    const versionId = generateId();
    try {
      const created = await this.repository.createTemplateWithVersionContent({
        templateId,
        versionId,
        code,
        title,
        versionNumber: 1,
        maxDepth: input.maxDepth,
        levels: this.levelWrites(input.levels),
        nodes: this.nodeWrites(input.levels, input.nodes),
        createdAt: now,
        actorId,
      });
      this.logger.log(
        'Base chart template created',
        { templateId, code, versionId },
        BaseChartTemplatesService.name,
      );
      return {
        template: toBaseChartTemplateDto(created.template),
        versions: [
          toBaseChartTemplateVersionDto(created.template, created.version),
        ],
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A base chart template with that code already exists.',
        );
      }
      const mapped = mapBaseChartGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  async createVersion(
    input: CreateVersionInput,
  ): Promise<BaseChartTemplateVersionDto> {
    const template = await this.repository.findTemplateById(input.templateId);
    if (template === null) {
      throw AppException.notFound('Base chart template', input.templateId);
    }
    this.assertContent(input.maxDepth, input.levels, input.nodes);

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    for (let attempt = 0; attempt < MAX_VERSION_ASSIGNMENT_RETRIES; attempt++) {
      const { rows: versions } = await this.repository.listVersions(
        { templateId: input.templateId },
        1_000,
      );
      const versionNumber =
        versions.reduce(
          (max, version) => Math.max(max, version.versionNumber),
          0,
        ) + 1;
      try {
        const created = await this.repository.createDraftVersionWithContent({
          templateId: input.templateId,
          versionId: generateId(),
          versionNumber,
          maxDepth: input.maxDepth,
          levels: this.levelWrites(input.levels),
          nodes: this.nodeWrites(input.levels, input.nodes),
          createdAt: now,
          actorId,
        });
        if (created === null) {
          throw AppException.notFound('Base chart template', input.templateId);
        }
        this.logger.log(
          'Base chart template version drafted',
          { templateId: input.templateId, versionNumber },
          BaseChartTemplatesService.name,
        );
        return toBaseChartTemplateVersionDto(template, created);
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          attempt < MAX_VERSION_ASSIGNMENT_RETRIES - 1
        ) {
          continue; // another draft claimed the same ordinal concurrently
        }
        if (isUniqueViolation(error)) {
          throw AppException.conflict(
            'Two draft versions were created concurrently; retry the request.',
          );
        }
        const mapped = mapBaseChartGuardError(error);
        if (mapped !== null) throw mapped;
        throw error;
      }
    }
    throw AppException.conflict(
      'Two draft versions were created concurrently; retry the request.',
    );
  }

  /** Renaming the template title is always allowed (identity is stable). */
  async renameTemplate(
    templateId: string,
    title: string,
  ): Promise<BaseChartTemplateDto> {
    const normalized = normalizeTitle(title);
    if (normalized === '') {
      throw AppException.badRequest('Template title is required.');
    }
    const updated = await this.repository.renameTemplate({
      templateId,
      title: normalized,
      updatedAt: new Date(),
      actorId: getPrincipal()?.userId ?? null,
    });
    if (updated === null) {
      throw AppException.notFound('Base chart template', templateId);
    }
    return toBaseChartTemplateDto(updated);
  }

  /**
   * Replace a DRAFT version's content. Omitted fields keep the stored rows
   * (the repository validates the RESULTING content, never the delta).
   */
  async updateVersionContent(
    versionId: string,
    input: UpdateVersionContentInput,
  ): Promise<BaseChartTemplateVersionDto> {
    const resolved = await this.repository.findVersionById(versionId);
    if (resolved === null) {
      throw AppException.notFound('Base chart template version', versionId);
    }
    if (resolved.version.status !== 'draft') {
      throw AppException.businessRule(
        `The base chart template version is "${resolved.version.status}" and is no longer editable. Only a draft version accepts content changes.`,
      );
    }
    // Fast author feedback on the RESULTING content (the repository re-runs
    // the same planner on the locked rows).
    const content = planBaseChartVersionContent({
      maxDepth: input.maxDepth ?? resolved.version.maxDepth,
      levels:
        input.levels ??
        resolved.version.levels.map((row) => ({
          levelIndex: row.levelIndex,
          digitLength: row.digitLength,
          defaultIsPostable: row.defaultIsPostable,
        })),
      nodes:
        input.nodes ??
        resolved.version.nodes.map((row) => ({
          nodeKey: row.nodeKey,
          parentNodeKey: row.parentNodeKey,
          code: row.code,
          title: row.title,
          accountNature: row.accountNature,
          isPostable: row.isPostable,
          isMandatory: row.isMandatory,
          defaultIsActive: row.defaultIsActive,
        })),
    });
    if (content.plan.problem !== null) {
      throw contentException(content.plan.problem, content.plan.subject);
    }
    try {
      const updated = await this.repository.updateDraftContentChecked({
        versionId,
        maxDepth: input.maxDepth,
        levels:
          input.levels === undefined
            ? undefined
            : this.levelWrites(input.levels),
        nodes:
          input.nodes === undefined
            ? undefined
            : this.nodeWrites(
                input.levels ??
                  resolved.version.levels.map((row) => ({
                    levelIndex: row.levelIndex,
                    digitLength: row.digitLength,
                    defaultIsPostable: row.defaultIsPostable,
                  })),
                input.nodes,
              ),
        updatedAt: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      if (updated === null) {
        throw AppException.notFound('Base chart template version', versionId);
      }
      return toBaseChartTemplateVersionDto(resolved.template, updated);
    } catch (error) {
      const mapped = mapBaseChartGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  // ------------------------------------------------------------- transitions

  async approve(versionId: string): Promise<BaseChartTemplateVersionDto> {
    return this.transition(versionId, 'approve');
  }

  async publish(versionId: string): Promise<BaseChartTemplateVersionDto> {
    return this.transition(versionId, 'publish');
  }

  async supersede(
    versionId: string,
    supersededByVersionId?: string | null,
  ): Promise<BaseChartTemplateVersionDto> {
    return this.transition(
      versionId,
      'supersede',
      supersededByVersionId ?? null,
    );
  }

  private async transition(
    versionId: string,
    transition: 'approve' | 'publish' | 'supersede',
    supersededByVersionId?: string | null,
  ): Promise<BaseChartTemplateVersionDto> {
    const resolved = await this.repository.findVersionById(versionId);
    if (resolved === null) {
      throw AppException.notFound('Base chart template version', versionId);
    }
    // Publish fast feedback: the exact same content gate the repository
    // replays under the template-wide lock.
    if (transition === 'publish') {
      this.assertContent(
        resolved.version.maxDepth,
        resolved.version.levels.map((row) => ({
          levelIndex: row.levelIndex,
          digitLength: row.digitLength,
          defaultIsPostable: row.defaultIsPostable,
        })),
        resolved.version.nodes.map((row) => ({
          nodeKey: row.nodeKey,
          parentNodeKey: row.parentNodeKey,
          code: row.code,
          title: row.title,
          accountNature: row.accountNature,
          isPostable: row.isPostable,
          isMandatory: row.isMandatory,
          defaultIsActive: row.defaultIsActive,
        })),
      );
    }
    if (
      transition === 'supersede' &&
      supersededByVersionId !== undefined &&
      supersededByVersionId !== null
    ) {
      if (supersededByVersionId === versionId) {
        throw AppException.businessRule('A version cannot supersede itself.');
      }
      const replacement = await this.repository.findVersionById(
        supersededByVersionId,
      );
      if (
        replacement === null ||
        replacement.template.id !== resolved.template.id
      ) {
        throw AppException.businessRule(
          'The replacement version must be a version of the same template.',
        );
      }
    }
    try {
      const result = await this.repository.transitionChecked({
        versionId,
        transition,
        supersededByVersionId,
        now: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      if (result === null) {
        throw AppException.notFound('Base chart template version', versionId);
      }
      this.logger.log(
        `Base chart template version ${transition}d`,
        {
          versionId,
          templateId: result.templateId,
          transition,
          supersededVersionIds: result.supersededVersionIds,
        },
        BaseChartTemplatesService.name,
      );
      return toBaseChartTemplateVersionDto(resolved.template, result.version);
    } catch (error) {
      const mapped = mapBaseChartGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  // ---------------------------------------------------------------- helpers

  /** The authoring gate: one call of the SAME planner the guarded writes run. */
  private assertContent(
    maxDepth: number,
    levels: readonly BaseChartLevelInput[],
    nodes: readonly BaseChartNodeInput[],
  ): void {
    const result = planBaseChartVersionContent({ maxDepth, levels, nodes });
    if (result.plan.problem !== null) {
      throw contentException(result.plan.problem, result.plan.subject);
    }
  }

  private levelWrites(levels: readonly BaseChartLevelInput[]): {
    id: string;
    levelIndex: number;
    digitLength: number;
    defaultIsPostable: boolean;
  }[] {
    return levels.map((level) => ({
      id: generateId(),
      levelIndex: level.levelIndex,
      digitLength: level.digitLength,
      defaultIsPostable: level.defaultIsPostable,
    }));
  }

  /**
   * Resolve the authored tree into storage rows: ids, the resolved adjacency
   * edges (`parentId`) and the derived levels all come from ONE derivation
   * (validity was already PROVEN by `assertContent` before this runs, and the
   * guarded write re-runs it), so the stored `parentNodeKey`/`parentId` pair
   * can never disagree. Postability defaults resolve from the node's OWN
   * derived level (Task 21 §7: omitted = the level default).
   */
  private nodeWrites(
    levels: readonly {
      levelIndex: number;
      digitLength: number;
      defaultIsPostable: boolean;
    }[],
    nodes: readonly BaseChartNodeInput[],
  ): TemplateNodeWrite[] {
    const defaultByLevelIndex = new Map(
      levels.map((level) => [level.levelIndex, level.defaultIsPostable]),
    );
    const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
    const idByKey = new Map(nodes.map((node) => [node.nodeKey, generateId()]));
    const levelCache = new Map<string, number>();
    const levelOf = (key: string): number => {
      const cached = levelCache.get(key);
      if (cached !== undefined) return cached;
      const node = byKey.get(key)!;
      const level =
        node.parentNodeKey === null ? 1 : levelOf(node.parentNodeKey) + 1;
      levelCache.set(key, level);
      return level;
    };
    return nodes.map((node) => {
      const level = levelOf(node.nodeKey);
      return {
        id: idByKey.get(node.nodeKey)!,
        nodeKey: node.nodeKey,
        parentNodeKey: node.parentNodeKey,
        parentId:
          node.parentNodeKey === null
            ? null
            : (idByKey.get(node.parentNodeKey) ?? null),
        code: node.code,
        title: node.title,
        accountNature: node.accountNature as AccountNature,
        isPostable: node.isPostable ?? defaultByLevelIndex.get(level) ?? false,
        isMandatory: node.isMandatory ?? false,
        defaultIsActive: node.defaultIsActive ?? true,
        level,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Guard mapping (the same posture as mapAccountGuardError)
// ---------------------------------------------------------------------------

export function mapBaseChartGuardError(error: unknown): AppException | null {
  if (error instanceof BaseChartVersionStatusError) {
    return AppException.businessRule(
      `The base chart template version is "${error.status}" and cannot accept "${error.transition}". Only a draft version is editable; transitions are one-way (draft → approved → published → superseded), and only a published version may be adopted.`,
    );
  }
  if (error instanceof BaseChartContentRejectedError) {
    return contentException(error.problem, error.subject);
  }
  return null;
}

function contentException(
  problem: Parameters<typeof baseChartContentProblemMessage>[0],
  subject: string | undefined,
): AppException {
  return AppException.businessRule(baseChartContentProblemMessage(problem), {
    problem,
    ...(subject !== undefined ? { subject } : {}),
  });
}
