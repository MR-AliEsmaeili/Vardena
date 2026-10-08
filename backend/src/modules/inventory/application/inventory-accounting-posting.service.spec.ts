import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import type { AuthorizationService } from '../../rbac/application/authorization.service.js';
import type { OrganizationsService } from '../../organization/application/organizations.service.js';
import type { InventoryPostingService } from '../../accounting/application/inventory-posting.service.js';
import type {
  InventoryPostingRequest,
  InventoryPostingResult,
} from '../../accounting/application/inventory-posting-contract.js';
import type { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type {
  InventoryAccountingPostingOperation,
  InventoryAccountingPostingRepository,
  InventoryAccountingPostingSnapshot,
  CreateAccountingPostingOperationInput,
  RecordAccountingPostingSnapshotInput,
} from '../data/inventory-accounting-posting.repository.js';
import type { WarehousesRepository } from '../data/warehouses.repository.js';
import type { InventoryValuationService } from './inventory-valuation.service.js';
import type { InventoryBusinessDocument } from '../domain/inventory-business-document.js';
import type { InventoryMovement } from '../domain/inventory-movement.js';
import type { Warehouse } from '../domain/warehouse.js';
import { InventoryAccountingPostingService } from './inventory-accounting-posting.service.js';

/**
 * Hermetic tests for the C-62 posting service's OD-06 idempotency and OD-01
 * durable recovery (PDR-10 C62-OD-01/OD-05/OD-06).
 *
 * The REAL `InventoryAccountingPostingService` runs against in-memory fakes:
 * the document/movement/posting repositories are Maps, and the Accounting
 * boundary is a double that models Accounting's OWN idempotency ledger
 * (`accounting.accounting_posting_operations`: keyed by (organization,
 * operationKey), insert-only, replay-or-reject on the create hash) exactly
 * as `AccountingDocumentsService.replayOrReject` behaves. That is the contract
 * Inventory must reconcile through — never a second ledger of its own.
 *
 * What is proven here (the live suite proves it against PostgreSQL):
 *
 *   idempotency — same key + same hash replays; same key + a different hash
 *     is a 409; a concurrent same-key race produces ONE effect (winner and
 *     loser converge on the same voucher); a concurrent same-key race with
 *     DIFFERENT requests produces one winner and a 409 loser; a lost insert
 *     race (the unique violation) is caught, the winner reloaded and answered
 *     — never a 500;
 *   recovery — a PENDING operation resumes from its IMMUTABLE snapshot:
 *     Accounting already holds the FINAL voucher → POSTED, no second
 *     voucher; Accounting already holds the DRAFT → DRAFT_CREATED, no second
 *     draft; Accounting was never reached → the resume completes it; the
 *     document was projected but the operation update was interrupted → the
 *     two converge; a FAILED operation re-enters PENDING and completes; a
 *     snapshot that does not reconstruct to the stored hash is never reused;
 *   cancellation — a confirmed cancellation answers `draft_cancelled` (a
 *     success, never `refused`), and both crash windows converge: the draft
 *     already gone but the document still `draft_created`, and the document
 *     already `draft_cancelled` but the operation still `DRAFT_CREATED`.
 */

const ORG = 'org-1';
const BRANCH = 'branch-1';
const USER = 'user-1';

// ---- the fake world ---------------------------------------------------------

interface FakeAccountingDocument {
  id: string;
  number: string | null;
  state: 'draft' | 'final';
}

interface FakeWorld {
  documents: Map<string, InventoryBusinessDocument>;
  movements: Map<string, InventoryMovement>;
  warehouses: Map<string, Warehouse>;
  operations: InventoryAccountingPostingOperation[];
  snapshots: Map<string, InventoryAccountingPostingSnapshot>;
  /** Accounting's OWN idempotency ledger: (org, operationKey) → create hash + document. */
  accountingLedger: Map<string, { hash: string; documentId: string }>;
  accountingDocuments: FakeAccountingDocument[];
  accountingCalls: InventoryPostingRequest[];
  cancelCalls: Array<{ organizationId: string; operationKey: string }>;
  /** `ok` posts, `crash` throws before answering, `refuse`/`fail` answer. */
  accountingMode: 'ok' | 'crash' | 'refuse' | 'fail';
  /** Test-controlled read blindness: findByKey/findInFlight see nothing. */
  blindFindByKey: boolean;
  /** Per-call movement-value overrides, shifted on every fact collection. */
  movementValueOverrides: string[];
  /** Serializes the fake's `withTransaction` like the document row lock. */
  docMutex: Promise<void>;
  serial: number;
}

function createWorld(): FakeWorld {
  return {
    documents: new Map(),
    movements: new Map(),
    warehouses: new Map(),
    operations: [],
    snapshots: new Map(),
    accountingLedger: new Map(),
    accountingDocuments: [],
    accountingCalls: [],
    cancelCalls: [],
    accountingMode: 'ok',
    blindFindByKey: false,
    movementValueOverrides: [],
    docMutex: Promise.resolve(),
    serial: 0,
  };
}

function uniqueViolation(): Error {
  const error = new Error(
    'Unique constraint failed on the fields: (`organization_id`,`document_id`,`action`,`operation_key`)',
  ) as Error & { code: string; meta: { target: string } };
  error.code = 'P2002';
  error.meta = { target: 'uq_inventory_accounting_posting_operations_key' };
  return error;
}

/** Model the snapshot columns' padding (numeric(18,6) unit costs). */
function pad(value: string, scale: number): string {
  if (!value.includes('.')) return `${value}.${'0'.repeat(scale)}`;
  const [whole, fraction] = value.split('.');
  return `${whole}.${(fraction ?? '').padEnd(scale, '0')}`;
}

// ---- fakes -------------------------------------------------------------------

function fakeDocumentsRepository(world: FakeWorld) {
  const findById = async (organizationId: string, id: string) => {
    const document = world.documents.get(id);
    return document !== undefined && document.organizationId === organizationId
      ? document
      : null;
  };
  return {
    async withTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const previous = world.docMutex;
      let release!: () => void;
      world.docMutex = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work({});
      } finally {
        release();
      }
    },
    findById,
    async lockDocumentRow(_tx: unknown, organizationId: string, id: string) {
      return findById(organizationId, id);
    },
    async updateHeader(_tx: unknown, id: string, patch: object) {
      const document = world.documents.get(id);
      if (document === undefined) throw new Error(`no document ${id}`);
      Object.assign(document, patch);
    },
    async lockValuationStateRows() {},
  } as unknown as InventoryBusinessDocumentsRepository;
}

function fakeMovementsRepository(world: FakeWorld) {
  return {
    async findIds(ids: string[]): Promise<InventoryMovement[]> {
      const override = world.movementValueOverrides.shift();
      return ids.flatMap((id) => {
        const movement = world.movements.get(id);
        if (movement === undefined) return [];
        return [
          override === undefined
            ? movement
            : { ...movement, totalCost: override },
        ];
      });
    },
  } as unknown as InventoryMovementsRepository;
}

function fakePostingRepository(world: FakeWorld) {
  const findOperation = (input: {
    organizationId: string;
    documentId: string;
    action: string;
    operationKey: string;
  }) =>
    world.operations.find(
      (row) =>
        row.organizationId === input.organizationId &&
        row.documentId === input.documentId &&
        row.action === input.action &&
        row.operationKey === input.operationKey,
    ) ?? null;
  return {
    async findByKey(
      input: {
        organizationId: string;
        documentId: string;
        action: string;
        operationKey: string;
      },
      _tx?: unknown,
    ) {
      if (world.blindFindByKey) return null;
      return findOperation(input);
    },
    async findInFlightForDocument(input: {
      organizationId: string;
      documentId: string;
      action: string;
    }) {
      if (world.blindFindByKey) return null;
      const TERMINAL = ['POSTED', 'REFUSED', 'CANCELLED'];
      return (
        world.operations.find(
          (row) =>
            row.organizationId === input.organizationId &&
            row.documentId === input.documentId &&
            row.action === input.action &&
            !TERMINAL.includes(row.state),
        ) ?? null
      );
    },
    async findById(organizationId: string, id: string) {
      const row = world.operations.find((entry) => entry.id === id);
      return row !== undefined && row.organizationId === organizationId
        ? row
        : null;
    },
    async lockOperationRow(_tx: unknown, organizationId: string, id: string) {
      // The fake's `withTransaction` mutex already serializes the critical
      // sections; the row lock only has to resolve the row.
      const row = world.operations.find((entry) => entry.id === id);
      return row !== undefined && row.organizationId === organizationId
        ? { id: row.id, organizationId: row.organizationId }
        : null;
    },
    async listForDocument(input: {
      organizationId: string;
      documentId: string;
    }) {
      return world.operations.filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.documentId === input.documentId,
      );
    },
    async findSnapshot(organizationId: string, operationId: string) {
      const snapshot = world.snapshots.get(operationId);
      return snapshot !== undefined &&
        snapshot.organizationId === organizationId
        ? snapshot
        : null;
    },
    async createOperationWithSnapshot(
      _tx: unknown,
      operation: CreateAccountingPostingOperationInput,
      snapshot: RecordAccountingPostingSnapshotInput,
    ) {
      // The insert attempt ends any test-controlled read blindness: from here
      // on, reads see committed rows again.
      world.blindFindByKey = false;
      if (findOperation(operation) !== null) {
        throw uniqueViolation();
      }
      const row: InventoryAccountingPostingOperation = {
        id: `op-${++world.serial}`,
        organizationId: operation.organizationId,
        documentId: operation.documentId,
        action: operation.action,
        operationKey: operation.operationKey,
        requestHash: operation.requestHash,
        documentVersion: operation.documentVersion,
        postingMode: operation.postingMode,
        state: operation.state,
        refusalCode: null,
        refusalReason: null,
        accountingDocumentId: null,
        accountingDocumentNumber: null,
        accountingDocumentPhase: null,
        accountingOperationKey: null,
        glPosted: false,
        replayed: false,
        actorUserId: operation.actorUserId,
        actorPermission: operation.actorPermission,
        requestedAt: operation.now,
        completedAt: null,
        createdAt: operation.now,
        updatedAt: operation.now,
      };
      world.operations.push(row);
      world.snapshots.set(row.id, {
        id: `snap-${row.id}`,
        organizationId: snapshot.organizationId,
        operationId: row.id,
        documentId: snapshot.documentId,
        documentType: snapshot.documentType,
        documentNumber: snapshot.documentNumber,
        documentVersion: snapshot.documentVersion,
        documentDate: snapshot.documentDate,
        branchId: snapshot.branchId,
        warehouseId: snapshot.warehouseId,
        valuationState: snapshot.valuationState,
        valuationStale: snapshot.valuationStale,
        staleVerdict: snapshot.staleVerdict,
        valuationRunId: snapshot.valuationRunId,
        valuationBasis: snapshot.valuationBasis,
        // numeric(18,2): the column pads the canonical sum on the way in.
        totalValue: pad(snapshot.totalValue, 2),
        actorUserId: snapshot.actorUserId,
        capturedAt: snapshot.capturedAt,
        movements: snapshot.movements.map((movement, index) => ({
          id: `snapmv-${row.id}-${index}`,
          movementId: movement.movementId,
          lineId: movement.lineId,
          itemId: movement.itemId,
          // numeric(18,4): stored with the column's scale.
          quantity: pad(movement.quantity, 4),
          unitId: movement.unitId,
          baseQuantity: pad(movement.baseQuantity, 4),
          baseUnitId: movement.baseUnitId,
          // numeric(18,2): the authoritative value, verbatim.
          totalValue: pad(movement.value, 2),
          // numeric(18,6): the derived figure, padded by the column. The
          // reconstruction must RE-DERIVE it, never read this back (the
          // original hash never saw the padded spelling).
          unitCost: pad(movement.unitCost, 6),
          valuationStatus: movement.valuationStatus,
          valuationSource: movement.valuationSource,
          valuationRunId: movement.valuationRunId,
        })),
      });
      return row;
    },
    async updateOperation(
      organizationId: string,
      id: string,
      patch: Partial<InventoryAccountingPostingOperation> & { updatedAt: Date },
    ) {
      const row = world.operations.find((entry) => entry.id === id);
      if (row === undefined || row.organizationId !== organizationId) {
        throw new Error(`no operation ${id}`);
      }
      Object.assign(row, patch);
      return row;
    },
    async markReplayed(
      organizationId: string,
      id: string,
      actorUserId: string | null,
      now: Date,
    ) {
      const row = world.operations.find((entry) => entry.id === id);
      if (row === undefined || row.organizationId !== organizationId) {
        throw new Error(`no operation ${id}`);
      }
      row.replayed = true;
      row.updatedAt = now;
      void actorUserId;
    },
  } as unknown as InventoryAccountingPostingRepository;
}

function fakeWarehousesRepository(world: FakeWorld) {
  return {
    async findByIdInOrganization(organizationId: string, id: string) {
      const warehouse = world.warehouses.get(id);
      return warehouse !== undefined &&
        warehouse.organizationId === organizationId
        ? warehouse
        : null;
    },
  } as unknown as WarehousesRepository;
}

/** A deterministic hash over the create-relevant request facts. */
function accountingCreateHash(request: InventoryPostingRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        organizationId: request.organizationId,
        branchId: request.branchId,
        sourceDocumentId: request.sourceDocumentId,
        sourceDocumentType: request.sourceDocumentType,
        sourceDocumentNumber: request.sourceDocumentNumber,
        sourceDocumentDate: request.sourceDocumentDate,
        postingMode: request.postingMode,
        valuation: {
          state: request.valuation.state,
          basis: request.valuation.basis,
          totalValue: request.valuation.totalValue,
        },
        movements: request.movements
          .map((movement) => ({
            movementId: movement.movementId,
            lineId: movement.lineId,
            itemId: movement.itemId,
            quantity: movement.quantity,
            unitId: movement.unitId,
            baseQuantity: movement.baseQuantity,
            baseUnitId: movement.baseUnitId,
            value: movement.value,
            unitCost: movement.unitCost,
            valuationStatus: movement.valuationStatus,
            valuationSource: movement.valuationSource,
            valuationRunId: movement.valuationRunId,
          }))
          .sort((left, right) =>
            left.movementId.localeCompare(right.movementId),
          ),
      }),
    )
    .digest('hex');
}

/**
 * The Accounting boundary double. It owns an insert-only idempotency ledger
 * keyed by (organization, operationKey) and replays-or-rejects on the create
 * hash — the exact contract `AccountingDocumentsService.replayOrReject`
 * implements — so a resumed Inventory call can never produce a second effect.
 */
function fakeAccountingPosting(world: FakeWorld) {
  const resultFor = (
    document: FakeAccountingDocument,
    request: InventoryPostingRequest,
    replayed: boolean,
  ): InventoryPostingResult => ({
    operationKey: request.operationKey,
    requestHash: request.requestHash,
    postingMode: request.postingMode,
    outcome:
      document.state === 'final'
        ? 'final_posted'
        : document.state === 'draft'
          ? 'draft_created'
          : 'failed',
    accountingDocument: {
      id: document.id,
      number: document.number,
      phase: document.state,
      state: document.state,
      final: document.state === 'final',
    },
    glPosted: document.state === 'final',
    replayed,
    refusalCode: null,
    refusalReason: null,
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });

  return {
    async postFromInventory(request: InventoryPostingRequest) {
      world.accountingCalls.push(request);
      if (world.accountingMode === 'crash') {
        throw new Error('simulated crash before Accounting answered');
      }
      if (world.accountingMode === 'refuse') {
        return {
          ...resultFor(
            { id: '', number: null, state: 'draft' },
            request,
            false,
          ),
          outcome: 'refused' as const,
          accountingDocument: null,
          glPosted: false,
          refusalCode: 'accounting.mapping_missing' as const,
          refusalReason: 'No Accounting posting mapping is configured.',
        };
      }
      if (world.accountingMode === 'fail') {
        return {
          ...resultFor(
            { id: '', number: null, state: 'draft' },
            request,
            false,
          ),
          outcome: 'failed' as const,
          accountingDocument: null,
          glPosted: false,
          refusalCode: 'accounting.operation_failed' as const,
          refusalReason: 'Accounting could not complete the posting operation.',
        };
      }
      const key = `${request.organizationId}:${request.operationKey}`;
      const hash = accountingCreateHash(request);
      const existing = world.accountingLedger.get(key);
      if (existing !== undefined) {
        if (existing.hash !== hash) {
          throw AppException.conflict(
            'The operationKey was already used for a different intent.',
          );
        }
        const document = world.accountingDocuments.find(
          (entry) => entry.id === existing.documentId,
        );
        if (document === undefined) {
          throw new Error('Replay points at a missing accounting document.');
        }
        return resultFor(document, request, true);
      }
      const document: FakeAccountingDocument = {
        id: `acc-${++world.serial}`,
        number:
          request.postingMode === 'draft'
            ? null
            : `JV-${String(world.serial).padStart(4, '0')}`,
        state: request.postingMode === 'draft' ? 'draft' : 'final',
      };
      world.accountingLedger.set(key, { hash, documentId: document.id });
      world.accountingDocuments.push(document);
      return resultFor(document, request, false);
    },
    async cancelInventoryDraft(input: {
      organizationId: string;
      operationKey: string;
    }) {
      world.cancelCalls.push(input);
      const key = `${input.organizationId}:${input.operationKey}`;
      const entry = world.accountingLedger.get(key);
      if (entry === undefined) {
        // The operation never created a document the caller can see.
        return {
          operationKey: input.operationKey,
          cancelled: true,
          refusalCode: null,
          refusalReason: null,
        };
      }
      const document = world.accountingDocuments.find(
        (candidate) => candidate.id === entry.documentId,
      );
      if (document === undefined) {
        // The draft was already discarded (the ledger row is kept): a
        // same-key retry is a replay, not a second deletion.
        return {
          operationKey: input.operationKey,
          cancelled: true,
          refusalCode: null,
          refusalReason: null,
        };
      }
      if (document.state !== 'draft') {
        return {
          operationKey: input.operationKey,
          cancelled: false,
          refusalCode: 'accounting.draft_not_cancellable' as const,
          refusalReason: 'The Accounting document is no longer a draft.',
        };
      }
      world.accountingDocuments = world.accountingDocuments.filter(
        (candidate) => candidate.id !== document.id,
      );
      return {
        operationKey: input.operationKey,
        cancelled: true,
        refusalCode: null,
        refusalReason: null,
      };
    },
  } as unknown as InventoryPostingService;
}

// ---- fixture ----------------------------------------------------------------

interface SeedOptions {
  mode?: 'direct_final' | 'draft';
  cost?: string;
  quantity?: string;
}

function seedWarehouse(world: FakeWorld, mode: 'direct_final' | 'draft') {
  const id = `wh-${mode}-${++world.serial}`;
  world.warehouses.set(id, {
    id,
    organizationId: ORG,
    branchId: BRANCH,
    code: id.toUpperCase(),
    name: id,
    allowNegativeStock: false,
    reservationsReduceAvailable: true,
    accountingPostingMode: mode,
    isActive: true,
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
  });
  return id;
}

function seedReceipt(world: FakeWorld, options: SeedOptions = {}) {
  const mode = options.mode ?? 'direct_final';
  const cost = options.cost ?? '100.00';
  const quantity = options.quantity ?? '10.0000';
  const warehouseId = seedWarehouse(world, mode);
  const documentId = `doc-${++world.serial}`;
  const movementId = `mv-${world.serial}`;
  const at = new Date('2026-10-08T00:00:00.000Z');
  world.movements.set(movementId, {
    id: movementId,
    organizationId: ORG,
    branchId: BRANCH,
    warehouseId,
    itemId: 'item-1',
    movementType: 'inbound',
    // The ledger's own column scales, as decimalToString reads them back.
    quantity,
    enteredUnitId: 'unit-1',
    baseQuantity: quantity,
    baseUnitId: 'unit-1',
    conversionFactor: '1.0000',
    movementDate: at,
    transferId: null,
    reversalOfMovementId: null,
    referenceType: null,
    referenceId: null,
    reason: null,
    operationKey: 'seed',
    totalCost: cost,
    valuationStatus: 'valued',
    valuationSource: 'entered',
    valuedAt: at,
    valuationRunId: null,
    createdAt: at,
    updatedAt: at,
  });
  world.documents.set(documentId, {
    id: documentId,
    organizationId: ORG,
    kind: 'receipt',
    number: 'R-0001',
    businessDate: at,
    lines: [
      {
        id: 'line-1',
        lineNumber: 1,
        itemId: 'item-1',
        quantity,
        unitId: 'unit-1',
        baseQuantity: quantity,
        baseUnitId: 'unit-1',
        conversionFactor: '1',
        basisMovementId: null,
        movementId,
        outMovementId: null,
        inMovementId: null,
      },
    ],
    description: null,
    reference: null,
    status: 'operational',
    operationKey: 'seed-op',
    valuationStale: false,
    accountingPostingState: 'not_posted',
    accountingPostingOperationId: null,
    accountingDocumentId: null,
    accountingDocumentNumber: null,
    accountingDocumentPhase: null,
    finalizedAt: at,
    finalizedBy: USER,
    accountingPostedAt: null,
    accountingPostedBy: null,
    sealedAt: null,
    sealedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: at,
    updatedAt: at,
    createdBy: USER,
    updatedBy: USER,
    warehouseId,
    sourceWarehouseId: null,
    destinationWarehouseId: null,
    cost,
  } as InventoryBusinessDocument);
  return { documentId, movementId, warehouseId };
}

function buildService(world: FakeWorld) {
  return new InventoryAccountingPostingService(
    fakeDocumentsRepository(world),
    fakeMovementsRepository(world),
    fakePostingRepository(world),
    fakeWarehousesRepository(world),
    {
      resolveMethodForPosting: async () => ({
        method: 'moving_weighted_average',
      }),
    } as unknown as InventoryValuationService,
    {
      assertOrganizationInScope: async () => undefined,
    } as unknown as OrganizationsService,
    {
      requireAllPermissions: async () => undefined,
    } as unknown as AuthorizationService,
    fakeAccountingPosting(world),
    { log: () => undefined, warn: () => undefined } as unknown as JsonLogger,
    { publish: async () => undefined } as unknown as DomainEventBus,
  );
}

/** Run one service call as the authenticated operator. */
async function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      correlationId: 'c62-hermetic',
      principal: { userId: USER, sessionId: 'session-1' },
    },
    fn,
  );
}

/** Simulate a document edit: apply the patch and bump the revision. */
function editDocument(
  world: FakeWorld,
  documentId: string,
  patch: Partial<InventoryBusinessDocument>,
) {
  const document = world.documents.get(documentId);
  if (document === undefined) throw new Error(`no document ${documentId}`);
  Object.assign(document, patch, {
    updatedAt: new Date(document.updatedAt.getTime() + 60_000),
  });
}

/** Simulate "Phase 3 crashed": the operation is PENDING with no result. */
function resetOperationToPending(world: FakeWorld, documentId: string) {
  const operation = world.operations.find(
    (row) => row.documentId === documentId,
  );
  if (operation === undefined) throw new Error('no operation to reset');
  Object.assign(operation, {
    state: 'PENDING',
    completedAt: null,
    accountingDocumentId: null,
    accountingDocumentNumber: null,
    accountingDocumentPhase: null,
    accountingOperationKey: null,
    glPosted: false,
    replayed: false,
    updatedAt: new Date(),
  });
  return operation;
}

/** Simulate "Phase 3 never ran": undo the projection onto the document. */
function revertDocumentProjection(world: FakeWorld, documentId: string) {
  const document = world.documents.get(documentId);
  if (document === undefined) throw new Error(`no document ${documentId}`);
  Object.assign(document, {
    status: 'operational',
    accountingPostingState: 'not_posted',
    accountingPostingOperationId: null,
    accountingDocumentId: null,
    accountingDocumentNumber: null,
    accountingDocumentPhase: null,
    accountingPostedAt: null,
    accountingPostedBy: null,
  });
}

const operationOf = (world: FakeWorld, documentId: string) => {
  const operation = world.operations.find(
    (row) => row.documentId === documentId,
  );
  if (operation === undefined) throw new Error('no operation');
  return operation;
};

const documentOf = (world: FakeWorld, documentId: string) => {
  const document = world.documents.get(documentId);
  if (document === undefined) throw new Error('no document');
  return document;
};

async function expectConflict(call: Promise<unknown>): Promise<void> {
  await expect(call).rejects.toMatchObject({ code: 'Conflict' });
}

async function expectBusinessRule(
  call: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(call).rejects.toMatchObject({
    code: 'BusinessRuleViolation',
    details: expect.objectContaining({ code }),
  });
}

// ---- idempotency ------------------------------------------------------------

describe('C-62 OD-06 idempotency (hermetic)', () => {
  it('replays the same key + same request instead of a second effect', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    const first = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    const second = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(first.outcome).toBe('final_posted');
    expect(second.outcome).toBe('final_posted');
    expect(second.replayed).toBe(true);
    expect(second.accountingDocumentId).toBe(first.accountingDocumentId);
    // One durable operation, one Accounting effect, one boundary call.
    expect(world.operations).toHaveLength(1);
    expect(world.operations[0]!.state).toBe('POSTED');
    expect(world.operations[0]!.replayed).toBe(true);
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingCalls).toHaveLength(1);
  });

  it('conflicts (409) when the same key is reused for a different request', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    // The document moves between the two attempts of the same key.
    editDocument(world, documentId, { description: 'edited after posting' });

    await expectConflict(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    );
    // Nothing new was written: one operation, one effect.
    expect(world.operations).toHaveLength(1);
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingCalls).toHaveLength(1);
  });

  it('conflicts (409) when the same key is reused after a refusal once the document moved', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    world.accountingMode = 'refuse';
    const refused = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    expect(refused.outcome).toBe('refused');

    // Unchanged document: the same key replays the recorded refusal.
    const replayed = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    expect(replayed.outcome).toBe('refused');
    expect(replayed.replayed).toBe(true);
    expect(replayed.refusalCode).toBe('accounting.mapping_missing');

    // Moved document: the same key is a different request → 409.
    editDocument(world, documentId, { description: 'edited after refusal' });
    await expectConflict(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    );
    expect(world.operations).toHaveLength(1);
    expect(world.accountingDocuments).toHaveLength(0);
  });

  it('produces one effect for a concurrent same-key same-request race', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    const [first, second] = await Promise.all([
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ]);

    // Both requests converge on the same answer...
    expect(first.outcome).toBe('final_posted');
    expect(second.outcome).toBe('final_posted');
    expect(second.accountingDocumentId).toBe(first.accountingDocumentId);
    // ...and there is exactly ONE effect and ONE durable operation.
    expect(world.operations).toHaveLength(1);
    expect(world.operations[0]!.state).toBe('POSTED');
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingLedger.size).toBe(1);
    expect(documentOf(world, documentId).status).toBe('accounting_posted');
  });

  it('produces one winner and a 409 loser for a concurrent same-key different-request race', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);
    // The two fact collections see different values: the loser's request
    // hashes differently from the winner's frozen one.
    world.movementValueOverrides = ['100.00', '200.00'];

    const results = await Promise.allSettled([
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.requestAccountingPosting>>
      > => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]!.value.outcome).toBe('final_posted');
    expect(rejected[0]!.reason).toMatchObject({ code: 'Conflict' });
    // One durable operation, one effect: the loser never reached Accounting.
    expect(world.operations).toHaveLength(1);
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingCalls).toHaveLength(1);
  });

  it('catches a lost insert race on the unique key and answers the winner', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    // Phase 1 commits, Accounting never answers: the operation stays PENDING.
    world.accountingMode = 'crash';
    await expect(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ).rejects.toThrow('simulated crash');
    expect(operationOf(world, documentId).state).toBe('PENDING');

    // The retry's reads are blind (the in-lock re-check misses), so the
    // insert hits the unique constraint: the catch reloads the winner and
    // applies the same OD-06 decision procedure — recovery, not a 500.
    world.accountingMode = 'ok';
    world.blindFindByKey = true;
    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    expect(recovered.outcome).toBe('final_posted');
    expect(world.operations).toHaveLength(1);
    expect(world.operations[0]!.state).toBe('POSTED');
    expect(world.accountingDocuments).toHaveLength(1);
    expect(documentOf(world, documentId).status).toBe('accounting_posted');
  });

  it('refuses a second operation under a different key while one is in flight', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    // A draft exists: a second operation under ANY key is refused.
    await expectBusinessRule(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-2',
        }),
      ),
      'inventory.document.accounting_post_in_flight',
    );
    expect(world.operations).toHaveLength(1);
    expect(world.accountingDocuments).toHaveLength(1);

    // The same for a PENDING operation (a crash left it unanswered).
    const pending = createWorld();
    const pendingService = buildService(pending);
    const seeded = seedReceipt(pending);
    pending.accountingMode = 'crash';
    await expect(
      asUser(() =>
        pendingService.requestAccountingPosting(seeded.documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ).rejects.toThrow('simulated crash');
    await expectBusinessRule(
      asUser(() =>
        pendingService.requestAccountingPosting(seeded.documentId, ORG, {
          operationKey: 'key-2',
        }),
      ),
      'inventory.document.accounting_post_in_flight',
    );
    expect(pending.operations).toHaveLength(1);
  });
});

// ---- recovery ---------------------------------------------------------------

describe('C-62 OD-01 durable recovery (hermetic)', () => {
  it('recovers a PENDING operation whose FINAL voucher already exists', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    const posted = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    const voucherId = posted.accountingDocumentId;
    expect(voucherId).toBeTruthy();

    // Crash before Phase 3: the operation is PENDING, the document projection
    // never happened, but Accounting already holds the FINAL voucher.
    resetOperationToPending(world, documentId);
    revertDocumentProjection(world, documentId);

    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(recovered.outcome).toBe('final_posted');
    // Accounting's own ledger replayed: the SAME voucher, no second one.
    expect(recovered.accountingDocumentId).toBe(voucherId);
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingLedger.size).toBe(1);
    // The durable records converged.
    expect(operationOf(world, documentId).state).toBe('POSTED');
    expect(operationOf(world, documentId).glPosted).toBe(true);
    const document = documentOf(world, documentId);
    expect(document.status).toBe('accounting_posted');
    expect(document.accountingPostingState).toBe('final_posted');
    expect(document.accountingDocumentId).toBe(voucherId);
  });

  it('recovers a PENDING operation whose DRAFT already exists', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    const drafted = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    expect(drafted.outcome).toBe('draft_created');
    const draftId = drafted.accountingDocumentId;

    // Crash before Phase 3: the operation is PENDING, the document standing
    // is back to not_posted, but Accounting already holds the draft.
    resetOperationToPending(world, documentId);
    revertDocumentProjection(world, documentId);

    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(recovered.outcome).toBe('draft_created');
    // The SAME draft, discovered through Accounting's idempotency contract.
    expect(recovered.accountingDocumentId).toBe(draftId);
    expect(world.accountingDocuments).toHaveLength(1);
    expect(world.accountingLedger.size).toBe(1);
    expect(operationOf(world, documentId).state).toBe('DRAFT_CREATED');
    const document = documentOf(world, documentId);
    expect(document.status).toBe('operational');
    expect(document.accountingPostingState).toBe('draft_created');
    expect(document.accountingDocumentId).toBe(draftId);
  });

  it('completes a PENDING operation that never reached Accounting', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    // Phase 1 committed, the process died before the boundary call.
    world.accountingMode = 'crash';
    await expect(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ).rejects.toThrow('simulated crash');
    expect(operationOf(world, documentId).state).toBe('PENDING');
    expect(world.accountingDocuments).toHaveLength(0);

    world.accountingMode = 'ok';
    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(recovered.outcome).toBe('final_posted');
    expect(world.accountingDocuments).toHaveLength(1);
    expect(operationOf(world, documentId).state).toBe('POSTED');
    const document = documentOf(world, documentId);
    expect(document.status).toBe('accounting_posted');
    expect(document.accountingPostingState).toBe('final_posted');
  });

  it('converges when the document was projected but the operation update was interrupted', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    const posted = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    const voucherId = posted.accountingDocumentId;

    // Crash between the document write and the operation write: the document
    // is accounting_posted but the operation is still PENDING.
    resetOperationToPending(world, documentId);

    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(recovered.outcome).toBe('final_posted');
    expect(recovered.accountingDocumentId).toBe(voucherId);
    expect(operationOf(world, documentId).state).toBe('POSTED');
    const document = documentOf(world, documentId);
    expect(document.status).toBe('accounting_posted');
    expect(document.accountingPostingState).toBe('final_posted');
    expect(world.accountingDocuments).toHaveLength(1);
  });

  it('resumes the request from the immutable snapshot, never from current state', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { cost: '100.00' });

    world.accountingMode = 'crash';
    await expect(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ).rejects.toThrow('simulated crash');
    world.accountingMode = 'ok';

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    // The resumed call carried the SNAPSHOT's facts: the authoritative value
    // verbatim, the unit cost RE-DERIVED (the stored copy is padded by
    // numeric(18,6) and would not hash to the frozen request), and the total
    // RE-SUMMED with the original exact arithmetic.
    const resumed = world.accountingCalls.at(-1);
    expect(resumed).toBeDefined();
    expect(resumed!.sourceDocumentId).toBe(documentId);
    expect(resumed!.valuation.totalValue).toBe('100');
    expect(resumed!.movements).toHaveLength(1);
    expect(resumed!.movements[0]!.value).toBe('100.00');
    expect(resumed!.movements[0]!.unitCost).toBe('10');
    expect(resumed!.movements[0]!.quantity).toBe('10.0000');
    // And it hashed to the operation's frozen request hash.
    expect(resumed!.requestHash).toBe(
      operationOf(world, documentId).requestHash,
    );
  });

  it('retries a FAILED operation by re-entering PENDING and completes it', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    world.accountingMode = 'fail';
    const failed = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    expect(failed.outcome).toBe('failed');
    expect(operationOf(world, documentId).state).toBe('FAILED');
    expect(documentOf(world, documentId).accountingPostingState).toBe(
      'not_posted',
    );

    world.accountingMode = 'ok';
    const recovered = await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );

    expect(recovered.outcome).toBe('final_posted');
    expect(operationOf(world, documentId).state).toBe('POSTED');
    expect(world.accountingDocuments).toHaveLength(1);
    expect(documentOf(world, documentId).status).toBe('accounting_posted');
  });

  it('never reuses an operation whose snapshot does not reconstruct to its hash', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world);

    world.accountingMode = 'crash';
    await expect(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    ).rejects.toThrow('simulated crash');
    world.accountingMode = 'ok';

    // Corrupt the durable record: the snapshot no longer matches the
    // operation's frozen request hash.
    const snapshot = world.snapshots.get(operationOf(world, documentId).id);
    if (snapshot === undefined) throw new Error('no snapshot');
    snapshot.movements[0]!.totalValue = '999.00';

    await expectConflict(
      asUser(() =>
        service.requestAccountingPosting(documentId, ORG, {
          operationKey: 'key-1',
        }),
      ),
    );
    // The corrupt operation is left untouched and unanswered.
    expect(operationOf(world, documentId).state).toBe('PENDING');
    expect(world.accountingDocuments).toHaveLength(0);
  });
});

// ---- cancellation -----------------------------------------------------------

describe('C-62 draft cancellation (hermetic)', () => {
  it('answers a confirmed cancellation as a success, never as refused', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    const cancelled = await asUser(() =>
      service.cancelAccountingPosting(documentId, ORG, {}),
    );

    expect(cancelled.outcome).toBe('draft_cancelled');
    expect(cancelled.state).toBe('draft_cancelled');
    expect(cancelled.replayed).toBe(false);
    expect(cancelled.refusalCode).toBe(null);
    expect(operationOf(world, documentId).state).toBe('CANCELLED');
    expect(documentOf(world, documentId).accountingPostingState).toBe(
      'draft_cancelled',
    );
    expect(world.accountingDocuments).toHaveLength(0);
    expect(world.cancelCalls).toHaveLength(1);
  });

  it('converges when the draft is already gone but the document still says draft_created', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    // Crash after Accounting deleted the draft, before Inventory wrote: the
    // Accounting document is gone, the ledger row is kept (as a real
    // pre-final deletion keeps it).
    const operation = operationOf(world, documentId);
    const entry = world.accountingLedger.get(
      `${ORG}:${operation.operationKey}`,
    );
    if (entry === undefined) throw new Error('no ledger entry');
    world.accountingDocuments = world.accountingDocuments.filter(
      (document) => document.id !== entry.documentId,
    );
    expect(documentOf(world, documentId).accountingPostingState).toBe(
      'draft_created',
    );

    // The retry converges WITHOUT a second Accounting deletion: the contract
    // answers cancelled:true because its ledger holds no document any more.
    const cancelled = await asUser(() =>
      service.cancelAccountingPosting(documentId, ORG, {}),
    );

    expect(cancelled.outcome).toBe('draft_cancelled');
    expect(cancelled.state).toBe('draft_cancelled');
    expect(world.cancelCalls).toHaveLength(1);
    expect(operationOf(world, documentId).state).toBe('CANCELLED');
    expect(documentOf(world, documentId).accountingPostingState).toBe(
      'draft_cancelled',
    );
  });

  it('converges when the document says draft_cancelled but the operation update was interrupted', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    await asUser(() =>
      service.requestAccountingPosting(documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    await asUser(() => service.cancelAccountingPosting(documentId, ORG, {}));
    expect(operationOf(world, documentId).state).toBe('CANCELLED');

    // Crash between the document write and the operation write: the document
    // says draft_cancelled, the operation still says DRAFT_CREATED.
    const operation = operationOf(world, documentId);
    Object.assign(operation, {
      state: 'DRAFT_CREATED',
      completedAt: null,
      updatedAt: new Date(),
    });

    const retried = await asUser(() =>
      service.cancelAccountingPosting(documentId, ORG, {}),
    );

    // The retry converges the operation onto the document's durable fact
    // WITHOUT touching Accounting again.
    expect(retried.outcome).toBe('draft_cancelled');
    expect(retried.replayed).toBe(true);
    expect(world.cancelCalls).toHaveLength(1);
    expect(operationOf(world, documentId).state).toBe('CANCELLED');
    expect(documentOf(world, documentId).accountingPostingState).toBe(
      'draft_cancelled',
    );

    // A further retry replays the converged success answer.
    const replayed = await asUser(() =>
      service.cancelAccountingPosting(documentId, ORG, {}),
    );
    expect(replayed.outcome).toBe('draft_cancelled');
    expect(replayed.replayed).toBe(true);
    expect(world.cancelCalls).toHaveLength(1);
  });

  it('still refuses to cancel anything but an Accounting draft', async () => {
    const world = createWorld();
    const service = buildService(world);
    const { documentId } = seedReceipt(world, { mode: 'draft' });

    await expectBusinessRule(
      asUser(() => service.cancelAccountingPosting(documentId, ORG, {})),
      'inventory.document.accounting_post_draft_required',
    );

    // A FINAL voucher is never cancellable through this route.
    const finalWorld = createWorld();
    const finalService = buildService(finalWorld);
    const seeded = seedReceipt(finalWorld);
    await asUser(() =>
      finalService.requestAccountingPosting(seeded.documentId, ORG, {
        operationKey: 'key-1',
      }),
    );
    await expectBusinessRule(
      asUser(() =>
        finalService.cancelAccountingPosting(seeded.documentId, ORG, {}),
      ),
      'inventory.document.accounting_post_draft_required',
    );
  });
});
