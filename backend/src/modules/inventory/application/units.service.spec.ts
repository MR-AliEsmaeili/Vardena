import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { UnitsService } from './units.service.js';
import {
  UNIT_CREATED_EVENT,
  UNIT_DISABLED_EVENT,
  UNIT_ENABLED_EVENT,
  UNIT_UPDATED_EVENT,
} from '../domain/inventory.events.js';

/**
 * `UnitsService` — unit of measure administration (master-data-strategy.md
 * §3.4).
 *
 * Units are the anchor of all quantity semantics: every item pins a base unit
 * and every conversion pairs two unit ids. Covered here: the code/name/symbol
 * shape rule with the narrower column widths of this entity, org-isolated
 * code uniqueness, normalization, literal fields, and the lifecycle
 * (`allowInactive`) rule that keeps history usable while blocking new
 * references.
 */

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  organizations: OrganizationsService;
  units: UnitsService;
  stores: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  organizationId: string;
  otherOrganizationId: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    UNIT_CREATED_EVENT,
    UNIT_UPDATED_EVENT,
    UNIT_ENABLED_EVENT,
    UNIT_DISABLED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // No request context → system context; authorization itself is covered by
  // master-data-authorization.spec.ts.
  const authorization = new AuthorizationService(
    undefined as never,
    loggerStub(),
    licensingTestDouble(),
  );
  const organizations = new OrganizationsService(
    stores.organizations,
    stores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const units = new UnitsService(
    stores.units,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const otherOrganizationId = (
    await organizations.createOrganization({ code: 'ORG-B', name: 'Org B' })
  ).id;

  return {
    organizations,
    units,
    stores,
    events,
    organizationId,
    otherOrganizationId,
  };
}

describe('UnitsService', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('creates a unit with normalization and publishes the event', async () => {
    const created = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: '  PCS ',
      name: '  Piece   counting unit ',
      symbol: ' pc ',
    });

    expect(created.code).toBe('PCS');
    // Names collapse internal whitespace runs to single spaces. Codes are
    // only trimmed — case is preserved verbatim (no casing policy is
    // invented; OQ-12/OQ-36).
    expect(created.name).toBe('Piece counting unit');
    expect(created.symbol).toBe('pc');
    expect(created.isActive).toBe(true);

    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]?.type).toBe(UNIT_CREATED_EVENT);
    expect(fixture.events[0]?.payload).toMatchObject({
      id: created.id,
      organizationId: fixture.organizationId,
      code: 'PCS',
    });
  });

  it('stores a blank symbol as null', async () => {
    const created = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'KG',
      name: 'Kilogram',
      symbol: '   ',
    });
    expect(created.symbol).toBe(null);
  });

  it('rejects an invalid code/name/symbol shape at the entity widths', async () => {
    for (const input of [
      { code: '   ', name: 'Piece', symbol: null },
      { code: 'X'.repeat(33), name: 'Piece', symbol: null }, // code: 32 max
      { code: 'PCS', name: '   ', symbol: null },
      { code: 'PCS', name: 'N'.repeat(121), symbol: null }, // name: 120 max
      { code: 'PCS', name: 'Piece', symbol: 'S'.repeat(17) }, // symbol: 16 max
    ]) {
      await expect(
        fixture.units.createUnit({
          organizationId: fixture.organizationId,
          ...input,
        }),
        JSON.stringify(input),
      ).rejects.toMatchObject({ code: 'BadRequest' });
    }

    // Boundary values are accepted: exactly at the column widths.
    const atLimit = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'C'.repeat(32),
      name: 'N'.repeat(120),
      symbol: 'S'.repeat(16),
    });
    expect(atLimit.code).toHaveLength(32);
  });

  it('rejects a duplicate code within one organization with Conflict', async () => {
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    await expect(
      fixture.units.createUnit({
        organizationId: fixture.organizationId,
        code: 'PCS',
        name: 'Piece duplicate',
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('lets two organizations reuse the same code independently', async () => {
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    const foreign = await fixture.units.createUnit({
      organizationId: fixture.otherOrganizationId,
      code: 'PCS',
      name: 'Piece (B)',
    });
    expect(foreign.code).toBe('PCS');

    // And each organization lists only its own unit.
    const listed = await fixture.units.listUnits({
      organizationId: fixture.otherOrganizationId,
      page: 1,
      pageSize: 10,
    });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(foreign.id);
  });

  it('normalizes on update and enforces code uniqueness against other rows', async () => {
    const first = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'KG',
      name: 'Kilogram',
    });

    // Renaming onto an existing code is a conflict…
    await expect(
      fixture.units.updateUnit(fixture.organizationId, first.id, {
        code: 'KG',
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });

    // …but re-submitting the same code is a plain update (trimmed only;
    // case is preserved, so ' pcs ' ≠ 'PCS' — its own row, allowed).
    const updated = await fixture.units.updateUnit(
      fixture.organizationId,
      first.id,
      { code: ' pcs ', name: 'Piece  unit', symbol: null },
    );
    expect(updated.code).toBe('pcs');
    expect(updated.name).toBe('Piece unit');
    expect(updated.symbol).toBe(null);
    expect(
      fixture.events.some((event) => event.type === UNIT_UPDATED_EVENT),
    ).toBe(true);
  });

  it('lifecycle: idempotent enable/disable with events only on real changes', async () => {
    const unit = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    fixture.events.length = 0;

    await fixture.units.enableUnit(fixture.organizationId, unit.id);
    expect(fixture.events).toHaveLength(0);

    const disabled = await fixture.units.disableUnit(
      fixture.organizationId,
      unit.id,
    );
    expect(disabled.isActive).toBe(false);
    await fixture.units.disableUnit(fixture.organizationId, unit.id);
    expect(fixture.events.map((event) => event.type)).toEqual([
      UNIT_DISABLED_EVENT,
    ]);

    await fixture.units.enableUnit(fixture.organizationId, unit.id);
    await fixture.units.enableUnit(fixture.organizationId, unit.id);
    expect(fixture.events.map((event) => event.type)).toEqual([
      UNIT_DISABLED_EVENT,
      UNIT_ENABLED_EVENT,
    ]);
  });

  it('a disabled unit is rejected for new references but stays readable for history', async () => {
    const unit = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    await fixture.units.disableUnit(fixture.organizationId, unit.id);

    await expect(
      fixture.units.requireUsableUnitInOrganization(
        unit.id,
        fixture.organizationId,
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    const historical = await fixture.units.requireUsableUnitInOrganization(
      unit.id,
      fixture.organizationId,
      { allowInactive: true },
    );
    expect(historical.id).toBe(unit.id);

    // And the public get is unaffected by the lifecycle state.
    const fetched = await fixture.units.getUnit(
      fixture.organizationId,
      unit.id,
    );
    expect(fetched.isActive).toBe(false);
  });

  it('reports cross-organization ids as not found everywhere (no-disclosure)', async () => {
    const unit = await fixture.units.createUnit({
      organizationId: fixture.otherOrganizationId,
      code: 'PCS',
      name: 'Piece',
    });

    await expect(
      fixture.units.getUnit(fixture.organizationId, unit.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.units.updateUnit(fixture.organizationId, unit.id, {
        name: 'Hijacked',
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.units.disableUnit(fixture.organizationId, unit.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.units.requireUsableUnitInOrganization(
        unit.id,
        fixture.organizationId,
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    // Nothing was written by any probe.
    const untouched = await fixture.units.getUnit(
      fixture.otherOrganizationId,
      unit.id,
    );
    expect(untouched.name).toBe('Piece');
    expect(untouched.isActive).toBe(true);
  });

  it('applies the sort allowlist at the service layer', async () => {
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
    });
    await expect(
      fixture.units.listUnits({
        organizationId: fixture.organizationId,
        page: 1,
        pageSize: 10,
        sort: 'isActive:asc',
      }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('search matches code, name and symbol case-insensitively', async () => {
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'PCS',
      name: 'Piece',
      symbol: 'pc',
    });
    await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'KG',
      name: 'Kilogram',
    });

    for (const search of ['pcs', 'KILO', 'PC']) {
      const listed = await fixture.units.listUnits({
        organizationId: fixture.organizationId,
        page: 1,
        pageSize: 10,
        search,
      });
      // eslint-disable-next-line no-await-in-loop
      expect(listed.total, search).toBe(1);
    }
  });

  it('blocks writes into a disabled organization', async () => {
    await fixture.organizations.disableOrganization(
      fixture.otherOrganizationId,
    );
    await expect(
      fixture.units.createUnit({
        organizationId: fixture.otherOrganizationId,
        code: 'PCS',
        name: 'Piece',
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });
});
