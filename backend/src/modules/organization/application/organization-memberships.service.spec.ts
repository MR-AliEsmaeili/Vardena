import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from '../domain/organization-permissions.js';
import { OrganizationMembershipsService } from './organization-memberships.service.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * ODR-3 membership-administration boundary (Task 19 post-merge correction).
 *
 * The rule under test:
 *
 * - Holding `Organization.Membership.{View,Grant,Revoke}` is NEVER by itself
 *   authority over an arbitrary `organizationId`. The acting principal must
 *   also be a MEMBER of the target organization.
 * - The ONE exception is bootstrap: the FIRST member of an organization whose
 *   membership set is empty may be granted by a non-member holding
 *   `Organization.Membership.Grant`. It applies to grant only, ends as soon
 *   as one member exists, and is re-entered only if the set becomes empty
 *   again.
 * - A non-member always gets **404**, never 403: the API must not reveal that
 *   an organization exists but the caller is outside it.
 *
 * Everything runs through the REAL `AuthorizationService` and REAL RBAC
 * repositories inside a real request context, so a service that lost its
 * permission check or its membership check fails here.
 */

const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';
const UNKNOWN_ORG = '01UNKNOWNORG0000000000000U';

const INSIDER = '01USERINSIDER000000000000A';
const OUTSIDER = '01USEROUTSIDER00000000000B';
const TARGET = '01USERTARGET00000000000000';
const SECOND_TARGET = '01USERTARGET2000000000000C';

const VIEW = 'Organization.Membership.View';
const GRANT = 'Organization.Membership.Grant';
const REVOKE = 'Organization.Membership.Revoke';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  memberships: OrganizationMembershipsService;
  organizations: OrganizationsService;
  stores: ReturnType<typeof createMasterDataStores>;
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
}

async function buildFixture(): Promise<Fixture> {
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
    licensingTestDouble(),
  );
  const organizations = new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const memberships = new OrganizationMembershipsService(
    masterStores.memberships,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );

  // Two organizations exist; nobody is a member of either yet.
  const now = new Date();
  for (const [id, code] of [
    [ORG_A, 'ORG-A'],
    [ORG_B, 'ORG-B'],
  ] as const) {
    await masterStores.raw.organizations.create({
      id,
      code,
      name: code,
      isActive: true,
      timeZone: 'Asia/Tehran',
      createdAt: now,
      updatedAt: now,
    });
  }

  let roleSeq = 0;
  async function grant(
    userId: string,
    codes: readonly string[],
  ): Promise<void> {
    await seedUser(rbacStores, { id: userId });
    if (codes.length === 0) return;
    const permissionIds = (
      await rbacStores.raw.permissions.findByCodes(codes)
    ).map((permission) => permission.id);
    // A missing code must fail loudly rather than silently granting nothing.
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
      now: new Date(),
      createdBy: null,
    });
    await rbacStores.raw.userRoles.assign({
      userId,
      roleId,
      now: new Date(),
      createdBy: null,
    });
  }

  return { memberships, organizations, stores: masterStores, grant };
}

/** Run as an authenticated HTTP-equivalent principal (request context). */
function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

const PAGE = { page: 1, pageSize: 20 };

describe('OrganizationMembershipsService — ODR-3 administration boundary', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  // ---- Bootstrap ----------------------------------------------------------

  describe('bootstrap (organization with zero members)', () => {
    it('lets a NON-MEMBER holding Grant create the FIRST membership', async () => {
      await fixture.grant(OUTSIDER, [GRANT]);
      await seedUserOnly(fixture, TARGET);

      expect(await fixture.stores.raw.memberships.hasAnyMember(ORG_A)).toBe(
        false,
      );
      await asActor(OUTSIDER, () =>
        fixture.memberships.grantMembership(ORG_A, TARGET),
      );

      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
      ).not.toBeNull();
      // The grantor did NOT become a member as a side effect.
      expect(
        await fixture.stores.raw.memberships.findMembership(OUTSIDER, ORG_A),
      ).toBeNull();
    });

    it('does NOT extend the exception to listing an empty organization', async () => {
      await fixture.grant(OUTSIDER, [VIEW]);
      await expect(
        asActor(OUTSIDER, () => fixture.memberships.listMembers(ORG_A, PAGE)),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });

    it('does NOT extend the exception to revoking on an empty organization', async () => {
      await fixture.grant(OUTSIDER, [REVOKE]);
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.revokeMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  });

  // ---- After bootstrap ----------------------------------------------------

  describe('after bootstrap (organization with at least one member)', () => {
    beforeEach(async () => {
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      await seedUserOnly(fixture, TARGET);
      await seedUserOnly(fixture, SECOND_TARGET);
    });

    it('refuses a SECOND grant by a non-member holding Grant (404)', async () => {
      await fixture.grant(OUTSIDER, [GRANT]);
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
      ).toBeNull();
    });

    it('allows a MEMBER holding Grant to grant another user', async () => {
      await fixture.grant(INSIDER, [GRANT]);
      await asActor(INSIDER, () =>
        fixture.memberships.grantMembership(ORG_A, TARGET),
      );
      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
      ).not.toBeNull();
    });

    it('refuses listing by a non-member holding View (404)', async () => {
      await fixture.grant(OUTSIDER, [VIEW]);
      await expect(
        asActor(OUTSIDER, () => fixture.memberships.listMembers(ORG_A, PAGE)),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });

    it('allows listing by a MEMBER holding View', async () => {
      await fixture.grant(INSIDER, [VIEW]);
      const page = await asActor(INSIDER, () =>
        fixture.memberships.listMembers(ORG_A, PAGE),
      );
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        userId: INSIDER,
        organizationId: ORG_A,
      });
      // Audit actor ids are never exposed (AR-24).
      expect(page.items[0]).not.toHaveProperty('createdBy');
    });

    it('refuses revoking by a non-member holding Revoke (404)', async () => {
      await fixture.grant(OUTSIDER, [REVOKE]);
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.revokeMembership(ORG_A, INSIDER),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      // The membership survived the refused call.
      expect(
        await fixture.stores.raw.memberships.findMembership(INSIDER, ORG_A),
      ).not.toBeNull();
    });

    it('allows revoking by a MEMBER holding Revoke', async () => {
      fixture.stores.raw.memberships.seed(TARGET, ORG_A);
      await fixture.grant(INSIDER, [REVOKE]);
      await asActor(INSIDER, () =>
        fixture.memberships.revokeMembership(ORG_A, TARGET),
      );
      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
      ).toBeNull();
    });

    it('refuses a duplicate grant with 409 (the member path is authorized)', async () => {
      await fixture.grant(INSIDER, [GRANT]);
      await expect(
        asActor(INSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, INSIDER),
        ),
      ).rejects.toMatchObject({ code: 'Conflict' });
    });
  });

  // ---- The last member ----------------------------------------------------

  describe('the last member', () => {
    it('re-enters bootstrap when the last member revokes themselves', async () => {
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      await fixture.grant(INSIDER, [REVOKE]);
      await fixture.grant(OUTSIDER, [GRANT]);
      await seedUserOnly(fixture, TARGET);

      // Before: the outsider cannot grant — the organization has a member.
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      // The last member revokes themselves; the set becomes empty.
      await asActor(INSIDER, () =>
        fixture.memberships.revokeMembership(ORG_A, INSIDER),
      );
      expect(await fixture.stores.raw.memberships.hasAnyMember(ORG_A)).toBe(
        false,
      );

      // After: the first grant is possible again (bootstrap, not a bypass).
      await asActor(OUTSIDER, () =>
        fixture.memberships.grantMembership(ORG_A, TARGET),
      );
      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
      ).not.toBeNull();

      // …and it closes again immediately: the next grant needs membership.
      await seedUserOnly(fixture, SECOND_TARGET);
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, SECOND_TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  });

  // ---- Permission vs membership ------------------------------------------

  describe('permission and membership are both required', () => {
    it('answers 403 for a MEMBER without the permission', async () => {
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      await fixture.grant(INSIDER, []);
      await seedUserOnly(fixture, TARGET);

      await expect(
        asActor(INSIDER, () => fixture.memberships.listMembers(ORG_A, PAGE)),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      await expect(
        asActor(INSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      await expect(
        asActor(INSIDER, () =>
          fixture.memberships.revokeMembership(ORG_A, INSIDER),
        ),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
    });

    it('answers 404 (never 403) for a NON-MEMBER holding every permission', async () => {
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      await fixture.grant(OUTSIDER, [VIEW, GRANT, REVOKE]);
      await seedUserOnly(fixture, TARGET);

      await expect(
        asActor(OUTSIDER, () => fixture.memberships.listMembers(ORG_A, PAGE)),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.revokeMembership(ORG_A, INSIDER),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  });

  // ---- Tenant isolation ---------------------------------------------------

  describe('tenant isolation', () => {
    it('does not let a member of A administer the memberships of B', async () => {
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      fixture.stores.raw.memberships.seed(TARGET, ORG_B);
      await fixture.grant(INSIDER, [VIEW, GRANT, REVOKE]);
      await seedUserOnly(fixture, SECOND_TARGET);

      await expect(
        asActor(INSIDER, () => fixture.memberships.listMembers(ORG_B, PAGE)),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        asActor(INSIDER, () =>
          fixture.memberships.grantMembership(ORG_B, SECOND_TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        asActor(INSIDER, () =>
          fixture.memberships.revokeMembership(ORG_B, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      // B is untouched; A stays administrable for the same principal.
      expect(
        await fixture.stores.raw.memberships.findMembership(TARGET, ORG_B),
      ).not.toBeNull();
      const page = await asActor(INSIDER, () =>
        fixture.memberships.listMembers(ORG_A, PAGE),
      );
      expect(page.total).toBe(1);
    });

    it('does not let the bootstrap exception of B leak A administration', async () => {
      // B is empty → the outsider may bootstrap B, and ONLY B.
      fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
      await fixture.grant(OUTSIDER, [GRANT]);
      await seedUserOnly(fixture, TARGET);

      await asActor(OUTSIDER, () =>
        fixture.memberships.grantMembership(ORG_B, TARGET),
      );
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(ORG_A, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  });

  // ---- Unknown organization ----------------------------------------------

  describe('unknown organization', () => {
    it('keeps the 404 posture for every operation', async () => {
      await fixture.grant(OUTSIDER, [VIEW, GRANT, REVOKE]);
      await seedUserOnly(fixture, TARGET);

      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.listMembers(UNKNOWN_ORG, PAGE),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      // The bootstrap path must not turn an unknown id into a usable one.
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.grantMembership(UNKNOWN_ORG, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        asActor(OUTSIDER, () =>
          fixture.memberships.revokeMembership(UNKNOWN_ORG, TARGET),
        ),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  });

  // ---- System context -----------------------------------------------------

  it('keeps the trusted-caller posture in system context (no request)', async () => {
    // No HTTP request in flight (bootstrap script, worker, direct call):
    // unchanged behaviour, exactly as `AuthorizationService` and
    // `assertOrganizationInScope` already do — it is not reachable from HTTP.
    fixture.stores.raw.memberships.seed(INSIDER, ORG_A);
    await seedUserOnly(fixture, TARGET);
    await fixture.memberships.grantMembership(ORG_A, TARGET);
    expect(
      await fixture.stores.raw.memberships.findMembership(TARGET, ORG_A),
    ).not.toBeNull();
  });
});

/** Register a user that is only ever a membership TARGET (no permissions). */
async function seedUserOnly(fixture: Fixture, userId: string): Promise<void> {
  await fixture.grant(userId, []);
}
