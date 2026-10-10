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
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { JALALI_RENDERABLE_GREGORIAN_RANGE } from '../../../kernel/datetime/jalali.js';
import { ORGANIZATION_PERMISSIONS } from '../domain/organization-permissions.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * C-63 — the organization's date/time policy (ADR-0042 §5/§6).
 *
 * The rules under test:
 *
 *   * every organization ALWAYS carries a calendar and a zone, and a newly
 *     created one starts on the deployment default (JALALI / Asia/Tehran);
 *   * the settings are a closed vocabulary plus a resolvable IANA zone: an
 *     unknown calendar or a fixed offset (`+03:30`) is refused at the
 *     boundary, never stored and re-interpreted later;
 *   * `getDateTimeSettings` is the cross-module read (AR-07): it carries no
 *     permission of its own — the caller has already authorized its request —
 *     but still asserts the principal-bound organization scope.
 */

const ACTOR = '01USERDT0000000000000000A';
const ADMIN = '01USERDTADMIN00000000000B';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    {
      correlationId: 'corr-datetime',
      principal: { userId, sessionId: 'sess' },
    },
    fn,
  );
}

async function buildFixture(): Promise<{
  service: OrganizationsService;
  stores: ReturnType<typeof createMasterDataStores>;
  organizationId: string;
  addInventoryBusinessDate(organizationId: string, date: BusinessDate): void;
  updateWithInventoryHistory(
    id: string,
    input: Parameters<OrganizationsService['updateOrganization']>[1],
  ): ReturnType<OrganizationsService['updateOrganization']>;
}> {
  const stores = createMasterDataStores();
  const inventoryBusinessDates = new Map<string, BusinessDate[]>();
  const rbacStores = createInMemoryStores();
  // The RBAC fake enforces the `user_roles.user_id` foreign key, so the two
  // principals must exist before a role can be assigned to them.
  await seedUser(rbacStores, { id: ADMIN, username: 'datetime-admin' });
  await seedUser(rbacStores, { id: ACTOR, username: 'datetime-member' });
  const authorization = new AuthorizationService(
    rbacStores.userRoles,
    loggerStub(),
    licensingTestDouble(),
  );
  const service = new OrganizationsService(
    stores.organizations,
    stores.memberships,
    authorization,
    loggerStub(),
    new DomainEventBus(),
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const addInventoryBusinessDate = (
    organizationId: string,
    date: BusinessDate,
  ) => {
    const dates = inventoryBusinessDates.get(organizationId) ?? [];
    dates.push(date);
    inventoryBusinessDates.set(organizationId, dates);
  };
  const findFirstUnrenderableBusinessDate = async (organizationId: string) => {
    const { minimum, maximum } = JALALI_RENDERABLE_GREGORIAN_RANGE;
    return (
      inventoryBusinessDates
        .get(organizationId)
        ?.filter((date) => date < minimum || date > maximum)
        .sort()[0] ?? null
    );
  };
  const updateWithInventoryHistory = (
    id: string,
    input: Parameters<OrganizationsService['updateOrganization']>[1],
  ) => service.updateOrganization(id, input, findFirstUnrenderableBusinessDate);

  const permissionIds: string[] = [];
  await rbacStores.raw.permissions.syncDefinitions(
    Object.values(ORGANIZATION_PERMISSIONS).map((code) => ({
      code,
      description: code,
    })),
    new Date(),
  );
  for (const code of Object.values(ORGANIZATION_PERMISSIONS)) {
    const found = await rbacStores.raw.permissions.findByCode(code);
    if (found === null) throw new Error(`fixture: permission ${code} missing`);
    permissionIds.push(found.id);
  }
  const role = await rbacStores.raw.roles.createWithPermissions({
    id: 'role-datetime-admin',
    name: 'Date/time admin',
    description: null,
    permissionIds,
    now: new Date(),
    createdBy: null,
  });
  await rbacStores.raw.userRoles.assign({
    userId: ADMIN,
    roleId: role.id,
    now: new Date(),
    createdBy: null,
  });

  const organizationId = (
    await asActor(ADMIN, () =>
      service.createOrganization({ code: 'ORG-DT', name: 'Dates' }),
    )
  ).id;
  stores.raw.memberships.seed(ADMIN, organizationId);
  stores.raw.memberships.seed(ACTOR, organizationId);

  return {
    service,
    stores,
    organizationId,
    addInventoryBusinessDate,
    updateWithInventoryHistory,
  };
}

describe('C-63 organization date/time settings', () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('starts a new organization on the deployment default and returns it', async () => {
    const dto = await asActor(ADMIN, () =>
      fixture.service.getOrganization(fixture.organizationId),
    );
    expect(dto.calendarSystem).toBe('JALALI');
    expect(dto.timeZone).toBe('Asia/Tehran');

    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });
  });

  it('accepts a stated calendar and zone, and refuses unknown ones', async () => {
    const updated = await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        calendarSystem: 'GREGORIAN',
        timeZone: 'Europe/Berlin',
      }),
    );
    expect(updated.calendarSystem).toBe('GREGORIAN');
    expect(updated.timeZone).toBe('Europe/Berlin');

    await expect(
      asActor(ADMIN, () =>
        fixture.service.updateOrganization(fixture.organizationId, {
          calendarSystem: 'HIJRI' as never,
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: [{ field: 'calendarSystem', code: 'isCalendarSystem' }],
    });

    // A fixed offset is not a time zone: it carries no rules, so it cannot
    // stay correct across a DST or zone-policy change (ADR-0042 §5).
    await expect(
      asActor(ADMIN, () =>
        fixture.service.updateOrganization(fixture.organizationId, {
          timeZone: '+03:30',
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: [{ field: 'timeZone', code: 'isTimeZone' }],
    });

    // Neither refusal changed anything.
    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Europe/Berlin',
    });
  });

  it('fails closed when the mandatory Jalali-history contract is missing or fails', async () => {
    await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        calendarSystem: 'GREGORIAN',
      }),
    );

    await expect(
      asActor(ADMIN, () =>
        fixture.service.updateOrganization(fixture.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ),
    ).rejects.toThrow(/Inventory history contract/);
    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Asia/Tehran',
    });

    const historyFailure = new Error('Inventory history read failed.');
    await expect(
      asActor(ADMIN, () =>
        fixture.service.updateOrganization(
          fixture.organizationId,
          { calendarSystem: 'JALALI' },
          async () => {
            throw historyFailure;
          },
        ),
      ),
    ).rejects.toBe(historyFailure);
    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Asia/Tehran',
    });
  });

  it('fails closed when an Inventory writer omits its lock callback or has stale calendar validation', async () => {
    let invoked = false;
    const missingCallback = undefined as unknown as () => Promise<void>;
    await expect(
      asActor(ADMIN, () =>
        fixture.service.withBusinessDateWriteLock(
          fixture.organizationId,
          'JALALI',
          missingCallback,
        ),
      ),
    ).rejects.toThrow(/transaction callback/);

    const stale = await asActor(ADMIN, () =>
      fixture.service.withBusinessDateWriteLock(
        fixture.organizationId,
        'GREGORIAN',
        async () => {
          invoked = true;
        },
      ),
    );
    expect(stale).toEqual({ kind: 'calendar_changed' });
    expect(invoked).toBe(false);
  });

  it('refuses GREGORIAN → JALALI when existing Inventory history is not renderable and preserves settings', async () => {
    await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        calendarSystem: 'GREGORIAN',
      }),
    );
    fixture.addInventoryBusinessDate(
      fixture.organizationId,
      toBusinessDate('0600-01-01')!,
    );

    await expect(
      asActor(ADMIN, () =>
        fixture.updateWithInventoryHistory(fixture.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'BusinessRuleViolation',
      details: {
        code: 'organization.calendar.jalali_history_unrenderable',
        businessDate: '0600-01-01',
      },
    });

    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({
      calendarSystem: 'GREGORIAN',
      timeZone: 'Asia/Tehran',
    });
  });

  it('allows GREGORIAN → JALALI when all existing Inventory dates are renderable', async () => {
    await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        calendarSystem: 'GREGORIAN',
      }),
    );
    fixture.addInventoryBusinessDate(
      fixture.organizationId,
      toBusinessDate('0621-03-21')!,
    );
    fixture.addInventoryBusinessDate(
      fixture.organizationId,
      toBusinessDate('3798-12-31')!,
    );

    const updated = await asActor(ADMIN, () =>
      fixture.updateWithInventoryHistory(fixture.organizationId, {
        calendarSystem: 'JALALI',
      }),
    );

    expect(updated.calendarSystem).toBe('JALALI');
    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({
      calendarSystem: 'JALALI',
      timeZone: 'Asia/Tehran',
    });
  });

  it('keeps the reverse JALALI → GREGORIAN transition unrestricted', async () => {
    fixture.addInventoryBusinessDate(
      fixture.organizationId,
      toBusinessDate('0600-01-01')!,
    );

    const updated = await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        calendarSystem: 'GREGORIAN',
      }),
    );

    expect(updated.calendarSystem).toBe('GREGORIAN');
  });

  it('lets a caller state the settings at creation time', async () => {
    const created = await asActor(ADMIN, () =>
      fixture.service.createOrganization({
        code: 'ORG-EN',
        name: 'English',
        calendarSystem: 'GREGORIAN',
        timeZone: 'UTC',
      }),
    );
    expect(created.calendarSystem).toBe('GREGORIAN');
    expect(created.timeZone).toBe('UTC');
  });

  it('serves the settings to a member without the administration permission', async () => {
    await expect(
      asActor(ACTOR, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ calendarSystem: 'JALALI', timeZone: 'Asia/Tehran' });

    // …but never to a non-member: a foreign organization is indistinguishable
    // from a missing one (AC-I-16).
    const outsider = '01USERDTOUTSIDER000000000C';
    await expect(
      asActor(outsider, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
