import { describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { PasswordService } from '../../users/domain/password.service.js';
import { UsersService } from '../../users/application/users.service.js';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

function organizationsFixture(limit: number) {
  const rbac = createInMemoryStores();
  const master = createMasterDataStores();
  const licensing = licensingTestDouble({ organizationLimit: limit });
  const authorization = new AuthorizationService(
    rbac.userRoles,
    loggerStub(),
    licensing,
  );
  const service = new OrganizationsService(
    master.organizations,
    master.memberships,
    authorization,
    loggerStub(),
    new DomainEventBus(),
    UNPINNED_APP_CONFIG,
    licensing,
  );
  return { service, master };
}

function usersFixture(limit: number) {
  const stores = createInMemoryStores();
  const licensing = licensingTestDouble({ userLimit: limit });
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
    licensing,
  );
  const service = new UsersService(
    stores.users,
    new PasswordService(),
    authorization,
    loggerStub(),
    new DomainEventBus(),
    licensing,
  );
  return { service, stores };
}

function outcomeCounts(results: PromiseSettledResult<unknown>[]) {
  return {
    fulfilled: results.filter(({ status }) => status === 'fulfilled').length,
    rejected: results.filter(({ status }) => status === 'rejected').length,
  };
}

describe('concurrency-safe licensed allocations', () => {
  it('admits exactly one of two concurrent organization creates at limit 1', async () => {
    const { service, master } = organizationsFixture(1);
    const results = await Promise.allSettled([
      service.createOrganization({ code: 'A', name: 'A' }),
      service.createOrganization({ code: 'B', name: 'B' }),
    ]);
    expect(outcomeCounts(results)).toEqual({ fulfilled: 1, rejected: 1 });
    expect(master.raw.organizations.table.size).toBe(1);
  });

  it('admits no more than two concurrent organization creates at limit 2', async () => {
    const { service, master } = organizationsFixture(2);
    const results = await Promise.allSettled(
      ['A', 'B', 'C', 'D'].map((code) =>
        service.createOrganization({ code, name: code }),
      ),
    );
    expect(outcomeCounts(results)).toEqual({ fulfilled: 2, rejected: 2 });
    expect(master.raw.organizations.table.size).toBe(2);
  });

  it('admits exactly one of two concurrent active-user creates at limit 1', async () => {
    const { service, stores } = usersFixture(1);
    const results = await Promise.allSettled([
      service.createUser({ username: 'one', password: 'secret' }),
      service.createUser({ username: 'two', password: 'secret' }),
    ]);
    expect(outcomeCounts(results)).toEqual({ fulfilled: 1, rejected: 1 });
    await expect(stores.raw.users.countActive()).resolves.toBe(1);
  });

  it('admits no more than two concurrent active-user creates at limit 2', async () => {
    const { service, stores } = usersFixture(2);
    const results = await Promise.allSettled(
      ['one', 'two', 'three', 'four'].map((username) =>
        service.createUser({ username, password: 'secret' }),
      ),
    );
    expect(outcomeCounts(results)).toEqual({ fulfilled: 2, rejected: 2 });
    await expect(stores.raw.users.countActive()).resolves.toBe(2);
  });

  it('serializes concurrent re-enables and refuses them when the active-user limit is consumed', async () => {
    const { service, stores } = usersFixture(1);
    await service.createUser({ username: 'active', password: 'secret' });
    const disabled = await Promise.all(
      ['disabled-a', 'disabled-b'].map((username) =>
        service.createUser({ username, password: 'secret', isActive: false }),
      ),
    );
    const results = await Promise.allSettled(
      disabled.map(({ id }) => service.enableUser(id)),
    );
    expect(outcomeCounts(results)).toEqual({ fulfilled: 0, rejected: 2 });
    await expect(stores.raw.users.countActive()).resolves.toBe(1);
  });
});
