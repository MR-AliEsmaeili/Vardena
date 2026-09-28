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
  type StructureStores,
} from '../../../../test/support/accounting-structure-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { CodingStructuresService } from './coding-structures.service.js';
import { AccountingConfigurationsService } from './accounting-configurations.service.js';
import { AccountsService } from './accounts.service.js';
import { ChartTreeService } from './chart-tree.service.js';
import { AccountingDocumentLinesRepository } from '../data/accounting-document-lines.repository.js';
import {
  ACCOUNTING_PERMISSION_DEFINITIONS,
  ACCOUNT_PERMISSIONS,
} from '../domain/accounting-permissions.js';

/**
 * ODR-2 (Task 19, Slice 2) — the Accounting-owned Chart Tree read surface.
 *
 * What this proves: the surface is READ-ONLY over the account master (same
 * repository as the administration surface — no second master, no figures),
 * the order is FIXED code-ascending (an explicit sort is a 400), inactive
 * nodes stay in the tree, paging is bounded, single-node reads keep the 404
 * isolation posture for foreign ids, and the organization scope is the ODR-3
 * chokepoint: permission alone does not cross organizations — a principal
 * without membership answers 404 exactly like an unknown organization.
 */

const ACTOR = '01ACTOR000000000000000000A';
const OUTSIDER = '01OUTSIDER0000000000000000B';

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

interface Fixture {
  organizations: OrganizationsService;
  structures: CodingStructuresService;
  configurations: AccountingConfigurationsService;
  accounts: AccountsService;
  chartTree: ChartTreeService;
  stores: StructureStores;
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
  member: (userId: string, organizationId: string) => void;
}

async function buildFixture(
  config: AppConfig = UNPINNED_APP_CONFIG,
): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const stores = createStructureStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  void events;

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
    config,
  );
  const structures = new CodingStructuresService(
    stores.structures,
    organizations,
    authorization,
    loggerStub(),
  );
  const configurations = new AccountingConfigurationsService(
    stores.configurations,
    organizations,
    authorization,
    loggerStub(),
  );
  const documentLines = {
    countForAccount: async () => 0,
  } as unknown as AccountingDocumentLinesRepository;
  const accounts = new AccountsService(
    stores.accounts,
    documentLines,
    structures,
    configurations,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const chartTree = new ChartTreeService(
    stores.accounts,
    organizations,
    authorization,
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
    if (permissionIds.length !== new Set(codes).size) {
      throw new Error(
        `Unknown permission code in grant(): ${codes.join(', ')}`,
      );
    }
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

  return {
    organizations,
    structures,
    configurations,
    accounts,
    chartTree,
    stores,
    grant,
    member: (userId, organizationId) => {
      masterStores.raw.memberships.seed(userId, organizationId);
    },
  };
}

function asSystem<R>(fn: () => Promise<R>): Promise<R> {
  return fn();
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

describe('ChartTreeService — ODR-2 Accounting-owned Chart Tree read surface', () => {
  let fixture: Fixture;
  let org: string;
  let otherOrg: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    org = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORGA',
          name: 'Org A',
        }),
      )
    ).id;
    otherOrg = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORGB',
          name: 'Org B',
        }),
      )
    ).id;
    fixture.member(ACTOR, org);
    await fixture.grant(ACTOR, [
      'Accounting.CodingStructure.View',
      'Accounting.CodingStructure.Configure',
      'Accounting.AccountingConfiguration.View',
      'Accounting.AccountingConfiguration.Configure',
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);

    // Publish a coherent pair (ODR-1) and build a small chart, deliberately
    // created out of code order.
    const publish = async (
      service: 'coding' | 'config',
      code: string,
    ): Promise<string> => {
      if (service === 'coding') {
        const created = await asActor(ACTOR, () =>
          fixture.structures.createVersion({
            organizationId: org,
            code,
            maxDepth: TWO_LEVELS.length,
            levels: TWO_LEVELS as never,
          }),
        );
        await asActor(ACTOR, () =>
          fixture.structures.publishVersion(org, created.id),
        );
        return created.id;
      }
      const created = await asActor(ACTOR, () =>
        fixture.configurations.createConfiguration({
          organizationId: org,
          code,
          name: code,
          levels: TWO_LEVELS.map((level) => ({
            levelIndex: level.levelIndex,
            title: level.title,
            digitLength: level.digitLength,
            defaultIsPostable: level.defaultIsPostable,
            levelKind: level.levelKind ?? null,
          })),
        }),
      );
      await asActor(ACTOR, () =>
        fixture.configurations.publishConfiguration(org, created.id),
      );
      return created.id;
    };
    await publish('coding', 'DEFAULT');
    await publish('config', 'DEFAULT');

    await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '20',
        title: 'Receivables',
        accountNature: 'debit',
      }),
    );
    const cash = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10',
        title: 'Cash',
        accountNature: 'debit',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10101',
        title: 'Cash — bank',
        accountNature: 'debit',
        parentId: cash.id,
      }),
    );
  });

  it('lists the chart in the FIXED code-ascending order, flat, with hierarchy fields', async () => {
    const result = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 100 }),
    );
    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.code)).toEqual([
      '10',
      '10101',
      '20',
    ]);
    const bank = result.items.find((item) => item.code === '10101')!;
    expect(bank).toMatchObject({
      parentId: expect.any(String),
      level: 2,
      isPostable: true,
      isActive: true,
      accountNature: 'debit',
      title: 'Cash — bank',
      codingStructureVersionId: expect.any(String),
      accountingConfigurationId: expect.any(String),
    });
    const root = result.items.find((item) => item.code === '10')!;
    expect(root.parentId).toBeNull();
    expect(root.level).toBe(1);
    expect(root.isPostable).toBe(false);
  });

  it('keeps disabled (inactive) nodes in the tree — accounts are never deleted', async () => {
    const before = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 100 }),
    );
    const bank = before.items.find((item) => item.code === '10101')!;
    await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(org, bank.id, { isPostable: false }),
    );
    await asActor(ACTOR, () => fixture.accounts.disableAccount(org, bank.id));

    const after = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 100 }),
    );
    expect(after.total).toBe(3);
    expect(after.items.find((item) => item.code === '10101')).toMatchObject({
      isActive: false,
      isPostable: false,
    });
  });

  it('bounds pagination and reports the full total', async () => {
    const page = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 2, pageSize: 2 }),
    );
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items.map((item) => item.code)).toEqual(['20']);
  });

  it('rejects an explicit sort — the order is part of the contract, not a choice', async () => {
    const result = await failure(
      asActor(ACTOR, () =>
        fixture.chartTree.list({
          organizationId: org,
          page: 1,
          pageSize: 100,
          sort: 'code:desc',
        }),
      ),
    );
    expect(result.code).toBe('BadRequest');
  });

  it('reads one node, and answers 404 for foreign and unknown account ids', async () => {
    const listed = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 100 }),
    );
    const bank = listed.items.find((item) => item.code === '10101')!;
    const one = await asActor(ACTOR, () => fixture.chartTree.get(org, bank.id));
    expect(one.code).toBe('10101');

    // An account of ANOTHER organization: 404, indistinguishable from
    // unknown — never a leak that the id exists elsewhere.
    // A row of ANOTHER organization, seeded directly (the foreign org has
    // no configuration published; the read under test must not care).
    const foreign = {
      id: '01FOREIGN0000000000000000X',
      organizationId: otherOrg,
      code: '10',
      title: 'Foreign chart',
      parentId: null,
      level: 1,
      codingStructureVersionId: null,
      accountingConfigurationId: null,
      accountNature: 'debit',
      accountType: 'BALANCE_SHEET',
      detailGroupId: null,
      isPostable: false,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      createdBy: null,
      updatedBy: null,
    };
    fixture.stores.raw.state.accounts.insert(foreign);
    expect(
      (
        await failure(
          asActor(ACTOR, () => fixture.chartTree.get(org, foreign.id)),
        )
      ).code,
    ).toBe('EntityNotFound');
    expect(
      (
        await failure(
          asActor(ACTOR, () =>
            fixture.chartTree.get(org, '01UNKNOWN0000000000000000X'),
          ),
        )
      ).code,
    ).toBe('EntityNotFound');
  });

  it('ODR-3: permission alone does not cross organizations — a non-member answers 404', async () => {
    // OUTSIDER holds the SAME accounting permission but no membership in org.
    fixture.member(OUTSIDER, otherOrg);
    await fixture.grant(OUTSIDER, [ACCOUNT_PERMISSIONS.VIEW]);

    const denied = await failure(
      asActor(OUTSIDER, () =>
        fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 10 }),
      ),
    );
    expect(denied.code).toBe('EntityNotFound');

    // The unknown-organization posture is identical.
    expect(
      (
        await failure(
          asActor(OUTSIDER, () =>
            fixture.chartTree.list({
              organizationId: '01UNKNOWN0000000000000000X',
              page: 1,
              pageSize: 10,
            }),
          ),
        )
      ).code,
    ).toBe('EntityNotFound');

    // A member still reads the same organization.
    const allowed = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 10 }),
    );
    expect(allowed.total).toBe(3);
  });

  it('ODR-3 + lifecycle: a disabled organization answers 422, and a missing permission 403', async () => {
    await asSystem(() => fixture.organizations.disableOrganization(org));

    const disabled = await failure(
      asActor(ACTOR, () =>
        fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 10 }),
      ),
    );
    expect(disabled.code).toBe('BusinessRuleViolation');

    fixture.member(OUTSIDER, org);
    await fixture.grant(OUTSIDER, []);
    const forbidden = await failure(
      asActor(OUTSIDER, () =>
        fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 10 }),
      ),
    );
    expect(forbidden.code).toBe('PermissionDenied');
  });

  it('exposes no financial figures and no mutation verb (structural read-only)', async () => {
    // The surface contract: only list/get exist on the service, and the node
    // DTO carries no balance/turnover field. Both are structural — this test
    // pins them so a regression is a deliberate contract change, not drift.
    const surface = Object.getOwnPropertyNames(
      ChartTreeService.prototype,
    ).filter((name) => name !== 'constructor');
    expect(surface.sort()).toEqual(['get', 'list']);
    const result = await asActor(ACTOR, () =>
      fixture.chartTree.list({ organizationId: org, page: 1, pageSize: 100 }),
    );
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'accountNature',
        'accountType',
        'accountingConfigurationId',
        'code',
        'codingStructureVersionId',
        'createdAt',
        'detailGroupId',
        'id',
        'isActive',
        'isPostable',
        'level',
        'organizationId',
        'parentId',
        'title',
        'updatedAt',
      ]);
    }
  });
});
