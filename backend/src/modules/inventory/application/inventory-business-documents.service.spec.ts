import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  runWithRequestContext,
  type AuthenticatedPrincipal,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BranchesService } from '../../organization/application/branches.service.js';
import { NumberingService } from '../../documents/application/numbering.service.js';
import { UnitsService } from './units.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { InventoryBusinessDocumentsService } from './inventory-business-documents.service.js';
import type { InventoryValuationService } from './inventory-valuation.service.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import type { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { InsufficientStockError } from '../data/inventory-posting-errors.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
} from '../domain/quantities.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../domain/inventory-document-permissions.js';
import { INVENTORY_DOCUMENT_EVENT_TYPES } from '../domain/inventory-document.events.js';

/**
 * `InventoryBusinessDocumentsService` — the C-58 runtime contract.
 *
 * The ledger is faked here (`FakeWorld` below) because this sandbox has no
 * PostgreSQL; the live-database proof of real transactional atomicity,
 * row-locking and concurrency lives in
 * `test/inventory-business-documents-live.e2e-spec.ts` and runs in CI. What
 * the fake DOES reproduce faithfully, because these tests depend on it:
 *
 *   * ONE transaction around the document write and every ledger effect,
 *     with a real rollback (`withTransaction` restores the pre-call snapshot
 *     of documents, lines, movements, balances and idempotency keys when the
 *     work throws) — so "a rejected edit leaves the previous state intact"
 *     is an assertion about observable state, not about a mock call count;
 *   * the negative-stock invariant evaluated against the balance the
 *     transaction has already written (ADR-0022 §5 / OD-54-04);
 *   * `(organizationId, operationKey)` uniqueness, so a duplicated ledger
 *     effect is impossible rather than merely unlikely;
 *   * the reversal rules the real repository enforces: a movement can be
 *     reversed once, and a reversal mirrors the original exactly.
 *
 * Everything else — authorization, organization scope, lifecycle, the OQ-54
 * edit pipeline, cost rules, numbering — is the REAL service code under test.
 */

const ACTOR: AuthenticatedPrincipal = {
  userId: 'user-doc-1',
  sessionId: 'session-doc-1',
};

function asActor<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { correlationId: 'test-correlation', principal: ACTOR },
    fn,
  );
}

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

// ---------------------------------------------------------------------------
// Fake world: documents + lines + movements + balances + idempotency keys
// ---------------------------------------------------------------------------

interface DocRow {
  id: string;
  organizationId: string;
  kind: string;
  number: string | null;
  businessDate: Date;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  receiptCost: string | null;
  status: string;
  description: string | null;
  reference: string | null;
  operationKey: string | null;
  valuationStale: boolean;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  accountingPostedAt: Date | null;
  accountingPostedBy: string | null;
  sealedAt: Date | null;
  sealedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

interface LineRow {
  id: string;
  documentId: string;
  organizationId: string;
  lineNumber: number;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  movementId: string | null;
  outMovementId: string | null;
  inMovementId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

interface MovementRow {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: string;
  quantity: string;
  enteredUnitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  movementDate: Date;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  totalCost: string | null;
  valuationStatus: string;
}

class FakeWorld {
  documents = new Map<string, DocRow>();
  lines = new Map<string, LineRow>();
  movements = new Map<string, MovementRow>();
  balances = new Map<string, string>();
  operations = new Set<string>();
  /** Set by a test to make the NEXT ledger write explode (rollback proof). */
  failNextPosting: string | null = null;

  snapshot() {
    return {
      documents: new Map(
        [...this.documents].map(([id, row]) => [id, { ...row }]),
      ),
      lines: new Map([...this.lines].map(([id, row]) => [id, { ...row }])),
      movements: new Map(
        [...this.movements].map(([id, row]) => [id, { ...row }]),
      ),
      balances: new Map(this.balances),
      operations: new Set(this.operations),
    };
  }

  restore(snapshot: ReturnType<FakeWorld['snapshot']>): void {
    this.documents = snapshot.documents;
    this.lines = snapshot.lines;
    this.movements = snapshot.movements;
    this.balances = snapshot.balances;
    this.operations = snapshot.operations;
  }

  balanceKey(warehouseId: string, itemId: string): string {
    return `${warehouseId}:${itemId}`;
  }

  onHand(warehouseId: string, itemId: string): string {
    return this.balances.get(this.balanceKey(warehouseId, itemId)) ?? '0';
  }

  applyDelta(
    warehouseId: string,
    itemId: string,
    delta: string,
    allowNegative: boolean,
  ): void {
    const current = this.onHand(warehouseId, itemId);
    const next = addDecimalStrings(current, delta);
    if (!allowNegative && compareDecimalStrings(next, '0') < 0) {
      throw new InsufficientStockError({
        onHand: current,
        requested: delta.startsWith('-') ? delta.slice(1) : delta,
      });
    }
    this.balances.set(this.balanceKey(warehouseId, itemId), next);
  }

  useKey(organizationId: string, operationKey: string): void {
    const key = `${organizationId}:${operationKey}`;
    if (this.operations.has(key)) {
      throw new Error(
        `TEST DOUBLE: duplicate inventory operation key "${operationKey}".`,
      );
    }
    this.operations.add(key);
  }

  maybeFail(stage: string): void {
    if (this.failNextPosting === stage) {
      this.failNextPosting = null;
      throw new Error(`TEST DOUBLE: forced failure at "${stage}".`);
    }
  }
}

function fakeDocumentsRepository(
  world: FakeWorld,
): InventoryBusinessDocumentsRepository {
  const linesOf = (documentId: string): LineRow[] =>
    [...world.lines.values()]
      .filter((line) => line.documentId === documentId)
      .sort((left, right) => left.lineNumber - right.lineNumber);

  const toDomain = (row: DocRow) => {
    const base = {
      id: row.id,
      organizationId: row.organizationId,
      number: row.number,
      businessDate: row.businessDate,
      lines: linesOf(row.id).map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: line.unitId,
        baseQuantity: line.baseQuantity,
        baseUnitId: line.baseUnitId,
        conversionFactor: line.conversionFactor,
        movementId: line.movementId,
        outMovementId: line.outMovementId,
        inMovementId: line.inMovementId,
      })),
      description: row.description,
      reference: row.reference,
      status: row.status,
      operationKey: row.operationKey,
      valuationStale: row.valuationStale,
      finalizedAt: row.finalizedAt,
      finalizedBy: row.finalizedBy,
      accountingPostedAt: row.accountingPostedAt,
      accountingPostedBy: row.accountingPostedBy,
      sealedAt: row.sealedAt,
      sealedBy: row.sealedBy,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      cancellationReason: row.cancellationReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      kind: row.kind,
      warehouseId: row.warehouseId,
      sourceWarehouseId: row.sourceWarehouseId,
      destinationWarehouseId: row.destinationWarehouseId,
      cost: row.kind === 'receipt' ? row.receiptCost : null,
    };
    return base as never;
  };

  const writeLines = (
    header: {
      id: string;
      organizationId: string;
      actorId: string | null;
      at: Date;
    },
    lines: Array<Record<string, unknown>>,
  ): void => {
    for (const line of lines) {
      world.lines.set(line['id'] as string, {
        id: line['id'] as string,
        documentId: header.id,
        organizationId: header.organizationId,
        lineNumber: line['lineNumber'] as number,
        itemId: line['itemId'] as string,
        quantity: line['quantity'] as string,
        unitId: line['unitId'] as string,
        baseQuantity: line['baseQuantity'] as string,
        baseUnitId: line['baseUnitId'] as string,
        conversionFactor: line['conversionFactor'] as string,
        movementId: null,
        outMovementId: null,
        inMovementId: null,
        createdAt: header.at,
        updatedAt: header.at,
        createdBy: header.actorId,
        updatedBy: null,
      });
    }
  };

  return {
    async withTransaction(work: (tx: never) => Promise<unknown>) {
      const snapshot = world.snapshot();
      try {
        return await work({ tx: true } as never);
      } catch (error) {
        world.restore(snapshot);
        throw error;
      }
    },
    async findById(organizationId: string, id: string) {
      const row = world.documents.get(id);
      if (row === undefined || row.organizationId !== organizationId) {
        return null;
      }
      return toDomain(row);
    },
    async list(params: {
      where: { organizationId: string; kind?: string; status?: string };
    }) {
      const rows = [...world.documents.values()].filter(
        (row) =>
          row.organizationId === params.where.organizationId &&
          (params.where.kind === undefined || row.kind === params.where.kind) &&
          (params.where.status === undefined ||
            row.status === params.where.status),
      );
      return { items: rows.map(toDomain), total: rows.length };
    },
    async createDocument(input: {
      header: Record<string, unknown>;
      lines: Array<Record<string, unknown>>;
    }) {
      const header = input.header as unknown as {
        id: string;
        organizationId: string;
        kind: string;
        businessDate: Date;
        warehouseId: string | null;
        sourceWarehouseId: string | null;
        destinationWarehouseId: string | null;
        receiptCost: string | null;
        status: string;
        description: string | null;
        reference: string | null;
        actorId: string | null;
        at: Date;
      };
      world.documents.set(header.id, {
        id: header.id,
        organizationId: header.organizationId,
        kind: header.kind,
        number: null,
        businessDate: header.businessDate,
        warehouseId: header.warehouseId,
        sourceWarehouseId: header.sourceWarehouseId,
        destinationWarehouseId: header.destinationWarehouseId,
        receiptCost: header.receiptCost,
        status: header.status,
        description: header.description,
        reference: header.reference,
        operationKey: null,
        valuationStale: false,
        finalizedAt: null,
        finalizedBy: null,
        accountingPostedAt: null,
        accountingPostedBy: null,
        sealedAt: null,
        sealedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        createdAt: header.at,
        updatedAt: header.at,
        createdBy: header.actorId,
        updatedBy: null,
      });
      writeLines(header, input.lines);
      return toDomain(world.documents.get(header.id)!);
    },
    async replaceLines(
      _tx: never,
      header: {
        id: string;
        organizationId: string;
        actorId: string | null;
        at: Date;
      },
      lines: Array<Record<string, unknown>>,
    ) {
      for (const [id, line] of Array.from(world.lines)) {
        if (line.documentId === header.id) world.lines.delete(id);
      }
      writeLines(header, lines);
    },
    async updateHeader(_tx: never, id: string, data: Record<string, unknown>) {
      const current = world.documents.get(id);
      if (current === undefined) throw new Error('missing document');
      world.documents.set(id, { ...current, ...(data as Partial<DocRow>) });
    },
    async setLineMovements(
      _tx: never,
      lineId: string,
      movements: Record<string, string | null | undefined>,
      audit: { at: Date; actorId: string | null },
    ) {
      const current = world.lines.get(lineId);
      if (current === undefined) throw new Error('missing line');
      world.lines.set(lineId, {
        ...current,
        ...(movements as Partial<LineRow>),
        updatedAt: audit.at,
        updatedBy: audit.actorId,
      });
    },
    async deleteDraft(organizationId: string, id: string) {
      const row = world.documents.get(id);
      if (row === undefined || row.organizationId !== organizationId) return;
      for (const [lineId, line] of Array.from(world.lines)) {
        if (line.documentId === id) world.lines.delete(lineId);
      }
      world.documents.delete(id);
    },
  } as unknown as InventoryBusinessDocumentsRepository;
}

function fakeMovementsRepository(
  world: FakeWorld,
): InventoryMovementsRepository {
  const insert = (
    movement: Record<string, unknown>,
    allowNegative: boolean,
    totalCost: string | null,
  ): MovementRow => {
    world.maybeFail('posting');
    const row: MovementRow = {
      id: movement['id'] as string,
      organizationId: movement['organizationId'] as string,
      branchId: movement['branchId'] as string,
      warehouseId: movement['warehouseId'] as string,
      itemId: movement['itemId'] as string,
      movementType: movement['movementType'] as string,
      quantity: movement['quantity'] as string,
      enteredUnitId: movement['unitId'] as string,
      baseQuantity: movement['baseQuantity'] as string,
      baseUnitId: movement['baseUnitId'] as string,
      conversionFactor: movement['conversionFactor'] as string,
      movementDate: movement['movementDate'] as Date,
      transferId: (movement['transferId'] as string | null) ?? null,
      reversalOfMovementId:
        (movement['reversalOfMovementId'] as string | null) ?? null,
      referenceType: (movement['referenceType'] as string | null) ?? null,
      referenceId: (movement['referenceId'] as string | null) ?? null,
      reason: (movement['reason'] as string | null) ?? null,
      operationKey: movement['operationKey'] as string,
      totalCost,
      valuationStatus: totalCost === null ? 'unvalued' : 'valued',
    };
    world.applyDelta(
      row.warehouseId,
      row.itemId,
      row.baseQuantity,
      allowNegative,
    );
    world.movements.set(row.id, row);
    return row;
  };

  return {
    async findById(id: string) {
      return world.movements.get(id) ?? null;
    },
    async maxMovementDate(
      organizationId: string,
      warehouseId: string,
      itemId: string,
    ) {
      const dates = [...world.movements.values()]
        .filter(
          (row) =>
            row.organizationId === organizationId &&
            row.warehouseId === warehouseId &&
            row.itemId === itemId,
        )
        .map((row) => row.movementDate.getTime());
      return dates.length === 0 ? null : new Date(Math.max(...dates));
    },
    async postMovement(input: Record<string, unknown>) {
      const operation = input['operation'] as {
        organizationId: string;
        operationKey: string;
      };
      const valuation = input['valuation'] as { knownValue: string | null };
      const movement = insert(
        input['movement'] as Record<string, unknown>,
        input['allowNegative'] === true,
        valuation.knownValue,
      );
      world.useKey(operation.organizationId, operation.operationKey);
      return { movement, balance: {} };
    },
    async postTransfer(input: Record<string, unknown>) {
      const operation = input['operation'] as {
        organizationId: string;
        operationKey: string;
      };
      const outLeg = insert(
        input['outLeg'] as Record<string, unknown>,
        input['sourceAllowNegative'] === true,
        null,
      );
      const inLeg = insert(
        input['inLeg'] as Record<string, unknown>,
        true,
        null,
      );
      world.useKey(operation.organizationId, operation.operationKey);
      return { outLeg, inLeg };
    },
    async postReversal(input: Record<string, unknown>) {
      const originalId = input['originalMovementId'] as string;
      const already = [...world.movements.values()].some(
        (row) => row.reversalOfMovementId === originalId,
      );
      if (already) throw new Error('TEST DOUBLE: already reversed.');
      const operation = input['operation'] as {
        organizationId: string;
        operationKey: string;
      };
      const movement = insert(
        input['movement'] as Record<string, unknown>,
        input['allowNegative'] === true,
        null,
      );
      world.useKey(operation.organizationId, operation.operationKey);
      return { movement };
    },
    async existsForItem() {
      return false;
    },
    async existsForWarehouse() {
      return false;
    },
  } as unknown as InventoryMovementsRepository;
}

interface ValuationOptions {
  canViewCost?: boolean;
  backdated?: boolean;
  /** Make the in-transaction repricing refuse, to prove the rollback. */
  repricingFails?: boolean;
}

function fakeValuation(
  options: ValuationOptions,
  recalculations: string[],
): InventoryValuationService {
  return {
    async canViewCost() {
      return options.canViewCost ?? true;
    },
    async resolveMethodForPosting() {
      return { method: 'moving_weighted_average', source: 'default' };
    },
    async assessBackdateImpact(params: { movementDate: Date }) {
      return {
        backdated: options.backdated === true,
        movementDate: params.movementDate,
        latestMovementDate: null,
        affectedMovements: 0,
        affectedValuedMovements: 0,
        alreadyStale: false,
      };
    },
    async requireBackdateDecisions() {
      return { backdated: options.backdated === true, repricing: null };
    },
    // The transaction-aware seam: the plan is built BEFORE the command's
    // transaction and executed INSIDE it, so `recalculations` only records
    // keys whose replay actually ran.
    async prepareRecalculation(input: { warehouseId: string; itemId: string }) {
      return { key: `${input.warehouseId}:${input.itemId}` };
    },
    async recalculateWithin(_tx: unknown, prepared: { key: string }) {
      if (options.repricingFails === true) {
        throw AppException.businessRule('Valuation replay refused.', {
          code: 'inventory.recalculation_too_large',
        });
      }
      recalculations.push(prepared.key);
      return { id: 'run', warehouseId: prepared.key };
    },
    async announceRecalculated() {
      return undefined;
    },
  } as unknown as InventoryValuationService;
}

interface BuildOptions {
  canViewCost?: boolean;
  backdated?: boolean;
  repricingFails?: boolean;
}

async function buildFixture(options: BuildOptions = {}) {
  const stores = createMasterDataStores();
  const requested: string[] = [];
  // Null until a test restricts it: the fixture itself has to create
  // organizations, items and warehouses, and that setup is not what an
  // authorization test is about.
  let allowed: string[] | null = null;
  const authorization = {
    requireAllPermissions: async (codes: string[]) => {
      requested.push(...codes);
      if (allowed === null) return;
      for (const code of codes) {
        if (!allowed.includes(code)) {
          const { AppException } =
            await import('../../../kernel/errors/app-exception.js');
          throw AppException.forbidden(`Missing permission ${code}.`);
        }
      }
    },
    hasAllPermissions: async () => true,
    hasAnyPermission: async () => true,
    effectivePermissionCodes: async () => [],
  } as unknown as AuthorizationService;

  const bus = new DomainEventBus();
  const published: Array<{ type: string; payload: unknown }> = [];
  for (const type of INVENTORY_DOCUMENT_EVENT_TYPES) {
    bus.on(type, (event) => {
      published.push({ type: event.type, payload: event.payload });
      return Promise.resolve();
    });
  }

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

  const world = new FakeWorld();
  const recalculations: string[] = [];
  const allocations = new Map<string, string>();
  let serial = 0;
  const numbering = {
    allocateNumber: async (input: { allocationKey: string }) => {
      const existing = allocations.get(input.allocationKey);
      if (existing !== undefined) return { number: existing };
      serial += 1;
      const number = `DOC-${String(serial).padStart(4, '0')}`;
      allocations.set(input.allocationKey, number);
      return { number };
    },
  } as unknown as NumberingService;

  const service = new InventoryBusinessDocumentsService(
    fakeDocumentsRepository(world),
    fakeMovementsRepository(world),
    stores.unitConversions as unknown as UnitConversionsRepository,
    organizations,
    items,
    warehouses,
    units,
    fakeValuation(options, recalculations),
    numbering,
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
  stores.raw.memberships.seed(ACTOR.userId, organizationId);
  stores.raw.memberships.seed(ACTOR.userId, otherOrganizationId);

  const branchId = (
    await branches.createBranch({ organizationId, code: 'B1', name: 'Branch' })
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
  const otherItemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-2',
      name: 'Gadget',
      itemKind: 'goods',
      baseUnitId: unitId,
    })
  ).id;
  const warehouseId = (
    await warehouses.createWarehouse({
      organizationId,
      branchId,
      code: 'WH-1',
      name: 'Main',
    })
  ).id;
  const otherWarehouseId = (
    await warehouses.createWarehouse({
      organizationId,
      branchId,
      code: 'WH-2',
      name: 'Second',
    })
  ).id;

  return {
    service,
    world,
    published,
    recalculations,
    requested,
    /** Narrow the caller's permissions once the fixture is built. */
    restrictPermissions: (codes: string[]) => {
      allowed = codes;
    },
    organizationId,
    otherOrganizationId,
    unitId,
    itemId,
    otherItemId,
    warehouseId,
    otherWarehouseId,
  };
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

async function createReceipt(
  fixture: Fixture,
  overrides: { quantity?: string; cost?: string; warehouseId?: string } = {},
) {
  return fixture.service.createDraft({
    organizationId: fixture.organizationId,
    kind: 'receipt',
    warehouseId: overrides.warehouseId ?? fixture.warehouseId,
    ...(overrides.cost === undefined ? {} : { cost: overrides.cost }),
    lines: [
      {
        itemId: fixture.itemId,
        quantity: overrides.quantity ?? '100',
        unitId: fixture.unitId,
      },
    ],
  });
}

async function stockUp(fixture: Fixture, quantity: string): Promise<void> {
  const receipt = await createReceipt(fixture, { quantity });
  await fixture.service.finalizeDocument(
    receipt.id,
    fixture.organizationId,
    {},
  );
}

// ---------------------------------------------------------------------------

describe('C-58 runtime — create and read', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('creates a receipt draft with resolved base quantities and no ledger effect', async () => {
    const created = await asActor(() => createReceipt(fixture));
    expect(created.status).toBe('draft');
    expect(created.number).toBeNull();
    expect(created.lines).toHaveLength(1);
    expect(created.lines[0]!.baseQuantity).toBe('100');
    expect(created.lines[0]!.movementId).toBeNull();
    expect(fixture.world.movements.size).toBe(0);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
  });

  it('refuses a transfer whose source and destination are the same warehouse', async () => {
    await expect(
      asActor(() =>
        fixture.service.createDraft({
          organizationId: fixture.organizationId,
          kind: 'transfer',
          sourceWarehouseId: fixture.warehouseId,
          destinationWarehouseId: fixture.warehouseId,
          lines: [
            { itemId: fixture.itemId, quantity: '5', unitId: fixture.unitId },
          ],
        }),
      ),
    ).rejects.toThrow(/two different warehouses/);
  });

  it('refuses a manual cost on an issue', async () => {
    await expect(
      asActor(() =>
        fixture.service.createDraft({
          organizationId: fixture.organizationId,
          kind: 'issue',
          warehouseId: fixture.warehouseId,
          cost: '42',
          lines: [
            { itemId: fixture.itemId, quantity: '5', unitId: fixture.unitId },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: [{ field: 'cost', code: 'costNotAcceptedForDocumentKind' }],
    });
  });

  it('keeps a receipt cost optional', async () => {
    const withoutCost = await asActor(() => createReceipt(fixture));
    expect(withoutCost.cost).toBeNull();
    const withCost = await asActor(() =>
      createReceipt(fixture, { cost: '250.00' }),
    );
    expect(withCost.cost).toBe('250.00');
  });

  it("answers 404 for another organization's document (no disclosure)", async () => {
    const created = await asActor(() => createReceipt(fixture));
    await expect(
      asActor(() =>
        fixture.service.getDocument(created.id, fixture.otherOrganizationId),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("never leaks another organization's document through the list", async () => {
    await asActor(() => createReceipt(fixture));
    const listed = await asActor(() =>
      fixture.service.listDocuments({
        organizationId: fixture.otherOrganizationId,
        page: 1,
        pageSize: 20,
      }),
    );
    expect(listed.total).toBe(0);
  });
});

describe('C-58 runtime — authorization', () => {
  it('refuses creation without Inventory.Document.Create', async () => {
    const fixture = await buildFixture();
    fixture.restrictPermissions([]);
    await expect(asActor(() => createReceipt(fixture))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses finalize without the ledger authority, even with the document permission', async () => {
    const fixture = await buildFixture();
    const created = await asActor(() => createReceipt(fixture));
    fixture.restrictPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.CREATE,
      INVENTORY_DOCUMENT_PERMISSIONS.VIEW,
      INVENTORY_DOCUMENT_PERMISSIONS.FINALIZE,
    ]);
    await expect(
      asActor(() =>
        fixture.service.finalizeDocument(
          created.id,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.world.movements.size).toBe(0);
  });

  it('hides the receipt cost from a caller who may not see inventory value', async () => {
    const fixture = await buildFixture({ canViewCost: false });
    const created = await asActor(() =>
      createReceipt(fixture, { cost: '99.00' }),
    );
    expect('cost' in created).toBe(false);
  });
});

describe('C-58 runtime — finalize (Receipt)', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('posts the movement, moves the balance, allocates a number and becomes operational', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    expect(finalized.status).toBe('operational');
    expect(finalized.number).toBe('DOC-0001');
    expect(finalized.lines[0]!.movementId).not.toBeNull();
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '100',
    );
    const movement = fixture.world.movements.get(
      finalized.lines[0]!.movementId!,
    )!;
    expect(movement.movementType).toBe('inbound');
    expect(movement.referenceType).toBe('inventory_business_document');
    expect(movement.referenceId).toBe(created.id);
  });

  it('carries the optional receipt cost onto the movement as an assigned value', async () => {
    const created = await asActor(() =>
      createReceipt(fixture, { cost: '500.00' }),
    );
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const movement = fixture.world.movements.get(
      finalized.lines[0]!.movementId!,
    )!;
    expect(movement.totalCost).toBe('500');
  });

  it('replays a finalize instead of posting twice (idempotency)', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const first = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const replay = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    expect(replay.number).toBe(first.number);
    expect(fixture.world.movements.size).toBe(1);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '100',
    );
  });

  it('rolls the WHOLE operation back when the ledger write fails', async () => {
    const created = await asActor(() => createReceipt(fixture));
    fixture.world.failNextPosting = 'posting';
    await expect(
      asActor(() =>
        fixture.service.finalizeDocument(
          created.id,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toThrow(/forced failure/);

    const after = await asActor(() =>
      fixture.service.getDocument(created.id, fixture.organizationId),
    );
    expect(after.status).toBe('draft');
    expect(after.number).toBeNull();
    expect(after.lines[0]!.movementId).toBeNull();
    expect(fixture.world.movements.size).toBe(0);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
    expect(fixture.world.operations.size).toBe(0);
  });

  it('publishes a finalized event with the created movement ids', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const event = fixture.published.find(
      (entry) => entry.type === 'InventoryDocument.Finalized',
    );
    expect(event).toBeDefined();
    expect(
      (event!.payload as { movementIds: string[] }).movementIds,
    ).toHaveLength(1);
  });
});

describe('C-58 runtime — finalize (Issue)', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('decreases stock and derives the cost from valuation (never from input)', async () => {
    await asActor(() => stockUp(fixture, '50'));
    const issue = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'issue',
        warehouseId: fixture.warehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '20', unitId: fixture.unitId },
        ],
      }),
    );
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(issue.id, fixture.organizationId, {}),
    );
    expect(finalized.status).toBe('operational');
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '30',
    );
    const movement = fixture.world.movements.get(
      finalized.lines[0]!.movementId!,
    )!;
    expect(movement.movementType).toBe('outbound');
    // No manually entered value ever reaches the ledger from an issue.
    expect(movement.totalCost).toBeNull();
  });

  it('blocks an issue that would drive stock negative and changes nothing', async () => {
    await asActor(() => stockUp(fixture, '10'));
    const issue = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'issue',
        warehouseId: fixture.warehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '25', unitId: fixture.unitId },
        ],
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.finalizeDocument(issue.id, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({ status: 422 });

    const after = await asActor(() =>
      fixture.service.getDocument(issue.id, fixture.organizationId),
    );
    expect(after.status).toBe('draft');
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '10',
    );
  });
});

describe('C-58 runtime — finalize (Transfer)', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('decreases the source and increases the destination atomically', async () => {
    await asActor(() => stockUp(fixture, '40'));
    const transfer = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'transfer',
        sourceWarehouseId: fixture.warehouseId,
        destinationWarehouseId: fixture.otherWarehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '15', unitId: fixture.unitId },
        ],
      }),
    );
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(transfer.id, fixture.organizationId, {}),
    );
    expect(finalized.lines[0]!.outMovementId).not.toBeNull();
    expect(finalized.lines[0]!.inMovementId).not.toBeNull();
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '25',
    );
    expect(fixture.world.onHand(fixture.otherWarehouseId, fixture.itemId)).toBe(
      '15',
    );
    const out = fixture.world.movements.get(
      finalized.lines[0]!.outMovementId!,
    )!;
    const into = fixture.world.movements.get(
      finalized.lines[0]!.inMovementId!,
    )!;
    expect(out.transferId).toBe(into.transferId);
  });

  it('never leaves one leg without the other when the transfer fails', async () => {
    await asActor(() => stockUp(fixture, '5'));
    const transfer = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'transfer',
        sourceWarehouseId: fixture.warehouseId,
        destinationWarehouseId: fixture.otherWarehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '50', unitId: fixture.unitId },
        ],
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.finalizeDocument(
          transfer.id,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });
    // Only the stock-up movement survives: no half transfer.
    expect(fixture.world.movements.size).toBe(1);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('5');
    expect(fixture.world.onHand(fixture.otherWarehouseId, fixture.itemId)).toBe(
      '0',
    );
  });

  it('refuses a backdated transfer fail-closed (OQ-67)', async () => {
    const backdating = await buildFixture({ backdated: true });
    const transfer = await asActor(() =>
      backdating.service.createDraft({
        organizationId: backdating.organizationId,
        kind: 'transfer',
        sourceWarehouseId: backdating.warehouseId,
        destinationWarehouseId: backdating.otherWarehouseId,
        lines: [
          {
            itemId: backdating.itemId,
            quantity: '1',
            unitId: backdating.unitId,
          },
        ],
      }),
    );
    await expect(
      asActor(() =>
        backdating.service.finalizeDocument(
          transfer.id,
          backdating.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(backdating.world.movements.size).toBe(0);
  });
});

describe('C-58 runtime — edit pipeline (OQ-54 / ADR-0040)', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('edits a draft freely, with no ledger effect at all', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const edited = await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        description: 'corrected',
        lines: [
          { itemId: fixture.itemId, quantity: '7', unitId: fixture.unitId },
        ],
      }),
    );
    expect(edited.description).toBe('corrected');
    expect(edited.lines[0]!.quantity).toBe('7');
    expect(fixture.world.movements.size).toBe(0);
  });

  it('treats an edit with no effective movement change as safe', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const movementId = (
      await asActor(() =>
        fixture.service.getDocument(created.id, fixture.organizationId),
      )
    ).lines[0]!.movementId;

    const edited = await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        description: 'just a note',
      }),
    );
    expect(edited.description).toBe('just a note');
    // No acknowledgement was needed and nothing was reversed/re-posted.
    expect(fixture.world.movements.size).toBe(1);
    expect(edited.lines[0]!.movementId).toBe(movementId);
  });

  it('refuses a material edit without an explicit acknowledgement', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await expect(
      asActor(() =>
        fixture.service.updateDocument(created.id, fixture.organizationId, {
          lines: [
            { itemId: fixture.itemId, quantity: '90', unitId: fixture.unitId },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        code: 'inventory.document.side_effect_acknowledgement_required',
      },
    });
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '100',
    );
  });

  it('refuses an acknowledged material edit that gives no repricing choice', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await expect(
      asActor(() =>
        fixture.service.updateDocument(created.id, fixture.organizationId, {
          acknowledgeSideEffects: true,
          lines: [
            { itemId: fixture.itemId, quantity: '90', unitId: fixture.unitId },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.document.repricing_choice_required' },
    });
  });

  it('reconciles a quantity change: reverses the old fact, posts the new one', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const originalMovementId = finalized.lines[0]!.movementId!;

    const edited = await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        acknowledgeSideEffects: true,
        repricing: 'skip',
        lines: [
          { itemId: fixture.itemId, quantity: '90', unitId: fixture.unitId },
        ],
      }),
    );
    expect(edited.lines[0]!.quantity).toBe('90');
    expect(edited.lines[0]!.movementId).not.toBe(originalMovementId);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '90',
    );
    // 1 original + 1 reversal + 1 re-post, and the original is untouched.
    expect(fixture.world.movements.size).toBe(3);
    expect(fixture.world.movements.get(originalMovementId)!.baseQuantity).toBe(
      '100',
    );
    // OD-54-06: "continue without repricing" is recorded honestly.
    expect(edited.valuationStale).toBe(true);
    expect(
      fixture.published.some(
        (event) => event.type === 'InventoryDocument.ValuationStale',
      ),
    ).toBe(true);
  });

  it('reconciles a warehouse change by moving the whole effect', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        acknowledgeSideEffects: true,
        repricing: 'skip',
        warehouseId: fixture.otherWarehouseId,
      }),
    );
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
    expect(fixture.world.onHand(fixture.otherWarehouseId, fixture.itemId)).toBe(
      '100',
    );
  });

  it('reconciles an item change', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        acknowledgeSideEffects: true,
        repricing: 'skip',
        lines: [
          {
            itemId: fixture.otherItemId,
            quantity: '100',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
    expect(fixture.world.onHand(fixture.warehouseId, fixture.otherItemId)).toBe(
      '100',
    );
  });

  it('runs the explicit repricing path when the operator asks for it', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const edited = await asActor(() =>
      fixture.service.updateDocument(created.id, fixture.organizationId, {
        acknowledgeSideEffects: true,
        repricing: 'recalculate',
        lines: [
          { itemId: fixture.itemId, quantity: '80', unitId: fixture.unitId },
        ],
      }),
    );
    expect(fixture.recalculations).toContain(
      `${fixture.warehouseId}:${fixture.itemId}`,
    );
    expect(edited.valuationStale).toBe(false);
  });

  it('ROLLS THE WHOLE EDIT BACK when the in-transaction repricing refuses', async () => {
    // The repricing the operator explicitly asked for runs inside the
    // command's own transaction, so a refused valuation replay may not
    // leave a re-posted quantity behind.
    const failing = await buildFixture({ repricingFails: true });
    const created = await asActor(() => createReceipt(failing));
    await asActor(() =>
      failing.service.finalizeDocument(created.id, failing.organizationId, {}),
    );
    await expect(
      asActor(() =>
        failing.service.updateDocument(created.id, failing.organizationId, {
          acknowledgeSideEffects: true,
          repricing: 'recalculate',
          lines: [
            { itemId: failing.itemId, quantity: '80', unitId: failing.unitId },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      details: { code: 'inventory.recalculation_too_large' },
    });
    expect(failing.recalculations).toEqual([]);
    // The quantity fact the failed command tried to write is gone.
    expect(failing.world.onHand(failing.warehouseId, failing.itemId)).toBe(
      '100',
    );
    const unchanged = await asActor(() =>
      failing.service.getDocument(created.id, failing.organizationId),
    );
    expect(unchanged.lines[0]?.quantity).toBe('100');
    expect(unchanged.valuationStale).toBe(false);
  });

  it('BLOCKS an edit that would make stock negative and leaves everything untouched', async () => {
    // 100 received, 95 issued → the receipt cannot be reduced to 90.
    const receipt = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(receipt.id, fixture.organizationId, {}),
    );
    const issue = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'issue',
        warehouseId: fixture.warehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '95', unitId: fixture.unitId },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.finalizeDocument(issue.id, fixture.organizationId, {}),
    );
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('5');

    const before = fixture.world.snapshot();
    await expect(
      asActor(() =>
        fixture.service.updateDocument(receipt.id, fixture.organizationId, {
          acknowledgeSideEffects: true,
          repricing: 'skip',
          lines: [
            { itemId: fixture.itemId, quantity: '90', unitId: fixture.unitId },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.insufficient_stock' },
    });

    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('5');
    expect(fixture.world.movements.size).toBe(before.movements.size);
    const reloaded = await asActor(() =>
      fixture.service.getDocument(receipt.id, fixture.organizationId),
    );
    expect(reloaded.lines[0]!.quantity).toBe('100');
    expect(reloaded.status).toBe('operational');
  });

  it('refuses to edit an accounting-posted document', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.accountingPostDocument(
        created.id,
        fixture.organizationId,
      ),
    );
    await expect(
      asActor(() =>
        fixture.service.updateDocument(created.id, fixture.organizationId, {
          description: 'nope',
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.document.accounting_posted_is_immutable' },
    });
  });
});

describe('C-58 runtime — lifecycle commands', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('walks draft → operational → accounting posted → immutable', async () => {
    const created = await asActor(() => createReceipt(fixture));
    expect(created.status).toBe('draft');
    const operational = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    expect(operational.status).toBe('operational');
    const posted = await asActor(() =>
      fixture.service.accountingPostDocument(
        created.id,
        fixture.organizationId,
      ),
    );
    expect(posted.status).toBe('accounting_posted');
    expect(posted.canEdit).toBe(false);
    const sealed = await asActor(() =>
      fixture.service.sealDocument(created.id, fixture.organizationId),
    );
    expect(sealed.status).toBe('immutable');
  });

  it('refuses draft → accounting posted', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await expect(
      asActor(() =>
        fixture.service.accountingPostDocument(
          created.id,
          fixture.organizationId,
        ),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.document.illegal_transition' },
    });
  });

  it('refuses every command on an immutable document', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.accountingPostDocument(
        created.id,
        fixture.organizationId,
      ),
    );
    await asActor(() =>
      fixture.service.sealDocument(created.id, fixture.organizationId),
    );
    const calls: Array<() => Promise<unknown>> = [
      () =>
        fixture.service.updateDocument(created.id, fixture.organizationId, {
          description: 'x',
        }),
      () =>
        fixture.service.cancelDocument(created.id, fixture.organizationId, {}),
      () => fixture.service.sealDocument(created.id, fixture.organizationId),
      () => fixture.service.deleteDraft(created.id, fixture.organizationId),
    ];
    for (const call of calls) {
      await expect(asActor(call)).rejects.toMatchObject({ status: 422 });
    }
  });

  it('deletes a draft but never a document with history', async () => {
    const draft = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.deleteDraft(draft.id, fixture.organizationId),
    );
    await expect(
      asActor(() =>
        fixture.service.getDocument(draft.id, fixture.organizationId),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const posted = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(posted.id, fixture.organizationId, {}),
    );
    await expect(
      asActor(() =>
        fixture.service.deleteDraft(posted.id, fixture.organizationId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.document.delete_forbidden' },
    });
  });
});

describe('C-58 runtime — cancellation / correction (OQ-54)', () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('cancels a draft with no ledger effect', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const cancelled = await asActor(() =>
      fixture.service.cancelDocument(created.id, fixture.organizationId, {
        reason: 'typed by mistake',
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellationReason).toBe('typed by mistake');
    expect(fixture.world.movements.size).toBe(0);
  });

  it('reverses the ledger effect of an operational document and keeps it visible', async () => {
    const created = await asActor(() => createReceipt(fixture));
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    const number = finalized.number;
    const cancelled = await asActor(() =>
      fixture.service.cancelDocument(created.id, fixture.organizationId, {}),
    );
    expect(cancelled.status).toBe('cancelled');
    // The number is KEPT and never reused (OD-54-09).
    expect(cancelled.number).toBe(number);
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
    expect(fixture.world.movements.size).toBe(2);
    // Still visible/auditable (OD-54-08).
    const reloaded = await asActor(() =>
      fixture.service.getDocument(created.id, fixture.organizationId),
    );
    expect(reloaded.status).toBe('cancelled');
  });

  it('refuses to finalize a CANCELLED document instead of replaying it', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.cancelDocument(created.id, fixture.organizationId, {}),
    );
    await expect(
      asActor(() =>
        fixture.service.finalizeDocument(
          created.id,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({
      details: { code: 'inventory.document.illegal_transition' },
    });
  });

  it('allocates a NEW number to the next document after a cancellation', async () => {
    const first = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(first.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.cancelDocument(first.id, fixture.organizationId, {}),
    );
    const second = await asActor(() => createReceipt(fixture));
    const finalized = await asActor(() =>
      fixture.service.finalizeDocument(second.id, fixture.organizationId, {}),
    );
    expect(finalized.number).toBe('DOC-0002');
  });

  it('refuses to cancel an accounting-posted document and names the correction boundary', async () => {
    const created = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(created.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.accountingPostDocument(
        created.id,
        fixture.organizationId,
      ),
    );
    await expect(
      asActor(() =>
        fixture.service.cancelDocument(created.id, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        code: 'inventory.document.accounting_posted_requires_correction',
      },
    });
  });

  it('blocks a cancellation whose reversal would make stock negative, unchanged', async () => {
    const receipt = await asActor(() => createReceipt(fixture));
    await asActor(() =>
      fixture.service.finalizeDocument(receipt.id, fixture.organizationId, {}),
    );
    const issue = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'issue',
        warehouseId: fixture.warehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '100', unitId: fixture.unitId },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.finalizeDocument(issue.id, fixture.organizationId, {}),
    );
    await expect(
      asActor(() =>
        fixture.service.cancelDocument(receipt.id, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: 'inventory.insufficient_stock' },
    });
    const reloaded = await asActor(() =>
      fixture.service.getDocument(receipt.id, fixture.organizationId),
    );
    expect(reloaded.status).toBe('operational');
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe('0');
  });

  it('reverses BOTH transfer legs on cancellation', async () => {
    await asActor(() => stockUp(fixture, '30'));
    const transfer = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        kind: 'transfer',
        sourceWarehouseId: fixture.warehouseId,
        destinationWarehouseId: fixture.otherWarehouseId,
        lines: [
          { itemId: fixture.itemId, quantity: '10', unitId: fixture.unitId },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.finalizeDocument(transfer.id, fixture.organizationId, {}),
    );
    await asActor(() =>
      fixture.service.cancelDocument(transfer.id, fixture.organizationId, {}),
    );
    expect(fixture.world.onHand(fixture.warehouseId, fixture.itemId)).toBe(
      '30',
    );
    expect(fixture.world.onHand(fixture.otherWarehouseId, fixture.itemId)).toBe(
      '0',
    );
  });
});
