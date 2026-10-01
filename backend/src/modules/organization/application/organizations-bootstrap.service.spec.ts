import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import {
  pinnedAppConfig,
  UNPINNED_APP_CONFIG,
} from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * `OrganizationsService.listMyOrganizations` — the organization BOOTSTRAP
 * read (Organization Bootstrap & Context Foundation task).
 *
 * The rule under test: this read is decided by MEMBERSHIP alone and carries
 * NO permission requirement (unlike `listOrganizations`, the
 * `Organization.Organization.View` administration catalog) — mirroring
 * `GET /license/current` / `GET /permissions/effective`. A principal with
 * every RBAC permission in the registry but no membership sees nothing; a
 * principal with no permission at all but a real membership sees exactly its
 * own organizations.
 */

const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';

const INSIDER = '01USERINSIDER000000000000A';
const OUTSIDER = '01USEROUTSIDER00000000000B';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

function buildOrganizations(
  masterStores: ReturnType<typeof createMasterDataStores>,
  config = UNPINNED_APP_CONFIG,
): OrganizationsService {
  const rbacStores = createInMemoryStores();
  const authorization = new AuthorizationService(
    rbacStores.userRoles,
    loggerStub(),
    licensingTestDouble(),
  );
  return new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    authorization,
    loggerStub(),
    new DomainEventBus(),
    config,
    licensingTestDouble(),
  );
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-bootstrap', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

async function seedOrganization(
  masterStores: ReturnType<typeof createMasterDataStores>,
  id: string,
  code: string,
  isActive = true,
): Promise<void> {
  const now = new Date();
  await masterStores.raw.organizations.create({
    id,
    code,
    name: code,
    isActive,
    createdAt: now,
    updatedAt: now,
  });
}

describe('OrganizationsService.listMyOrganizations — bootstrap discovery', () => {
  let masterStores: ReturnType<typeof createMasterDataStores>;

  beforeEach(() => {
    masterStores = createMasterDataStores();
  });

  it('returns [] for an authenticated user with no membership at all', async () => {
    await seedOrganization(masterStores, ORG_A, 'ORG-A');
    const organizations = buildOrganizations(masterStores);

    const result = await asActor(OUTSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(result).toEqual([]);
  });

  it('requires no RBAC permission — a plain member with zero permissions sees its own organization', async () => {
    await seedOrganization(masterStores, ORG_A, 'ORG-A');
    masterStores.raw.memberships.seed(INSIDER, ORG_A);
    const organizations = buildOrganizations(masterStores);

    const result = await asActor(INSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: ORG_A, code: 'ORG-A' });
  });

  it('isolation: membership of A does not leak organization B', async () => {
    await seedOrganization(masterStores, ORG_A, 'ORG-A');
    await seedOrganization(masterStores, ORG_B, 'ORG-B');
    masterStores.raw.memberships.seed(INSIDER, ORG_A);
    masterStores.raw.memberships.seed(OUTSIDER, ORG_B);
    const organizations = buildOrganizations(masterStores);

    const insiderView = await asActor(INSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(insiderView.map((o) => o.id)).toEqual([ORG_A]);

    const outsiderView = await asActor(OUTSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(outsiderView.map((o) => o.id)).toEqual([ORG_B]);
  });

  it('returns every organization the user has a membership of (multi-organization)', async () => {
    await seedOrganization(masterStores, ORG_A, 'ORG-A');
    await seedOrganization(masterStores, ORG_B, 'ORG-B');
    masterStores.raw.memberships.seed(INSIDER, ORG_A);
    masterStores.raw.memberships.seed(INSIDER, ORG_B);
    const organizations = buildOrganizations(masterStores);

    const result = await asActor(INSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(result.map((o) => o.code).sort()).toEqual(['ORG-A', 'ORG-B']);
  });

  it('excludes a disabled organization even when a membership row exists', async () => {
    await seedOrganization(masterStores, ORG_A, 'ORG-A', false);
    masterStores.raw.memberships.seed(INSIDER, ORG_A);
    const organizations = buildOrganizations(masterStores);

    const result = await asActor(INSIDER, () =>
      organizations.listMyOrganizations(),
    );
    expect(result).toEqual([]);
  });

  it('rejects when no principal is in flight (belt-and-braces, the route is behind AuthGuard)', async () => {
    const organizations = buildOrganizations(masterStores);
    await expect(
      runWithRequestContext({ correlationId: 'corr-anon' }, () =>
        organizations.listMyOrganizations(),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  describe('deployment pin (ADR-0025)', () => {
    it('returns the pinned organization only for a member of it', async () => {
      await seedOrganization(masterStores, ORG_A, 'MAIN');
      masterStores.raw.memberships.seed(INSIDER, ORG_A);
      const organizations = buildOrganizations(
        masterStores,
        pinnedAppConfig(ORG_A),
      );

      const result = await asActor(INSIDER, () =>
        organizations.listMyOrganizations(),
      );
      expect(result.map((o) => o.id)).toEqual([ORG_A]);
    });

    it('returns [] for a non-member even though the pinned organization exists', async () => {
      await seedOrganization(masterStores, ORG_A, 'MAIN');
      const organizations = buildOrganizations(
        masterStores,
        pinnedAppConfig(ORG_A),
      );

      const result = await asActor(OUTSIDER, () =>
        organizations.listMyOrganizations(),
      );
      expect(result).toEqual([]);
    });

    it('never returns a foreign organization even when the caller is a member of it', async () => {
      // ORG_B exists (e.g. left over from before the pin was configured) and
      // the caller is genuinely a member of it — the pin must still confine
      // the bootstrap read to the pinned organization only.
      await seedOrganization(masterStores, ORG_A, 'MAIN');
      await seedOrganization(masterStores, ORG_B, 'OTHER');
      masterStores.raw.memberships.seed(INSIDER, ORG_B);
      const organizations = buildOrganizations(
        masterStores,
        pinnedAppConfig(ORG_A),
      );

      const result = await asActor(INSIDER, () =>
        organizations.listMyOrganizations(),
      );
      expect(result).toEqual([]);
    });
  });
});
