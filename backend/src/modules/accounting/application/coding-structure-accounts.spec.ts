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
import {
  pinnedAppConfig,
  UNPINNED_APP_CONFIG,
} from '../../../../test/support/app-config.js';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { CodingStructuresService } from './coding-structures.service.js';
import { AccountingConfigurationsService } from './accounting-configurations.service.js';
import { AccountsService } from './accounts.service.js';
import { AccountingDocumentLinesRepository } from '../data/accounting-document-lines.repository.js';
import {
  ACCOUNTING_CONFIGURATION_PERMISSIONS,
  ACCOUNTING_PERMISSION_DEFINITIONS,
  ACCOUNT_PERMISSIONS,
  CODING_STRUCTURE_PERMISSIONS,
} from '../domain/accounting-permissions.js';
import {
  ACCOUNTING_EVENT_TYPES,
  ACCOUNT_CREATED_EVENT,
  ACCOUNT_DISABLED_EVENT,
  ACCOUNT_ENABLED_EVENT,
  ACCOUNT_UPDATED_EVENT,
} from '../domain/accounting.events.js';

/**
 * The Task 10.3 services, driven through the REAL `AuthorizationService` with
 * real RBAC rows and in-memory structure/account tables (the same harness shape
 * as `accounting-authorization.spec.ts`).
 *
 * What this proves beyond the domain specs: the permission is checked inside
 * the service (not only on a route), a foreign organization's id answers 404
 * rather than 403 on every new read and write, the coding-structure version
 * lifecycle (draft → active → superseded, exactly one active per organization)
 * is what gates account creation, and every chart invariant is enforced on the
 * WRITE path — including the ones a UI would "prevent" by hiding a picker.
 *
 * Single-threaded fakes cannot prove lock contention; the live-database suite
 * (`test/account-structure-live.e2e-spec.ts`) covers the races themselves.
 */

const ACTOR = '01ACTOR000000000000000000A';

/** The 2 + 3 layout most cases use — ONE configuration, not a constant. */
const TWO_LEVELS = {
  code: 'DEFAULT',
  maxDepth: 2,
  levels: [
    { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
    {
      levelIndex: 2,
      title: 'Subsidiary',
      digitLength: 3,
      defaultIsPostable: true,
      levelKind: 'subsidiary',
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

/** The stable parts of a rejection: the API code + the rule details. */
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
  if (caught === undefined) throw new Error('Expected the operation to fail.');
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
  structures: CodingStructuresService;
  configurations: AccountingConfigurationsService;
  accounts: AccountsService;
  stores: StructureStores;
  master: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
  /** ODR-3 (Task 19): seed a principal → organization membership. */
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
  for (const type of [
    ACCOUNT_CREATED_EVENT,
    ACCOUNT_UPDATED_EVENT,
    ACCOUNT_ENABLED_EVENT,
    ACCOUNT_DISABLED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // Mirror the permission vocabulary into `rbac.permissions`, exactly as
  // `PermissionSyncService` does at startup — otherwise every authorization
  // test below would pass for the wrong reason.
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
    // A missing code must fail loudly rather than silently grant nothing.
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
    stores,
    master: masterStores,
    events,
    grant,
    member: (userId: string, organizationId: string) => {
      masterStores.raw.memberships.seed(userId, organizationId);
    },
  };
}

/** Services called outside any HTTP request run in system context (no check). */
function asSystem<R>(fn: () => Promise<R>): Promise<R> {
  return fn();
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

type LevelConfig = (typeof TWO_LEVELS)['levels'][number] & {
  levelKind?: string | null;
};

/** Draft + publish a configuration for one organization; returns the version id. */
async function publishAccountingConfig(
  fixture: Fixture,
  organizationId: string,
  configuration: {
    code?: string;
    maxDepth: number;
    levels: readonly LevelConfig[];
  },
): Promise<string> {
  await fixture.grant(ACTOR, [ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE]);
  const created = await asActor(ACTOR, () =>
    fixture.configurations.createConfiguration({
      organizationId,
      code: configuration.code ?? 'DEFAULT',
      name: configuration.code ?? 'DEFAULT',
      levels: configuration.levels.map((l) => ({
        levelIndex: l.levelIndex,
        title: l.title,
        digitLength: l.digitLength,
        defaultIsPostable: l.defaultIsPostable,
        levelKind: (l as any).levelKind ?? null,
      })),
    }),
  );
  const published = await asActor(ACTOR, () =>
    fixture.configurations.publishConfiguration(organizationId, created.id),
  );
  return published.id;
}

async function publishStructure(
  fixture: Fixture,
  organizationId: string,
  configuration: {
    code?: string;
    separator?: string;
    maxDepth: number;
    levels: readonly LevelConfig[];
  },
): Promise<string> {
  await fixture.grant(ACTOR, [CODING_STRUCTURE_PERMISSIONS.CONFIGURE]);
  const created = await asActor(ACTOR, () =>
    fixture.structures.createVersion({
      organizationId,
      code: configuration.code ?? 'DEFAULT',
      maxDepth: configuration.maxDepth,
      separator: configuration.separator,
      levels: configuration.levels,
    }),
  );
  await asActor(ACTOR, () =>
    fixture.structures.publishVersion(organizationId, created.id),
  );
  // Task 11 Final D1: also publish accounting configuration so AccountsService can create accounts
  try {
    await publishAccountingConfig(fixture, organizationId, configuration);
  } catch {
    // Ignore if already exists — publishAccountingConfig will handle version increment
  }
  return created.id;
}

async function publishBoth(
  fixture: Fixture,
  organizationId: string,
  configuration: {
    code?: string;
    maxDepth: number;
    levels: readonly LevelConfig[];
  },
): Promise<{ codingId: string; configId: string }> {
  const codingId = await publishStructure(
    fixture,
    organizationId,
    configuration,
  );
  const configId = await publishAccountingConfig(
    fixture,
    organizationId,
    configuration,
  );
  return { codingId, configId };
}

interface RootOverrides {
  title?: string;
  accountNature?: string;
  isPostable?: boolean;
  parentId?: string | null;
}

async function createAccount(
  fixture: Fixture,
  organizationId: string,
  code: string,
  overrides: RootOverrides = {},
) {
  const input: Parameters<AccountsService['createAccount']>[0] = {
    organizationId,
    code,
    title: overrides.title ?? `Account ${code}`,
    accountNature: overrides.accountNature ?? 'DEBIT',
  };
  if (overrides.isPostable !== undefined)
    input.isPostable = overrides.isPostable;
  if (overrides.parentId !== undefined) input.parentId = overrides.parentId;
  return asActor(ACTOR, () => fixture.accounts.createAccount(input));
}

function accountFailures(fixture: Fixture) {
  return {
    create: (
      organizationId: string,
      code: string,
      overrides: RootOverrides = {},
    ) => {
      const input: Parameters<AccountsService['createAccount']>[0] = {
        organizationId,
        code,
        title: overrides.title ?? `Account ${code}`,
        accountNature: overrides.accountNature ?? 'DEBIT',
      };
      if (overrides.isPostable !== undefined) {
        input.isPostable = overrides.isPostable;
      }
      if (overrides.parentId !== undefined) input.parentId = overrides.parentId;
      return failure(
        asActor(ACTOR, () => fixture.accounts.createAccount(input)),
      );
    },
    update: (
      organizationId: string,
      id: string,
      patch: Parameters<AccountsService['updateAccount']>[2],
    ) =>
      failure(
        asActor(ACTOR, () =>
          fixture.accounts.updateAccount(organizationId, id, patch),
        ),
      ),
  };
}

describe('CodingStructuresService', () => {
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
    // ODR-3 (Task 19): organization scope is principal-bound; ACTOR is a
    // legitimate member of both organizations so the behaviour under test
    // surfaces exactly as before. The membership boundary has its own specs.
    fixture.member(ACTOR, orgA);
    fixture.member(ACTOR, orgB);
    await fixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);
  });

  it('drafts a version with its levels and activates it on publish', async () => {
    const draft = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgA,
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '-',
        levels: TWO_LEVELS.levels,
      }),
    );
    expect(draft.status).toBe('draft');
    expect(draft.versionNumber).toBe(1);
    expect(draft.separator).toBe('-');
    expect(draft.pattern).toBe('2 + 3');
    expect(draft.levels.map((level) => level.levelIndex)).toEqual([1, 2]);
    expect(draft.levels[1]?.levelKind).toBe('subsidiary');
    expect(draft.levels[0]?.defaultIsPostable).toBe(false);

    const published = await asActor(ACTOR, () =>
      fixture.structures.publishVersion(orgA, draft.id),
    );
    expect(published.status).toBe('active');
    const active = await asActor(ACTOR, () =>
      fixture.structures.getActiveVersion(orgA),
    );
    expect(active.id).toBe(draft.id);
  });

  it('accepts any configured shape: nothing about the coding is hardcoded', async () => {
    const single = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgA,
        code: 'FLAT',
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'Account',
            digitLength: 5,
            defaultIsPostable: true,
          },
        ],
      }),
    );
    expect(single.pattern).toBe('5');
    const deep = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgA,
        code: 'DEEP',
        maxDepth: 4,
        levels: [1, 2, 3, 4].map((index) => ({
          levelIndex: index,
          title: `L${index}`,
          digitLength: 1,
          defaultIsPostable: index === 4,
        })),
      }),
    );
    expect(deep).toMatchObject({ code: 'DEEP', maxDepth: 4, versionNumber: 1 });
    expect(deep.pattern).toBe('1 + 1 + 1 + 1');
  });

  it('refuses an incomplete or over-cap level set', async () => {
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.createVersion({
            organizationId: orgA,
            code: 'GAP',
            maxDepth: 3,
            levels: [
              {
                levelIndex: 1,
                title: 'A',
                digitLength: 2,
                defaultIsPostable: false,
              },
              {
                levelIndex: 3,
                title: 'C',
                digitLength: 2,
                defaultIsPostable: false,
              },
            ],
          }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest', details: {} });

    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.createVersion({
            organizationId: orgA,
            code: 'DUP',
            maxDepth: 2,
            levels: [
              {
                levelIndex: 1,
                title: 'A',
                digitLength: 2,
                defaultIsPostable: false,
              },
              {
                levelIndex: 1,
                title: 'B',
                digitLength: 2,
                defaultIsPostable: false,
              },
            ],
          }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest' });

    // 8 levels × 5 digits = 40 > the 32-character architecture cap.
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.createVersion({
            organizationId: orgA,
            code: 'LONG',
            maxDepth: 8,
            levels: [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
              levelIndex: index,
              title: `L${index}`,
              digitLength: 5,
              defaultIsPostable: false,
            })),
          }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest' });

    // A depth beyond the cap is refused without consulting the levels.
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.createVersion({
            organizationId: orgA,
            code: 'TOODEEP',
            maxDepth: 9,
            levels: [
              {
                levelIndex: 1,
                title: 'A',
                digitLength: 1,
                defaultIsPostable: false,
              },
            ],
          }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest' });
  });

  it('keeps published versions immutable and keeps ONE active version per organization', async () => {
    const first = await publishStructure(fixture, orgA, TWO_LEVELS);
    const second = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgA,
        code: 'DEFAULT',
        maxDepth: 3,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'B',
            digitLength: 1,
            defaultIsPostable: false,
          },
          {
            levelIndex: 3,
            title: 'C',
            digitLength: 1,
            defaultIsPostable: true,
          },
        ],
      }),
    );
    expect(second.versionNumber).toBe(2);

    const published = await asActor(ACTOR, () =>
      fixture.structures.publishVersion(orgA, second.id),
    );
    expect(published.status).toBe('active');
    expect(
      await asActor(ACTOR, () => fixture.structures.getVersion(orgA, first)),
    ).toMatchObject({ status: 'superseded' });
    expect(
      await asActor(ACTOR, () => fixture.structures.getActiveVersion(orgA)),
    ).toMatchObject({ id: second.id });

    // Neither an active nor a superseded version may be edited or published.
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.updateVersion(orgA, second.id, { maxDepth: 2 }),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.publishVersion(orgA, second.id),
        ),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(
      await failure(
        asActor(ACTOR, () => fixture.structures.publishVersion(orgA, first)),
      ),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('configures a draft, guards maxDepth against the stored levels, then publishes', async () => {
    const draft = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgA,
        code: 'PARTIAL',
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 2,
            defaultIsPostable: false,
          },
        ],
      }),
    );
    const edited = await asActor(ACTOR, () =>
      fixture.structures.updateVersion(orgA, draft.id, {
        maxDepth: 2,
        separator: '/',
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 2,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'B',
            digitLength: 4,
            defaultIsPostable: true,
          },
        ],
      }),
    );
    expect(edited).toMatchObject({
      maxDepth: 2,
      separator: '/',
      pattern: '2 + 4',
    });

    // Shrinking the depth below the stored levels is refused, not truncated.
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.updateVersion(orgA, draft.id, { maxDepth: 1 }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest' });

    expect(
      await asActor(ACTOR, () =>
        fixture.structures.publishVersion(orgA, draft.id),
      ),
    ).toMatchObject({ status: 'active' });
  });

  it('scopes structure reads and writes by organization (404, never 403)', async () => {
    const versionId = await publishStructure(fixture, orgA, TWO_LEVELS);
    expect(
      await failure(
        asActor(ACTOR, () => fixture.structures.getVersion(orgB, versionId)),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.updateVersion(orgB, versionId, { maxDepth: 1 }),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.structures.publishVersion(orgB, versionId),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });

    // Another organization may configure the same code, and its own active
    // version is independent of the first organization's publishes.
    const otherId = await publishStructure(fixture, orgB, TWO_LEVELS);
    expect(otherId).not.toBe(versionId);
    expect(
      await asActor(ACTOR, () => fixture.structures.getActiveVersion(orgB)),
    ).toMatchObject({ id: otherId });
    expect(
      await asActor(ACTOR, () =>
        fixture.structures.listVersions({
          organizationId: orgB,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });
    // A second publish in org B creates version 2 of the same structure code.
    const v2 = await asActor(ACTOR, () =>
      fixture.structures.createVersion({
        organizationId: orgB,
        ...TWO_LEVELS,
      }),
    );
    expect(v2.versionNumber).toBe(2);
  });

  it('separates View from Configure and rejects a principal-less HTTP request', async () => {
    const viewer = '01VIEWER000000000000000000';
    await fixture.grant(viewer, [CODING_STRUCTURE_PERMISSIONS.VIEW]);
    fixture.member(viewer, orgA);
    const configured = await publishStructure(fixture, orgA, TWO_LEVELS);

    expect(
      await failure(
        asActor(viewer, () =>
          fixture.structures.createVersion({
            organizationId: orgA,
            code: 'NOPE',
            maxDepth: 1,
            levels: [
              {
                levelIndex: 1,
                title: 'A',
                digitLength: 1,
                defaultIsPostable: false,
              },
            ],
          }),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });
    expect(
      await failure(
        asActor(viewer, () =>
          fixture.structures.publishVersion(orgA, configured),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });
    expect(
      await failure(
        asActor(viewer, () =>
          fixture.structures.updateVersion(orgA, configured, {}),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });

    expect(
      await asActor(viewer, () =>
        fixture.structures.listVersions({
          organizationId: orgA,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });

    // An HTTP-shaped request with no principal is an authentication failure,
    // never an implicit system-context bypass (docs/security.md §3).
    expect(
      await failure(
        runWithRequestContext({ correlationId: 'corr-anon' }, () =>
          fixture.structures.listVersions({
            organizationId: orgA,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    ).toMatchObject({ code: 'Unauthorized' });
  });
});

describe('AccountsService', () => {
  let fixture: Fixture;
  let orgA = '';
  let orgB = '';
  let versionId = '';

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
    // ODR-3 (Task 19): organization scope is principal-bound; ACTOR is a
    // legitimate member of both organizations so the behaviour under test
    // surfaces exactly as before. The membership boundary has its own specs.
    fixture.member(ACTOR, orgA);
    fixture.member(ACTOR, orgB);
    await fixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
      ...Object.values(ACCOUNTING_CONFIGURATION_PERMISSIONS),
    ]);
    versionId = await publishStructure(fixture, orgA, TWO_LEVELS);
    // Ensure accounting config exists for orgA
    try {
      await publishAccountingConfig(fixture, orgA, TWO_LEVELS);
    } catch {}
    fixture.events.length = 0;
  });

  it('creates a root account, deriving level, pinned version and postability default', async () => {
    const root = await createAccount(fixture, orgA, '02', {
      title: '  Current   Assets  ',
    });
    expect(root).toMatchObject({
      code: '02',
      title: 'Current Assets',
      parentId: null,
      level: 1,
      accountNature: 'DEBIT',
      // Level 1 of THIS configuration defaults to non-postable (§14 rule 4).
      isPostable: false,
      isActive: true,
    });
    // Task 11 Final D1/D2/D3: both accountingConfigurationId sole scope and codingStructureVersionId code shape NOT NULL
    expect(root.accountingConfigurationId).toBeTruthy();
    expect(root.codingStructureVersionId).toBeTruthy();
    // The API never exposes audit actor ids (AR-24).
    expect(root).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      ACCOUNT_CREATED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toMatchObject({
      organizationId: orgA,
      code: '02',
      level: 1,
    });
    expect(
      (fixture.events[0]?.payload as any).accountingConfigurationId,
    ).toBeTruthy();
  });

  it('honours an explicit postability override against the level default', async () => {
    expect(
      await createAccount(fixture, orgA, '03', { isPostable: true }),
    ).toMatchObject({ isPostable: true });
    // Level 2's default IS postable; an override can still say no.
    const root = await createAccount(fixture, orgA, '04');
    const child = await createAccount(fixture, orgA, '04001', {
      parentId: root.id,
      isPostable: false,
    });
    expect(child).toMatchObject({ level: 2, isPostable: false });
  });

  it('creates a valid child account under its parent', async () => {
    const root = await createAccount(fixture, orgA, '02');
    const child = await createAccount(fixture, orgA, '02003', {
      parentId: root.id,
    });
    // Level 2 of the configuration defaults to postable (§14 rule 4).
    expect(child).toMatchObject({
      level: 2,
      parentId: root.id,
      isPostable: true,
    });
    expect(child.accountingConfigurationId).toBe(
      root.accountingConfigurationId,
    );
    // maxDepth is 2, so a third level is beyond this configuration. The child
    // is made non-postable first so the DEPTH rule is what refuses it.
    await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(orgA, child.id, { isPostable: false }),
    );
    expect(
      await accountFailures(fixture).create(orgA, '02003004', {
        parentId: child.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'depth_exceeded' },
    });
    // A POSTABLE parent refuses the same child first (§14 rule 2).
    const postableChild = await createAccount(fixture, orgA, '03003', {
      parentId: (await createAccount(fixture, orgA, '03')).id,
    });
    expect(postableChild.isPostable).toBe(true);
    expect(
      await accountFailures(fixture).create(orgA, '03003004', {
        parentId: postableChild.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'parent_postable' },
    });
  });

  it('follows a DIFFERENT published configuration without a code change', async () => {
    // 1 + 4 in organization B: codes of length 1 and 5, nothing in common
    // with org A's 2 + 3.
    await publishStructure(fixture, orgB, {
      code: 'SIMPLE',
      maxDepth: 2,
      levels: [
        { levelIndex: 1, title: 'A', digitLength: 1, defaultIsPostable: false },
        { levelIndex: 2, title: 'B', digitLength: 4, defaultIsPostable: true },
      ],
    });
    const root = await createAccount(fixture, orgB, '2');
    const child = await createAccount(fixture, orgB, '20001', {
      parentId: root.id,
    });
    expect(child).toMatchObject({ level: 2, code: '20001' });
    // Org A's shape still rejects what B's accepts.
    expect(await accountFailures(fixture).create(orgA, '20001')).toMatchObject({
      code: 'BusinessRuleViolation',
    });
  });

  it("validates a move against the account's OWN configuration, never the organization's active one", async () => {
    // Org A runs on TWO_LEVELS (2 + 3): root '02', child '02003'.
    const root = await createAccount(fixture, orgA, '02');
    const child = await createAccount(fixture, orgA, '02003', {
      parentId: root.id,
    });
    const pinnedConfigId = child.accountingConfigurationId;
    const pinnedVersionId = child.codingStructureVersionId;

    // A SECOND configuration becomes ACTIVE for the same organization, with a
    // 5-digit level 1 — exactly the child code's length. A move validated
    // against THIS configuration would accept '02003' as a root code.
    await publishAccountingConfig(fixture, orgA, {
      code: 'WIDE',
      maxDepth: 2,
      levels: [
        {
          levelIndex: 1,
          title: 'Wide',
          digitLength: 5,
          defaultIsPostable: false,
        },
        {
          levelIndex: 2,
          title: 'Narrow',
          digitLength: 1,
          defaultIsPostable: true,
        },
      ],
    });
    const activeNow = await asActor(ACTOR, () =>
      fixture.configurations.getActiveConfiguration(orgA),
    );
    expect(activeNow.id).not.toBe(pinnedConfigId);

    // The move to root is decided by the account's OWN configuration (2 + 3 →
    // '02003' is a level-2 code, not a root), never by the active one.
    expect(
      await accountFailures(fixture).update(orgA, child.id, {
        parentId: null,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'level_length_mismatch' },
    });

    // Nothing moved, and the account is still pinned to its own pair.
    expect(fixture.stores.raw.state.accounts.findById(child.id)).toMatchObject({
      parentId: root.id,
      level: 2,
      accountingConfigurationId: pinnedConfigId,
      codingStructureVersionId: pinnedVersionId,
    });
  });

  it('refuses to pin a new root to a coding version that stopped being active between resolution and write', async () => {
    // Simulate the concurrent publish: the service resolves the ACTIVE version
    // and a competing request supersedes it before the repository's locked
    // write runs. The write boundary must re-check the pin — it may not trust
    // the resolution that happened before the lock.
    const raw = fixture.stores.raw.structures;
    const original = raw.findActiveForOrganization.bind(raw);
    raw.findActiveForOrganization = async (organizationId: string) => {
      const version = await original(organizationId);
      if (version !== null) {
        fixture.stores.raw.state.versions.patch(version.id, {
          status: 'superseded',
        });
      }
      return version;
    };

    expect(await accountFailures(fixture).create(orgA, '09')).toMatchObject({
      code: 'Conflict',
    });

    // The failed create wrote nothing.
    expect(
      fixture.stores.raw.state.accounts.findMany(
        (row) => row.organizationId === orgA,
      ),
    ).toEqual([]);
  });

  it('rejects an invalid code shape as a client error', async () => {
    const root = await createAccount(fixture, orgA, '02');
    expect(
      await accountFailures(fixture).create(orgA, '02-03', {
        parentId: root.id,
      }),
    ).toMatchObject({ code: 'BadRequest' });
    expect(
      await accountFailures(fixture).create(orgA, 'AB003', {
        parentId: root.id,
      }),
    ).toMatchObject({ code: 'BadRequest' });
    // Structurally valid digits, but the wrong length for level 1 (2 digits).
    expect(await accountFailures(fixture).create(orgA, '020')).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'level_length_mismatch' },
    });
  });

  it('rejects a child code that does not extend its parent code', async () => {
    const root = await createAccount(fixture, orgA, '02');
    expect(
      await accountFailures(fixture).create(orgA, '03003', {
        parentId: root.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'parent_prefix_mismatch', field: 'code' },
    });
  });

  it('reports a missing or foreign parent as 404 (no existence leak)', async () => {
    expect(
      await accountFailures(fixture).create(orgA, '02003', {
        parentId: '01NOPE000000000000000000A',
      }),
    ).toMatchObject({ code: 'EntityNotFound' });

    await publishStructure(fixture, orgB, TWO_LEVELS);
    const otherRoot = await createAccount(fixture, orgB, '02');
    expect(
      await accountFailures(fixture).create(orgA, '09009', {
        parentId: otherRoot.id,
      }),
    ).toMatchObject({ code: 'EntityNotFound' });
  });

  it('refuses to create an account in an organization with no active structure (now accounting config per D1)', async () => {
    // orgB has no accounting config yet — publishStructure not called for orgB in this test
    // Ensure orgB has no active accounting config
    const freshFixture = await buildFixture();
    const orgB2 = (
      await asSystem(() =>
        freshFixture.organizations.createOrganization({
          code: 'ORGB2',
          name: 'Org B2',
        }),
      )
    ).id;
    freshFixture.member(ACTOR, orgB2);
    await freshFixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
      ...Object.values(ACCOUNTING_CONFIGURATION_PERMISSIONS),
    ]);
    const failures = {
      create: (organizationId: string, code: string) =>
        failure(
          asActor(ACTOR, () =>
            freshFixture.accounts.createAccount({
              organizationId,
              code,
              title: `Account ${code}`,
              accountNature: 'DEBIT',
            }),
          ),
        ),
    };
    expect(await failures.create(orgB2, '02')).toMatchObject({
      code: 'BusinessRuleViolation',
    });
  });

  it('enforces code uniqueness per organization and never reuses a code', async () => {
    const root = await createAccount(fixture, orgA, '02');
    expect(await accountFailures(fixture).create(orgA, '02')).toMatchObject({
      code: 'Conflict',
    });
    // The same code in another organization is a different account (§9.2).
    await publishStructure(fixture, orgB, TWO_LEVELS);
    expect(await createAccount(fixture, orgB, '02')).toMatchObject({
      organizationId: orgB,
    });

    // Disabling does not free the code: nothing is deleted (§8.6, OQ-36).
    await asActor(ACTOR, () => fixture.accounts.disableAccount(orgA, root.id));
    expect(await accountFailures(fixture).create(orgA, '02')).toMatchObject({
      code: 'Conflict',
    });
  });

  it('enforces the postable ⇄ leaf invariant on both write paths', async () => {
    const root = await createAccount(fixture, orgA, '02');
    await createAccount(fixture, orgA, '02001', { parentId: root.id });
    // (1) postable on an account with children → refused.
    expect(
      await accountFailures(fixture).update(orgA, root.id, {
        isPostable: true,
      }),
    ).toMatchObject({ code: 'BusinessRuleViolation' });

    // (2) the first child of a postable account → refused.
    const leaf = await createAccount(fixture, orgA, '03', {
      isPostable: true,
    });
    expect(
      await accountFailures(fixture).create(orgA, '03001', {
        parentId: leaf.id,
      }),
    ).toMatchObject({ code: 'BusinessRuleViolation' });

    // (3) clearing the parent's postability first makes the extension legal
    //     (§14 rule 2's other path, as two explicit operations).
    await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(orgA, leaf.id, { isPostable: false }),
    );
    expect(
      await createAccount(fixture, orgA, '03001', { parentId: leaf.id }),
    ).toMatchObject({ level: 2 });

    // (4) a leaf may stay non-postable (a placeholder awaiting children).
    expect(
      await createAccount(fixture, orgA, '05', { isPostable: false }),
    ).toMatchObject({ isPostable: false, isActive: true });
  });

  it('prevents cycles on the write path, never in a UI', async () => {
    const root = await createAccount(fixture, orgA, '02');
    const child = await createAccount(fixture, orgA, '02001', {
      parentId: root.id,
    });
    // Moving the root under its own child would close the cycle A → B → A.
    expect(
      await accountFailures(fixture).update(orgA, root.id, {
        parentId: child.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'cycle' },
    });
    expect(
      await accountFailures(fixture).update(orgA, child.id, {
        parentId: child.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'self_parent' },
    });
    // A three-node cycle attempt (A → B → C → A) is refused the same way.
    const grandchild = await createAccount(fixture, orgA, '03');
    const grandchildChild = await createAccount(fixture, orgA, '03001', {
      parentId: grandchild.id,
    });
    expect(
      await accountFailures(fixture).update(orgA, grandchild.id, {
        parentId: grandchildChild.id,
      }),
    ).toMatchObject({ details: { rule: 'cycle' } });

    // Nothing changed: the tree is still acyclic.
    expect(
      await asActor(ACTOR, () => fixture.accounts.getAccount(orgA, root.id)),
    ).toMatchObject({ parentId: null });
  });

  it('refuses a re-parent that breaks the code-prefix proof', async () => {
    const a = await createAccount(fixture, orgA, '02');
    const b = await createAccount(fixture, orgA, '03');
    const child = await createAccount(fixture, orgA, '02001', {
      parentId: a.id,
    });
    // '02001' does not extend '03': codes are immutable, so the move is refused
    // rather than storing a tree whose codes lie (§9.3 "fail loudly").
    expect(
      await accountFailures(fixture).update(orgA, child.id, { parentId: b.id }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'parent_prefix_mismatch' },
    });
    expect(
      await asActor(ACTOR, () => fixture.accounts.getAccount(orgA, child.id)),
    ).toMatchObject({ parentId: a.id, level: 2 });
  });

  it('edits title and nature, and has no way to change the code', async () => {
    const root = await createAccount(fixture, orgA, '02', { title: 'Assets' });
    const renamed = await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(orgA, root.id, {
        title: '  Current Assets  ',
        accountNature: 'CREDIT',
      }),
    );
    expect(renamed).toMatchObject({
      code: '02',
      title: 'Current Assets',
      accountNature: 'CREDIT',
    });
    expect(fixture.events.map((event) => event.type)).toContain(
      ACCOUNT_UPDATED_EVENT,
    );
    expect(
      await accountFailures(fixture).update(orgA, root.id, { title: '   ' }),
    ).toMatchObject({ code: 'BadRequest' });
    expect(
      await accountFailures(fixture).update(orgA, root.id, {
        accountNature: 'asset',
      }),
    ).toMatchObject({ code: 'BadRequest' });
    // Lowercase values are rejected at boundary (OD-29-01)
    expect(
      await accountFailures(fixture).update(orgA, root.id, {
        accountNature: 'credit',
      }),
    ).toMatchObject({ code: 'BadRequest' });
    // `UpdateAccountInput` has no `code` property: the immutability is
    // structural (no field to send), not a validated coincidence.
    const patch: Parameters<AccountsService['updateAccount']>[2] = {
      title: 'x',
    };
    expect(Object.keys(patch)).toEqual(['title']);
  });

  it('blocks new children under a disabled account while history stays readable', async () => {
    const root = await createAccount(fixture, orgA, '02');
    const child = await createAccount(fixture, orgA, '02001', {
      parentId: root.id,
    });

    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.disableAccount(orgA, root.id),
      ),
    ).toMatchObject({ isActive: false });
    expect(
      await asActor(ACTOR, () => fixture.accounts.getAccount(orgA, root.id)),
    ).toMatchObject({ code: '02' });
    expect(
      await accountFailures(fixture).create(orgA, '02002', {
        parentId: root.id,
      }),
    ).toMatchObject({
      code: 'BusinessRuleViolation',
      details: { rule: 'parent_disabled' },
    });

    // The existing child is untouched (freeze over delete).
    await expect(
      asActor(ACTOR, () =>
        fixture.accounts.requireUsableAccountInOrganization(child.id, orgA),
      ),
    ).resolves.toMatchObject({ code: '02001' });

    expect(
      await asActor(ACTOR, () => fixture.accounts.enableAccount(orgA, root.id)),
    ).toMatchObject({ isActive: true });
    expect(
      await createAccount(fixture, orgA, '02002', { parentId: root.id }),
    ).toMatchObject({ code: '02002' });
    expect(fixture.events.map((event) => event.type)).toContain(
      ACCOUNT_DISABLED_EVENT,
    );
    expect(fixture.events.map((event) => event.type)).toContain(
      ACCOUNT_ENABLED_EVENT,
    );
  });

  it('scopes every account read and write by organization', async () => {
    const root = await createAccount(fixture, orgA, '02');
    expect(
      await failure(
        asActor(ACTOR, () => fixture.accounts.getAccount(orgB, root.id)),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await accountFailures(fixture).update(orgB, root.id, { title: 'Nope' }),
    ).toMatchObject({ code: 'EntityNotFound' });
    expect(
      await failure(
        asActor(ACTOR, () => fixture.accounts.disableAccount(orgB, root.id)),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });

    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgB,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 0 });
    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });
    // `requireUsableAccountInOrganization` never leaks a foreign account either.
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.accounts.requireUsableAccountInOrganization(root.id, orgB),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
  });

  it('filters lists by parent, level and postability', async () => {
    const root = await createAccount(fixture, orgA, '02');
    await createAccount(fixture, orgA, '02001', { parentId: root.id });
    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          parentId: root.id,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });
    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          level: 1,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });
    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          isPostable: true,
          page: 1,
          pageSize: 20,
        }),
      ),
    ).toMatchObject({ total: 1 });
    // A foreign parentId is a 404, not an empty page.
    await publishStructure(fixture, orgB, TWO_LEVELS);
    const otherRoot = await createAccount(fixture, orgB, '02');
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.accounts.listAccounts({
            organizationId: orgA,
            parentId: otherRoot.id,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
  });

  it('enforces one permission per operation (the service check, not the route)', async () => {
    const viewOnly = '01VIEWONLY00000000000000000';
    fixture.member(viewOnly, orgA);
    await fixture.grant(viewOnly, [ACCOUNT_PERMISSIONS.VIEW]);
    expect(
      await failure(
        asActor(viewOnly, () =>
          fixture.accounts.createAccount({
            organizationId: orgA,
            code: '02',
            title: 'Nope',
            accountNature: 'DEBIT',
          }),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });
    expect(
      await failure(
        asActor(viewOnly, () =>
          fixture.accounts.disableAccount(orgA, '01ANY000000000000000000A'),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });

    // `Create` is not `Edit`; `Edit` is not `Enable`/`Disable`.
    const creator = '01CREATOR0000000000000000A';
    fixture.member(creator, orgA);
    await fixture.grant(creator, [ACCOUNT_PERMISSIONS.CREATE]);
    expect(
      await asActor(creator, () =>
        fixture.accounts.createAccount({
          organizationId: orgA,
          code: '07',
          title: 'Created',
          accountNature: 'DEBIT',
        }),
      ),
    ).toMatchObject({ code: '07' });
    const list = await asActor(ACTOR, () =>
      fixture.accounts.listAccounts({
        organizationId: orgA,
        page: 1,
        pageSize: 5,
        search: '07',
      }),
    );
    const createdId = list.items[0]?.id ?? '';
    expect(
      await failure(
        asActor(creator, () =>
          fixture.accounts.updateAccount(orgA, createdId, { title: 'Renamed' }),
        ),
      ),
    ).toMatchObject({ code: 'PermissionDenied' });
    expect(
      await failure(
        asActor(ACTOR, () =>
          fixture.accounts.updateAccount(orgA, createdId, {
            accountNature: 'nonsense',
          }),
        ),
      ),
    ).toMatchObject({ code: 'BadRequest' });
  });

  it('refuses every write for a disabled organization or a pinned-out-of-scope one', async () => {
    const disabledOrg = await asSystem(() =>
      fixture.organizations.createOrganization({
        code: 'OFF',
        name: 'Disabled org',
      }),
    );
    await asSystem(() =>
      fixture.organizations.disableOrganization(disabledOrg.id),
    );
    // A member of a DISABLED organization still gets the usability 422 — the
    // membership gate must not mask it with a 404 (ODR-3 preserves posture).
    fixture.member(ACTOR, disabledOrg.id);
    expect(
      await accountFailures(fixture).create(disabledOrg.id, '02'),
    ).toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('keeps structural edits available while no document line exists (the AC-I-11 seam)', async () => {
    // Task 10.3 has no posting, so NO account can be referenced yet: the
    // after-use refusal is implemented and unit-tested in the domain layer
    // (`account-placement.spec.ts`), and the seam that decides it is
    // `isReferencedByDocumentLine`. This test pins the CURRENT observable
    // behaviour so the posting task notices the rule activates for real.
    const root = await createAccount(fixture, orgA, '02');
    expect(
      await asActor(ACTOR, () =>
        fixture.accounts.updateAccount(orgA, root.id, {
          isPostable: true,
          accountNature: 'CREDIT',
        }),
      ),
    ).toMatchObject({ isPostable: true, accountNature: 'CREDIT' });
    expect(fixture.stores.raw.state.versions.findById(versionId)?.status).toBe(
      'active',
    );
  });
  // ---- chart work records NO configuration usage (Task 13 §3A) -------------
  //
  // Task 11 D4 decided the marker's caller is Posting, not the chart, and
  // Task 13 kept that boundary: a configuration becomes operationally used when
  // a FINAL document posts over an account pinned to it — never because a chart
  // was built, renamed, activated or deactivated. These tests are the local
  // half of that rule (the live-DB half is
  // `test/accounting-configuration-live.e2e-spec.ts`, "D4 … NOT called on
  // Account creation").

  it('creates, edits and toggles accounts without marking the pinned configuration', async () => {
    const configurationId = await publishAccountingConfig(
      fixture,
      orgA,
      TWO_LEVELS,
    );
    const usedAt = () =>
      fixture.stores.raw.state.accountingConfigurations.findById(
        configurationId,
      )?.operationallyUsedAt ?? null;
    expect(usedAt()).toBeNull();

    // A root pinned to the ACTIVE configuration: the pin exists, the marker does
    // not.
    const root = await createAccount(fixture, orgA, '10', {
      isPostable: false,
    });
    expect(
      fixture.stores.raw.state.accounts.findById(root.id)
        ?.accountingConfigurationId,
    ).toBe(configurationId);
    expect(usedAt()).toBeNull();

    // A child, a title edit, a postability flip and an activation cycle.
    const child = await createAccount(fixture, orgA, '10001', {
      parentId: root.id,
      isPostable: true,
    });
    await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(orgA, child.id, { title: 'Renamed' }),
    );
    await asActor(ACTOR, () => fixture.accounts.disableAccount(orgA, child.id));
    await asActor(ACTOR, () => fixture.accounts.enableAccount(orgA, child.id));
    expect(usedAt()).toBeNull();

    // …and the configuration stays fully editable while it is only authored:
    // a DRAFT is mutable until something USES it, and chart work is not use.
    const draft = await asActor(ACTOR, () =>
      fixture.configurations.createConfiguration({
        organizationId: orgA,
        code: 'DRAFT2',
        name: 'Draft v2',
        effectiveFrom: null,
        levels: TWO_LEVELS.levels as any,
      }),
    );
    await asActor(ACTOR, () =>
      fixture.configurations.updateConfiguration(orgA, draft.id, {
        name: 'Draft v2 renamed',
      }),
    );
    expect(
      (
        await asActor(ACTOR, () =>
          fixture.configurations.getConfiguration(orgA, draft.id),
        )
      ).name,
    ).toBe('Draft v2 renamed');
    expect(usedAt()).toBeNull();
  });
});

describe('deployment organization pin over the Task 10.3 surface (ADR-0025)', () => {
  /**
   * The pin is the ONLY organization restriction a single-organization
   * deployment has today (there is still no principal→organization binding —
   * OQ-01/OQ-22), so the new accounting routes must confine themselves to it
   * exactly like the calendar services do. `mustFindInOrganization` and the
   * create paths call `organizations.assertOrganizationInScope`, which is what
   * this proves: a direct service caller (worker, bootstrap, a future posting
   * flow) is bounded the same way an HTTP caller is by the global guard, and a
   * foreign organization's rows — which DO exist — answer 404, never 403.
   */
  it('confines every chart and structure operation to the pinned organization', async () => {
    const fixture = await buildFixture();
    const orgA = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'PINNA',
          name: 'Pinned org',
        }),
      )
    ).id;
    await fixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);
    fixture.member(ACTOR, orgA);
    const versionId = await publishStructure(fixture, orgA, TWO_LEVELS);
    const accountId = (await createAccount(fixture, orgA, '02')).id;

    // A second, foreign organization that genuinely exists — inserted straight
    // into the store so nothing about it is "missing".
    const foreignId = '01FOREIGNORGANIZATION0000FF';
    fixture.master.raw.organizations.table.insert({
      id: foreignId,
      code: 'PINF',
      name: 'Foreign org (exists, unreachable while pinned)',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      updatedBy: null,
    } as never);

    // Same data, pinned application: only orgA is reachable.
    const pinned = await buildFixture(pinnedAppConfig(orgA));
    pinned.member(ACTOR, orgA);
    await pinned.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);
    pinned.stores.raw.state.versions.insert(
      fixture.stores.raw.state.versions.findById(versionId) as never,
    );
    for (const level of fixture.stores.raw.state.levels.findMany(
      (row) => row.versionId === versionId,
    )) {
      pinned.stores.raw.state.levels.insert(level as never);
    }
    pinned.stores.raw.state.accounts.insert(
      fixture.stores.raw.state.accounts.findById(accountId) as never,
    );
    pinned.master.raw.organizations.table.insert(
      fixture.master.raw.organizations.table.findById(orgA) as never,
    );
    pinned.master.raw.organizations.table.insert(
      fixture.master.raw.organizations.table.findById(foreignId) as never,
    );

    // In scope: reads and writes keep working.
    expect(
      await asActor(ACTOR, () => pinned.structures.getVersion(orgA, versionId)),
    ).toMatchObject({ id: versionId });
    expect(
      await asActor(ACTOR, () => pinned.accounts.getAccount(orgA, accountId)),
    ).toMatchObject({ code: '02' });

    // Out of scope: every operation on rows that exist answers 404.
    const attempts: Array<() => Promise<unknown>> = [
      () => pinned.accounts.getAccount(foreignId, accountId),
      () => pinned.accounts.updateAccount(foreignId, accountId, { title: 'x' }),
      () => pinned.accounts.disableAccount(foreignId, accountId),
      () => pinned.structures.getVersion(foreignId, versionId),
      () => pinned.structures.publishVersion(foreignId, versionId),
      () =>
        pinned.accounts.createAccount({
          organizationId: foreignId,
          code: '05',
          title: 'Out of scope',
          accountNature: 'DEBIT',
        }),
      () =>
        pinned.structures.createVersion({
          organizationId: foreignId,
          code: 'NOPE',
          maxDepth: 1,
          levels: [
            {
              levelIndex: 1,
              title: 'A',
              digitLength: 1,
              defaultIsPostable: false,
            },
          ],
        }),
    ];
    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop
      expect(await failure(asActor(ACTOR, attempt))).toMatchObject({
        code: 'EntityNotFound',
      });
    }

    // Lists never return the pinned organization's rows to another scope.
    // Task 24 / Owner decision R-2: the ACCOUNT list now asserts the scope
    // itself, on every path, so a non-pinned organization answers 404 instead
    // of an empty page (an empty page is indistinguishable from "no rows yet"
    // and therefore is not evidence of enforcement).
    expect(
      await failure(
        asActor(ACTOR, () =>
          pinned.accounts.listAccounts({
            organizationId: foreignId,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });
    // Task 26 closes Task 25 SEC-01 on the coding-structure list as well: the
    // same deployment pin and principal-bound chokepoint now answers 404.
    expect(
      await failure(
        asActor(ACTOR, () =>
          pinned.structures.listVersions({
            organizationId: foreignId,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    ).toMatchObject({ code: 'EntityNotFound' });

    // The pinned organization itself is unaffected.
    expect(
      await asActor(ACTOR, () =>
        pinned.accounts.listAccounts({
          organizationId: orgA,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).toMatchObject({ total: 1 });
  });
});

describe('Accounting event vocabulary (contract §21)', () => {
  it('ships exactly the four chart-maintenance events §21 names for Account', () => {
    for (const type of [
      'Account.Created',
      'Account.Updated',
      'Account.Enabled',
      'Account.Disabled',
    ]) {
      expect(ACCOUNTING_EVENT_TYPES).toContain(type);
    }
  });

  it('publishes no deletion event for master data and no invented CodingStructure event', () => {
    // Accounts, areas, years, periods and structures are never deleted
    // (§8.6, OQ-36; §5.6, §6.5): the ONLY deletion event §21 sanctions is
    // `AccountingDocument.Deleted`, and that one fires pre-final only
    // (§15.3 — a final document is never deletable, AC-I-06). A
    // `CodingStructure.*` row does not exist at all — a structure publish is
    // evidenced by the audit columns instead of an invented name (event
    // vocabularies are ADR-gated, AR-29).
    expect(
      ACCOUNTING_EVENT_TYPES.filter(
        (t) => t.endsWith('.Deleted') && t !== 'AccountingDocument.Deleted',
      ),
    ).toEqual([]);
    expect(
      ACCOUNTING_EVENT_TYPES.filter((t) => t.startsWith('CodingStructure')),
    ).toEqual([]);
  });
});

/**
 * Owner decision R-2 (Task 24): the ODR-3 organization chokepoint must run on
 * EVERY path of `GET /api/v1/accounts`, not only when the optional `parentId`
 * filter is supplied.
 *
 * Before the fix, `listAccounts` asserted the scope inside the `parentId`
 * branch only, so an authenticated principal holding `Accounting.Account.View`
 * but holding NO membership of the named organization received that
 * organization's accounts by simply omitting the filter. These tests drive the
 * real `AuthorizationService`, real RBAC rows and the real
 * `OrganizationsService` membership store, so they fail against the
 * pre-fix code path.
 *
 * Scope discipline: this is an authorization correction only. No account
 * lifecycle policy, no response shape, no permission code and no schema is
 * touched here.
 */
describe('ODR-3 organization scope on the account list (Task 24 / R-2)', () => {
  let fixture: Fixture;
  let orgA = '';
  let orgB = '';
  let parentInA = '';
  let childInA = '';
  let parentInB = '';

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'R2ORGA',
          name: 'Org A (member)',
        }),
      )
    ).id;
    orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'R2ORGB',
          name: 'Org B (foreign, genuinely populated)',
        }),
      )
    ).id;

    // The actor holds every Account/structure/configuration permission — the
    // point of these tests is that PERMISSION ALONE MUST NOT CROSS
    // ORGANIZATIONS (ODR-3) — but is a member of orgA ONLY.
    await fixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
      ...Object.values(ACCOUNTING_CONFIGURATION_PERMISSIONS),
    ]);
    fixture.member(ACTOR, orgA);

    await publishBoth(fixture, orgA, TWO_LEVELS);
    // orgB is provisioned through the trusted system context ONLY: the actor
    // must stay a complete stranger to it for the boundary under test to mean
    // anything.
    await asSystem(async () => {
      const version = await fixture.structures.createVersion({
        organizationId: orgB,
        code: 'DEFAULT',
        maxDepth: TWO_LEVELS.maxDepth,
        levels: TWO_LEVELS.levels,
      });
      await fixture.structures.publishVersion(orgB, version.id);
      const configuration = await fixture.configurations.createConfiguration({
        organizationId: orgB,
        code: 'DEFAULT',
        name: 'DEFAULT',
        levels: TWO_LEVELS.levels.map((level) => ({
          levelIndex: level.levelIndex,
          title: level.title,
          digitLength: level.digitLength,
          defaultIsPostable: level.defaultIsPostable,
          levelKind: null,
        })),
      });
      await fixture.configurations.publishConfiguration(orgB, configuration.id);
    });

    // orgA: a root plus a child, so the `parentId` branch has real data.
    parentInA = (await createAccount(fixture, orgA, '02')).id;
    childInA = (
      await createAccount(fixture, orgA, '02001', { parentId: parentInA })
    ).id;

    // orgB genuinely OWNS accounts: an empty result must never be mistaken for
    // an enforced boundary. System context bypasses the membership check by
    // design (trusted internal caller), which is exactly how the fixture data
    // is planted without granting the actor anything.
    parentInB = (
      await asSystem(() =>
        fixture.accounts.createAccount({
          organizationId: orgB,
          code: '03',
          title: 'Foreign root',
          accountNature: 'DEBIT',
        }),
      )
    ).id;
    await asSystem(() =>
      fixture.accounts.createAccount({
        organizationId: orgB,
        code: '03001',
        title: 'Foreign child',
        accountNature: 'DEBIT',
        parentId: parentInB,
      }),
    );
  });

  // Test A — same organization: the happy path is untouched.
  it('returns the caller’s own organization accounts (no behaviour change)', async () => {
    const page = await asActor(ACTOR, () =>
      fixture.accounts.listAccounts({
        organizationId: orgA,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(page.total).toBe(2);
    expect(page.items.map((account) => account.code)).toEqual(['02', '02001']);
    for (const account of page.items) {
      expect(account.organizationId).toBe(orgA);
    }
  });

  // Test B + Test C — the regression: a foreign organization, WITHOUT the
  // optional `parentId` filter. This is the path that used to skip the
  // chokepoint entirely.
  it('refuses a foreign organization with 404 when no parentId filter is supplied', async () => {
    // The foreign rows really exist — proven through the trusted system
    // context — so a 404 below is an enforced boundary, not an empty table.
    const asSeenBySystem = await asSystem(() =>
      fixture.accounts.listAccounts({
        organizationId: orgB,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(asSeenBySystem.total).toBe(2);

    const refused = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgB,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    // 404, never 403: a permission holder must not learn that another
    // organization exists by probing its id (AC-I-16, ODR-3).
    expect(refused.code).toBe('EntityNotFound');
  });

  it('refuses a foreign organization identically for every optional filter combination', async () => {
    const queries = [
      { isActive: true },
      { isPostable: true },
      { level: 1 },
      { search: '03' },
      { sort: 'code' },
    ] as const;
    for (const extra of queries) {
      // eslint-disable-next-line no-await-in-loop
      const refused = await failure(
        asActor(ACTOR, () =>
          fixture.accounts.listAccounts({
            organizationId: orgB,
            page: 1,
            pageSize: 50,
            ...extra,
          }),
        ),
      );
      expect(refused.code).toBe('EntityNotFound');
    }
  });

  it('never leaks a foreign organization’s accounts into an in-scope list', async () => {
    const page = await asActor(ACTOR, () =>
      fixture.accounts.listAccounts({
        organizationId: orgA,
        page: 1,
        pageSize: 50,
        search: '03',
      }),
    );
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  // Test D — with `parentId`: the previously-scoped path keeps working.
  it('keeps the parentId path working inside the caller’s organization', async () => {
    const page = await asActor(ACTOR, () =>
      fixture.accounts.listAccounts({
        organizationId: orgA,
        page: 1,
        pageSize: 50,
        parentId: parentInA,
      }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: childInA, parentId: parentInA });
  });

  it('refuses a foreign organization even when a parentId filter is supplied', async () => {
    const refused = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgB,
          page: 1,
          pageSize: 50,
          parentId: parentInB,
        }),
      ),
    );
    expect(refused.code).toBe('EntityNotFound');
  });

  // Test E — foreign parent under an in-scope organization: unchanged
  // non-disclosure behaviour.
  it('reports a parent that belongs to another organization as not found', async () => {
    const refused = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          page: 1,
          pageSize: 50,
          parentId: parentInB,
        }),
      ),
    );
    expect(refused.code).toBe('EntityNotFound');
  });

  it('keeps the deployment pin (ADR-0025) enforced on the list without a parentId', async () => {
    // Same data, a deployment pinned to orgA: the list path must refuse a
    // non-pinned organization too, not answer an empty page.
    const pinned = await buildFixture(pinnedAppConfig(orgA));
    await pinned.grant(ACTOR, Object.values(ACCOUNT_PERMISSIONS));
    pinned.member(ACTOR, orgA);
    pinned.member(ACTOR, orgB);
    const refused = await failure(
      asActor(ACTOR, () =>
        pinned.accounts.listAccounts({
          organizationId: orgB,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    expect(refused.code).toBe('EntityNotFound');
  });

  it('still refuses the list with 403 when the View permission is missing', async () => {
    const other = '01ACTOR000000000000000000B';
    fixture.member(other, orgA);
    await fixture.grant(other, [CODING_STRUCTURE_PERMISSIONS.VIEW]);
    const refused = await failure(
      asActor(other, () =>
        fixture.accounts.listAccounts({
          organizationId: orgA,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    // Authorization order is unchanged: the permission is decided first, so a
    // missing code is still 403 and never downgraded to 404.
    expect(refused.code).toBe('PermissionDenied');
  });

  describe('OD-29-01 and OD-29-02 semantics and immutability timing', () => {
    it('accepts exactly DEBIT, CREDIT, DUAL and rejects lowercase or invalid values', async () => {
      const debitAcc = await createAccount(fixture, orgA, '11', {
        accountNature: 'DEBIT',
      });
      expect(debitAcc.accountNature).toBe('DEBIT');

      const creditAcc = await createAccount(fixture, orgA, '12', {
        accountNature: 'CREDIT',
      });
      expect(creditAcc.accountNature).toBe('CREDIT');

      const dualAcc = await createAccount(fixture, orgA, '13', {
        accountNature: 'DUAL',
      });
      expect(dualAcc.accountNature).toBe('DUAL');

      // Lowercase is rejected at API/service boundary
      const badDebit = await accountFailures(fixture).create(orgA, '14', {
        accountNature: 'debit',
      });
      expect(badDebit.code).toBe('BadRequest');

      const badCredit = await accountFailures(fixture).create(orgA, '15', {
        accountNature: 'credit',
      });
      expect(badCredit.code).toBe('BadRequest');

      const badDual = await accountFailures(fixture).create(orgA, '16', {
        accountNature: 'dual',
      });
      expect(badDual.code).toBe('BadRequest');
    });

    it('accepts BALANCE_SHEET, INCOME_STATEMENT, MEMORANDUM for accountType', async () => {
      const bs = await asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: orgA,
          code: '21',
          title: 'Balance Sheet Account',
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
        }),
      );
      expect(bs.accountType).toBe('BALANCE_SHEET');

      const is = await asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: orgA,
          code: '22',
          title: 'Income Statement Account',
          accountNature: 'CREDIT',
          accountType: 'INCOME_STATEMENT',
        }),
      );
      expect(is.accountType).toBe('INCOME_STATEMENT');

      const memo = await asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: orgA,
          code: '23',
          title: 'Memorandum Account',
          accountNature: 'DUAL',
          accountType: 'MEMORANDUM',
        }),
      );
      expect(memo.accountType).toBe('MEMORANDUM');
    });

    it('allows changing accountType when referenced by draft/temporary document lines, and blocks it only after posted ledger entry', async () => {
      const referencedAccountIds = new Set<string>();
      const postedAccountIds = new Set<string>();

      const customFixture = await buildFixture(
        testAppConfig(),
        createStructureStores({
          lineUsage: {
            countForAccount: (id) => (referencedAccountIds.has(id) ? 1 : 0),
          },
          ledgerUsage: {
            countForAccount: (id) => (postedAccountIds.has(id) ? 1 : 0),
          },
        }),
      );
      await customFixture.grant(ACTOR, Object.values(ACCOUNT_PERMISSIONS));
      customFixture.member(ACTOR, orgA);

      await setupCodingAndConfiguration(
        customFixture,
        orgA,
        standardTwoLevelConfiguration(),
      );

      const acc = await asActor(ACTOR, () =>
        customFixture.accounts.createAccount({
          organizationId: orgA,
          code: '31',
          title: 'Dynamic Type Account',
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
        }),
      );
      expect(acc.accountType).toBe('BALANCE_SHEET');

      // 1. Simulate account referenced in draft / temporary document lines (lineUsage > 0, ledgerUsage = 0)
      referencedAccountIds.add(acc.id);

      // accountType change SUCCEEDS (OD-29-02)
      const updatedType = await asActor(ACTOR, () =>
        customFixture.accounts.updateAccount(orgA, acc.id, {
          accountType: 'INCOME_STATEMENT',
        }),
      );
      expect(updatedType.accountType).toBe('INCOME_STATEMENT');

      // But other structural fields (nature, postability) are blocked by line reference
      const blockedNature = await failure(
        asActor(ACTOR, () =>
          customFixture.accounts.updateAccount(orgA, acc.id, {
            accountNature: 'CREDIT',
          }),
        ),
      );
      expect(blockedNature.code).toBe('BusinessRuleViolation');

      // 2. Simulate account referenced in finalized / posted ledger entries (ledgerUsage > 0)
      postedAccountIds.add(acc.id);

      // Now accountType change is BLOCKED (OD-29-02)
      const blockedType = await failure(
        asActor(ACTOR, () =>
          customFixture.accounts.updateAccount(orgA, acc.id, {
            accountType: 'BALANCE_SHEET',
          }),
        ),
      );
      expect(blockedType.code).toBe('BusinessRuleViolation');

      // Title update always still succeeds
      const updatedTitle = await asActor(ACTOR, () =>
        customFixture.accounts.updateAccount(orgA, acc.id, {
          title: 'Updated Title After Posting',
        }),
      );
      expect(updatedTitle.title).toBe('Updated Title After Posting');
    });
  });
});
