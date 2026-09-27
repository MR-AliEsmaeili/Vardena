import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isAccountNature, type AccountNature } from '../domain/account.js';
import type {
  BaseChartTemplate,
  BaseChartTemplateLevel,
  BaseChartTemplateNode,
  BaseChartTemplateVersion,
  BaseChartVersionStatus,
  BaseChartVersionTransition,
} from '../domain/base-chart-template.js';
import {
  isBaseChartVersionStatus,
  planBaseChartVersionContent,
  planBaseChartVersionTransition,
} from '../domain/base-chart-template.js';
import {
  BaseChartContentRejectedError,
  BaseChartVersionStatusError,
} from './base-chart-errors.js';
import {
  lockBaseChartTemplateVersionRow,
  lockBaseChartTemplateVersionsOfTemplate,
} from './accounting-locks.js';
import type {
  AccountingTransactionalClient,
  BaseChartTemplateDelegate,
  BaseChartTemplateLevelCreate,
  BaseChartTemplateLevelDelegate,
  BaseChartTemplateLevelRow,
  BaseChartTemplateNodeCreate,
  BaseChartTemplateNodeDelegate,
  BaseChartTemplateNodeRow,
  BaseChartTemplateRow,
  BaseChartTemplateVersionCreate,
  BaseChartTemplateVersionDelegate,
  BaseChartTemplateVersionRow,
  BaseChartTemplateWhere,
} from './accounting-rows.js';

/**
 * Data access for `accounting.base_chart_templates`,
 * `accounting.base_chart_template_versions`,
 * `accounting.base_chart_template_levels` and
 * `accounting.base_chart_template_nodes` — the PRODUCT-OWNED Base Chart
 * template store (Task 23). These tables carry NO `organization_id`: they are
 * a tenant-neutral product asset (the OD-20-1 tenancy exception, resolved by
 * the task: templates are delivered and explicitly adopted by each
 * organization, never owned by one). Cross-tenant safety for the
 * tenant-neutral store is enforced at the service/permission boundary — the
 * same precedent `rbac.permissions` already sets.
 *
 * Notes this seam keeps honest:
 *
 * - Levels/nodes are replaced ONLY while the version is a DRAFT, always under
 *   the version-row lock (`FOR UPDATE`) with a status re-check — the exact
 *   draft-configuration precedent of `CodingStructuresRepository` (§9.4,
 *   ADR-0024). APPROVED/PUBLISHED/SUPERSEDED versions are immutable; the
 *   editor is "make a new draft version".
 * - `publishChecked` locks EVERY version row of the template (ascending id)
 *   so two concurrent publishes serialize; it then replays the full content
 *   validation against the LOCKED rows and supersedes the previously
 *   published version(s) with `supersededByVersionId` pointing at the winner
 *   — at most one PUBLISHED version per template, guaranteed in code (a
 *   partial unique index is rejected for the Prisma-representability reason
 *   `accounting-locks.ts` already records).
 * - Node `parentNodeKey` AND `parentId` are written from the SAME planner
 *   output (domains resolve both from one derivation, so they can never
 *   disagree); the `parentId` self-FK RESTRICTROWS the delete-only-drafts
 *   rule.
 */

type Client = {
  baseChartTemplate: BaseChartTemplateDelegate;
  baseChartTemplateVersion: BaseChartTemplateVersionDelegate;
  baseChartTemplateLevel: BaseChartTemplateLevelDelegate;
  baseChartTemplateNode: BaseChartTemplateNodeDelegate;
};

const MAX_NODE_ROWS = 20_000;

/** One level row as the caller writes it (ids are generated in the service). */
export interface TemplateLevelWrite {
  id: string;
  levelIndex: number;
  digitLength: number;
  defaultIsPostable: boolean;
}

/** One node row as the caller writes it. `parentId` accompanies `parentNodeKey`. */
export interface TemplateNodeWrite {
  id: string;
  nodeKey: string;
  parentNodeKey: string | null;
  parentId: string | null;
  code: string;
  title: string;
  accountNature: AccountNature;
  isPostable: boolean;
  isMandatory: boolean;
  defaultIsActive: boolean;
  level: number;
}

export interface TemplateListFilter {
  code?: string | undefined;
  search?: string | undefined;
}

export interface VersionListFilter {
  templateId: string;
  status?: string | undefined;
}

@Injectable()
export class BaseChartTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  // ------------------------------------------------------------------ reads

  async findTemplateById(id: string): Promise<BaseChartTemplate | null> {
    const { baseChartTemplate } = await this.client();
    const row = await baseChartTemplate.findUnique({ where: { id } });
    return row === null ? null : toTemplate(row);
  }

  async findTemplateByCode(code: string): Promise<BaseChartTemplate | null> {
    const { baseChartTemplate } = await this.client();
    const row = await baseChartTemplate.findFirst({ where: { code } });
    return row === null ? null : toTemplate(row);
  }

  async listTemplates(
    filter: TemplateListFilter,
    page: { skip: number; take: number },
  ): Promise<{ rows: BaseChartTemplate[]; total: number }> {
    const { baseChartTemplate } = await this.client();
    const where: BaseChartTemplateWhere = {};
    if (filter.code !== undefined) where.code = filter.code;
    if (filter.search !== undefined && filter.search !== '') {
      where.OR = [
        { code: { contains: filter.search, mode: 'insensitive' } },
        { title: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      baseChartTemplate.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      baseChartTemplate.count({ where }),
    ]);
    return { rows: rows.map(toTemplate), total };
  }

  async findVersionById(id: string): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  } | null> {
    const { baseChartTemplate, baseChartTemplateVersion } = await this.client();
    const row = await baseChartTemplateVersion.findUnique({ where: { id } });
    if (row === null) return null;
    const templateRow = await baseChartTemplate.findUnique({
      where: { id: row.templateId },
    });
    if (templateRow === null) {
      // Versions are never deleted and the FK is RESTRICT: a version whose
      // template row disappeared is a corrupted store, not an API outcome.
      throw new Error(
        `Base chart template version "${row.id}" references missing template "${row.templateId}".`,
      );
    }
    const [levels, nodes] = await Promise.all([
      this.listLevelRows(row.id),
      this.listNodeRows(row.id),
    ]);
    return {
      template: toTemplate(templateRow),
      version: toVersion(row, levels, nodes),
    };
  }

  async listVersions(
    filter: VersionListFilter,
    take: number,
    skip = 0,
  ): Promise<{ rows: BaseChartTemplateVersion[]; total: number }> {
    const { baseChartTemplateVersion } = await this.client();
    const where: { templateId: string; status?: string } = {
      templateId: filter.templateId,
    };
    if (filter.status !== undefined) where.status = filter.status;
    const [rows, total] = await Promise.all([
      baseChartTemplateVersion.findMany({
        where,
        orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      baseChartTemplateVersion.count({ where }),
    ]);
    const list: BaseChartTemplateVersion[] = [];
    for (const row of rows) {
      const [levels, nodes] = await Promise.all([
        this.listLevelRows(row.id),
        this.listNodeRows(row.id),
      ]);
      list.push(toVersion(row, levels, nodes));
    }
    return { rows: list, total };
  }

  // ----------------------------------------------------------------- writes

  /**
   * Create a template together with its FIRST draft version and full draft
   * content in ONE transaction: a template never exists without the version
   * the caller configured (no orphan template, no half-written version).
   * The `uq_base_chart_templates_code` unique index is authoritative for code
   * uniqueness; the service maps the P2002 to 409.
   */
  async createTemplateWithVersionContent(input: {
    templateId: string;
    versionId: string;
    code: string;
    title: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly TemplateLevelWrite[];
    nodes: readonly TemplateNodeWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const templateRow = await tx.baseChartTemplate.create({
        data: {
          id: input.templateId,
          code: input.code,
          title: input.title,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          createdBy: input.actorId,
        },
      });
      await tx.baseChartTemplateVersion.create({ data: versionCreate(input) });
      for (const level of input.levels) {
        await tx.baseChartTemplateLevel.create({
          data: levelCreate(input.versionId, level, {
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            actorId: input.actorId,
          }),
        });
      }
      for (const node of input.nodes) {
        await tx.baseChartTemplateNode.create({
          data: nodeCreate(input.versionId, node, {
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            actorId: input.actorId,
          }),
        });
      }
      const [levels, nodes] = await Promise.all([
        tx.baseChartTemplateLevel.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
        tx.baseChartTemplateNode.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
      ]);
      return {
        template: toTemplate(templateRow),
        version: toVersion(
          {
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
          },
          levels,
          nodes,
        ),
      };
    });
  }

  /** Renaming the template title is always allowed (identity is stable). */
  async renameTemplate(input: {
    templateId: string;
    title: string;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplate | null> {
    const { baseChartTemplate } = await this.client();
    const existing = await baseChartTemplate.findUnique({
      where: { id: input.templateId },
    });
    if (existing === null) return null;
    const row = await baseChartTemplate.update({
      where: { id: input.templateId },
      data: {
        title: input.title,
        updatedAt: input.updatedAt,
        updatedBy: input.actorId,
      },
    });
    return toTemplate(row);
  }

  /**
   * Create the NEXT draft version (content fully re-supplied by the caller —
   * versions are authoring cartridges, each with its own independent draft).
   * `versionNumber = max + 1` is assigned by the SERVICE, which retries on the
   * `uq_base_chart_template_versions_ordinal` collision (the Workflow
   * version-assignment precedent).
   */
  async createDraftVersionWithContent(input: {
    templateId: string;
    versionId: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly TemplateLevelWrite[];
    nodes: readonly TemplateNodeWrite[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplateVersion | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // The template row is never deleted (RESTRICT children), so existence is
      // re-asserted cheaply inside the transaction.
      const template = await tx.baseChartTemplate.findFirst({
        where: { id: input.templateId },
      });
      if (template === null) return null;
      await tx.baseChartTemplateVersion.create({ data: versionCreate(input) });
      for (const level of input.levels) {
        await tx.baseChartTemplateLevel.create({
          data: levelCreate(input.versionId, level, {
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            actorId: input.actorId,
          }),
        });
      }
      for (const node of input.nodes) {
        await tx.baseChartTemplateNode.create({
          data: nodeCreate(input.versionId, node, {
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            actorId: input.actorId,
          }),
        });
      }
      const [levels, nodes] = await Promise.all([
        tx.baseChartTemplateLevel.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
        tx.baseChartTemplateNode.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
      ]);
      return toVersion(
        {
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
        },
        levels,
        nodes,
      );
    });
  }

  /**
   * Replace a DRAFT version's content (depth, level set, node tree). The
   * shape check runs against the LOCKED row and the levels/nodes as they will
   * be stored; level/node rows are delete-and-replace ONLY here (a draft is
   * an unreferenced workspace — nothing pins a template draft).
   *
   * @throws BaseChartVersionStatusError when the version is no longer a draft.
   * @throws BaseChartContentRejectedError when the resulting content is not
   *   a publishable shape.
   */
  async updateDraftContentChecked(input: {
    versionId: string;
    maxDepth?: number | undefined;
    levels?: readonly TemplateLevelWrite[] | undefined;
    nodes?: readonly TemplateNodeWrite[] | undefined;
    updatedAt: Date;
    actorId: string | null;
    /**
     * When the caller re-uses existing level/node ids (partial update), the
     * delete-and-replace writes NEW ids instead — the service always passes
     * fully-resolved fresh ids, so this flag only documents intent.
     */
  }): Promise<BaseChartTemplateVersion | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockBaseChartTemplateVersionRow(tx, input.versionId);
      if (locked === null) return null;
      if (locked.status !== 'draft') {
        throw new BaseChartVersionStatusError(locked.status, 'edit');
      }

      const maxDepth = input.maxDepth ?? locked.maxDepth;
      const storedLevels =
        input.levels === undefined
          ? await tx.baseChartTemplateLevel.findMany({
              where: { versionId: input.versionId },
              orderBy: [{ levelIndex: 'asc' }],
              skip: 0,
              take: MAX_NODE_ROWS,
            })
          : [];
      const storedNodes =
        input.nodes === undefined
          ? await tx.baseChartTemplateNode.findMany({
              where: { versionId: input.versionId },
              orderBy: [{ level: 'asc' }, { code: 'asc' }],
              skip: 0,
              take: MAX_NODE_ROWS,
            })
          : [];
      const candidateLevels = (input.levels ?? storedLevels).map((row) => ({
        levelIndex: row.levelIndex,
        digitLength: row.digitLength,
        defaultIsPostable: row.defaultIsPostable,
      }));
      const candidateNodes = (input.nodes ?? storedNodes).map((row) => ({
        nodeKey: row.nodeKey,
        parentNodeKey: row.parentNodeKey,
        code: row.code,
        title: row.title,
        accountNature: row.accountNature,
        isPostable: row.isPostable,
        isMandatory: row.isMandatory,
        defaultIsActive: row.defaultIsActive,
      }));

      const result = planBaseChartVersionContent({
        maxDepth,
        levels: candidateLevels,
        nodes: candidateNodes,
      });
      if (result.plan.problem !== null) {
        throw new BaseChartContentRejectedError(
          result.plan.problem,
          result.plan.subject,
        );
      }

      await tx.baseChartTemplateVersion.update({
        where: { id: input.versionId },
        data: {
          maxDepth,
          updatedAt: input.updatedAt,
          updatedBy: input.actorId,
        },
      });
      if (input.levels !== undefined) {
        await tx.baseChartTemplateLevel.deleteMany({
          where: { versionId: input.versionId },
        });
        for (const level of input.levels) {
          await tx.baseChartTemplateLevel.create({
            data: levelCreate(input.versionId, level, {
              createdAt: input.updatedAt,
              updatedAt: input.updatedAt,
              actorId: input.actorId,
            }),
          });
        }
      }
      if (input.nodes !== undefined) {
        await tx.baseChartTemplateNode.deleteMany({
          where: { versionId: input.versionId },
        });
        for (const node of input.nodes) {
          await tx.baseChartTemplateNode.create({
            data: nodeCreate(input.versionId, node, {
              createdAt: input.updatedAt,
              updatedAt: input.updatedAt,
              actorId: input.actorId,
            }),
          });
        }
      }
      const [levels, nodes] = await Promise.all([
        tx.baseChartTemplateLevel.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ levelIndex: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
        tx.baseChartTemplateNode.findMany({
          where: { versionId: input.versionId },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        }),
      ]);
      return toVersion(
        {
          id: input.versionId,
          templateId: locked.templateId,
          versionNumber: locked.versionNumber,
          status: 'draft',
          maxDepth,
          approvedAt: null,
          publishedAt: null,
          supersededAt: null,
          supersededByVersionId: null,
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
          createdBy: null,
          updatedBy: input.actorId,
        },
        levels,
        nodes,
      );
    });
  }

  /**
   * Execute ONE lifecycle transition under the template-wide lock
   * (approve/publish) or the version-row lock where a template-wide statement
   * is not needed. Publish additionally replays the full content validation
   * against the LOCKED rows and supersedes the previously published
   * version(s), pointing `supersededByVersionId` at the winner.
   *
   * @returns null when the version row does not exist (404).
   * @throws BaseChartVersionStatusError when the locked status rejects the
   *   transition (422).
   * @throws BaseChartContentRejectedError when publish re-validation fails —
   *   possible only for content that changed between checks (a bug guard;
   *   mapped to 422 by the service).
   */
  async transitionChecked(input: {
    versionId: string;
    transition: BaseChartVersionTransition;
    supersededByVersionId?: string | null | undefined;
    now: Date;
    actorId: string | null;
  }): Promise<{
    templateId: string;
    version: BaseChartTemplateVersion;
    supersededVersionIds: string[];
  } | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Template-wide lock FIRST for publish/supersede: "at most one
      // published version per template" is a template-wide statement, so this
      // is the serialization point (the coding-structure publish precedent).
      // Approve touches only its own row, but locking the set uniformly keeps
      // ONE acquisition order and can never deadlock.
      const first = await lockBaseChartTemplateVersionRow(tx, input.versionId);
      if (first === null) return null;
      const lockedIds = await lockBaseChartTemplateVersionsOfTemplate(
        tx,
        first.templateId,
      );
      if (!lockedIds.includes(input.versionId)) return null;
      const locked = first;

      const target = planBaseChartVersionTransition(
        locked.status as BaseChartVersionStatus,
        input.transition,
      );
      if (target === null) {
        throw new BaseChartVersionStatusError(locked.status, input.transition);
      }

      let levels: BaseChartTemplateLevelRow[] = [];
      let nodes: BaseChartTemplateNodeRow[] = [];
      if (input.transition === 'publish') {
        [levels, nodes] = await Promise.all([
          tx.baseChartTemplateLevel.findMany({
            where: { versionId: input.versionId },
            orderBy: [{ levelIndex: 'asc' }],
            skip: 0,
            take: MAX_NODE_ROWS,
          }),
          tx.baseChartTemplateNode.findMany({
            where: { versionId: input.versionId },
            orderBy: [{ level: 'asc' }, { code: 'asc' }],
            skip: 0,
            take: MAX_NODE_ROWS,
          }),
        ]);
        const result = planBaseChartVersionContent({
          maxDepth: locked.maxDepth,
          levels: levels.map((row) => ({
            levelIndex: row.levelIndex,
            digitLength: row.digitLength,
            defaultIsPostable: row.defaultIsPostable,
          })),
          nodes: nodes.map((row) => ({
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
        if (result.plan.problem !== null) {
          throw new BaseChartContentRejectedError(
            result.plan.problem,
            result.plan.subject,
          );
        }
      }

      const supersededVersionIds: string[] = [];
      if (input.transition === 'publish') {
        const previous = await tx.baseChartTemplateVersion.findMany({
          where: { templateId: locked.templateId, status: 'published' },
          orderBy: [{ id: 'asc' }],
          skip: 0,
          take: MAX_NODE_ROWS,
        });
        for (const row of previous) {
          if (row.id === input.versionId) continue;
          supersededVersionIds.push(row.id);
          await tx.baseChartTemplateVersion.update({
            where: { id: row.id },
            data: {
              status: 'superseded' satisfies BaseChartVersionStatus,
              supersededAt: input.now,
              supersededByVersionId: input.versionId,
              updatedAt: input.now,
              updatedBy: input.actorId,
            },
          });
        }
      }

      const updated = await tx.baseChartTemplateVersion.update({
        where: { id: input.versionId },
        data: {
          status: target satisfies BaseChartVersionStatus,
          approvedAt: input.transition === 'approve' ? input.now : undefined,
          publishedAt: input.transition === 'publish' ? input.now : undefined,
          supersededAt:
            input.transition === 'supersede' ? input.now : undefined,
          supersededByVersionId:
            input.transition === 'supersede'
              ? (input.supersededByVersionId ?? null)
              : undefined,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });

      if (input.transition !== 'publish') {
        [levels, nodes] = await Promise.all([
          tx.baseChartTemplateLevel.findMany({
            where: { versionId: input.versionId },
            orderBy: [{ levelIndex: 'asc' }],
            skip: 0,
            take: MAX_NODE_ROWS,
          }),
          tx.baseChartTemplateNode.findMany({
            where: { versionId: input.versionId },
            orderBy: [{ level: 'asc' }, { code: 'asc' }],
            skip: 0,
            take: MAX_NODE_ROWS,
          }),
        ]);
      }

      return {
        templateId: locked.templateId,
        version: toVersion(updated, levels, nodes),
        supersededVersionIds,
      };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async listLevelRows(
    versionId: string,
  ): Promise<BaseChartTemplateLevelRow[]> {
    const { baseChartTemplateLevel } = await this.client();
    return baseChartTemplateLevel.findMany({
      where: { versionId },
      orderBy: [{ levelIndex: 'asc' }],
      skip: 0,
      take: MAX_NODE_ROWS,
    });
  }

  private async listNodeRows(
    versionId: string,
  ): Promise<BaseChartTemplateNodeRow[]> {
    const { baseChartTemplateNode } = await this.client();
    return baseChartTemplateNode.findMany({
      where: { versionId },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      skip: 0,
      take: MAX_NODE_ROWS,
    });
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toTemplate(row: BaseChartTemplateRow): BaseChartTemplate {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLevel(row: BaseChartTemplateLevelRow): BaseChartTemplateLevel {
  return {
    id: row.id,
    versionId: row.versionId,
    levelIndex: row.levelIndex,
    digitLength: row.digitLength,
    defaultIsPostable: row.defaultIsPostable,
  };
}

function toNode(row: BaseChartTemplateNodeRow): BaseChartTemplateNode {
  if (!isAccountNature(row.accountNature)) {
    throw new Error(
      `Base chart template node "${row.id}" has an invalid account nature "${row.accountNature}".`,
    );
  }
  return {
    id: row.id,
    versionId: row.versionId,
    nodeKey: row.nodeKey,
    parentNodeKey: row.parentNodeKey,
    parentId: row.parentId,
    code: row.code,
    title: row.title,
    accountNature: row.accountNature,
    isPostable: row.isPostable,
    isMandatory: row.isMandatory,
    defaultIsActive: row.defaultIsActive,
    level: row.level,
  };
}

function toVersion(
  row: BaseChartTemplateVersionRow,
  levels: readonly BaseChartTemplateLevelRow[],
  nodes: readonly BaseChartTemplateNodeRow[],
): BaseChartTemplateVersion {
  if (!isBaseChartVersionStatus(row.status)) {
    throw new Error(
      `Base chart template version "${row.id}" has an invalid status "${row.status}".`,
    );
  }
  return {
    id: row.id,
    templateId: row.templateId,
    versionNumber: row.versionNumber,
    status: row.status satisfies BaseChartVersionStatus,
    maxDepth: row.maxDepth,
    approvedAt: row.approvedAt,
    publishedAt: row.publishedAt,
    supersededAt: row.supersededAt,
    supersededByVersionId: row.supersededByVersionId,
    levels: levels.map(toLevel),
    nodes: nodes.map(toNode),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function versionCreate(input: {
  versionId: string;
  templateId: string;
  versionNumber: number;
  maxDepth: number;
  createdAt: Date;
  actorId: string | null;
}): BaseChartTemplateVersionCreate {
  return {
    id: input.versionId,
    templateId: input.templateId,
    versionNumber: input.versionNumber,
    status: 'draft',
    maxDepth: input.maxDepth,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    createdBy: input.actorId,
  };
}

function levelCreate(
  versionId: string,
  level: TemplateLevelWrite,
  input: { createdAt: Date; updatedAt: Date; actorId: string | null },
): BaseChartTemplateLevelCreate {
  const at = input.createdAt;
  return {
    id: level.id,
    versionId,
    levelIndex: level.levelIndex,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    createdAt: at,
    updatedAt: at,
    createdBy: input.actorId,
  };
}

function nodeCreate(
  versionId: string,
  node: TemplateNodeWrite,
  input: { createdAt: Date; updatedAt: Date; actorId: string | null },
): BaseChartTemplateNodeCreate {
  const at = input.createdAt;
  return {
    id: node.id,
    versionId,
    nodeKey: node.nodeKey,
    parentNodeKey: node.parentNodeKey,
    parentId: node.parentId,
    code: node.code,
    title: node.title,
    accountNature: node.accountNature satisfies AccountNature,
    isPostable: node.isPostable,
    isMandatory: node.isMandatory,
    defaultIsActive: node.defaultIsActive,
    level: node.level,
    createdAt: at,
    updatedAt: at,
    createdBy: input.actorId,
  };
}
