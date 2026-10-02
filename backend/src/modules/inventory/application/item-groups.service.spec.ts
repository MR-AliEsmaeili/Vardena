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
import { ItemGroupsService } from './item-groups.service.js';
import {
  ITEM_GROUP_CREATED_EVENT,
  ITEM_GROUP_DISABLED_EVENT,
  ITEM_GROUP_ENABLED_EVENT,
  ITEM_GROUP_UPDATED_EVENT,
} from '../domain/inventory.events.js';

/**
 * `ItemGroupsService` — the self-referencing classification tree
 * (master-data-strategy.md §3.2).
 *
 * The tree is exactly three hierarchy rules — same organization, no
 * self-parenting, no cycles — plus the master-data lifecycle: a DISABLED
 * group cannot accept new children, while a child whose parent was disabled
 * later stays editable (§7.4). Groups carry no item defaults by design
 * (kind provides those).
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
  itemGroups: ItemGroupsService;
  events: DomainEvent[];
  organizationId: string;
  otherOrganizationId: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    ITEM_GROUP_CREATED_EVENT,
    ITEM_GROUP_UPDATED_EVENT,
    ITEM_GROUP_ENABLED_EVENT,
    ITEM_GROUP_DISABLED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // System context: authorization itself is covered by
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
  const itemGroups = new ItemGroupsService(
    stores.itemGroups,
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
    itemGroups,
    events,
    organizationId,
    otherOrganizationId,
  };
}

describe('ItemGroupsService', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  async function createGroup(
    code: string,
    name: string,
    parentId?: string,
  ): Promise<string> {
    const created = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.organizationId,
      parentId: parentId ?? null,
      code,
      name,
    });
    return created.id;
  }

  it('creates a root group with normalization and the event', async () => {
    const created = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.organizationId,
      parentId: null,
      code: ' RAW ',
      name: 'Raw   materials',
    });
    expect(created.code).toBe('RAW');
    expect(created.name).toBe('Raw materials');
    expect(created.parentId).toBe(null);
    expect(fixture.events[0]?.type).toBe(ITEM_GROUP_CREATED_EVENT);
  });

  it('creates a child under an active parent', async () => {
    const parent = await createGroup('RM', 'Raw materials');
    const child = await createGroup('RM-MET', 'Metals', parent);
    const fetched = await fixture.itemGroups.getItemGroup(
      fixture.organizationId,
      child,
    );
    expect(fetched.parentId).toBe(parent);
  });

  it('rejects a parent from another organization (hierarchy rule, mirrors departments)', async () => {
    // The hierarchy rule answers cross-organization parents with a 422 naming
    // the constraint — the same shape the Organization module's departments
    // use (the two `hierarchy.ts` copies exist to keep the answers identical).
    // Direct id lookups of a foreign group stay 404 (separate test below).
    const foreign = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.otherOrganizationId,
      parentId: null,
      code: 'G-B',
      name: 'Group B',
    });
    await expect(
      fixture.itemGroups.createItemGroup({
        organizationId: fixture.organizationId,
        parentId: foreign.id,
        code: 'G-A',
        name: 'Group A',
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('different organization'),
    });
    await expect(
      fixture.itemGroups.updateItemGroup(
        fixture.organizationId,
        await createGroup('X', 'Extra'),
        { parentId: foreign.id },
      ),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('different organization'),
    });
  });

  it('rejects an unknown parent as not found', async () => {
    await expect(
      fixture.itemGroups.createItemGroup({
        organizationId: fixture.organizationId,
        parentId: '01UNKNOWNGROUP000000000000AA',
        code: 'G-1',
        name: 'Group 1',
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects a duplicate code in one organization, allows it across organizations', async () => {
    await createGroup('RAW', 'Raw materials');
    await expect(
      createGroup('RAW', 'Raw materials duplicate'),
    ).rejects.toMatchObject({ code: 'Conflict' });

    const foreign = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.otherOrganizationId,
      parentId: null,
      code: 'RAW',
      name: 'Raw materials (B)',
    });
    expect(foreign.code).toBe('RAW');
  });

  it('rejects making a group its own parent', async () => {
    const group = await createGroup('G-1', 'Group 1');
    await expect(
      fixture.itemGroups.updateItemGroup(fixture.organizationId, group, {
        parentId: group,
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('own parent'),
    });
  });

  it('rejects moving a group under one of its descendants (cycle)', async () => {
    const grandparent = await createGroup('GP', 'Grandparent');
    const parent = await createGroup('P', 'Parent', grandparent);
    const child = await createGroup('C', 'Child', parent);

    // GP → C would close the loop GP→P→C→GP.
    await expect(
      fixture.itemGroups.updateItemGroup(fixture.organizationId, grandparent, {
        parentId: child,
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('cycle'),
    });

    // The failed move left the tree untouched.
    const unchanged = await fixture.itemGroups.getItemGroup(
      fixture.organizationId,
      grandparent,
    );
    expect(unchanged.parentId).toBe(null);
  });

  it('rejects a disabled group as a parent (blocks new usage)', async () => {
    const parent = await createGroup('P', 'Parent');
    await fixture.itemGroups.disableItemGroup(fixture.organizationId, parent);
    await expect(createGroup('C', 'Child', parent)).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('disabled'),
    });
    await expect(
      fixture.itemGroups.updateItemGroup(
        fixture.organizationId,
        await createGroup('X', 'Extra'),
        { parentId: parent },
      ),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('disabled'),
    });
  });

  it('keeps an existing child editable after its parent was disabled, and does not re-validate an unchanged parent', async () => {
    const parent = await createGroup('P', 'Parent');
    const child = await createGroup('C', 'Child', parent);
    await fixture.itemGroups.disableItemGroup(fixture.organizationId, parent);

    // Same-parent edits must not re-run parent validation (master-data-strategy
    // §7.4: only "new usage" of a disabled record is blocked).
    const renamed = await fixture.itemGroups.updateItemGroup(
      fixture.organizationId,
      child,
      { name: 'Child renamed', parentId: parent },
    );
    expect(renamed.name).toBe('Child renamed');
    expect(renamed.parentId).toBe(parent);
  });

  it('moves a group between parents and to the root with real re-validation', async () => {
    const a = await createGroup('A', 'A');
    const b = await createGroup('B', 'B');
    const child = await createGroup('C', 'Child', a);

    const moved = await fixture.itemGroups.updateItemGroup(
      fixture.organizationId,
      child,
      { parentId: b },
    );
    expect(moved.parentId).toBe(b);

    // Clearing the parent makes it a root.
    const rooted = await fixture.itemGroups.updateItemGroup(
      fixture.organizationId,
      child,
      { parentId: null },
    );
    expect(rooted.parentId).toBe(null);
  });

  it('lifecycle: idempotent enable/disable emits only real changes', async () => {
    const group = await createGroup('G', 'Group');
    fixture.events.length = 0;

    await fixture.itemGroups.enableItemGroup(fixture.organizationId, group);
    expect(fixture.events).toHaveLength(0);

    await fixture.itemGroups.disableItemGroup(fixture.organizationId, group);
    await fixture.itemGroups.disableItemGroup(fixture.organizationId, group);
    expect(fixture.events.map((event) => event.type)).toEqual([
      ITEM_GROUP_DISABLED_EVENT,
    ]);

    await fixture.itemGroups.enableItemGroup(fixture.organizationId, group);
    expect(fixture.events.map((event) => event.type)).toEqual([
      ITEM_GROUP_DISABLED_EVENT,
      ITEM_GROUP_ENABLED_EVENT,
    ]);
  });

  it('reports cross-organization ids as not found and never touches the row', async () => {
    const foreign = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.otherOrganizationId,
      parentId: null,
      code: 'G-B',
      name: 'Group B',
    });

    await expect(
      fixture.itemGroups.getItemGroup(fixture.organizationId, foreign.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.itemGroups.updateItemGroup(fixture.organizationId, foreign.id, {
        name: 'Hijacked',
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.itemGroups.disableItemGroup(fixture.organizationId, foreign.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.itemGroups.requireUsableItemGroupInOrganization(
        foreign.id,
        fixture.organizationId,
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    const untouched = await fixture.itemGroups.getItemGroup(
      fixture.otherOrganizationId,
      foreign.id,
    );
    expect(untouched.name).toBe('Group B');
  });

  it('lists by org with parent filter and never crosses organizations', async () => {
    const parent = await createGroup('P', 'Parent');
    await createGroup('C', 'Child', parent);

    const roots = await fixture.itemGroups.listItemGroups({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      parentId: undefined,
    });
    expect(roots.total).toBe(2);

    const children = await fixture.itemGroups.listItemGroups({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      parentId: parent,
    });
    expect(children.total).toBe(1);
    expect(children.items[0]?.code).toBe('C');

    const foreign = await fixture.itemGroups.listItemGroups({
      organizationId: fixture.otherOrganizationId,
      page: 1,
      pageSize: 10,
    });
    expect(foreign.total).toBe(0);
  });

  it('applies the sort allowlist and rejects unknown fields', async () => {
    await createGroup('G', 'Group');
    await expect(
      fixture.itemGroups.listItemGroups({
        organizationId: fixture.organizationId,
        page: 1,
        pageSize: 10,
        sort: 'parentId:asc',
      }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });
});
