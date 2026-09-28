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
  ACCOUNT_CREATED_EVENT,
  ACCOUNT_UPDATED_EVENT,
} from '../domain/accounting.events.js';

const ACTOR = '01ACTOR000000000000000000A';

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

interface Fixture {
  organizations: OrganizationsService;
  structures: CodingStructuresService;
  configurations: AccountingConfigurationsService;
  accounts: AccountsService;
  stores: StructureStores;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
  member: (userId: string, organizationId: string) => void;
}

async function buildFixture(): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const stores = createStructureStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [ACCOUNT_CREATED_EVENT, ACCOUNT_UPDATED_EVENT]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

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
    events,
    grant,
    member: (userId: string, organizationId: string) => {
      masterStores.raw.memberships.seed(userId, organizationId);
    },
  };
}

function asActor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      correlationId: 'corr-1',
      principal: { userId, sessionId: 'sess' },
    },
    fn,
  );
}

function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

describe('Task 30 Accounting Domain (OD-29-01, OD-29-02, OD-29-03)', () => {
  let fx: Fixture;
  let orgId: string;

  beforeEach(async () => {
    fx = await buildFixture();
    await fx.grant(ACTOR, [
      ...Object.values(CODING_STRUCTURE_PERMISSIONS),
      ...Object.values(ACCOUNTING_CONFIGURATION_PERMISSIONS),
      ...Object.values(ACCOUNT_PERMISSIONS),
    ]);

    const org = await asSystem(() =>
      fx.organizations.createOrganization({
        code: 'ORG_T30',
        name: 'Task 30 Org',
      }),
    );
    orgId = org.id;
    fx.member(ACTOR, orgId);

    const draftCoding = await asActor(ACTOR, () =>
      fx.structures.createVersion({
        organizationId: orgId,
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '-',
        levels: TWO_LEVELS.levels,
      }),
    );
    await asActor(ACTOR, () =>
      fx.structures.publishVersion(orgId, draftCoding.id),
    );

    const draftConfig = await asActor(ACTOR, () =>
      fx.configurations.createConfiguration({
        organizationId: orgId,
        code: 'DEFAULT',
        name: 'Default Config',
        levels: TWO_LEVELS.levels.map((l) => ({
          levelIndex: l.levelIndex,
          title: l.title,
          digitLength: l.digitLength,
          defaultIsPostable: l.defaultIsPostable,
          levelKind: l.levelKind ?? null,
        })),
      }),
    );
    await asActor(ACTOR, () =>
      fx.configurations.publishConfiguration(orgId, draftConfig.id),
    );
  });

  describe('OD-29-01: Dual Nature Account Support', () => {
    it('creates root account with DUAL nature and retrieves it correctly', async () => {
      const created = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '10',
          title: 'Cash and Bank Clearing (Dual)',
          parentId: null,
          accountNature: 'DUAL',
          accountType: 'BALANCE_SHEET',
          isPostable: false,
        }),
      );

      expect(created.accountNature).toBe('DUAL');
      expect(created.accountType).toBe('BALANCE_SHEET');

      const fetched = await asActor(ACTOR, () =>
        fx.accounts.getAccount(orgId, created.id),
      );
      expect(fetched.accountNature).toBe('DUAL');
    });

    it('creates debit and credit accounts successfully', async () => {
      const debit = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '20',
          title: 'Assets (Debit)',
          parentId: null,
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
          isPostable: false,
        }),
      );
      expect(debit.accountNature).toBe('DEBIT');

      const credit = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '30',
          title: 'Liabilities (Credit)',
          parentId: null,
          accountNature: 'CREDIT',
          accountType: 'BALANCE_SHEET',
          isPostable: false,
        }),
      );
      expect(credit.accountNature).toBe('CREDIT');
    });
  });

  describe('OD-29-02: Account Type Support & Immutability', () => {
    it('supports BALANCE_SHEET, INCOME_STATEMENT, MEMORANDUM account types', async () => {
      const bs = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '40',
          title: 'BS Account',
          parentId: null,
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
          isPostable: false,
        }),
      );
      expect(bs.accountType).toBe('BALANCE_SHEET');

      const is = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '50',
          title: 'IS Account',
          parentId: null,
          accountNature: 'CREDIT',
          accountType: 'INCOME_STATEMENT',
          isPostable: false,
        }),
      );
      expect(is.accountType).toBe('INCOME_STATEMENT');

      const memo = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '60',
          title: 'Memo Account',
          parentId: null,
          accountNature: 'DUAL',
          accountType: 'MEMORANDUM',
          isPostable: false,
        }),
      );
      expect(memo.accountType).toBe('MEMORANDUM');
    });
  });

  describe('OD-29-03: Controlled Destructive Unlink Account ↔ Detail Group', () => {
    it('creates account linked to detail group and requires confirmation to unlink', async () => {
      const account = await asActor(ACTOR, () =>
        fx.accounts.createAccount({
          organizationId: orgId,
          code: '70',
          title: 'Account With Detail Group',
          parentId: null,
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
          detailGroupId: 'det-group-01',
          isPostable: false,
        }),
      );

      expect(account.detailGroupId).toBe('det-group-01');

      // Attempt to unlink without confirmation throws businessRule/badRequest exception
      await expect(
        asActor(ACTOR, () =>
          fx.accounts.unlinkDetailGroup(orgId, account.id, false),
        ),
      ).rejects.toThrow();

      // Unlink with confirmation succeeds
      const unlinked = await asActor(ACTOR, () =>
        fx.accounts.unlinkDetailGroup(orgId, account.id, true),
      );

      expect(unlinked.detailGroupId).toBeNull();

      const refetched = await asActor(ACTOR, () =>
        fx.accounts.getAccount(orgId, account.id),
      );
      expect(refetched.detailGroupId).toBeNull();
    });
  });
});
