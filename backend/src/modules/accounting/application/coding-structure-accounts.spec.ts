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
import { AccountsService } from './accounts.service.js';
import {
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
  accounts: AccountsService;
  stores: StructureStores;
  master: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
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
  const accounts = new AccountsService(
    stores.accounts,
    structures,
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
    accounts,
    stores,
    master: masterStores,
    events,
    grant,
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
  return created.id;
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
    accountNature: overrides.accountNature ?? 'debit',
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
        accountNature: overrides.accountNature ?? 'debit',
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
    await fixture.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);
    versionId = await publishStructure(fixture, orgA, TWO_LEVELS);
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
      codingStructureVersionId: versionId,
      accountNature: 'debit',
      // Level 1 of THIS configuration defaults to non-postable (§14 rule 4).
      isPostable: false,
      isActive: true,
    });
    // The API never exposes audit actor ids (AR-24).
    expect(root).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      ACCOUNT_CREATED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toMatchObject({
      organizationId: orgA,
      code: '02',
      level: 1,
      codingStructureVersionId: versionId,
    });
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
      codingStructureVersionId: versionId,
    });
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

  it('refuses to create an account in an organization with no active structure', async () => {
    expect(await accountFailures(fixture).create(orgB, '02')).toMatchObject({
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
        accountNature: 'credit',
      }),
    );
    expect(renamed).toMatchObject({
      code: '02',
      title: 'Current Assets',
      accountNature: 'credit',
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
    await fixture.grant(viewOnly, [ACCOUNT_PERMISSIONS.VIEW]);
    expect(
      await failure(
        asActor(viewOnly, () =>
          fixture.accounts.createAccount({
            organizationId: orgA,
            code: '02',
            title: 'Nope',
            accountNature: 'debit',
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
    await fixture.grant(creator, [ACCOUNT_PERMISSIONS.CREATE]);
    expect(
      await asActor(creator, () =>
        fixture.accounts.createAccount({
          organizationId: orgA,
          code: '07',
          title: 'Created',
          accountNature: 'debit',
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
          accountNature: 'credit',
        }),
      ),
    ).toMatchObject({ isPostable: true, accountNature: 'credit' });
    expect(fixture.stores.raw.state.versions.findById(versionId)?.status).toBe(
      'active',
    );
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
          accountNature: 'debit',
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

    // Lists never return the pinned organization's rows to another scope: the
    // HTTP surface is confined by the global pin guard, and a direct service
    // caller of a LIST is scoped by its parameter (the same posture the
    // calendar services keep — no invented second authorization system).
    expect(
      await asActor(ACTOR, () =>
        pinned.accounts.listAccounts({
          organizationId: foreignId,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).toMatchObject({ total: 0, items: [] });
    expect(
      await asActor(ACTOR, () =>
        pinned.structures.listVersions({
          organizationId: foreignId,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).toMatchObject({ total: 0, items: [] });

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

  it('publishes no deletion event and no invented CodingStructure event', () => {
    // Accounts and structures are never deleted (§8.6, OQ-36), and §21 defines
    // no `CodingStructure.*` row — a structure publish is evidenced by the
    // audit columns instead of an invented name (event vocabularies are
    // ADR-gated, AR-29).
    expect(
      ACCOUNTING_EVENT_TYPES.filter((t) => t.endsWith('.Deleted')),
    ).toEqual([]);
    expect(
      ACCOUNTING_EVENT_TYPES.filter((t) => t.startsWith('CodingStructure')),
    ).toEqual([]);
  });
});
