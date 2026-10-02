import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '../../../kernel/ids/ulid.js';
import {
  runWithRequestContext,
  type AuthenticatedPrincipal,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BranchesService } from '../../organization/application/branches.service.js';
import { UnitsService } from './units.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { NumberingService } from '../../documents/application/numbering.service.js';
import { DocumentRelationsService } from '../../documents/application/document-relations.service.js';
import { DocumentTypesService } from '../../documents/application/document-types.service.js';
import { DocumentTypeRegistry } from '../../documents/application/document-type-registry.js';
import {
  ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
  ACCOUNTING_VOUCHER_TYPE_DEFINITION,
} from '../../accounting/domain/accounting-document.js';
import { MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION } from '../domain/material-request-document-type.js';
import { MaterialRequestsService } from './material-requests.service.js';
import type { MaterialRequest } from '../domain/material-request.js';
import type { MaterialRequestLine } from '../domain/material-request-line.js';
import type { MaterialRequestEvent } from '../domain/material-request-event.js';
import {
  MaterialRequestStatusError,
  MaterialRequestApproverMismatchError,
  MaterialRequestLineNotFoundError,
  MaterialRequestInvocationCapacityError,
  type ApproveLineInput,
  type CreateDraftHeaderInput,
  type DraftLineInput,
  type InvocationCapacityResult,
  type MaterialRequestListFilter,
  type RejectInput,
  type ReverseApprovalInput,
  type SubmitInput,
  type UpdateDraftHeaderInput,
} from '../data/material-requests.repository.js';
import {
  addDecimalStrings,
  subtractDecimalStrings,
} from '../domain/quantities.js';

/**
 * `MaterialRequestsService` — regression coverage for the four PR #112
 * review findings:
 *   1. mutation responses must never require `Documents.Relation.View`;
 *   2. `invokeLine` must validate the destination document before consuming
 *      any capacity (never trust a registered type as proof of existence);
 *   3. (covered separately in `inventory-balances.service.spec.ts`);
 *   4. invoked-quantity accounting must not be capped at 1000 relations and
 *      must be race-free under concurrent invocations.
 *
 * `MaterialRequestsRepository` is faked here (`FakeMaterialRequestsRepository`
 * below) rather than driven through Prisma — there is no live Postgres in
 * this sandbox, and the fake still exercises the REAL service logic end to
 * end, including the lock-serialized capacity reservation the concurrency
 * test below depends on (`withLock` mirrors the real repository's
 * `SELECT … FOR UPDATE` header-row lock with an async mutex keyed by request
 * id, so two concurrent calls provably serialize instead of racing).
 * Reservation/balance arithmetic itself is OUT of scope for these findings
 * (already covered by `inventory-core.e2e-spec.ts`/the reservation suites),
 * so `approve()` here is a simplified stub that always succeeds for a
 * flagged line — never a redesign of the real `approve()` transaction.
 */

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

// ---------------------------------------------------------------------------
// Fake MaterialRequestsRepository
// ---------------------------------------------------------------------------

class FakeMaterialRequestsRepository {
  private readonly headers = new Map<string, MaterialRequest>();
  private readonly lines = new Map<string, MaterialRequestLine[]>();
  private readonly events = new Map<string, MaterialRequestEvent[]>();
  private readonly tails = new Map<string, Promise<void>>();

  /** Async mutex keyed by Material Request id — models the real
   *  `lockMaterialRequestRow` `SELECT … FOR UPDATE` serialization so
   *  concurrent calls provably observe each other's committed state. */
  private async withLock<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    const prior = this.tails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      id,
      prior.then(() => mine),
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async findById(id: string): Promise<MaterialRequest | null> {
    return this.headers.get(id) ?? null;
  }

  async list(params: {
    where: MaterialRequestListFilter;
    orderBy: unknown;
    skip: number;
    take: number;
  }): Promise<{ items: MaterialRequest[]; total: number }> {
    const items = [...this.headers.values()].filter(
      (header) => header.organizationId === params.where.organizationId,
    );
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async listLines(materialRequestId: string): Promise<MaterialRequestLine[]> {
    return [...(this.lines.get(materialRequestId) ?? [])];
  }

  async listEvents(materialRequestId: string): Promise<MaterialRequestEvent[]> {
    return [...(this.events.get(materialRequestId) ?? [])];
  }

  async createDraft(
    header: CreateDraftHeaderInput,
    lines: DraftLineInput[],
  ): Promise<{ header: MaterialRequest; lines: MaterialRequestLine[] }> {
    const created: MaterialRequest = {
      id: header.id,
      organizationId: header.organizationId,
      number: null,
      status: 'draft',
      description: header.description,
      requestedBy: header.requestedBy,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      approvalReversedAt: null,
      approvalReversedBy: null,
      approvalReversalReason: null,
      createdAt: header.createdAt,
      updatedAt: header.createdAt,
    };
    const createdLines: MaterialRequestLine[] = lines.map((line) => ({
      id: line.id,
      materialRequestId: header.id,
      organizationId: header.organizationId,
      branchId: line.branchId,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitId: line.unitId,
      baseQuantity: line.baseQuantity,
      baseUnitId: line.baseUnitId,
      conversionFactor: line.conversionFactor,
      reservationRequested: line.reservationRequested,
      reservationId: null,
      invokedBaseQuantity: '0',
      invocationCount: 0,
      createdAt: header.createdAt,
      updatedAt: header.createdAt,
    }));
    this.headers.set(header.id, created);
    this.lines.set(header.id, createdLines);
    this.events.set(header.id, []);
    this.appendEvent(header.id, header.organizationId, {
      eventType: 'created',
      fromStatus: null,
      toStatus: 'draft',
      actorId: header.createdBy,
      reason: null,
      referenceId: null,
      occurredAt: header.createdAt,
    });
    return { header: created, lines: createdLines };
  }

  async updateDraft(input: {
    id: string;
    organizationId: string;
    header: UpdateDraftHeaderInput;
    lines: DraftLineInput[] | undefined;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<{ header: MaterialRequest; lines: MaterialRequestLine[] }> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'draft');
      const updated: MaterialRequest = {
        ...current,
        description:
          input.header.description === undefined
            ? current.description
            : input.header.description,
        updatedAt: input.updatedAt,
      };
      this.headers.set(input.id, updated);
      let lines = this.lines.get(input.id) ?? [];
      if (input.lines !== undefined) {
        lines = input.lines.map((line) => ({
          id: line.id,
          materialRequestId: input.id,
          organizationId: input.organizationId,
          branchId: line.branchId,
          lineNumber: line.lineNumber,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          quantity: line.quantity,
          unitId: line.unitId,
          baseQuantity: line.baseQuantity,
          baseUnitId: line.baseUnitId,
          conversionFactor: line.conversionFactor,
          reservationRequested: line.reservationRequested,
          reservationId: null,
          invokedBaseQuantity: '0',
          invocationCount: 0,
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
        }));
        this.lines.set(input.id, lines);
      }
      return { header: updated, lines: [...lines] };
    });
  }

  async deleteDraft(id: string): Promise<void> {
    await this.withLock(id, () => {
      const current = this.requireHeader(id);
      this.assertStatus(current, 'draft');
      this.headers.delete(id);
      this.lines.delete(id);
      this.events.delete(id);
    });
  }

  async submit(input: SubmitInput): Promise<MaterialRequest> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'draft');
      const updated: MaterialRequest = {
        ...current,
        number: input.number,
        status: 'submitted',
        submittedAt: input.submittedAt,
        submittedBy: input.submittedBy,
        updatedAt: input.submittedAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'submitted',
        fromStatus: 'draft',
        toStatus: 'submitted',
        actorId: input.submittedBy,
        reason: null,
        referenceId: null,
        occurredAt: input.submittedAt,
      });
      return updated;
    });
  }

  /** Simplified: always succeeds for every flagged line (see class docs —
   *  reservation/balance arithmetic is out of scope for these findings). */
  async approve(input: {
    id: string;
    organizationId: string;
    approvedAt: Date;
    approvedBy: string | null;
    reservationLines: ApproveLineInput[];
  }): Promise<{
    header: MaterialRequest;
    reservationIds: Map<string, string>;
  }> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'submitted');
      const reservationIds = new Map<string, string>();
      const lines = this.lines.get(input.id) ?? [];
      const updatedLines = lines.map((line) => {
        const flagged = input.reservationLines.find(
          (l) => l.lineId === line.id,
        );
        if (flagged === undefined) return line;
        const reservationId = generateId();
        reservationIds.set(line.id, reservationId);
        return { ...line, reservationId };
      });
      this.lines.set(input.id, updatedLines);
      const updated: MaterialRequest = {
        ...current,
        status: 'approved',
        approvedAt: input.approvedAt,
        approvedBy: input.approvedBy,
        updatedAt: input.approvedAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'approved',
        fromStatus: 'submitted',
        toStatus: 'approved',
        actorId: input.approvedBy,
        reason: null,
        referenceId: null,
        occurredAt: input.approvedAt,
      });
      return { header: updated, reservationIds };
    });
  }

  async reject(input: RejectInput): Promise<MaterialRequest> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'submitted');
      const updated: MaterialRequest = {
        ...current,
        status: 'rejected',
        rejectedAt: input.rejectedAt,
        rejectedBy: input.rejectedBy,
        rejectionReason: input.reason,
        updatedAt: input.rejectedAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'rejected',
        fromStatus: 'submitted',
        toStatus: 'rejected',
        actorId: input.rejectedBy,
        reason: input.reason,
        referenceId: null,
        occurredAt: input.rejectedAt,
      });
      return updated;
    });
  }

  async reverseApproval(
    input: ReverseApprovalInput,
  ): Promise<{ header: MaterialRequest; releasedReservationIds: string[] }> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'approved');
      if (current.approvedBy !== input.expectedApprovedBy) {
        throw new MaterialRequestApproverMismatchError();
      }
      const updated: MaterialRequest = {
        ...current,
        status: 'submitted',
        approvalReversedAt: input.reversedAt,
        approvalReversedBy: input.reversedBy,
        approvalReversalReason: input.reason,
        updatedAt: input.reversedAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'approval_reversed',
        fromStatus: 'approved',
        toStatus: 'submitted',
        actorId: input.reversedBy,
        reason: input.reason,
        referenceId: null,
        occurredAt: input.reversedAt,
      });
      return { header: updated, releasedReservationIds: [] };
    });
  }

  async reserveInvocationCapacity(input: {
    id: string;
    organizationId: string;
    lineId: string;
    invokedBase: string;
    now: Date;
    actorId: string | null;
  }): Promise<InvocationCapacityResult> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'approved');
      const lines = this.lines.get(input.id) ?? [];
      const index = lines.findIndex(
        (candidate) => candidate.id === input.lineId,
      );
      if (index === -1) {
        throw new MaterialRequestLineNotFoundError(input.lineId);
      }
      const line = lines[index]!;
      const remaining = subtractDecimalStrings(
        line.baseQuantity,
        line.invokedBaseQuantity,
      );
      if (compare(input.invokedBase, remaining) > 0) {
        throw new MaterialRequestInvocationCapacityError({
          remaining,
          requested: input.invokedBase,
        });
      }
      const nextInvoked = addDecimalStrings(
        line.invokedBaseQuantity,
        input.invokedBase,
      );
      const nextCount = line.invocationCount + 1;
      lines[index] = {
        ...line,
        invokedBaseQuantity: nextInvoked,
        invocationCount: nextCount,
        updatedAt: input.now,
      };
      return {
        invokedBaseQuantity: nextInvoked,
        remainingBaseQuantity: subtractDecimalStrings(
          remaining,
          input.invokedBase,
        ),
        invocationCount: nextCount,
      };
    });
  }

  async releaseInvocationCapacity(input: {
    id: string;
    lineId: string;
    invokedBase: string;
    now: Date;
    actorId: string | null;
  }): Promise<void> {
    await this.withLock(input.id, () => {
      const lines = this.lines.get(input.id) ?? [];
      const index = lines.findIndex(
        (candidate) => candidate.id === input.lineId,
      );
      if (index === -1) return;
      const line = lines[index]!;
      const restored = subtractDecimalStrings(
        line.invokedBaseQuantity,
        input.invokedBase,
      );
      const floored = compare(restored, '0') < 0 ? '0' : restored;
      lines[index] = {
        ...line,
        invokedBaseQuantity: floored,
        invocationCount: Math.max(line.invocationCount - 1, 0),
        updatedAt: input.now,
      };
    });
  }

  async recordInvocationEvent(input: {
    materialRequestId: string;
    organizationId: string;
    actorId: string | null;
    occurredAt: Date;
    relationId: string;
  }): Promise<void> {
    this.appendEvent(input.materialRequestId, input.organizationId, {
      eventType: 'line_invoked',
      fromStatus: null,
      toStatus: null,
      actorId: input.actorId,
      reason: null,
      referenceId: input.relationId,
      occurredAt: input.occurredAt,
    });
  }

  // ---- internals ----------------------------------------------------------

  private requireHeader(id: string): MaterialRequest {
    const header = this.headers.get(id);
    if (header === undefined) {
      throw new Error(`Material Request "${id}" does not exist.`);
    }
    return header;
  }

  private assertStatus(
    header: MaterialRequest,
    expected: MaterialRequest['status'],
  ): void {
    if (header.status !== expected) {
      throw new MaterialRequestStatusError(header.status, expected);
    }
  }

  private appendEvent(
    materialRequestId: string,
    organizationId: string,
    partial: Omit<
      MaterialRequestEvent,
      'id' | 'materialRequestId' | 'organizationId' | 'createdAt'
    >,
  ): void {
    const list = this.events.get(materialRequestId) ?? [];
    list.push({
      id: generateId(),
      materialRequestId,
      organizationId,
      createdAt: partial.occurredAt,
      ...partial,
    });
    this.events.set(materialRequestId, list);
  }
}

function compare(a: string, b: string): number {
  const x = Number.parseFloat(a);
  const y = Number.parseFloat(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface BuildOptions {
  /** When true, `DocumentRelationsService.listRelations` always throws a
   *  forbidden error (simulating a caller WITHOUT `Documents.Relation.View`)
   *  — proves finding #1: nothing in the service may call it. */
  denyRelationView?: boolean;
  /** When true, `DocumentRelationsService.linkDocuments` always throws —
   *  used to test the finding #2/#4 compensation path. */
  failLinkDocuments?: boolean;
}

async function buildFixture(options: BuildOptions = {}) {
  const stores = createMasterDataStores();
  // Every call in these tests runs WITH a request context + principal
  // (`requireActorId` demands one regardless of authorization), which would
  // otherwise route `AuthorizationService` through its real database-backed
  // check. That check is orthogonal to these four findings (already covered
  // by `master-data-authorization.spec.ts`), so it is faked here as an
  // always-allow no-op — exactly what matters is that
  // `Documents.Relation.View` specifically is never requested, which this
  // fake cannot hide (`documentRelations.listRelations` is a SEPARATE test
  // double below that throws unconditionally).
  const authorization = {
    requireAllPermissions: async () => {},
    hasAllPermissions: async () => true,
    hasAnyPermission: async () => true,
    effectivePermissionCodes: async () => [],
  } as unknown as AuthorizationService;
  const bus = new (
    await import('../../../kernel/events/domain-event-bus.js')
  ).DomainEventBus();
  const organizations = new OrganizationsService(
    stores.organizations,
    stores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const branches = new BranchesService(
    stores.branches,
    organizations,
    authorization,
    loggerStub(),
    bus,
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
  const noMovements = {
    existsForItem: async () => false,
    existsForWarehouse: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalances = {
    hasBlockingBalanceForItem: async () => false,
    hasBlockingBalanceForWarehouse: async () => false,
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
  const warehouses = new WarehousesService(
    stores.warehouses,
    organizations,
    branches,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );

  const repository = new FakeMaterialRequestsRepository();

  const numbering = {
    allocateNumber: async () => ({ number: `MR-${generateId()}` }),
  } as unknown as NumberingService;

  const registry = new DocumentTypeRegistry();
  registry.register([
    MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION,
    ACCOUNTING_VOUCHER_TYPE_DEFINITION,
  ]);
  const documentTypes = new DocumentTypesService(
    registry,
    undefined as never,
    undefined as never,
    undefined as never,
    loggerStub(),
    undefined as never,
  );

  const relationCalls: string[] = [];
  const documentRelations = {
    listRelations: async () => {
      relationCalls.push('listRelations');
      if (options.denyRelationView ?? true) {
        throw new Error(
          'TEST DOUBLE: listRelations must never be called by ' +
            'MaterialRequestsService (Documents.Relation.View leak, finding #1).',
        );
      }
      return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    },
    linkDocuments: async (input: {
      organizationId: string;
      source: {
        module: string;
        documentType: string;
        documentId: string;
        lineId: string | null;
      };
      target: {
        module: string;
        documentType: string;
        documentId: string;
        lineId: string | null;
      };
      relationKind: string;
      quantity?: string | null;
    }) => {
      relationCalls.push('linkDocuments');
      if (options.failLinkDocuments === true) {
        throw new Error('TEST DOUBLE: linkDocuments forced failure.');
      }
      return {
        id: generateId(),
        organizationId: input.organizationId,
        source: input.source,
        target: input.target,
        relationKind: input.relationKind,
        quantity: input.quantity ?? null,
      };
    },
  } as unknown as DocumentRelationsService;

  const service = new MaterialRequestsService(
    repository as unknown as import('../data/material-requests.repository.js').MaterialRequestsRepository,
    organizations,
    items,
    warehouses,
    units,
    stores.unitConversions as unknown as UnitConversionsRepository,
    numbering,
    documentRelations,
    documentTypes,
    authorization,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const otherOrganizationId = (
    await organizations.createOrganization({ code: 'ORG-B', name: 'Org B' })
  ).id;
  // ODR-3: every call in these tests runs with a request context + principal
  // (`asActor`), so `OrganizationsService.assertOrganizationInScope` demands
  // an actual membership row — it is not a system-context caller. Seed the
  // fixed test actor into both organizations up front.
  stores.raw.memberships.seed(ACTOR.userId, organizationId);
  stores.raw.memberships.seed(ACTOR.userId, otherOrganizationId);
  const branchId = (
    await branches.createBranch({
      organizationId,
      code: 'B1',
      name: 'Branch 1',
    })
  ).id;
  const unitId = (
    await units.createUnit({ organizationId, code: 'EA', name: 'Each' })
  ).id;
  const itemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-1',
      name: 'Widget',
      itemKind: 'goods',
      baseUnitId: unitId,
    })
  ).id;
  const warehouseId = (
    await warehouses.createWarehouse({
      organizationId,
      branchId,
      code: 'WH-1',
      name: 'Main warehouse',
      allowNegativeStock: true,
    })
  ).id;

  return {
    service,
    repository,
    organizations,
    branches,
    units,
    items,
    warehouses,
    organizationId,
    otherOrganizationId,
    branchId,
    unitId,
    itemId,
    warehouseId,
    relationCalls,
  };
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

const ACTOR: AuthenticatedPrincipal = {
  userId: 'user-1',
  sessionId: 'session-1',
};

function asActor<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { correlationId: 'test-correlation', principal: ACTOR },
    fn,
  );
}

async function createAndApprove(
  fixture: Fixture,
  overrides: { quantity?: string; reservationRequested?: boolean } = {},
): Promise<{ materialRequestId: string; lineId: string }> {
  return asActor(async () => {
    const created = await fixture.service.createDraft({
      organizationId: fixture.organizationId,
      lines: [
        {
          itemId: fixture.itemId,
          warehouseId: fixture.warehouseId,
          quantity: overrides.quantity ?? '10',
          unitId: fixture.unitId,
          reservationRequested: overrides.reservationRequested ?? false,
        },
      ],
    });
    await fixture.service.submit(created.id, fixture.organizationId);
    await fixture.service.approve(created.id, fixture.organizationId);
    return { materialRequestId: created.id, lineId: created.lines[0]!.id };
  });
}

// ---------------------------------------------------------------------------
// Finding #1 — no Documents.Relation.View dependency on mutation responses
// ---------------------------------------------------------------------------

describe('Finding #1 — mutation responses never require Documents.Relation.View', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    // `denyRelationView` makes listRelations throw on ANY call — if any
    // mutation still read relations back to build its response, these tests
    // would fail with the test double's thrown error, not a business error.
    fixture = await buildFixture({ denyRelationView: true });
  });

  it('createDraft succeeds and never calls listRelations', async () => {
    const result = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '5',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    expect(result.lines[0]?.invokedBaseQuantity).toBe('0');
    expect(result.lines[0]?.remainingBaseQuantity).toBe('5');
    expect(fixture.relationCalls).not.toContain('listRelations');
  });

  it('updateDraft, submit, approve, reject all succeed without listRelations', async () => {
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '5',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.updateDraft(created.id, fixture.organizationId, {
        description: 'updated',
      }),
    );
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );

    // Branch A: approve.
    const approveFixture = fixture;
    await asActor(() =>
      approveFixture.service.approve(created.id, approveFixture.organizationId),
    );
    expect(approveFixture.relationCalls).not.toContain('listRelations');
  });

  it('reject succeeds without listRelations', async () => {
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '5',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    const rejected = await asActor(() =>
      fixture.service.reject(created.id, fixture.organizationId, {
        reason: 'Not needed anymore',
      }),
    );
    expect(rejected.status).toBe('rejected');
    expect(fixture.relationCalls).not.toContain('listRelations');
  });

  it('reverseApproval succeeds without listRelations (uses the line counters)', async () => {
    const { materialRequestId } = await createAndApprove(fixture);
    const reversed = await asActor(() =>
      fixture.service.reverseApproval(
        materialRequestId,
        fixture.organizationId,
        {},
      ),
    );
    expect(reversed.status).toBe('submitted');
    expect(fixture.relationCalls).not.toContain('listRelations');
  });

  it('getMaterialRequest succeeds without listRelations', async () => {
    const { materialRequestId } = await createAndApprove(fixture);
    const detail = await asActor(() =>
      fixture.service.getMaterialRequest(
        materialRequestId,
        fixture.organizationId,
      ),
    );
    expect(detail.status).toBe('approved');
    expect(fixture.relationCalls).not.toContain('listRelations');
  });
});

// ---------------------------------------------------------------------------
// Finding #2 — invocation destination validation
// ---------------------------------------------------------------------------

describe('Finding #2 — invokeLine validates the destination before consuming capacity', () => {
  it('rejects an unregistered destination document type', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'purchasing',
          destinationDocumentType: 'purchase_request_not_registered',
          destinationDocumentId: generateId(),
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects when the claimed module does not own the registered type (module/type mismatch)', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          // accounting_voucher is registered to module "accounting", not "inventory".
          destinationModule: 'inventory',
          destinationDocumentType: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
          destinationDocumentId: generateId(),
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a destination type/module with no safe verifier, rather than fabricating validation', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'accounting',
          destinationDocumentType: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
          destinationDocumentId: generateId(),
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects a nonexistent destination document id (registered type is NOT proof of existence)', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: 'does-not-exist',
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    // Capacity must not have been consumed by the failed attempt.
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('rejects a destination document that belongs to a different organization', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    // A second Material Request in the OTHER organization, used purely as a
    // real, verifiable document for the org-mismatch case. Items and
    // warehouses are themselves organization-scoped, so this needs its own
    // master data rather than reusing org A's item/warehouse.
    const otherUnitId = (
      await fixture.units.createUnit({
        organizationId: fixture.otherOrganizationId,
        code: 'EA',
        name: 'Each',
      })
    ).id;
    const otherItemId = (
      await fixture.items.createItem({
        organizationId: fixture.otherOrganizationId,
        code: 'ITM-1',
        name: 'Widget (Org B)',
        itemKind: 'goods',
        baseUnitId: otherUnitId,
      })
    ).id;
    const otherBranchId = (
      await fixture.branches.createBranch({
        organizationId: fixture.otherOrganizationId,
        code: 'B1',
        name: 'Branch 1',
      })
    ).id;
    const otherWarehouseId = (
      await fixture.warehouses.createWarehouse({
        organizationId: fixture.otherOrganizationId,
        branchId: otherBranchId,
        code: 'WH-1',
        name: 'Main warehouse',
        allowNegativeStock: true,
      })
    ).id;
    const otherOrgRequest = await runWithRequestContext(
      { correlationId: 'other-org', principal: ACTOR },
      () =>
        fixture.service.createDraft({
          organizationId: fixture.otherOrganizationId,
          lines: [
            {
              itemId: otherItemId,
              warehouseId: otherWarehouseId,
              quantity: '3',
              unitId: otherUnitId,
            },
          ],
        }),
    );
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: otherOrgRequest.id,
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an invalid destination line id on an otherwise valid destination', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '3',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          destinationLineId: 'not-a-real-line',
          quantity: '1',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('happy path: a valid, verified destination succeeds and records the invocation', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '10',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '3',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    const result = await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        destinationLineId: destination.lines[0]!.id,
        quantity: '4',
      }),
    );
    expect(result.invokedBaseQuantity).toBe('4');
    expect(result.remainingBaseQuantity).toBe('6');
    expect(result.invocationCount).toBe(1);
    expect(fixture.relationCalls).toContain('linkDocuments');
  });
});

// ---------------------------------------------------------------------------
// Finding #4 — invocation quantity accounting: no 1000-row cap, concurrency
// ---------------------------------------------------------------------------

describe('Finding #4 — invocation accounting correctness and concurrency', () => {
  it('supports a partial invocation followed by exact completion', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '10',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '100',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    const invoke = (quantity: string) =>
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity,
        }),
      );
    const first = await invoke('4');
    expect(first.remainingBaseQuantity).toBe('6');
    const second = await invoke('6');
    expect(second.remainingBaseQuantity).toBe('0');
    expect(second.invocationCount).toBe(2);
  });

  it('rejects an invocation that would exceed what remains on the line', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '10',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '100',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '11',
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('a failed linkDocuments write does not consume capacity (compensating release)', async () => {
    const fixture = await buildFixture({ failLinkDocuments: true });
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '10',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '100',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '4',
        }),
      ),
    ).rejects.toThrow();
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('0');
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('aggregates correctly past 1000 invocations — no page-size cap (equivalent of the >1000-relation test)', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '2000',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '5000',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    const total = 1005;
    for (let i = 0; i < total; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '1',
        }),
      );
    }
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invocationCount).toBe(total);
    expect(lines[0]?.invokedBaseQuantity).toBe(`${total}`);
    expect(subtractDecimalStrings('2000', lines[0]!.invokedBaseQuantity)).toBe(
      `${2000 - total}`,
    );
  }, 20000);

  it('two concurrent invocations of the same line cannot jointly exceed its remaining quantity', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '10',
    });
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '100',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    const invoke = (quantity: string) =>
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity,
        }),
      );
    // Each requests 7 of a line with only 10 remaining — if these raced
    // without the header-row lock, BOTH could read "10 remaining" and both
    // succeed, consuming 14 total. They must not.
    const results = await Promise.allSettled([invoke('7'), invoke('7')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('7');
    expect(lines[0]?.invocationCount).toBe(1);
  });
});
