import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import {
  createAccountingStores,
  type AccountingStores,
} from '../../../../test/support/accounting-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { seedUser } from '../../../../test/support/in-memory-repositories.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  FiscalYearTransitionConflictError,
  PeriodTransitionConflictError,
} from '../data/accounting-calendar-errors.js';
import { FinancialAreasService } from './financial-areas.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';
import { AccountingPeriodsService } from './accounting-periods.service.js';
import {
  ACCOUNTING_PERMISSION_DEFINITIONS,
  FINANCIAL_AREA_PERMISSIONS,
  FISCAL_YEAR_PERMISSIONS,
  ACCOUNTING_PERIOD_PERMISSIONS,
} from '../domain/accounting-permissions.js';
import {
  ACCOUNTING_PERIOD_CLOSED_EVENT,
  ACCOUNTING_PERIOD_OPENED_EVENT,
  ACCOUNTING_PERIOD_REOPENED_EVENT,
  ACCOUNTING_PERIOD_SEALED_EVENT,
  FINANCIAL_AREA_CREATED_EVENT,
  FINANCIAL_AREA_DISABLED_EVENT,
  FINANCIAL_AREA_ENABLED_EVENT,
  FINANCIAL_AREA_UPDATED_EVENT,
  FISCAL_YEAR_CLOSED_EVENT,
  FISCAL_YEAR_CREATED_EVENT,
  FISCAL_YEAR_REOPENED_EVENT,
  FISCAL_YEAR_SEALED_EVENT,
  FISCAL_YEAR_UNSEALED_EVENT,
} from '../domain/accounting.events.js';

/**
 * Accounting foundation services, driven through the REAL
 * `AuthorizationService` with real RBAC rows and in-memory accounting
 * tables.
 *
 * This file proves what guards alone cannot: authorization lives at the
 * service layer, the organization is the tenant/security boundary (a
 * cross-organization id answers 404, never 403), and the calendar guards
 * (overlap, containment, lifecycle) hold on the write path. A service that
 * forgot its `requireAllPermissions` call, or scoped a lookup globally
 * instead of by organization, would fail here, not in production.
 *
 * The fakes mirror the guarded transactions' observable effects (same
 * tables, same unique scopes, same plain errors); single-threaded fakes
 * cannot prove lock contention, so the race itself is covered by the
 * live-database suite instead.
 */

const ACTOR = '01ACTOR000000000000000000A';
const ACTOR_B = '01ACTORB0000000000000000B';
const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';

const ALL_FINANCIAL_AREA_CODES = Object.values(FINANCIAL_AREA_PERMISSIONS);
const ALL_FISCAL_YEAR_CODES = Object.values(FISCAL_YEAR_PERMISSIONS);
const ALL_ACCOUNTING_PERIOD_CODES = Object.values(
  ACCOUNTING_PERIOD_PERMISSIONS,
);

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  organizations: OrganizationsService;
  areas: FinancialAreasService;
  years: FiscalYearsService;
  periods: AccountingPeriodsService;
  rbacStores: ReturnType<typeof createInMemoryStores>;
  accountingStores: AccountingStores;
  authorization: AuthorizationService;
  bus: DomainEventBus;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
  /** ODR-3 (Task 19): seed a principal → organization membership. */
  member: (userId: string, organizationId: string) => void;
}

async function buildFixture(): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const accountingStores = createAccountingStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    FINANCIAL_AREA_CREATED_EVENT,
    FINANCIAL_AREA_UPDATED_EVENT,
    FINANCIAL_AREA_ENABLED_EVENT,
    FINANCIAL_AREA_DISABLED_EVENT,
    FISCAL_YEAR_CREATED_EVENT,
    FISCAL_YEAR_CLOSED_EVENT,
    FISCAL_YEAR_REOPENED_EVENT,
    FISCAL_YEAR_SEALED_EVENT,
    FISCAL_YEAR_UNSEALED_EVENT,
    ACCOUNTING_PERIOD_OPENED_EVENT,
    ACCOUNTING_PERIOD_CLOSED_EVENT,
    ACCOUNTING_PERIOD_REOPENED_EVENT,
    ACCOUNTING_PERIOD_SEALED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // Mirror the permission vocabulary into `rbac.permissions`, exactly as
  // `PermissionSyncService` does at startup. Without these rows no
  // principal can hold a code, and every authorization test below would
  // pass for the wrong reason.
  await rbacStores.raw.permissions.syncDefinitions(
    [...ACCOUNTING_PERMISSION_DEFINITIONS],
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
  const areas = new FinancialAreasService(
    accountingStores.areas,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const years = new FiscalYearsService(
    accountingStores.years,
    areas,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const periods = new AccountingPeriodsService(
    accountingStores.periods,
    years,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );

  /**
   * Give one user the listed permission codes: resolve the codes to
   * `rbac.permissions` rows, put them on a role, and assign that role. This
   * is the same join `AuthorizationService` evaluates (`user_roles →
   * role_permissions → permissions`), so the check under test is the real
   * one.
   */
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
    areas,
    years,
    periods,
    rbacStores,
    accountingStores,
    authorization,
    bus,
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

/**
 * Create an organization in system context and make both fixture actors
 * members of it (ODR-3, Task 19): organization scope is principal-bound, so
 * the actor-driven calls below resolve organizations they are members of.
 */
async function createMemberOrg(
  fixture: Fixture,
  code: string,
  name: string,
): Promise<string> {
  const org = await asSystem(() =>
    fixture.organizations.createOrganization({ code, name }),
  );
  fixture.member(ACTOR, org.id);
  fixture.member(ACTOR_B, org.id);
  return org.id;
}

describe('FinancialAreasService', () => {
  let fixture: Fixture;
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = await createMemberOrg(fixture, 'ORGA', 'Org A');
    orgB = await createMemberOrg(fixture, 'ORGB', 'Org B');
  });

  it('creates a financial area and publishes FinancialArea.Created', async () => {
    await fixture.grant(ACTOR, [FINANCIAL_AREA_PERMISSIONS.CREATE]);
    const created = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: '  GA  ',
        title: '  General   Area  ',
      }),
    );

    expect(created.code).toBe('GA');
    expect(created.title).toBe('General Area');
    expect(created.isDefault).toBe(false);
    expect(created.isActive).toBe(true);
    // The API shape never carries audit actor ids (AR-24).
    expect(created).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      FINANCIAL_AREA_CREATED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toEqual({
      id: created.id,
      organizationId: orgA,
      code: 'GA',
    });
  });

  it('rejects a duplicate code within the organization with a conflict', async () => {
    await fixture.grant(ACTOR, [FINANCIAL_AREA_PERMISSIONS.CREATE]);
    await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.createFinancialArea({
          organizationId: orgA,
          code: 'GA',
          title: 'Other',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('allows the same code in a different organization', async () => {
    await fixture.grant(ACTOR, [FINANCIAL_AREA_PERMISSIONS.CREATE]);
    await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const other = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgB,
        code: 'GA',
        title: 'General Area',
      }),
    );
    expect(other.organizationId).toBe(orgB);
  });

  it('rejects blank code/title and missing organizations', async () => {
    await fixture.grant(ACTOR, [FINANCIAL_AREA_PERMISSIONS.CREATE]);
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.createFinancialArea({
          organizationId: orgA,
          code: '  ',
          title: 'T',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.createFinancialArea({
          organizationId: ORG_A,
          code: 'GA',
          title: 'T',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
  it('reads and lists areas organization-scoped', async () => {
    await fixture.grant(ACTOR, [
      FINANCIAL_AREA_PERMISSIONS.CREATE,
      FINANCIAL_AREA_PERMISSIONS.VIEW,
    ]);
    const created = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgB,
        code: 'GA',
        title: 'General Area',
      }),
    );

    const found = await asActor(ACTOR, () =>
      fixture.areas.getFinancialArea(orgA, created.id),
    );
    expect(found.code).toBe('GA');

    // Cross-organization id: 404, never 403 (no existence leak).
    await expect(
      asActor(ACTOR, () => fixture.areas.getFinancialArea(orgB, created.id)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    const listing = await asActor(ACTOR, () =>
      fixture.areas.listFinancialAreas({
        organizationId: orgA,
        page: 1,
        pageSize: 10,
      }),
    );
    expect(listing.total).toBe(1);
    expect(listing.items.map((item) => item.id)).toEqual([created.id]);
  });

  it('updates code/title and transfers the default flag atomically', async () => {
    await fixture.grant(ACTOR, [
      FINANCIAL_AREA_PERMISSIONS.CREATE,
      FINANCIAL_AREA_PERMISSIONS.VIEW,
      FINANCIAL_AREA_PERMISSIONS.EDIT,
    ]);
    const first = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const second = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GB',
        title: 'Second Area',
      }),
    );

    const renamed = await asActor(ACTOR, () =>
      fixture.areas.updateFinancialArea(orgA, first.id, {
        title: 'Renamed',
        isDefault: true,
      }),
    );
    expect(renamed.title).toBe('Renamed');
    expect(renamed.isDefault).toBe(true);
    expect(fixture.events.map((event) => event.type)).toContain(
      FINANCIAL_AREA_UPDATED_EVENT,
    );

    const moved = await asActor(ACTOR, () =>
      fixture.areas.updateFinancialArea(orgA, second.id, { isDefault: true }),
    );
    expect(moved.isDefault).toBe(true);
    const cleared = await asActor(ACTOR, () =>
      fixture.areas.getFinancialArea(orgA, first.id),
    );
    expect(cleared.isDefault).toBe(false);
  });

  it('rejects a code clash on update with a conflict', async () => {
    await fixture.grant(ACTOR, [
      FINANCIAL_AREA_PERMISSIONS.CREATE,
      FINANCIAL_AREA_PERMISSIONS.EDIT,
    ]);
    await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const second = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GB',
        title: 'Second Area',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.updateFinancialArea(orgA, second.id, { code: 'GA' }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('enables idempotently and disables only with no open year', async () => {
    await fixture.grant(ACTOR, [
      ...ALL_FINANCIAL_AREA_CODES,
      ...ALL_FISCAL_YEAR_CODES,
    ]);
    const area = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const enabled = await asActor(ACTOR, () =>
      fixture.areas.enableFinancialArea(orgA, area.id),
    );
    expect(enabled.isActive).toBe(true);
    // Already enabled: no event, still success.
    expect(
      fixture.events.filter(
        (event) => event.type === FINANCIAL_AREA_ENABLED_EVENT,
      ),
    ).toHaveLength(0);

    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: area.id,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );

    // Open year present: disable is refused, area untouched.
    await expect(
      asActor(ACTOR, () => fixture.areas.disableFinancialArea(orgA, area.id)),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    const stillActive = await asActor(ACTOR, () =>
      fixture.areas.getFinancialArea(orgA, area.id),
    );
    expect(stillActive.isActive).toBe(true);

    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    const disabled = await asActor(ACTOR, () =>
      fixture.areas.disableFinancialArea(orgA, area.id),
    );
    expect(disabled.isActive).toBe(false);
    expect(fixture.events.map((event) => event.type)).toContain(
      FINANCIAL_AREA_DISABLED_EVENT,
    );
  });

  it('rejects a principal that lacks the per-operation permission with 403', async () => {
    await fixture.grant(ACTOR, [FINANCIAL_AREA_PERMISSIONS.VIEW]);
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.createFinancialArea({
          organizationId: orgA,
          code: 'GA',
          title: 'General Area',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    // Nothing was written.
    const listing = await asActor(ACTOR, () =>
      fixture.areas.listFinancialAreas({
        organizationId: orgA,
        page: 1,
        pageSize: 10,
      }),
    );
    expect(listing.total).toBe(0);
  });

  it('rejects an anonymous request with 401, not 403', async () => {
    await expect(
      runWithRequestContext({ correlationId: 'corr-1' }, () =>
        fixture.areas.createFinancialArea({
          organizationId: orgA,
          code: 'GA',
          title: 'General Area',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('requires a distinct permission per operation', async () => {
    await fixture.grant(ACTOR, [
      FINANCIAL_AREA_PERMISSIONS.CREATE,
      FINANCIAL_AREA_PERMISSIONS.VIEW,
    ]);
    const created = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );

    // Edit / Disable are separate codes and are NOT covered by Create+View.
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.updateFinancialArea(orgA, created.id, {
          title: 'Renamed',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(ACTOR, () =>
        fixture.areas.disableFinancialArea(orgA, created.id),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
});

describe('FiscalYearsService', () => {
  let fixture: Fixture;
  let orgA: string;
  let orgB: string;
  let areaA: string;
  let areaB: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = await createMemberOrg(fixture, 'ORGA', 'Org A');
    orgB = await createMemberOrg(fixture, 'ORGB', 'Org B');
    await fixture.grant(ACTOR, [
      ...ALL_FINANCIAL_AREA_CODES,
      ...ALL_FISCAL_YEAR_CODES,
      ...ALL_ACCOUNTING_PERIOD_CODES,
    ]);
    const area1 = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const area2 = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgB,
        code: 'GA',
        title: 'General Area',
      }),
    );
    areaA = area1.id;
    areaB = area2.id;
    fixture.events.length = 0;
  });

  it('creates a fiscal year and publishes FiscalYear.Created', async () => {
    const created = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );

    expect(created.code).toBe('Y1404');
    expect(created.status).toBe('open');
    expect(created.startDate).toBe('2025-03-21');
    expect(created.endDate).toBe('2026-03-20');
    expect(created).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      FISCAL_YEAR_CREATED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toEqual({
      id: created.id,
      organizationId: orgA,
      financialAreaId: areaA,
      code: 'Y1404',
    });
  });

  it('rejects an overlapping year and accepts touching boundaries', async () => {
    await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );

    // One shared day is already an overlap (bounds are inclusive).
    await expect(
      asActor(ACTOR, () =>
        fixture.years.createFiscalYear({
          organizationId: orgA,
          financialAreaId: areaA,
          code: 'Y-X',
          title: 'Overlap',
          startDate: '2026-03-20',
          endDate: '2027-03-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    // Touching without sharing a day is fine.
    const next = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1405',
        title: 'Year 1405',
        startDate: '2026-03-21',
        endDate: '2027-03-20',
      }),
    );
    expect(next.startDate).toBe('2026-03-21');

    // Overlapping ranges in a different area do not collide.
    const area2 = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GB',
        title: 'Second Area',
      }),
    );
    const parallel = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: area2.id,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    expect(parallel.financialAreaId).toBe(area2.id);
  });

  it('rejects an inverted range and a year under a disabled area', async () => {
    await expect(
      asActor(ACTOR, () =>
        fixture.years.createFiscalYear({
          organizationId: orgA,
          financialAreaId: areaA,
          code: 'Y-BAD',
          title: 'Inverted',
          startDate: '2026-03-20',
          endDate: '2025-03-21',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    await asActor(ACTOR, () => fixture.areas.disableFinancialArea(orgA, areaA));
    await expect(
      asActor(ACTOR, () =>
        fixture.years.createFiscalYear({
          organizationId: orgA,
          financialAreaId: areaA,
          code: 'Y1404',
          title: 'Year 1404',
          startDate: '2025-03-21',
          endDate: '2026-03-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('links a prior year only within the same organization and area', async () => {
    const first = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    const second = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1405',
        title: 'Year 1405',
        startDate: '2026-03-21',
        endDate: '2027-03-20',
        priorYearId: first.id,
      }),
    );
    expect(second.priorYearId).toBe(first.id);

    // A prior year of another organization answers 404 (no existence leak).
    const foreign = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgB,
        financialAreaId: areaB,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.years.createFiscalYear({
          organizationId: orgA,
          financialAreaId: areaA,
          code: 'Y1406',
          title: 'Year 1406',
          startDate: '2027-03-21',
          endDate: '2028-03-19',
          priorYearId: foreign.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('updates labels freely but dates only while open and containing', async () => {
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: year.id,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    const renamed = await asActor(ACTOR, () =>
      fixture.years.updateFiscalYear(orgA, year.id, { title: 'Renamed' }),
    );
    expect(renamed.title).toBe('Renamed');

    // Narrowing the year so it would exclude a period is refused.
    await expect(
      asActor(ACTOR, () =>
        fixture.years.updateFiscalYear(orgA, year.id, {
          startDate: '2025-05-01',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    // Closed years keep editable labels but frozen dates.
    const relabeled = await asActor(ACTOR, () =>
      fixture.years.updateFiscalYear(orgA, year.id, { title: 'Relabeled' }),
    );
    expect(relabeled.title).toBe('Relabeled');
    await expect(
      asActor(ACTOR, () =>
        fixture.years.updateFiscalYear(orgA, year.id, {
          endDate: '2026-04-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('closes a year and cascades the close onto its open periods', async () => {
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    const first = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: year.id,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );
    const second = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: year.id,
        sequence: 2,
        title: 'Ordibehesht',
        startDate: '2025-04-21',
        endDate: '2025-05-21',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: second.id,
        transition: 'close',
        reason: 'Month-end close.',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: second.id,
        transition: 'seal',
        reason: 'Audited early.',
      }),
    );
    fixture.events.length = 0;

    const closed = await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    expect(closed.status).toBe('closed');

    // The still-open period was cascaded; the sealed one was left alone.
    const cascaded = await asActor(ACTOR, () =>
      fixture.periods.getAccountingPeriod(orgA, first.id),
    );
    expect(cascaded.status).toBe('closed');
    const untouched = await asActor(ACTOR, () =>
      fixture.periods.getAccountingPeriod(orgA, second.id),
    );
    expect(untouched.status).toBe('sealed');

    const types = fixture.events.map((event) => event.type);
    expect(types).toEqual([
      FISCAL_YEAR_CLOSED_EVENT,
      ACCOUNTING_PERIOD_CLOSED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toMatchObject({
      id: year.id,
      fromStatus: 'open',
      toStatus: 'closed',
      reason: 'Year-end close.',
    });
  });

  it('reopens, seals only when every period is closed, and unseals', async () => {
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    const period = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: year.id,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    // Close cascaded: the period is closed, so the seal goes through.
    const sealed = await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'seal',
        reason: 'Audit sign-off.',
      }),
    );
    expect(sealed.status).toBe('sealed');

    const unsealed = await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'unseal',
        reason: 'Correction round.',
      }),
    );
    expect(unsealed.status).toBe('closed');

    await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'reopen',
        reason: 'Correction round.',
      }),
    );
    // An open period now blocks the seal (fail closed).
    await expect(
      asActor(ACTOR, () =>
        fixture.years.transitionFiscalYear({
          organizationId: orgA,
          id: year.id,
          transition: 'seal',
          reason: 'Audit sign-off.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    const reopened = await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: year.id,
        transition: 'reopen',
        reason: 'Correction round.',
      }),
    );
    expect(reopened.status).toBe('open');
    expect(fixture.events.map((event) => event.type)).toContain(
      FISCAL_YEAR_REOPENED_EVENT,
    );
    expect(fixture.events.map((event) => event.type)).toContain(
      FISCAL_YEAR_UNSEALED_EVENT,
    );
  });

  it('rejects invalid transitions with 422 and reasons are mandatory', async () => {
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    // open → reopen is not a legal move.
    await expect(
      asActor(ACTOR, () =>
        fixture.years.transitionFiscalYear({
          organizationId: orgA,
          id: year.id,
          transition: 'reopen',
          reason: 'Nope.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    // Blank reasons are refused before anything is evaluated.
    await expect(
      asActor(ACTOR, () =>
        fixture.years.transitionFiscalYear({
          organizationId: orgA,
          id: year.id,
          transition: 'close',
          reason: '  ',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('keeps years invisible across organizations', async () => {
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    await expect(
      asActor(ACTOR, () => fixture.years.getFiscalYear(orgB, year.id)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActor(ACTOR, () =>
        fixture.years.updateFiscalYear(orgB, year.id, { title: 'X' }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActor(ACTOR, () =>
        fixture.years.transitionFiscalYear({
          organizationId: orgB,
          id: year.id,
          transition: 'close',
          reason: 'Hostile.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    const listing = await asActor(ACTOR, () =>
      fixture.years.listFiscalYears({
        organizationId: orgB,
        page: 1,
        pageSize: 10,
      }),
    );
    expect(listing.total).toBe(0);

    // A parent filter is also organization-qualified: it must not turn a
    // known foreign area into an ambiguous empty list.
    await expect(
      asActor(ACTOR, () =>
        fixture.years.listFiscalYears({
          organizationId: orgB,
          financialAreaId: areaA,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('gates every year operation on its own permission', async () => {
    await fixture.grant(ACTOR_B, [FISCAL_YEAR_PERMISSIONS.VIEW]);
    await expect(
      asActor(ACTOR_B, () =>
        fixture.years.createFiscalYear({
          organizationId: orgA,
          financialAreaId: areaA,
          code: 'Y1404',
          title: 'Year 1404',
          startDate: '2025-03-21',
          endDate: '2026-03-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });

    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: areaA,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    await expect(
      asActor(ACTOR_B, () =>
        fixture.years.updateFiscalYear(orgA, year.id, { title: 'X' }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(ACTOR_B, () =>
        fixture.years.transitionFiscalYear({
          organizationId: orgA,
          id: year.id,
          transition: 'close',
          reason: 'Nope.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    // View alone still reads.
    const found = await asActor(ACTOR_B, () =>
      fixture.years.getFiscalYear(orgA, year.id),
    );
    expect(found.id).toBe(year.id);
  });
});

describe('AccountingPeriodsService', () => {
  let fixture: Fixture;
  let orgA: string;
  let orgB: string;
  let yearId: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = await createMemberOrg(fixture, 'ORGA', 'Org A');
    orgB = await createMemberOrg(fixture, 'ORGB', 'Org B');
    await fixture.grant(ACTOR, [
      ...ALL_FINANCIAL_AREA_CODES,
      ...ALL_FISCAL_YEAR_CODES,
      ...ALL_ACCOUNTING_PERIOD_CODES,
    ]);
    const area = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: area.id,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    yearId = year.id;
    fixture.events.length = 0;
  });

  it('opens a period and publishes AccountingPeriod.Opened', async () => {
    const opened = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    expect(opened.sequence).toBe(1);
    expect(opened.status).toBe('open');
    expect(opened).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      ACCOUNTING_PERIOD_OPENED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toMatchObject({
      id: opened.id,
      fiscalYearId: yearId,
      sequence: 1,
    });
  });

  it('rejects overlaps and duplicate sequences, accepts touching periods', async () => {
    await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    await expect(
      asActor(ACTOR, () =>
        fixture.periods.createAccountingPeriod({
          organizationId: orgA,
          fiscalYearId: yearId,
          sequence: 2,
          title: 'Overlap',
          startDate: '2025-04-20',
          endDate: '2025-05-21',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    await expect(
      asActor(ACTOR, () =>
        fixture.periods.createAccountingPeriod({
          organizationId: orgA,
          fiscalYearId: yearId,
          sequence: 1,
          title: 'Same sequence',
          startDate: '2025-04-21',
          endDate: '2025-05-21',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });

    const touching = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 2,
        title: 'Ordibehesht',
        startDate: '2025-04-21',
        endDate: '2025-05-21',
      }),
    );
    expect(touching.sequence).toBe(2);
  });

  it('refuses periods outside the year and under unusable years', async () => {
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.createAccountingPeriod({
          organizationId: orgA,
          fiscalYearId: yearId,
          sequence: 1,
          title: 'Spill',
          startDate: '2025-03-21',
          endDate: '2026-03-21',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: yearId,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.createAccountingPeriod({
          organizationId: orgA,
          fiscalYearId: yearId,
          sequence: 1,
          title: 'Late',
          startDate: '2025-03-21',
          endDate: '2025-04-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('closes, reopens and seals periods; sealed years gate close/reopen', async () => {
    const period = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    const closed = await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'close',
        reason: 'Month-end close.',
      }),
    );
    expect(closed.status).toBe('closed');

    const reopened = await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'reopen',
        reason: 'Correction.',
      }),
    );
    expect(reopened.status).toBe('open');
    expect(fixture.events.map((event) => event.type)).toContain(
      ACCOUNTING_PERIOD_REOPENED_EVENT,
    );

    // Seal the year around a closed period, then try to reopen the period.
    await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'close',
        reason: 'Month-end close.',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: yearId,
        transition: 'close',
        reason: 'Year-end close.',
      }),
    );
    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: yearId,
        transition: 'seal',
        reason: 'Audit sign-off.',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.transitionAccountingPeriod({
          organizationId: orgA,
          id: period.id,
          transition: 'reopen',
          reason: 'Too late.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    // Sealing the period itself is still allowed under a sealed year.
    const sealed = await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'seal',
        reason: 'Audit sign-off.',
      }),
    );
    expect(sealed.status).toBe('sealed');
    expect(fixture.events.map((event) => event.type)).toContain(
      ACCOUNTING_PERIOD_SEALED_EVENT,
    );

    // Unseal the year: the sealed period may reopen (contract §7.2 rule 4).
    await asActor(ACTOR, () =>
      fixture.years.transitionFiscalYear({
        organizationId: orgA,
        id: yearId,
        transition: 'unseal',
        reason: 'Correction round.',
      }),
    );
    const reopenedAfterUnseal = await asActor(ACTOR, () =>
      fixture.periods.transitionAccountingPeriod({
        organizationId: orgA,
        id: period.id,
        transition: 'reopen',
        reason: 'Correction round.',
      }),
    );
    expect(reopenedAfterUnseal.status).toBe('open');
  });

  it('rejects invalid period transitions with 422', async () => {
    const period = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.transitionAccountingPeriod({
          organizationId: orgA,
          id: period.id,
          transition: 'reopen',
          reason: 'Already open.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('keeps periods invisible across organizations and gates by permission', async () => {
    const period = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );

    await asSystem(() =>
      fixture.organizations.createOrganization({ code: 'ORGC', name: 'Org C' }),
    );
    // Unknown organization scope: 404 like any other scope miss.
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.getAccountingPeriod(ORG_B, period.id),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    // The fiscal-year list filter carries the same ownership rule as a by-id
    // read; a foreign parent must not be treated as an ordinary empty page.
    await expect(
      asActor(ACTOR, () =>
        fixture.periods.listAccountingPeriods({
          organizationId: orgB,
          fiscalYearId: yearId,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    await fixture.grant(ACTOR_B, [ACCOUNTING_PERIOD_PERMISSIONS.VIEW]);
    const found = await asActor(ACTOR_B, () =>
      fixture.periods.getAccountingPeriod(orgA, period.id),
    );
    expect(found.id).toBe(period.id);
    await expect(
      asActor(ACTOR_B, () =>
        fixture.periods.transitionAccountingPeriod({
          organizationId: orgA,
          id: period.id,
          transition: 'close',
          reason: 'Nope.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
});

describe('stale-state mapping', () => {
  let fixture: Fixture;
  let orgA: string;
  let yearId: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = await createMemberOrg(fixture, 'ORGA', 'Org A');
    await fixture.grant(ACTOR, [
      ...ALL_FINANCIAL_AREA_CODES,
      ...ALL_FISCAL_YEAR_CODES,
      ...ALL_ACCOUNTING_PERIOD_CODES,
    ]);
    const area = await asActor(ACTOR, () =>
      fixture.areas.createFinancialArea({
        organizationId: orgA,
        code: 'GA',
        title: 'General Area',
      }),
    );
    const year = await asActor(ACTOR, () =>
      fixture.years.createFiscalYear({
        organizationId: orgA,
        financialAreaId: area.id,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      }),
    );
    yearId = year.id;
  });

  it('maps a lost guarded write to 409 Conflict (year)', async () => {
    // The service read `open`, but the guarded transaction reports the row
    // moved while the request was in flight (the live suite forces this
    // interleaving for real; here the mapping itself is pinned).
    const delegate = fixture.accountingStores.raw.years;
    const raced = {
      findById: (id: string) => delegate.findById(id),
      transitionChecked: async () => {
        throw new FiscalYearTransitionConflictError('closed');
      },
    };
    const logger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as JsonLogger;
    const years = new FiscalYearsService(
      raced as unknown as ConstructorParameters<typeof FiscalYearsService>[0],
      fixture.areas,
      fixture.organizations,
      fixture.authorization,
      logger,
      fixture.bus,
    );

    await expect(
      asActor(ACTOR, () =>
        years.transitionFiscalYear({
          organizationId: orgA,
          id: yearId,
          transition: 'close',
          reason: 'Year-end close.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('maps a lost guarded write to 409 Conflict (period)', async () => {
    const period = await asActor(ACTOR, () =>
      fixture.periods.createAccountingPeriod({
        organizationId: orgA,
        fiscalYearId: yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      }),
    );
    const delegate = fixture.accountingStores.raw.periods;
    const raced = {
      findById: (id: string) => delegate.findById(id),
      transitionChecked: async () => {
        throw new PeriodTransitionConflictError('closed');
      },
    };
    const logger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as JsonLogger;
    const periods = new AccountingPeriodsService(
      raced as unknown as ConstructorParameters<
        typeof AccountingPeriodsService
      >[0],
      fixture.years,
      fixture.organizations,
      fixture.authorization,
      logger,
      fixture.bus,
    );

    await expect(
      asActor(ACTOR, () =>
        periods.transitionAccountingPeriod({
          organizationId: orgA,
          id: period.id,
          transition: 'close',
          reason: 'Month-end close.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });
});
