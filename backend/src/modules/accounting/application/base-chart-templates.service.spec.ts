import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { PRISMA_UNIQUE_VIOLATION } from '../../../kernel/prisma/prisma-errors.js';
import { BaseChartTemplatesRepository } from '../data/base-chart-templates.repository.js';
import {
  BaseChartContentRejectedError,
  BaseChartVersionStatusError,
} from '../data/base-chart-errors.js';
import type {
  BaseChartLevelInput,
  BaseChartNodeInput,
  BaseChartTemplate,
  BaseChartTemplateVersion,
  BaseChartVersionStatus,
} from '../domain/base-chart-template.js';
import { planBaseChartVersionContent } from '../domain/base-chart-template.js';
import { BaseChartTemplatesService } from './base-chart-templates.service.js';

/**
 * Task 23 — Base Chart template lifecycle, application layer.
 *
 * What this proves: the deterministic state machine (create-as-draft → edit
 * draft → approve → publish → supersede), the draft-only editing and the
 * immutable-after-publish contracts, the content author gate (one planner at
 * every boundary), the deterministic version-number assignment with retry on
 * the ordinal unique race, the code-unique 409, the 404 posture for unknown
 * ids, and that publish supersedes the previously published version with
 * `supersededByVersionId` pointing at the winner. Concurrency/refusal twins
 * run in the repository fake UNDER the same guards the SQL implementation
 * holds under its row locks.
 */

const ACTOR = '01ACTOR000000000000000000A';

const LEVELS: readonly BaseChartLevelInput[] = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
  { levelIndex: 2, digitLength: 3, defaultIsPostable: true },
];

const NODES: readonly BaseChartNodeInput[] = [
  {
    nodeKey: 'G1',
    parentNodeKey: null,
    code: '10',
    title: 'Assets',
    accountNature: 'debit',
    isMandatory: true,
    defaultIsActive: true,
  },
  {
    nodeKey: 'L1',
    parentNodeKey: 'G1',
    code: '10001',
    title: 'Cash',
    accountNature: 'debit',
    isMandatory: false,
    defaultIsActive: true,
  },
];

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function failure(promise: Promise<unknown>): Promise<{
  code: string;
  details: Record<string, unknown>;
}> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) throw new Error('Expected the operation to fail.');
  const exception = caught as {
    code: string;
    getResponse?: () => { details?: unknown };
  };
  const response = exception.getResponse?.() ?? {};
  return {
    code: exception.code,
    details: (response.details ?? {}) as Record<string, unknown>,
  };
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    {
      correlationId: 'corr-base-chart',
      principal: { userId, sessionId: 'sess' },
    },
    fn,
  );
}

// ---------------------------------------------------------------------------
// Repository fake — mirrors the guarded semantics of
// `BaseChartTemplatesRepository` (draft-only writes, transitions under the
// template-wide lock, publish content re-validation, auto-supersede).
// ---------------------------------------------------------------------------

class TemplatesRepositoryFake {
  templates: BaseChartTemplate[] = [];
  versions: BaseChartTemplateVersion[] = [];
  simulateOrdinalCollisionOnce = false;

  async findTemplateById(id: string): Promise<BaseChartTemplate | null> {
    return this.templates.find((row) => row.id === id) ?? null;
  }

  async findTemplateByCode(code: string): Promise<BaseChartTemplate | null> {
    return this.templates.find((row) => row.code === code) ?? null;
  }

  async listTemplates(
    filter: { code?: string | undefined; search?: string | undefined },
    page: { skip: number; take: number },
  ): Promise<{ rows: BaseChartTemplate[]; total: number }> {
    let rows = [...this.templates].sort((a, b) =>
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
      rows: rows.slice(page.skip, page.skip + page.take),
      total: rows.length,
    };
  }

  async findVersionById(id: string): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  } | null> {
    const version = this.versions.find((row) => row.id === id);
    if (version === undefined) return null;
    const template = this.templates.find(
      (row) => row.id === version.templateId,
    );
    if (template === undefined) throw new Error('orphan version');
    return { template, version };
  }

  async listVersions(
    filter: { templateId: string; status?: string | undefined },
    take: number,
    skip = 0,
  ): Promise<{ rows: BaseChartTemplateVersion[]; total: number }> {
    let rows = this.versions.filter((v) => v.templateId === filter.templateId);
    if (filter.status !== undefined)
      rows = rows.filter((v) => v.status === filter.status);
    rows = rows.sort(
      (a, b) => b.versionNumber - a.versionNumber || a.id.localeCompare(b.id),
    );
    return { rows: rows.slice(skip, skip + take), total: rows.length };
  }

  async createTemplateWithVersionContent(input: {
    templateId: string;
    versionId: string;
    code: string;
    title: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly {
      id: string;
      levelIndex: number;
      digitLength: number;
      defaultIsPostable: boolean;
    }[];
    nodes: readonly {
      id: string;
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
    }[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<{
    template: BaseChartTemplate;
    version: BaseChartTemplateVersion;
  }> {
    if (this.templates.some((row) => row.code === input.code)) {
      throw Object.assign(new Error('duplicate'), {
        code: PRISMA_UNIQUE_VIOLATION,
      });
    }
    const template: BaseChartTemplate = {
      id: input.templateId,
      code: input.code,
      title: input.title,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    const version = this.buildDraftVersion(input);
    this.templates.push(template);
    this.versions.push(version);
    return { template, version };
  }

  async createDraftVersionWithContent(input: {
    templateId: string;
    versionId: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly {
      id: string;
      levelIndex: number;
      digitLength: number;
      defaultIsPostable: boolean;
    }[];
    nodes: readonly {
      id: string;
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
    }[];
    createdAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplateVersion | null> {
    const template = this.templates.find((row) => row.id === input.templateId);
    if (template === undefined) return null;
    if (
      this.simulateOrdinalCollisionOnce ||
      this.versions.some(
        (v) =>
          v.templateId === input.templateId &&
          v.versionNumber === input.versionNumber,
      )
    ) {
      if (this.simulateOrdinalCollisionOnce) {
        this.simulateOrdinalCollisionOnce = false;
      }
      throw Object.assign(new Error('duplicate ordinal'), {
        code: PRISMA_UNIQUE_VIOLATION,
      });
    }
    const version = this.buildDraftVersion(input);
    this.versions.push(version);
    return version;
  }

  async renameTemplate(input: {
    templateId: string;
    title: string;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplate | null> {
    const template = this.templates.find((row) => row.id === input.templateId);
    if (template === undefined) return null;
    template.title = input.title;
    template.updatedAt = input.updatedAt;
    return template;
  }

  async updateDraftContentChecked(input: {
    versionId: string;
    maxDepth?: number | undefined;
    levels?:
      | readonly {
          id: string;
          levelIndex: number;
          digitLength: number;
          defaultIsPostable: boolean;
        }[]
      | undefined;
    nodes?:
      | readonly {
          id: string;
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
        }[]
      | undefined;
    updatedAt: Date;
    actorId: string | null;
  }): Promise<BaseChartTemplateVersion | null> {
    const version = this.versions.find((row) => row.id === input.versionId);
    if (version === undefined) return null;
    if (version.status !== 'draft') {
      throw new BaseChartVersionStatusError(version.status, 'edit');
    }
    const maxDepth = input.maxDepth ?? version.maxDepth;
    const levels = input.levels ?? version.levels;
    const nodes = input.nodes ?? version.nodes;
    const result = planBaseChartVersionContent({
      maxDepth,
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
    version.maxDepth = maxDepth;
    version.levels = levels.map((row) => ({
      id: row.id,
      versionId: version.id,
      levelIndex: row.levelIndex,
      digitLength: row.digitLength,
      defaultIsPostable: row.defaultIsPostable,
    }));
    version.nodes = nodes.map((row) => ({
      id: row.id,
      versionId: version.id,
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
    }));
    version.updatedAt = input.updatedAt;
    return version;
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
    const version = this.versions.find((row) => row.id === input.versionId);
    if (version === undefined) return null;
    const targets: Record<string, BaseChartVersionStatus> = {
      approve: 'approved',
      publish: 'published',
      supersede: 'superseded',
    };
    const legal: Record<string, BaseChartVersionStatus> = {
      approve: 'draft',
      publish: 'approved',
      supersede: 'published',
    };
    if (version.status !== legal[input.transition]) {
      throw new BaseChartVersionStatusError(version.status, input.transition);
    }
    const supersededVersionIds: string[] = [];
    if (input.transition === 'publish') {
      // Publish re-validates the stored content under the template-wide lock.
      const result = planBaseChartVersionContent({
        maxDepth: version.maxDepth,
        levels: version.levels,
        nodes: version.nodes,
      });
      if (result.plan.problem !== null) {
        throw new BaseChartContentRejectedError(
          result.plan.problem,
          result.plan.subject,
        );
      }
      for (const other of this.versions) {
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
    version.status = targets[input.transition]!;
    if (input.transition === 'approve') version.approvedAt = input.now;
    if (input.transition === 'publish') version.publishedAt = input.now;
    if (input.transition === 'supersede') {
      version.supersededAt = input.now;
      version.supersededByVersionId = input.supersededByVersionId ?? null;
    }
    version.updatedAt = input.now;
    return {
      templateId: version.templateId,
      version,
      supersededVersionIds,
    };
  }

  private buildDraftVersion(input: {
    versionId: string;
    templateId: string;
    versionNumber: number;
    maxDepth: number;
    levels: readonly {
      id: string;
      levelIndex: number;
      digitLength: number;
      defaultIsPostable: boolean;
    }[];
    nodes: readonly {
      id: string;
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
    }[];
    createdAt: Date;
  }): BaseChartTemplateVersion {
    return {
      id: input.versionId,
      templateId: input.templateId,
      versionNumber: input.versionNumber,
      status: 'draft',
      maxDepth: input.maxDepth,
      approvedAt: null,
      publishedAt: null,
      supersededAt: null,
      supersededByVersionId: null,
      levels: input.levels.map((row) => ({
        ...row,
        versionId: input.versionId,
      })),
      nodes: input.nodes.map((row) => ({ ...row, versionId: input.versionId })),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
  }
}

interface Fixture {
  service: BaseChartTemplatesService;
  repo: TemplatesRepositoryFake;
}

function buildFixture(): Fixture {
  const repo = new TemplatesRepositoryFake();
  const service = new BaseChartTemplatesService(
    repo as unknown as BaseChartTemplatesRepository,
    loggerStub(),
    new DomainEventBus(),
  );
  return { service, repo };
}

async function createPublished(
  fixture: Fixture,
  nodes: readonly BaseChartNodeInput[] = NODES,
): Promise<{ templateId: string; versionId: string }> {
  const detail = await asActor(ACTOR, () =>
    fixture.service.createTemplate({
      code: 'STD',
      title: 'Standard chart',
      maxDepth: 2,
      levels: LEVELS,
      nodes,
    }),
  );
  const versionId = detail.versions[0]!.id;
  await asActor(ACTOR, () => fixture.service.approve(versionId));
  await asActor(ACTOR, () => fixture.service.publish(versionId));
  return { templateId: detail.template.id, versionId };
}

describe('BaseChartTemplatesService — lifecycle and drafting (Task 23)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = buildFixture();
  });

  it('creates a template with version 1 as a DRAFT carrying the full authored content', async () => {
    const detail = await asActor(ACTOR, () =>
      fixture.service.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    expect(detail.template.code).toBe('STD');
    expect(detail.versions).toHaveLength(1);
    const version = detail.versions[0]!;
    expect(version.status).toBe('draft');
    expect(version.versionNumber).toBe(1);
    expect(version.levels).toHaveLength(2);
    expect(version.nodes).toHaveLength(2);
    const child = version.nodes.find((node) => node.nodeKey === 'L1')!;
    expect(child.level).toBe(2);
    // defaultIsPostable came from the node's own LEVEL default (false at 1, true at 2).
    const root = version.nodes.find((node) => node.nodeKey === 'G1')!;
    expect(root.isPostable).toBe(false);
    expect(child.isPostable).toBe(true);
  });

  it('refuses a duplicate template code with 409', async () => {
    await asActor(ACTOR, () =>
      fixture.service.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.service.createTemplate({
          code: 'STD',
          title: 'Another chart',
          maxDepth: 2,
          levels: LEVELS,
          nodes: NODES,
        }),
      ),
    );
    expect(result.code).toBe('Conflict');
  });

  it('refuses authoring content that violates the shape rules (422, no rows stored)', async () => {
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.service.createTemplate({
          code: 'BAD',
          title: 'Broken chart',
          maxDepth: 2,
          levels: LEVELS,
          nodes: [
            ...NODES,
            {
              nodeKey: 'ORPHAN',
              parentNodeKey: 'MISSING',
              code: '10002',
              title: 'Orphan',
              accountNature: 'debit',
              isMandatory: false,
              defaultIsActive: true,
            },
          ],
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details['problem']).toBe('node_parent_unknown');
    expect(fixture.repo.templates).toHaveLength(0);
  });

  it('moves draft → approved → published and stamps the lifecycle dates', async () => {
    const detail = await asActor(ACTOR, () =>
      fixture.service.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    const versionId = detail.versions[0]!.id;
    const approved = await asActor(ACTOR, () =>
      fixture.service.approve(versionId),
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).not.toBeNull();
    const published = await asActor(ACTOR, () =>
      fixture.service.publish(versionId),
    );
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();
  });

  it('refuses illegal transitions (422 typed): approve on approved, publish on draft, supersede on approved, edit on approved', async () => {
    const detail = await asActor(ACTOR, () =>
      fixture.service.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    const versionId = detail.versions[0]!.id;
    expect(
      (await failure(asActor(ACTOR, () => fixture.service.publish(versionId))))
        .code,
    ).toBe('BusinessRuleViolation');
    await asActor(ACTOR, () => fixture.service.approve(versionId));
    expect(
      (await failure(asActor(ACTOR, () => fixture.service.approve(versionId))))
        .code,
    ).toBe('BusinessRuleViolation');
    expect(
      (
        await failure(
          asActor(ACTOR, () => fixture.service.supersede(versionId)),
        )
      ).code,
    ).toBe('BusinessRuleViolation');
    const editAfterApprove = await failure(
      asActor(ACTOR, () =>
        fixture.service.updateVersionContent(versionId, { maxDepth: 2 }),
      ),
    );
    expect(editAfterApprove.code).toBe('BusinessRuleViolation');
  });

  it('allowances editing draft content and replays the planner on the RESULTING shape', async () => {
    const detail = await asActor(ACTOR, () =>
      fixture.service.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    const versionId = detail.versions[0]!.id;
    const edited = await asActor(ACTOR, () =>
      fixture.service.updateVersionContent(versionId, {
        nodes: [
          ...NODES,
          {
            nodeKey: 'L2',
            parentNodeKey: 'G1',
            code: '10002',
            title: 'Bank',
            accountNature: 'debit',
            isMandatory: false,
            defaultIsActive: true,
          },
        ],
      }),
    );
    expect(edited.nodes).toHaveLength(3);
    // Depth changes are refused when the stored shape cannot fit.
    const tooShallow = await failure(
      asActor(ACTOR, () =>
        fixture.service.updateVersionContent(versionId, { maxDepth: 1 }),
      ),
    );
    expect(tooShallow.code).toBe('BusinessRuleViolation');
  });

  it('publish supersedes the previously published version with supersededByVersionId pointing at the winner', async () => {
    const first = await createPublished(fixture);
    const second = await asActor(ACTOR, () =>
      fixture.service.createVersion({
        templateId: first.templateId,
        maxDepth: 2,
        levels: LEVELS,
        nodes: [...NODES],
      }),
    );
    expect(second.versionNumber).toBe(2);
    await asActor(ACTOR, () => fixture.service.approve(second.id));
    const published = await asActor(ACTOR, () =>
      fixture.service.publish(second.id),
    );
    expect(published.status).toBe('published');
    const old = await fixture.service.getVersion(first.versionId);
    expect(old.status).toBe('superseded');
    expect(old.supersededByVersionId).toBe(second.id);
  });

  it('assigns version numbers server-side and retries the ordinal race (never client input)', async () => {
    const first = await createPublished(fixture);
    fixture.repo.simulateOrdinalCollisionOnce = true;
    const second = await asActor(ACTOR, () =>
      fixture.service.createVersion({
        templateId: first.templateId,
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    expect(second.versionNumber).toBe(2);
  });

  it('a standalone supersede retires a published version and records the replacement', async () => {
    const first = await createPublished(fixture);
    const next = await asActor(ACTOR, () =>
      fixture.service.createVersion({
        templateId: first.templateId,
        maxDepth: 2,
        levels: LEVELS,
        nodes: NODES,
      }),
    );
    // NOT a version of the same template → 422.
    const foreign = await failure(
      asActor(ACTOR, () =>
        fixture.service.supersede(
          first.versionId,
          '01SOMETHINGELSE000000000000',
        ),
      ),
    );
    expect(foreign.code).toBe('BusinessRuleViolation');
    const retired = await asActor(ACTOR, () =>
      fixture.service.supersede(first.versionId, next.id),
    );
    expect(retired.status).toBe('superseded');
    expect(retired.supersededByVersionId).toBe(next.id);
    // Mutual supersession of a version by itself is refused.
    const selfSupersede = await failure(
      asActor(ACTOR, () => fixture.service.supersede(next.id, next.id)),
    );
    expect(selfSupersede.code).toBe('BusinessRuleViolation');
  });

  it('answers 404 for unknown template/version ids and stays read-only on lookups', async () => {
    expect(
      (await failure(fixture.service.getTemplate('01UNKNOWN00000000000000000')))
        .code,
    ).toBe('EntityNotFound');
    expect(
      (await failure(fixture.service.getVersion('01UNKNOWN00000000000000000')))
        .code,
    ).toBe('EntityNotFound');
    const listed = await fixture.service.listTemplates({
      page: 1,
      pageSize: 10,
    });
    expect(listed.items).toHaveLength(0);
  });

  it('rename is always allowed and trims the title (master-data convention)', async () => {
    const first = await createPublished(fixture);
    const renamed = await asActor(ACTOR, () =>
      fixture.service.renameTemplate(first.templateId, '  Standard chart v2  '),
    );
    expect(renamed.title).toBe('Standard chart v2');
    const empty = await failure(
      asActor(ACTOR, () =>
        fixture.service.renameTemplate(first.templateId, '   '),
      ),
    );
    expect(empty.code).toBe('BadRequest');
  });
});
