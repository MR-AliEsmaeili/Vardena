import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import {
  createStructureStores,
  type StructureState,
  type StructureStores,
} from '../../../../test/support/accounting-structure-repositories.js';
import {
  createBaseChartState,
  InMemoryBaseChartAdoptionsRepository,
  InMemoryBaseChartTemplatesRepository,
  type BaseChartState,
} from '../../../../test/support/base-chart-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { CodingStructuresService } from './coding-structures.service.js';
import { AccountingConfigurationsService } from './accounting-configurations.service.js';
import { AccountsService } from './accounts.service.js';
import { AccountingDocumentLinesRepository } from '../data/accounting-document-lines.repository.js';
import { BaseChartTemplatesRepository } from '../data/base-chart-templates.repository.js';
import { BaseChartAdoptionsRepository } from '../data/base-chart-adoptions.repository.js';
import type {
  BaseChartLevelInput,
  BaseChartNodeInput,
} from '../domain/base-chart-template.js';
import { ACCOUNTING_PERMISSION_DEFINITIONS } from '../domain/accounting-permissions.js';
import { ACCOUNT_CREATED_EVENT } from '../domain/accounting.events.js';
import { BaseChartTemplatesService } from './base-chart-templates.service.js';
import { BaseChartAdoptionsService } from './base-chart-adoptions.service.js';

/**
 * Task 23 — explicit Base Chart adoption, application layer.
 *
 * What this proves: adoption is a SNAPSHOT COPY that materializes ordinary
 * organization accounts (pins bound to the organization's ACTIVE coherent
 * pair, topological parents-first insertion, leaf-only postability
 * re-derived — OD-20-5), the full/partial adoption boundary set is the
 * selection ∪ ALL ancestors ∪ ALL mandatory nodes, refusals are the spec's
 * typed postures (404 scope, 422 not-published/incompatible/bad-selection,
 * 409 chart-not-empty/duplicate — never silent, never partial), preview
 * (R8) is read-only with a deterministic verdict, post-adoption accounts
 * are the organization's OWN (editable), and every created account emits
 * the EXISTING `Account.Created` event with the identical payload shape.
 */

const ACTOR = '01ACTOR000000000000000000A';

const TWO_LEVELS = [
  { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
  {
    levelIndex: 2,
    title: 'Subsidiary',
    digitLength: 3,
    defaultIsPostable: true,
    levelKind: 'subsidiary',
  },
];

const TEMPLATE_LEVELS: readonly BaseChartLevelInput[] = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
  { levelIndex: 2, digitLength: 3, defaultIsPostable: true },
];

const TEMPLATE_NODES: readonly BaseChartNodeInput[] = [
  {
    nodeKey: 'A',
    parentNodeKey: null,
    code: '10',
    title: 'Assets',
    accountNature: 'DEBIT',
    isMandatory: false,
    defaultIsActive: true,
  },
  {
    nodeKey: 'A1',
    parentNodeKey: 'A',
    code: '10001',
    title: 'Cash',
    accountNature: 'DEBIT',
    isMandatory: false,
    defaultIsActive: true,
  },
  {
    nodeKey: 'B',
    parentNodeKey: null,
    code: '20',
    title: 'Liabilities',
    accountNature: 'CREDIT',
    isMandatory: true,
    defaultIsActive: true,
  },
  {
    nodeKey: 'B1',
    parentNodeKey: 'B',
    code: '20002',
    title: 'Payables',
    accountNature: 'CREDIT',
    isMandatory: false,
    defaultIsActive: false,
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
    { correlationId: 'corr-adopt', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

interface Fixture {
  organizations: OrganizationsService;
  structures: CodingStructuresService;
  configurations: AccountingConfigurationsService;
  accounts: AccountsService;
  templates: BaseChartTemplatesService;
  adoptions: BaseChartAdoptionsService;
  structure: StructureStores;
  structureState: StructureState;
  baseChart: BaseChartState;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
  member: (userId: string, organizationId: string) => void;
}

async function buildFixture(): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const structure = createStructureStores();
  const structureState = structure.raw.state;
  const baseChart = createBaseChartState();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  bus.on(ACCOUNT_CREATED_EVENT, (event) => {
    events.push(event);
  });

  await rbacStores.raw.permissions.syncDefinitions(
    [...ACCOUNTING_PERMISSION_DEFINITIONS],
    new Date(),
  );

  const authorization = new AuthorizationService(
    rbacStores.userRoles,
    loggerStub(),
  );
  const organizations = new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
  );
  const structures = new CodingStructuresService(
    structure.structures,
    organizations,
    authorization,
    loggerStub(),
  );
  const configurations = new AccountingConfigurationsService(
    structure.configurations,
    organizations,
    authorization,
    loggerStub(),
  );
  const documentLines = {
    countForAccount: async () => 0,
  } as unknown as AccountingDocumentLinesRepository;
  const accounts = new AccountsService(
    structure.accounts,
    documentLines,
    structures,
    configurations,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const templatesRepo = new InMemoryBaseChartTemplatesRepository(baseChart);
  const adoptionsRepo = new InMemoryBaseChartAdoptionsRepository(
    baseChart,
    structureState,
  );
  const templates = new BaseChartTemplatesService(
    templatesRepo as unknown as BaseChartTemplatesRepository,
    loggerStub(),
    bus,
  );
  const adoptions = new BaseChartAdoptionsService(
    adoptionsRepo as unknown as BaseChartAdoptionsRepository,
    templatesRepo as unknown as BaseChartTemplatesRepository,
    structures,
    configurations,
    organizations,
    loggerStub(),
    bus,
  );

  let roleSeq = 0;
  async function grant(
    userId: string,
    codes: readonly string[],
  ): Promise<void> {
    const now = new Date();
    await seedUser(rbacStores, { id: userId });
    const permissionIds = (
      await rbacStores.raw.permissions.findByCodes(codes)
    ).map((permission) => permission.id);
    roleSeq += 1;
    const roleId = `01ROLE${String(roleSeq).padStart(20, '0')}`;
    await rbacStores.raw.roles.createWithPermissions({
      id: roleId,
      name: `role-${roleSeq}`,
      description: null,
      permissionIds,
      now,
      createdBy: null,
    });
    await rbacStores.raw.userRoles.assign({
      userId,
      roleId,
      now,
      createdBy: null,
    });
  }
  function member(userId: string, organizationId: string): void {
    masterStores.raw.memberships.seed(userId, organizationId);
  }

  return {
    organizations,
    structures,
    configurations,
    accounts,
    templates,
    adoptions,
    structure,
    structureState,
    baseChart,
    events,
    grant,
    member,
  };
}

async function createPublishedTemplate(
  fixture: Fixture,
  nodes: readonly BaseChartNodeInput[] = TEMPLATE_NODES,
  levels: readonly BaseChartLevelInput[] = TEMPLATE_LEVELS,
  maxDepth = 2,
  code = 'STD',
): Promise<{ templateId: string; versionId: string }> {
  const detail = await asActor(ACTOR, () =>
    fixture.templates.createTemplate({
      code,
      title: 'Standard chart',
      maxDepth,
      levels,
      nodes,
    }),
  );
  const versionId = detail.versions[0]!.id;
  await asActor(ACTOR, () => fixture.templates.approve(versionId));
  await asActor(ACTOR, () => fixture.templates.publish(versionId));
  return { templateId: detail.template.id, versionId };
}

describe('BaseChartAdoptionsService — explicit adoption (Task 23)', () => {
  let fixture: Fixture;
  let org: string;
  let otherOrg: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    org = (
      await fixture.organizations.createOrganization({
        code: 'ORGA',
        name: 'Org A',
      })
    ).id;
    otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORGB',
        name: 'Org B',
      })
    ).id;
    fixture.member(ACTOR, org);
    fixture.member(ACTOR, otherOrg);
    await fixture.grant(ACTOR, [
      'Accounting.CodingStructure.View',
      'Accounting.CodingStructure.Configure',
      'Accounting.AccountingConfiguration.View',
      'Accounting.AccountingConfiguration.Configure',
      'Accounting.Account.View',
      'Accounting.Account.Create',
      'Accounting.Account.Edit',
      'Accounting.BaseChart.View',
      'Accounting.BaseChart.Configure',
      'Accounting.BaseChart.Adopt',
    ]);

    // Publish the coherent ACTIVE pair (ODR-1): the adoption binds to it.
    const structure = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: org,
        code: 'DEFAULT',
        maxDepth: TWO_LEVELS.length,
        levels: TWO_LEVELS as never,
      }),
    );
    await asActor(ACTOR, () =>
      fixture.structures.publishVersion(org, structure.id),
    );
    const config = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: org,
        code: 'DEFAULT',
        name: 'Default',
        levels: TWO_LEVELS.map((level) => ({
          levelIndex: level.levelIndex,
          title: level.title,
          digitLength: level.digitLength,
          defaultIsPostable: level.defaultIsPostable,
          levelKind: level.levelKind,
        })),
      }),
    );
    await asActor(ACTOR, () =>
      fixture.configurations.publishConfiguration(org, config.id),
    );
    // otherOrg stays deliberately WITHOUT an active pair.
  });

  it('adopts a published version: ordinary accounts, pins bound to the ACTIVE pair, leaf-only postability re-derived, one immutable adoption record', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const dto = await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
      }),
    );
    expect(dto.accountCount).toBe(4);
    expect(dto.organizationId).toBe(org);
    expect(dto.templateVersionId).toBe(versionId);
    expect(dto.adoptedBy).toBe(ACTOR);

    const accounts = fixture.structureState.accounts.findMany(
      (row) => row.organizationId === org,
    );
    expect(accounts).toHaveLength(4);
    const byCode = new Map(accounts.map((row) => [row.code, row]));
    const root = byCode.get('10')!;
    const child = byCode.get('10001')!;
    expect(child.parentId).toBe(root.id);
    // OD-20-5: non-leaf never postable, leaf takes the authored default.
    expect(root.isPostable).toBe(false);
    expect(child.isPostable).toBe(true);
    // defaultIsActive carried; pins bound to the ACTIVE configuration pair.
    expect(byCode.get('20002')!.isActive).toBe(false);
    const activeConfig =
      await fixture.configurations.requireActiveConfigurationOrThrow(org);
    const activeVersion =
      await fixture.structures.requireActiveVersionOrThrow(org);
    expect(root.accountingConfigurationId).toBe(activeConfig.id);
    expect(root.codingStructureVersionId).toBe(activeVersion.id);
    // Ordinary accounts: editable afterwards (the organization's own chart).
    const renamed = await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(org, root.id, {
        title: 'Assets (renamed)',
      }),
    );
    expect(renamed.title).toBe('Assets (renamed)');
  });

  it('emits the EXISTING Account.Created event per adopted account (no invented vocabulary)', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    fixture.events.length = 0;
    await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
      }),
    );
    const created = fixture.events.filter(
      (event) => event.type === ACCOUNT_CREATED_EVENT,
    );
    expect(created).toHaveLength(4);
    for (const event of created) {
      const payload = event.payload as Record<string, unknown>;
      expect(payload['organizationId']).toBe(org);
      expect(typeof payload['code']).toBe('string');
      expect(payload['accountingConfigurationId']).toBeTruthy();
      expect(payload['codingStructureVersionId']).toBeTruthy();
    }
  });

  it('partial adoption: final set = selection ∪ ALL ancestors ∪ ALL mandatory (mandatory applies even when not selected)', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const dto = await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
        selectedNodeKeys: ['A1'],
      }),
    );
    // A1 selected → ancestor A; B mandatory → B1 is NOT included (only the
    // mandatory NODE itself plus its ancestors — descendants are opt-in).
    expect(dto.accountCount).toBe(3);
    const codes = fixture.structureState.accounts
      .findMany((row) => row.organizationId === org)
      .map((row) => row.code)
      .sort();
    expect(codes).toEqual(['10', '10001', '20']);
  });

  it('refuses an unknown selection key with 422 typed', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: versionId,
          selectedNodeKeys: ['A1', 'NOPE'],
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details['problem']).toBe('unknown_node_key');
    expect(result.details['subject']).toBe('NOPE');
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === org,
      ),
    ).toHaveLength(0);
  });

  it('repeated adoption of the same version is a deterministic 409 — never a duplicate chart, never a silent no-op', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
      }),
    );
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: versionId,
        }),
      ),
    );
    expect(result.code).toBe('Conflict');
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === org,
      ),
    ).toHaveLength(4);
  });

  it('refuses adoption into a non-empty chart (409 — no merge/overwrite semantics), including partial collisions', async () => {
    await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '30',
        title: 'Equity',
        accountNature: 'CREDIT',
      }),
    );
    const { versionId } = await createPublishedTemplate(fixture);
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: versionId,
          selectedNodeKeys: ['A1'],
        }),
      ),
    );
    expect(result.code).toBe('Conflict');
    // The manually created account is untouched.
    const codes = fixture.structureState.accounts
      .findMany((row) => row.organizationId === org)
      .map((row) => row.code);
    expect(codes).toEqual(['30']);
  });

  it('refuses to adopt a non-published version (422 one-way)', async () => {
    const detail = await asActor(ACTOR, () =>
      fixture.templates.createTemplate({
        code: 'STD',
        title: 'Standard chart',
        maxDepth: 2,
        levels: TEMPLATE_LEVELS,
        nodes: TEMPLATE_NODES,
      }),
    );
    const draftId = detail.versions[0]!.id;
    const asDraft = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: draftId,
        }),
      ),
    );
    expect(asDraft.code).toBe('BusinessRuleViolation');
    await asActor(ACTOR, () => fixture.templates.approve(draftId));
    const asApproved = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: draftId,
        }),
      ),
    );
    expect(asApproved.code).toBe('BusinessRuleViolation');
    // Superseded is likewise not adoptable.
    const { versionId } = await createPublishedTemplate(
      fixture,
      TEMPLATE_NODES,
      TEMPLATE_LEVELS,
      2,
      'STD-2',
    );
    await asActor(ACTOR, () => fixture.templates.supersede(versionId, null));
    const asSuperseded = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: versionId,
        }),
      ),
    );
    expect(asSuperseded.code).toBe('BusinessRuleViolation');
  });

  it('refuses an incompatible template shape with 422 typed + the refusal problem', async () => {
    // digit mismatch: template declares 2+2 where the organization runs 2+3.
    const { versionId } = await createPublishedTemplate(
      fixture,
      [
        TEMPLATE_NODES[0]!,
        {
          nodeKey: 'A1',
          parentNodeKey: 'A',
          code: '1001',
          title: 'Cash',
          accountNature: 'DEBIT',
          isMandatory: false,
          defaultIsActive: true,
        },
        {
          nodeKey: 'B',
          parentNodeKey: null,
          code: '20',
          title: 'Liabilities',
          accountNature: 'CREDIT',
          isMandatory: false,
          defaultIsActive: true,
        },
        {
          nodeKey: 'B1',
          parentNodeKey: 'B',
          code: '2099',
          title: 'Payables',
          accountNature: 'CREDIT',
          isMandatory: false,
          defaultIsActive: true,
        },
      ],
      [
        { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
        { levelIndex: 2, digitLength: 2, defaultIsPostable: true },
      ],
    );
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: versionId,
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details['problem']).toBe('digit_length_mismatch');
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === org,
      ),
    ).toHaveLength(0);
  });

  it('refuses when the organization has no active pinned pair (422, adopt) / verdict (preview)', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: otherOrg,
          templateVersionId: versionId,
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    const preview = await asActor(ACTOR, () =>
      fixture.adoptions.preview({
        organizationId: otherOrg,
        templateVersionId: versionId,
      }),
    );
    expect(preview.verdict).toBe('incompatible');
    expect(preview.problem).toBe('configuration_missing');
  });

  it('preview (R8): deterministic verdict, the FINAL adoption set, never writes anything', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const compatible = await asActor(ACTOR, () =>
      fixture.adoptions.preview({
        organizationId: org,
        templateVersionId: versionId,
        selectedNodeKeys: ['A1'],
      }),
    );
    expect(compatible.verdict).toBe('compatible');
    expect(compatible.finalNodeCount).toBe(3);
    expect(compatible.finalSet.map((node) => node.nodeKey)).toEqual([
      'A',
      'B',
      'A1',
    ]);
    // Read-only by construction.
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === org,
      ),
    ).toHaveLength(0);
    expect(
      fixture.baseChart.adoptions.filter((row) => row.organizationId === org),
    ).toHaveLength(0);

    const draft = await fixture.templates.createTemplate({
      code: 'DRAFT',
      title: 'Draft chart',
      maxDepth: 2,
      levels: TEMPLATE_LEVELS,
      nodes: TEMPLATE_NODES,
    });
    const notPublished = await asActor(ACTOR, () =>
      fixture.adoptions.preview({
        organizationId: org,
        templateVersionId: draft.versions[0]!.id,
      }),
    );
    expect(notPublished.verdict).toBe('incompatible');
    expect(notPublished.problem).toBe('version_not_published');
  });

  it('organizations adopt INDEPENDENTLY — each organization adopts the same published version exactly once (OD-20-2)', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
      }),
    );
    // Publish a coherent pair for otherOrg and it adopts too.
    const structure = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: otherOrg,
        code: 'DEFAULT',
        maxDepth: TWO_LEVELS.length,
        levels: TWO_LEVELS as never,
      }),
    );
    await asActor(ACTOR, () =>
      fixture.structures.publishVersion(otherOrg, structure.id),
    );
    const config = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: otherOrg,
        code: 'DEFAULT',
        name: 'Default',
        levels: TWO_LEVELS.map((level) => ({
          levelIndex: level.levelIndex,
          title: level.title,
          digitLength: level.digitLength,
          defaultIsPostable: level.defaultIsPostable,
          levelKind: level.levelKind,
        })),
      }),
    );
    await asActor(ACTOR, () =>
      fixture.configurations.publishConfiguration(otherOrg, config.id),
    );
    await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: otherOrg,
        templateVersionId: versionId,
      }),
    );
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === org,
      ),
    ).toHaveLength(4);
    expect(
      fixture.structureState.accounts.findMany(
        (row) => row.organizationId === otherOrg,
      ),
    ).toHaveLength(4);
    // The accounts share codes but have DIFFERENT ids and organizations.
    const a = fixture.structureState.accounts.findMany(
      (row) => row.organizationId === org && row.code === '10',
    )[0]!;
    const b = fixture.structureState.accounts.findMany(
      (row) => row.organizationId === otherOrg && row.code === '10',
    )[0]!;
    expect(a.id).not.toBe(b.id);
    expect(a.organizationId).not.toBe(b.organizationId);
  });

  it('adoption records are tenant-scoped: list/get honor organization isolation (foreign row = 404)', async () => {
    const { versionId } = await createPublishedTemplate(fixture);
    const dto = await asActor(ACTOR, () =>
      fixture.adoptions.adopt({
        organizationId: org,
        templateVersionId: versionId,
      }),
    );
    const listed = await asActor(ACTOR, () =>
      fixture.adoptions.listAdoptions(org, 1, 10),
    );
    expect(listed.total).toBe(1);
    expect(listed.items[0]!.id).toBe(dto.id);
    const foreign = await failure(
      asActor(ACTOR, () => fixture.adoptions.getAdoption(otherOrg, dto.id)),
    );
    expect(foreign.code).toBe('EntityNotFound');
    const unknown = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.listAdoptions('01UNKNOWN00000000000000000', 1, 10),
      ),
    );
    expect(unknown.code).toBe('EntityNotFound');
  });

  it('404 for an unknown template version (map 404, never 500)', async () => {
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.adopt({
          organizationId: org,
          templateVersionId: '01UNKNOWN00000000000000000',
        }),
      ),
    );
    expect(result.code).toBe('EntityNotFound');
    const preview = await failure(
      asActor(ACTOR, () =>
        fixture.adoptions.preview({
          organizationId: org,
          templateVersionId: '01UNKNOWN00000000000000000',
        }),
      ),
    );
    expect(preview.code).toBe('EntityNotFound');
  });
});
