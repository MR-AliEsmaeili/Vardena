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
import { AccountingDocumentLinesRepository } from '../data/accounting-document-lines.repository.js';
import {
  ACCOUNTING_PERMISSION_DEFINITIONS,
  ACCOUNT_PERMISSIONS,
} from '../domain/accounting-permissions.js';
import type { AccountRecord } from '../../../../test/support/accounting-structure-repositories.js';

/**
 * ODR-1 (Task 19) — Explicit Configuration Coherence, applied end-to-end
 * through the REAL `AccountsService`.
 *
 * What this proves beyond the domain decision-table spec: the guard runs on
 * every write that establishes or re-validates an account's two pins (root
 * create, child create, move), the refusal surfaces as the API contract's
 * 422 `BusinessRuleViolation` (never a silent pin choice), no row is
 * persisted when the pair diverges, and READS are never blocked — existing
 * accounts stay listable and gettable while the organization's ACTIVE pair
 * is divergent, and a coherent pinned account stays movable. Divergent
 * legacy rows are seeded directly into the store (the service itself can no
 * longer produce them — that is the point of the rule) exactly like the
 * repository-boundary specs do for superseded versions.
 */

const ACTOR = '01ACTOR000000000000000000A';

/** The coherent 2 + 3 layout. */
const COHERENT = [
  { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
  {
    levelIndex: 2,
    title: 'Subsidiary',
    digitLength: 3,
    defaultIsPostable: true,
    levelKind: 'subsidiary',
  },
];

/** Same level count, different level-2 width — digit-length divergence. */
const CODING_NARROW = [
  { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
  {
    levelIndex: 2,
    title: 'Subsidiary',
    digitLength: 2,
    defaultIsPostable: true,
    levelKind: 'subsidiary',
  },
];

/** Fewer levels than the configuration — level-count divergence. */
const CODING_FLAT = [
  { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: true },
];

type LevelConfig = (typeof COHERENT)[number] & { levelKind?: string | null };

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
  void bus;
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
    stores,
    grant,
    member: (userId: string, organizationId: string) => {
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

/** Publish ONLY a coding-structure version (configuration untouched). */
async function publishCoding(
  fixture: Fixture,
  organizationId: string,
  code: string,
  levels: readonly LevelConfig[],
): Promise<string> {
  await fixture.grant(ACTOR, ['Accounting.CodingStructure.Configure']);
  const created = await asActor(ACTOR, () =>
    fixture.structures.createVersion({
      organizationId,
      code,
      maxDepth: levels.length,
      levels: levels as never,
    }),
  );
  await asActor(ACTOR, () =>
    fixture.structures.publishVersion(organizationId, created.id),
  );
  return created.id;
}

/** Publish ONLY an accounting configuration (coding untouched). */
async function publishConfig(
  fixture: Fixture,
  organizationId: string,
  code: string,
  levels: readonly LevelConfig[],
): Promise<string> {
  await fixture.grant(ACTOR, ['Accounting.AccountingConfiguration.Configure']);
  const created = await asActor(ACTOR, () =>
    fixture.configurations.createConfiguration({
      organizationId,
      code,
      name: code,
      levels: levels.map((level) => ({
        levelIndex: level.levelIndex,
        title: level.title,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
        levelKind: level.levelKind ?? null,
      })),
    }),
  );
  await asActor(ACTOR, () =>
    fixture.configurations.publishConfiguration(organizationId, created.id),
  );
  return created.id;
}

/** Seed a legacy-style account row whose pins the service could not refuse. */
function seedAccountRow(
  fixture: Fixture,
  row: {
    id: string;
    organizationId: string;
    code: string;
    parentId: string | null;
    level: number;
    codingStructureVersionId: string;
    accountingConfigurationId: string;
    isPostable?: boolean;
  },
): void {
  const record: AccountRecord = {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: `Legacy ${row.code}`,
    parentId: row.parentId,
    level: row.level,
    codingStructureVersionId: row.codingStructureVersionId,
    accountingConfigurationId: row.accountingConfigurationId,
    accountNature: 'debit',
    isPostable: row.isPostable ?? false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
  };
  fixture.stores.raw.state.accounts.insert(record);
}

describe('AccountsService — ODR-1 pin coherence (Explicit Configuration Coherence)', () => {
  let fixture: Fixture;
  let org: string;

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
    fixture.member(ACTOR, org);
    await fixture.grant(ACTOR, [
      'Accounting.CodingStructure.View',
      'Accounting.CodingStructure.Configure',
      'Accounting.AccountingConfiguration.View',
      'Accounting.AccountingConfiguration.Configure',
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);
  });

  it('accepts a coherent ACTIVE pair — root and child creation still work', async () => {
    await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    await publishConfig(fixture, org, 'DEFAULT', COHERENT);

    const root = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10',
        title: 'Cash',
        accountNature: 'debit',
      }),
    );
    const child = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10101',
        title: 'Cash — local',
        accountNature: 'debit',
        parentId: root.id,
      }),
    );
    expect(root.code).toBe('10');
    expect(child.parentId).toBe(root.id);
  });

  it('refuses a root creation whose ACTIVE pins disagree on digit length — 422, no row', async () => {
    await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    await publishConfig(fixture, org, 'DEFAULT', COHERENT);
    // Supersede the coding structure with a narrower level 2 — the ACTIVE
    // configuration still describes 2 + 3.
    await publishCoding(fixture, org, 'DEFAULT', CODING_NARROW);

    const result = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: org,
          code: '20',
          title: 'Receivables',
          accountNature: 'debit',
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details.rule).toBe('coding_digit_length_mismatch');
    expect(result.message).toMatch(/digit lengths/i);

    // Fail closed: nothing was persisted under a divergent pair.
    const rows = fixture.stores.raw.state.accounts.findMany(
      (row) => row.organizationId === org,
    );
    expect(rows.map((row) => row.code)).toEqual([]);
  });

  it('refuses a root creation whose ACTIVE pins disagree on level count', async () => {
    await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    await publishConfig(fixture, org, 'DEFAULT', COHERENT);
    await publishCoding(fixture, org, 'DEFAULT', CODING_FLAT);

    const result = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: org,
          code: '20',
          title: 'Receivables',
          accountNature: 'debit',
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details.rule).toBe('coding_level_count_mismatch');
  });

  it('refuses a child creation under a legacy parent with divergent pins', async () => {
    await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    const configId = await publishConfig(fixture, org, 'DEFAULT', COHERENT);
    const narrowCodingId = await publishCoding(
      fixture,
      org,
      'DEFAULT',
      CODING_NARROW,
    );
    // Legacy row: the pair (narrowCoding, coherentConfig) diverges at
    // level 2 — exactly what OQ-62/OQ-63 must eventually repair. The service
    // can no longer create it; the store accepts it directly.
    seedAccountRow(fixture, {
      id: 'legacy-root-00000000000001',
      organizationId: org,
      code: '20',
      parentId: null,
      level: 1,
      codingStructureVersionId: narrowCodingId,
      accountingConfigurationId: configId,
    });

    const result = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: org,
          code: '20101',
          title: 'Receivables — EU',
          accountNature: 'debit',
          parentId: 'legacy-root-00000000000001',
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details.rule).toBe('coding_digit_length_mismatch');
  });

  it('refuses a move of a legacy account with divergent pins', async () => {
    await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    const configId = await publishConfig(fixture, org, 'DEFAULT', COHERENT);

    // Target parent is created while the ACTIVE pair is still coherent.
    const target = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10',
        title: 'Cash',
        accountNature: 'debit',
      }),
    );
    const narrowCodingId = await publishCoding(
      fixture,
      org,
      'DEFAULT',
      CODING_NARROW,
    );
    seedAccountRow(fixture, {
      id: 'legacy-child-00000000000001',
      organizationId: org,
      code: '30101',
      parentId: null,
      level: 2,
      codingStructureVersionId: narrowCodingId,
      accountingConfigurationId: configId,
    });

    const result = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.updateAccount(org, 'legacy-child-00000000000001', {
          parentId: target.id,
        }),
      ),
    );
    expect(result.code).toBe('BusinessRuleViolation');
    expect(result.details.rule).toBe('coding_digit_length_mismatch');
  });

  it('reads are never blocked by a divergent ACTIVE pair, and coherent pins stay movable', async () => {
    const codingId = await publishCoding(fixture, org, 'DEFAULT', COHERENT);
    const configId = await publishConfig(fixture, org, 'DEFAULT', COHERENT);

    const cash = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10',
        title: 'Cash',
        accountNature: 'debit',
      }),
    );
    const bank = await asActor(ACTOR, () =>
      fixture.accounts.createAccount({
        organizationId: org,
        code: '10101',
        title: 'Cash — bank',
        accountNature: 'debit',
        parentId: cash.id,
      }),
    );
    expect(bank.codingStructureVersionId).toBe(codingId);

    // A level-1 code currently sitting under a parent — the shape the move
    // path exists to undo, and the only movable shape under immutable codes
    // (same construction as the repository boundary spec's CONTROL case; the
    // service cannot create it, which is exactly why it is seeded).
    seedAccountRow(fixture, {
      id: 'movable-000000000000000001',
      organizationId: org,
      code: '20',
      parentId: cash.id,
      level: 1,
      codingStructureVersionId: codingId,
      accountingConfigurationId: configId,
    });

    // Diverge the ACTIVE pair (coding narrows level 2, configuration stays).
    await publishCoding(fixture, org, 'DEFAULT', CODING_NARROW);

    // Reads still work — existing rows stay visible and gettable.
    const listed = await asActor(ACTOR, () =>
      fixture.accounts.listAccounts({
        organizationId: org,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(listed.items.map((item) => item.code).sort()).toEqual([
      '10',
      '10101',
      '20',
    ]);
    const fetched = await asActor(ACTOR, () =>
      fixture.accounts.getAccount(org, bank.id),
    );
    expect(fetched.code).toBe('10101');

    // A coherent-pinned account still moves: the move re-validates the
    // account's OWN pair (coherent coding + config), not the organization's
    // now divergent ACTIVE pair.
    const moved = await asActor(ACTOR, () =>
      fixture.accounts.updateAccount(org, 'movable-000000000000000001', {
        parentId: null,
      }),
    );
    expect(moved.parentId).toBeNull();

    // But a NEW root under the divergent ACTIVE pair is still refused.
    const refused = await failure(
      asActor(ACTOR, () =>
        fixture.accounts.createAccount({
          organizationId: org,
          code: '30',
          title: 'Equity',
          accountNature: 'credit',
        }),
      ),
    );
    expect(refused.code).toBe('BusinessRuleViolation');
    expect(refused.details.rule).toBe('coding_digit_length_mismatch');
  });
});
