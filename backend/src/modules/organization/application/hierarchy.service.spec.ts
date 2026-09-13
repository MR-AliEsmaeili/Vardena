import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from './organizations.service.js';
import { DepartmentsService } from './departments.service.js';
import { ItemGroupsService } from '../../inventory/application/item-groups.service.js';

/**
 * Hierarchy wiring for the two self-referencing master-data entities
 * (departments, item groups).
 *
 * `hierarchy.ts` is unit-tested on its own; what is covered here is the
 * *wiring*: that the service actually loads the organization's edges, asks for
 * the descendants, and turns each `HierarchyProblem` into a 422 — plus the
 * organization-isolation half of the same rules.
 */

const ORG_A_CODE = 'ORG-A';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  organizations: OrganizationsService;
  departments: DepartmentsService;
  itemGroups: ItemGroupsService;
  stores: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  orgA: string;
  orgB: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
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
  const departments = new DepartmentsService(
    stores.departments,
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
  bus.on('*', () => {});

  const orgA = (
    await organizations.createOrganization({ code: ORG_A_CODE, name: 'Org A' })
  ).id;
  const orgB = (
    await organizations.createOrganization({ code: 'ORG-B', name: 'Org B' })
  ).id;

  return { organizations, departments, itemGroups, stores, events, orgA, orgB };
}

describe('DepartmentsService hierarchy', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('creates a root department and a child under it', async () => {
    const root = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'ENG',
      name: 'Engineering',
    });
    expect(root.parentDepartmentId).toBe(null);

    const child = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: root.id,
      code: 'QA',
      name: 'Quality',
    });
    expect(child.parentDepartmentId).toBe(root.id);
  });

  it('rejects self-parenting on update with 422', async () => {
    const root = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'ENG',
      name: 'Engineering',
    });
    await expect(
      fixture.departments.updateDepartment(fixture.orgA, root.id, {
        parentDepartmentId: root.id,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects a move that would create a cycle, three levels deep', async () => {
    const root = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'L1',
      name: 'Level 1',
    });
    const mid = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: root.id,
      code: 'L2',
      name: 'Level 2',
    });
    const leaf = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: mid.id,
      code: 'L3',
      name: 'Level 3',
    });

    // Moving the root under its own grandchild would close a cycle.
    await expect(
      fixture.departments.updateDepartment(fixture.orgA, root.id, {
        parentDepartmentId: leaf.id,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('accepts a re-parent that does not create a cycle', async () => {
    const a = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'A',
      name: 'A',
    });
    const b = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'B',
      name: 'B',
    });
    const moved = await fixture.departments.updateDepartment(
      fixture.orgA,
      b.id,
      {
        parentDepartmentId: a.id,
      },
    );
    expect(moved.parentDepartmentId).toBe(a.id);

    const promoted = await fixture.departments.updateDepartment(
      fixture.orgA,
      b.id,
      {
        parentDepartmentId: null,
      },
    );
    expect(promoted.parentDepartmentId).toBe(null);
  });

  it('rejects a parent department from another organization', async () => {
    const foreign = await fixture.departments.createDepartment({
      organizationId: fixture.orgB,
      parentDepartmentId: null,
      code: 'ENG',
      name: 'Engineering',
    });
    await expect(
      fixture.departments.createDepartment({
        organizationId: fixture.orgA,
        parentDepartmentId: foreign.id,
        code: 'QA',
        name: 'Quality',
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects a disabled parent department', async () => {
    const root = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'ENG',
      name: 'Engineering',
    });
    await fixture.departments.disableDepartment(fixture.orgA, root.id);
    await expect(
      fixture.departments.createDepartment({
        organizationId: fixture.orgA,
        parentDepartmentId: root.id,
        code: 'QA',
        name: 'Quality',
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('keeps an existing child readable after its parent is disabled', async () => {
    // Disabling blocks NEW usage; it does not orphan or hide existing rows.
    const root = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: null,
      code: 'ENG',
      name: 'Engineering',
    });
    const child = await fixture.departments.createDepartment({
      organizationId: fixture.orgA,
      parentDepartmentId: root.id,
      code: 'QA',
      name: 'Quality',
    });
    await fixture.departments.disableDepartment(fixture.orgA, root.id);

    const fetched = await fixture.departments.getDepartment(
      fixture.orgA,
      child.id,
    );
    expect(fetched.parentDepartmentId).toBe(root.id);
  });
});

describe('ItemGroupsService hierarchy', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('builds a two-level classification', async () => {
    const root = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    const child = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      parentId: root.id,
      code: 'BOLTS',
      name: 'Bolts',
    });
    expect(child.parentId).toBe(root.id);
  });

  it('rejects a cycle the same way departments do', async () => {
    const root = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      code: 'A',
      name: 'A',
    });
    const child = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      parentId: root.id,
      code: 'B',
      name: 'B',
    });
    await expect(
      fixture.itemGroups.updateItemGroup(fixture.orgA, root.id, {
        parentId: child.id,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects a parent group from another organization', async () => {
    const foreign = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgB,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    await expect(
      fixture.itemGroups.createItemGroup({
        organizationId: fixture.orgA,
        parentId: foreign.id,
        code: 'BOLTS',
        name: 'Bolts',
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('filters by parent, including roots', async () => {
    const root = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      parentId: root.id,
      code: 'BOLTS',
      name: 'Bolts',
    });

    const children = await fixture.itemGroups.listItemGroups({
      organizationId: fixture.orgA,
      parentId: root.id,
      page: 1,
      pageSize: 10,
    });
    expect(children.items.map((group) => group.code)).toEqual(['BOLTS']);
  });

  it("never exposes another organization's groups", async () => {
    await fixture.itemGroups.createItemGroup({
      organizationId: fixture.orgA,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    const listed = await fixture.itemGroups.listItemGroups({
      organizationId: fixture.orgB,
      page: 1,
      pageSize: 10,
    });
    expect(listed.total).toBe(0);
  });
});
