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
import { ItemsService } from './items.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { UnitConversionsService } from './unit-conversions.service.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import { UNIT_CONVERSION_CREATED_EVENT } from '../domain/inventory.events.js';

/**
 * `UnitConversionsService` — effective-dated versioning (D-26, ADR-0020 §4).
 *
 * The behaviour that matters and is asserted here:
 * - a change is a NEW version; nothing is edited in place, and the previous
 *   open-ended version is closed atomically with the new one;
 * - the factor travels as a decimal string, never a JSON number;
 * - resolution honours the instant, so a past date yields the old factor;
 * - no conversion is ever invented when none covers the instant.
 */

const D = (iso: string): Date => new Date(iso);
const JAN = D('2026-01-01T00:00:00Z');
const FEB = D('2026-02-01T00:00:00Z');
const MAR = D('2026-03-01T00:00:00Z');

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
  items: ItemsService;
  conversions: UnitConversionsService;
  stores: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  organizationId: string;
  pcsId: string;
  boxId: string;
  itemId: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  bus.on(UNIT_CONVERSION_CREATED_EVENT, (event) => {
    events.push(event);
  });

  const authorization = new AuthorizationService(
    undefined as never,
    loggerStub(),
  );
  const organizations = new OrganizationsService(
    stores.organizations,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
  );
  const units = new UnitsService(
    stores.units,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const itemGroups = new ItemGroupsService(
    stores.itemGroups,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  // Freeze-guard seam (ADR-0022): no movements or balances on record here.
  const noMovements = {
    existsForItem: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalances = {
    hasBlockingBalanceForItem: async () => false,
  } as unknown as InventoryBalancesRepository;
  const items = new ItemsService(
    stores.items,
    organizations,
    itemGroups,
    units,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );
  const conversions = new UnitConversionsService(
    stores.unitConversions,
    organizations,
    units,
    items,
    authorization,
    loggerStub(),
    bus,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const pcsId = (
    await units.createUnit({ organizationId, code: 'PCS', name: 'Piece' })
  ).id;
  const boxId = (
    await units.createUnit({ organizationId, code: 'BOX', name: 'Box' })
  ).id;
  const itemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-1',
      name: 'Widget',
      itemKind: 'goods',
      baseUnitId: pcsId,
    })
  ).id;

  return {
    organizations,
    units,
    items,
    conversions,
    stores,
    events,
    organizationId,
    pcsId,
    boxId,
    itemId,
  };
}

describe('UnitConversionsService', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('creates a global conversion version and publishes the event', async () => {
    const created = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });

    expect(created.factor).toBe('12');
    expect(created.validTo).toBe(null);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]?.payload).toMatchObject({
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      supersededConversionId: null,
    });
  });

  it('keeps the factor as a decimal string with no floating-point drift', async () => {
    const created = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '0.000001',
      validFrom: JAN,
      validTo: null,
    });
    expect(created.factor).toBe('0.000001');
    expect(typeof created.factor).toBe('string');
  });

  it('rejects a non-positive or over-precise factor', async () => {
    for (const factor of ['0', '-3', '1.0000001', 'abc', '']) {
      await expect(
        fixture.conversions.createConversion({
          organizationId: fixture.organizationId,
          itemId: null,
          fromUnitId: fixture.boxId,
          toUnitId: fixture.pcsId,
          factor,
          validFrom: JAN,
          validTo: null,
        }),
        factor,
      ).rejects.toMatchObject({ code: 'BadRequest' });
    }
  });

  it('rejects a window that ends before it starts', async () => {
    await expect(
      fixture.conversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: null,
        fromUnitId: fixture.boxId,
        toUnitId: fixture.pcsId,
        factor: '12',
        validFrom: FEB,
        validTo: JAN,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects a conversion between the same unit', async () => {
    await expect(
      fixture.conversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: null,
        fromUnitId: fixture.pcsId,
        toUnitId: fixture.pcsId,
        factor: '1',
        validFrom: JAN,
        validTo: null,
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('supersedes the open-ended version and closes it at the new validFrom', async () => {
    const first = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    const second = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '24',
      validFrom: FEB,
      validTo: null,
    });

    // The old version is CLOSED, not deleted and not overwritten.
    const closed = await fixture.conversions.getConversion(
      fixture.organizationId,
      first.id,
    );
    expect(closed.validTo).toBe(FEB.toISOString());
    expect(closed.factor).toBe('12');

    expect(second.validTo).toBe(null);
    expect(fixture.events[1]?.payload).toMatchObject({
      supersededConversionId: first.id,
    });
  });

  it('rejects an overlap it cannot resolve by supersession', async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    // A bounded version inside the open-ended one would imply "revert after
    // MAR", which nobody has approved.
    await expect(
      fixture.conversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: null,
        fromUnitId: fixture.boxId,
        toUnitId: fixture.pcsId,
        factor: '24',
        validFrom: FEB,
        validTo: MAR,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('resolves the version in force at an instant, historically', async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '24',
      validFrom: FEB,
      validTo: null,
    });

    const january = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: D('2026-01-15T00:00:00Z'),
    });
    expect(january?.factor).toBe('12');

    const current = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: D('2026-06-01T00:00:00Z'),
    });
    expect(current?.factor).toBe('24');
  });

  it('returns null rather than inventing a 1:1 conversion', async () => {
    const resolved = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: JAN,
    });
    expect(resolved).toBe(null);
  });

  it('prefers an item-specific version over the global one', async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '6',
      validFrom: JAN,
      validTo: null,
    });

    const forItem = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: FEB,
    });
    expect(forItem?.factor).toBe('6');
    expect(forItem?.itemId).toBe(fixture.itemId);

    // …and the global one still applies to everything else.
    const generic = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: FEB,
    });
    expect(generic?.factor).toBe('12');
  });

  it('falls back to the global version when the item has none', async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    const resolved = await fixture.conversions.resolveConversion({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      asOf: FEB,
    });
    expect(resolved?.itemId).toBe(null);
    expect(resolved?.factor).toBe('12');
  });

  it('rejects a unit from another organization', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const foreignUnit = await fixture.units.createUnit({
      organizationId: otherOrg,
      code: 'PCS',
      name: 'Piece',
    });

    await expect(
      fixture.conversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: null,
        fromUnitId: foreignUnit.id,
        toUnitId: fixture.pcsId,
        factor: '12',
        validFrom: JAN,
        validTo: null,
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects an item from another organization', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const foreignUnit = await fixture.units.createUnit({
      organizationId: otherOrg,
      code: 'PCS',
      name: 'Piece',
    });
    const foreignItem = await fixture.items.createItem({
      organizationId: otherOrg,
      code: 'ITM-X',
      name: 'Foreign',
      itemKind: 'goods',
      baseUnitId: foreignUnit.id,
    });

    await expect(
      fixture.conversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: foreignItem.id,
        fromUnitId: fixture.boxId,
        toUnitId: fixture.pcsId,
        factor: '12',
        validFrom: JAN,
        validTo: null,
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('lists one scope at a time and requires itemId for the item scope', async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '6',
      validFrom: JAN,
      validTo: null,
    });

    const global = await fixture.conversions.listConversions({
      organizationId: fixture.organizationId,
      scope: 'global',
      page: 1,
      pageSize: 10,
    });
    expect(global.total).toBe(1);
    expect(global.items[0]?.itemId).toBe(null);

    const forItem = await fixture.conversions.listConversions({
      organizationId: fixture.organizationId,
      scope: 'item',
      itemId: fixture.itemId,
      page: 1,
      pageSize: 10,
    });
    expect(forItem.total).toBe(1);
    expect(forItem.items[0]?.itemId).toBe(fixture.itemId);

    // A conditional requirement class-validator cannot express declaratively,
    // so the service rejects it: 400, with a message naming the missing field.
    await expect(
      fixture.conversions.listConversions({
        organizationId: fixture.organizationId,
        scope: 'item',
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it("never lists another organization's conversions", async () => {
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const listed = await fixture.conversions.listConversions({
      organizationId: otherOrg,
      scope: 'global',
      page: 1,
      pageSize: 10,
    });
    expect(listed.total).toBe(0);
  });

  it('reads a superseded version by id (history stays readable)', async () => {
    const first = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '12',
      validFrom: JAN,
      validTo: null,
    });
    await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: null,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '24',
      validFrom: FEB,
      validTo: null,
    });

    const historical = await fixture.conversions.getConversion(
      fixture.organizationId,
      first.id,
    );
    expect(historical.factor).toBe('12');
    expect(historical.validTo).toBe(FEB.toISOString());
  });

  it('reads an item-scoped conversion by id', async () => {
    const itemConversion = await fixture.conversions.createConversion({
      organizationId: fixture.organizationId,
      itemId: fixture.itemId,
      fromUnitId: fixture.boxId,
      toUnitId: fixture.pcsId,
      factor: '6',
      validFrom: JAN,
      validTo: null,
    });
    const fetched = await fixture.conversions.getConversion(
      fixture.organizationId,
      itemConversion.id,
    );
    expect(fetched.itemId).toBe(fixture.itemId);
  });

  it('reports an unknown conversion id as not found', async () => {
    await expect(
      fixture.conversions.getConversion(
        fixture.organizationId,
        '01NONEXISTENTCONVERSION000AA',
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});
