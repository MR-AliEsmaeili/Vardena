import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateSync } from 'class-validator';
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
import { ORGANIZATION_PERMISSIONS } from '../domain/organization-permissions.js';
import { OrganizationsService } from './organizations.service.js';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from '../api/dto/organization.dto.js';

/**
 * C-63 / ADR-0042: the MVP display calendar is fixed Jalali-first. Organization
 * owns only the IANA time zone used to render Instants; it cannot select a
 * Gregorian calendar or change the canonical BusinessDate contract.
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
}> {
  const stores = createMasterDataStores();
  const rbacStores = createInMemoryStores();
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

  return { service, stores, organizationId };
}

describe('C-63 fixed Jalali MVP date policy and organization time zone', () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('returns a fixed read-only Jalali compatibility field and only the time zone as settings', async () => {
    const dto = await asActor(ADMIN, () =>
      fixture.service.getOrganization(fixture.organizationId),
    );
    expect(dto.calendarSystem).toBe('JALALI');
    expect(dto.timeZone).toBe('Asia/Tehran');

    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ timeZone: 'Asia/Tehran' });
  });

  it('rejects calendarSystem on organization create/update DTOs', () => {
    const createErrors = validateSync(
      Object.assign(new CreateOrganizationDto(), {
        code: 'ACME',
        name: 'Acme',
        calendarSystem: 'GREGORIAN',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    const updateErrors = validateSync(
      Object.assign(new UpdateOrganizationDto(), {
        calendarSystem: 'GREGORIAN',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(createErrors.map((error) => error.property)).toContain(
      'calendarSystem',
    );
    expect(updateErrors.map((error) => error.property)).toContain(
      'calendarSystem',
    );
  });

  it('does not honor a legacy calendarSystem value passed around the DTO boundary', async () => {
    const legacyPayload = {
      calendarSystem: 'GREGORIAN',
      timeZone: 'Europe/Berlin',
    } as never;
    const updated = await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, legacyPayload),
    );

    expect(updated.calendarSystem).toBe('JALALI');
    expect(updated.timeZone).toBe('Europe/Berlin');
    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ timeZone: 'Europe/Berlin' });
  });

  it('accepts valid IANA time zones and refuses fixed offsets without changing the stored value', async () => {
    const updated = await asActor(ADMIN, () =>
      fixture.service.updateOrganization(fixture.organizationId, {
        timeZone: 'Europe/Berlin',
      }),
    );
    expect(updated.calendarSystem).toBe('JALALI');
    expect(updated.timeZone).toBe('Europe/Berlin');

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

    await expect(
      asActor(ADMIN, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ timeZone: 'Europe/Berlin' });
  });

  it('serves the time zone to a member without the administration permission but never to a non-member', async () => {
    await expect(
      asActor(ACTOR, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).resolves.toEqual({ timeZone: 'Asia/Tehran' });

    const outsider = '01USERDTOUTSIDER000000000C';
    await expect(
      asActor(outsider, () =>
        fixture.service.getDateTimeSettings(fixture.organizationId),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
