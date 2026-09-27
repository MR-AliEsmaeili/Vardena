import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { seedUser } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import {
  pinnedAppConfig,
  UNPINNED_APP_CONFIG,
} from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from '../domain/organization-permissions.js';
import { OrganizationMembershipsService } from './organization-memberships.service.js';
import {
  DEPLOYMENT_ORGANIZATION_BOOTSTRAP_CODE,
  OrganizationsService,
} from './organizations.service.js';

/**
 * Installation bootstrap of the pinned deployment organization (ADR-0025) and
 * of the administrator's ordinary ODR-3 membership.
 *
 * Everything here is driven through the real services, the real
 * `AuthorizationService` and real RBAC rows, so a missing permission check or
 * a missing membership fails the test rather than passing silently.
 */

const PIN = '01ORGPINNED00000000000000A';
const ADMIN = '01ADMINUSER0000000000000AA';
const OTHER = '01OTHERUSER0000000000000BB';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function buildFixture(pinned: boolean) {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const bus = new DomainEventBus();
  await rbacStores.raw.permissions.syncDefinitions(
    [...ORGANIZATION_PERMISSION_DEFINITIONS],
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
    pinned ? pinnedAppConfig(PIN) : UNPINNED_APP_CONFIG,
  );
  const memberships = new OrganizationMembershipsService(
    masterStores.memberships,
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

  return { organizations, memberships, masterStores, grant };
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

describe('Deployment organization installation bootstrap', () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fixture = await buildFixture(true);
  });

  it('creates exactly the pinned organization on a fresh database', async () => {
    const result = await fixture.organizations.ensureDeploymentOrganization();

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.organization.id).toBe(PIN);
    expect(result!.organization.code).toBe(
      DEPLOYMENT_ORGANIZATION_BOOTSTRAP_CODE,
    );
    expect(result!.organization.isActive).toBe(true);
  });

  it('never creates a second organization when bootstrap is re-run', async () => {
    await fixture.organizations.ensureDeploymentOrganization();
    const second = await fixture.organizations.ensureDeploymentOrganization();
    const third = await fixture.organizations.ensureDeploymentOrganization();

    expect(second).toMatchObject({ created: false });
    expect(third).toMatchObject({ created: false });
    await expect(
      fixture.masterStores.organizations.findById(PIN),
    ).resolves.not.toBeNull();
    // A pinned deployment lists exactly one organization: its own.
    await fixture.grant(ADMIN, ['Organization.Organization.View']);
    const listed = await asActor(ADMIN, () =>
      fixture.organizations.listOrganizations({ page: 1, pageSize: 50 }),
    );
    expect(listed.total).toBe(1);
  });

  it('invents no organization when the deployment is not pinned', async () => {
    const unpinned = await buildFixture(false);
    await expect(
      unpinned.organizations.ensureDeploymentOrganization(),
    ).resolves.toBeNull();
  });

  it('is refused inside an HTTP request context (installation command only)', async () => {
    await expect(
      asActor(ADMIN, () =>
        fixture.organizations.ensureDeploymentOrganization(),
      ),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('gives the bootstrapped administrator ordinary ODR-3 access, and nobody else', async () => {
    await fixture.organizations.ensureDeploymentOrganization();
    // The installation command runs in system context, exactly as
    // `bootstrap:system-admin` does.
    await fixture.memberships.grantMembership(PIN, ADMIN);

    await fixture.grant(ADMIN, ['Organization.Organization.View']);
    await fixture.grant(OTHER, ['Organization.Organization.View']);

    await expect(
      asActor(ADMIN, () => fixture.organizations.getOrganization(PIN)),
    ).resolves.toMatchObject({ id: PIN });
    // Same permission, no membership: the ODR-3 chokepoint answers 404.
    await expect(
      asActor(OTHER, () => fixture.organizations.getOrganization(PIN)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('does not duplicate an existing membership on re-run', async () => {
    await fixture.organizations.ensureDeploymentOrganization();
    await fixture.memberships.grantMembership(PIN, ADMIN);

    await expect(
      fixture.memberships.grantMembership(PIN, ADMIN),
    ).rejects.toMatchObject({ code: 'Conflict' });
    const rows = await fixture.masterStores.memberships.listForOrganization({
      organizationId: PIN,
      skip: 0,
      take: 10,
    });
    expect(rows.total).toBe(1);
  });

  it('removes organization access when the membership is revoked', async () => {
    await fixture.organizations.ensureDeploymentOrganization();
    await fixture.memberships.grantMembership(PIN, ADMIN);
    await fixture.grant(ADMIN, [
      'Organization.Organization.View',
      'Organization.Membership.Revoke',
    ]);

    await asActor(ADMIN, () =>
      fixture.memberships.revokeMembership(PIN, ADMIN),
    );

    await expect(
      asActor(ADMIN, () => fixture.organizations.getOrganization(PIN)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('keeps permission and membership independent: membership alone is not authority', async () => {
    await fixture.organizations.ensureDeploymentOrganization();
    // Member of the pinned organization, but holding no
    // Organization.Organization.View permission at all.
    await fixture.memberships.grantMembership(PIN, OTHER);

    await expect(
      asActor(OTHER, () => fixture.organizations.getOrganization(PIN)),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
});
