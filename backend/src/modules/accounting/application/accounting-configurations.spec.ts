import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
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
import { AccountingConfigurationsService } from './accounting-configurations.service.js';
import {
  ACCOUNTING_PERMISSION_DEFINITIONS,
  ACCOUNTING_CONFIGURATION_PERMISSIONS,
} from '../domain/accounting-permissions.js';

const ACTOR = '01ACTOR000000000000000000A';

const TWO_LEVELS = {
  code: 'DEFAULT',
  name: 'Main Config',
  levels: [
    { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
    {
      levelIndex: 2,
      title: 'Detail',
      digitLength: 3,
      defaultIsPostable: true,
      levelKind: 'detail',
    },
  ],
};

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function failure(promise: Promise<unknown>): Promise<{
  code: string;
  message: string;
  details: Record<string, unknown>;
}> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) throw new Error('Expected to fail');
  const exception = caught as {
    code: string;
    getResponse?: () => { message?: string; details?: unknown };
  };
  const response = exception.getResponse?.() ?? {};
  return {
    code: exception.code,
    message: response.message ?? '',
    details: (response.details ?? {}) as Record<string, unknown>,
  };
}

interface Fixture {
  organizations: OrganizationsService;
  configurations: AccountingConfigurationsService;
  stores: StructureStores;
  master: ReturnType<typeof createMasterDataStores>;
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
}

async function buildFixture(
  config: AppConfig = UNPINNED_APP_CONFIG,
): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const stores = createStructureStores();
  const bus = new DomainEventBus();

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
    authorization,
    loggerStub(),
    bus,
    config,
  );
  const configurations = new AccountingConfigurationsService(
    stores.configurations,
    organizations,
    authorization,
    loggerStub(),
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
    ).map((p) => p.id);
    if (permissionIds.length !== new Set(codes).size)
      throw new Error(`Unknown permission ${codes.join(', ')}`);
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

  return { organizations, configurations, stores, master: masterStores, grant };
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

async function publishConfiguration(
  fixture: Fixture,
  organizationId: string,
  input?: Partial<typeof TWO_LEVELS>,
): Promise<string> {
  await fixture.grant(ACTOR, [ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE]);
  const created = await asActor(ACTOR, () =>
    fixture.configurations.createConfiguration({
      organizationId,
      code: input?.code ?? TWO_LEVELS.code,
      name: input?.name ?? TWO_LEVELS.name,
      effectiveFrom: null,
      levels: (input?.levels ?? TWO_LEVELS.levels) as any,
    }),
  );
  await asActor(ACTOR, () =>
    fixture.configurations.publishConfiguration(organizationId, created.id),
  );
  return created.id;
}

describe('AccountingConfigurationsService — Task 11 foundation', () => {
  let fixture: Fixture;
  let orgA = '';
  let orgB = '';

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORGA',
          name: 'Org A',
        }),
      )
    ).id;
    orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORGB',
          name: 'Org B',
        }),
      )
    ).id;
    await fixture.grant(ACTOR, Object.values(ACCOUNTING_CONFIGURATION_PERMISSIONS));
  });

  it('drafts a version with levels and activates it on publish', async () => {
    const draft = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'DEFAULT',
        name: 'Main Config',
        effectiveFrom: null,
        levels: TWO_LEVELS.levels as any,
      }),
    );
    expect(draft.status).toBe('DRAFT');
    expect(draft.versionNumber).toBe(1);
    expect(draft.pattern).toBe('2 + 3');
    expect(draft.levels.map((l) => l.levelIndex)).toEqual([1, 2]);
    expect(draft.isOperationallyUsed).toBe(false);

    const published = await asActor(ACTOR, () =>
      fixture.configurations.publishConfiguration(orgA, draft.id),
    );
    expect(published.status).toBe('ACTIVE');
    const active = await asActor(ACTOR, () =>
      fixture.configurations.getActiveConfiguration(orgA),
    );
    expect(active.id).toBe(draft.id);
  });

  it('enforces single ACTIVE per organization (FOR UPDATE guard)', async () => {
    const first = await publishConfiguration(fixture, orgA);
    const secondDraft = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'DEFAULT',
        name: 'Main Config v2',
        effectiveFrom: null,
        levels: TWO_LEVELS.levels as any,
      }),
    );
    expect(secondDraft.versionNumber).toBe(2);
    const second = await asActor(ACTOR, () =>
      fixture.configurations.publishConfiguration(orgA, secondDraft.id),
    );
    expect(second.status).toBe('ACTIVE');
    expect(
      await asActor(ACTOR, () =>
        fixture.configurations.getConfiguration(orgA, first),
      ),
    ).toMatchObject({ status: 'SUPERSEDED' });
    expect(
      await asActor(ACTOR, () =>
        fixture.configurations.getActiveConfiguration(orgA),
      ),
    ).toMatchObject({ id: second.id });
  });

  it('keeps published versions immutable', async () => {
    const id = await publishConfiguration(fixture, orgA);
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.updateConfiguration(orgA, id, {
            name: 'Changed',
          }),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.publishConfiguration(orgA, id),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('allows DRAFT mutation and blocks after operational use', async () => {
    const draft = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'DEFAULT',
        name: 'Main Config',
        effectiveFrom: null,
        levels: TWO_LEVELS.levels as any,
      }),
    );
    // Mutable while DRAFT not used
    const updated = await asActor(ACTOR, () =>
      fixture.configurations.updateConfiguration(orgA, draft.id, {
        name: 'Renamed',
      }),
    );
    expect(updated.name).toBe('Renamed');

    // Mark operationally used
    await fixture.stores.raw.configurations.markOperationallyUsed({
      id: draft.id,
      now: new Date(),
    });

    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.updateConfiguration(orgA, draft.id, {
            name: 'Again',
          }),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.deleteConfiguration(orgA, draft.id),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('allows deletion of DRAFT not yet used, forbids ACTIVE', async () => {
    const draft = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'TMP',
        name: 'Tmp Config',
        effectiveFrom: null,
        levels: TWO_LEVELS.levels as any,
      }),
    );
    await asActor(ACTOR, () =>
      fixture.configurations.deleteConfiguration(orgA, draft.id),
    );
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.getConfiguration(orgA, draft.id),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });

    const activeId = await publishConfiguration(fixture, orgA);
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.deleteConfiguration(orgA, activeId),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('scopes by organization (404, never 403)', async () => {
    const id = await publishConfiguration(fixture, orgA);
    expect(
      await failure(
        asActor(ACTOR, () => fixture.configurations.getConfiguration(orgB, id)),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.updateConfiguration(orgB, id, { name: 'X' }),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.configurations.publishConfiguration(orgB, id),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });

    const otherId = await publishConfiguration(fixture, orgB);
    expect(otherId).not.toBe(id);
  });

  it('validates configurable hierarchy — no hardcoded 1=Assets', async () => {
    // Any titles and levelKinds allowed
    const custom = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'CUSTOM',
        name: 'Custom Chart',
        effectiveFrom: new Date(),
        levels: [
          {
            levelIndex: 1,
            title: 'My Group',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: 'my_group',
          },
          {
            levelIndex: 2,
            title: 'My Sub',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: 'my_sub',
          },
          {
            levelIndex: 3,
            title: 'My Detail',
            digitLength: 4,
            defaultIsPostable: true,
            levelKind: 'my_detail',
          },
        ] as any,
      }),
    );
    expect(custom.pattern).toBe('1 + 2 + 4');
  });

  it('separates View from Configure', async () => {
    const viewer = '01VIEWER000000000000000000';
    await fixture.grant(viewer, [ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW]);
    const id = await publishConfiguration(fixture, orgA);

    expect(
      await failure(
        asActor(viewer, () =>
          fixture.configurations.createConfiguration({
            organizationId: orgA,
            code: 'NOPE',
            name: 'Nope',
            effectiveFrom: null,
            levels: TWO_LEVELS.levels as any,
          }),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });
    expect(
      await failure(
        asActor(viewer, () =>
          fixture.configurations.publishConfiguration(orgA, id),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });

    expect(
      await asActor(viewer, () =>
        fixture.configurations.listConfigurations({
          organizationId: orgA,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).toMatchObject({ total: 1 });
  });
});
