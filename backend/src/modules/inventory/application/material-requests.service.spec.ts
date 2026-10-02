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
  MaterialRequestLinesInvokedError,
  MaterialRequestInvocationCapacityError,
  type ApproveLineInput,
  type CreateDraftHeaderInput,
  type DraftLineInput,
  type InvocationCapacityResult,
  type MaterialRequestListFilter,
  type RejectInput,
  type ReservationConsumptionResult,
  type ReverseApprovalInput,
  type SubmitInput,
  type UpdateDraftHeaderInput,
} from '../data/material-requests.repository.js';
import { BalanceDriftError } from '../data/inventory-posting-errors.js';
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
 * Availability/negative-policy arithmetic in `approve()` itself is OUT of
 * scope for these findings (already covered by
 * `inventory-core.e2e-spec.ts`/the reservation suites, and by
 * `material-requests-live.e2e-spec.ts` against real Postgres), so `approve()`
 * here is a simplified stub that always succeeds for a flagged line and
 * never throws `ReservationAvailabilityError` — never a redesign of the
 * real `approve()` transaction. It DOES seed a realistic reservation row
 * (`quantity`/`baseQuantity` equal to the line's own, `status: 'active'`),
 * because `reserveInvocationCapacity`'s reservation-consumption arithmetic
 * (C-50 §3.8 follow-up: every invocation of a reserved line consumes the
 * identical amount from its reservation) IS exercised at the unit level
 * below — the fake's `reserveInvocationCapacity`/`releaseInvocationCapacity`
 * mirror the real repository's reservation quantity/status transitions
 * exactly (decrement while active, close at exactly zero, reopen on
 * compensation), while `inventory_balances.reserved`/`onHand` themselves
 * stay out of this fake's scope (verified against real Postgres by the live
 * E2E suite instead).
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

/** Just enough of `inventory_reservations` to exercise consumption
 *  arithmetic — `FakeMaterialRequestsRepository` is not a general-purpose
 *  reservation fake, only what `reserveInvocationCapacity`/
 *  `releaseInvocationCapacity` need. */
interface FakeReservationRow {
  id: string;
  quantity: string;
  baseQuantity: string;
  status: 'active' | 'released';
}

class FakeMaterialRequestsRepository {
  private readonly headers = new Map<string, MaterialRequest>();
  private readonly lines = new Map<string, MaterialRequestLine[]>();
  private readonly events = new Map<string, MaterialRequestEvent[]>();
  private readonly tails = new Map<string, Promise<void>>();
  readonly reservations = new Map<string, FakeReservationRow>();
  /** When set, `recordInvocationEvent` throws instead of appending — used
   *  to exercise the §4 post-relation-success audit-event-loss window. */
  failRecordInvocationEvent = false;

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
      returnedAt: null,
      returnedBy: null,
      returnReason: null,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      approvalReversedAt: null,
      approvalReversedBy: null,
      approvalReversalReason: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
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
      this.assertStatusIn(current, ['draft', 'returned']);
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
      this.assertStatusIn(current, ['draft', 'returned']);
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
        fromStatus: current.status,
        toStatus: 'submitted',
        actorId: input.submittedBy,
        reason: null,
        referenceId: null,
        occurredAt: input.submittedAt,
      });
      return updated;
    });
  }

  async returnForCorrection(input: {
    id: string;
    organizationId: string;
    returnedAt: Date;
    returnedBy: string | null;
    reason: string;
  }): Promise<MaterialRequest> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'submitted');
      const updated: MaterialRequest = {
        ...current,
        status: 'returned',
        returnedAt: input.returnedAt,
        returnedBy: input.returnedBy,
        returnReason: input.reason,
        updatedAt: input.returnedAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'returned_for_correction',
        fromStatus: 'submitted',
        toStatus: 'returned',
        actorId: input.returnedBy,
        reason: input.reason,
        referenceId: null,
        occurredAt: input.returnedAt,
      });
      return updated;
    });
  }

  async cancel(input: {
    id: string;
    organizationId: string;
    cancelledAt: Date;
    cancelledBy: string | null;
    reason: string | null;
  }): Promise<{ header: MaterialRequest; releasedReservationIds: string[] }> {
    return this.withLock(input.id, () => {
      const current = this.requireHeader(input.id);
      this.assertStatus(current, 'approved');
      const lines = this.lines.get(input.id) ?? [];
      if (lines.some((line) => line.invocationCount > 0)) {
        throw new MaterialRequestLinesInvokedError();
      }
      const releasedReservationIds = lines
        .map((line) => line.reservationId)
        .filter((id): id is string => id !== null);
      const updated: MaterialRequest = {
        ...current,
        status: 'cancelled',
        cancelledAt: input.cancelledAt,
        cancelledBy: input.cancelledBy,
        cancellationReason: input.reason,
        updatedAt: input.cancelledAt,
      };
      this.headers.set(input.id, updated);
      this.appendEvent(input.id, input.organizationId, {
        eventType: 'cancelled',
        fromStatus: 'approved',
        toStatus: 'cancelled',
        actorId: input.cancelledBy,
        reason: input.reason,
        referenceId: null,
        occurredAt: input.cancelledAt,
      });
      return { header: updated, releasedReservationIds };
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
        // Exact reservation (Owner decision): the same item/warehouse/
        // quantity/unit-conversion as the line itself.
        this.reservations.set(reservationId, {
          id: reservationId,
          quantity: flagged.quantity,
          baseQuantity: flagged.baseQuantity,
          status: 'active',
        });
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
      const lines = this.lines.get(input.id) ?? [];
      if (lines.some((line) => line.invocationCount > 0)) {
        throw new MaterialRequestLinesInvokedError();
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
      const releasedReservationIds = lines
        .map((line) => line.reservationId)
        .filter((id): id is string => id !== null);
      return { header: updated, releasedReservationIds };
    });
  }

  async reserveInvocationCapacity(input: {
    id: string;
    organizationId: string;
    lineId: string;
    invokedBase: string;
    invokedEntered: string;
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

      let reservationConsumption: ReservationConsumptionResult | null = null;
      if (line.reservationId !== null) {
        const reservation = this.reservations.get(line.reservationId);
        if (
          reservation === undefined ||
          reservation.status !== 'active' ||
          compare(reservation.quantity, '0') <= 0 ||
          compare(reservation.baseQuantity, '0') <= 0
        ) {
          throw new BalanceDriftError();
        }
        if (
          compare(input.invokedBase, reservation.baseQuantity) > 0 ||
          compare(input.invokedEntered, reservation.quantity) > 0
        ) {
          throw new BalanceDriftError();
        }
        const nextBase = subtractDecimalStrings(
          reservation.baseQuantity,
          input.invokedBase,
        );
        const nextQuantity = subtractDecimalStrings(
          reservation.quantity,
          input.invokedEntered,
        );
        const closed = compare(nextBase, '0') === 0;
        if (closed !== (compare(nextQuantity, '0') === 0)) {
          throw new BalanceDriftError();
        }
        this.reservations.set(line.reservationId, {
          ...reservation,
          quantity: nextQuantity,
          baseQuantity: nextBase,
          status: closed ? 'released' : 'active',
        });
        reservationConsumption = {
          reservationId: line.reservationId,
          consumedBase: input.invokedBase,
          consumedEntered: input.invokedEntered,
          closed,
        };
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
        reservationConsumption,
      };
    });
  }

  async releaseInvocationCapacity(input: {
    id: string;
    lineId: string;
    invokedBase: string;
    now: Date;
    actorId: string | null;
    reservationConsumption: ReservationConsumptionResult | null;
  }): Promise<void> {
    // Mirrors the real repository's `releaseInvocationCapacity`: always add
    // this attempt's own captured deltas back to whatever the CURRENT
    // (locked) state is — never branch on this attempt's own `closed`
    // snapshot, which only ever described what THIS attempt did and is
    // invalidated the moment a different concurrent attempt legitimately
    // changes the reservation afterwards. See the real implementation's
    // doc comment for the full reasoning.
    await this.withLock(input.id, () => {
      const lines = this.lines.get(input.id) ?? [];
      const index = lines.findIndex(
        (candidate) => candidate.id === input.lineId,
      );
      if (index !== -1) {
        const line = lines[index]!;
        const restored = subtractDecimalStrings(
          line.invokedBaseQuantity,
          input.invokedBase,
        );
        if (compare(restored, '0') < 0 || line.invocationCount - 1 < 0) {
          throw new BalanceDriftError();
        }
        lines[index] = {
          ...line,
          invokedBaseQuantity: restored,
          invocationCount: line.invocationCount - 1,
          updatedAt: input.now,
        };
      }

      const consumption = input.reservationConsumption;
      if (consumption !== null) {
        const reservation = this.reservations.get(consumption.reservationId);
        if (reservation === undefined) return;
        const restoredQuantity = addDecimalStrings(
          reservation.quantity,
          consumption.consumedEntered,
        );
        const restoredBaseQuantity = addDecimalStrings(
          reservation.baseQuantity,
          consumption.consumedBase,
        );
        if (
          compare(restoredQuantity, '0') <= 0 ||
          compare(restoredBaseQuantity, '0') <= 0
        ) {
          throw new BalanceDriftError();
        }
        this.reservations.set(consumption.reservationId, {
          ...reservation,
          status: 'active',
          quantity: restoredQuantity,
          baseQuantity: restoredBaseQuantity,
        });
      }
    });
  }

  async recordInvocationEvent(input: {
    materialRequestId: string;
    organizationId: string;
    actorId: string | null;
    occurredAt: Date;
    relationId: string;
  }): Promise<void> {
    if (this.failRecordInvocationEvent) {
      throw new Error('TEST DOUBLE: recordInvocationEvent forced failure.');
    }
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
    this.assertStatusIn(header, [expected]);
  }

  private assertStatusIn(
    header: MaterialRequest,
    expected: readonly MaterialRequest['status'][],
  ): void {
    if (!(expected as readonly string[]).includes(header.status)) {
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
  /** When provided, `DocumentRelationsService.linkDocuments` throws only for
   *  calls where this predicate (given the attempt's own `quantity`) returns
   *  true — lets a concurrency test fail exactly ONE of several genuinely
   *  overlapping invocations (e.g. "the 60 attempt, not the 40 attempt") by
   *  a property distinguishable from the outside, the same way a real
   *  destination-side failure would single out one caller. */
  failLinkDocumentsWhen?: (quantity: string | null | undefined) => boolean;
  /** When provided, `linkDocuments` awaits this (keyed by the attempt's own
   *  `quantity`) AFTER `reserveInvocationCapacity` has already committed but
   *  BEFORE deciding success/failure — lets a test hold one genuinely
   *  in-flight attempt open while a second, fully independent attempt races
   *  ahead and commits against the same reservation, reproducing a true
   *  "concurrent, not sequential" interleaving even though the fake runs on
   *  a single event loop. */
  beforeLinkDocuments?: (
    quantity: string | null | undefined,
  ) => Promise<void> | undefined;
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

  // Idempotent by `allocationKey`, matching the real `NumberingService`
  // contract (see its class docs): a resubmission after return-for-
  // correction calls `allocateNumber` again with the SAME key (the Material
  // Request id) and must replay the already-allocated number rather than
  // minting a new one.
  const numberingAllocations = new Map<string, string>();
  const numbering = {
    allocateNumber: async (input: { allocationKey: string }) => {
      const existing = numberingAllocations.get(input.allocationKey);
      if (existing !== undefined) {
        return { number: existing };
      }
      const number = `MR-${generateId()}`;
      numberingAllocations.set(input.allocationKey, number);
      return { number };
    },
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
      await options.beforeLinkDocuments?.(input.quantity);
      if (options.failLinkDocuments === true) {
        throw new Error('TEST DOUBLE: linkDocuments forced failure.');
      }
      if (options.failLinkDocumentsWhen?.(input.quantity) === true) {
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

  const loggerErrors: Array<{ message: string; meta: unknown }> = [];
  const serviceLogger = {
    log: () => {},
    warn: () => {},
    error: (message: string, meta: unknown) => {
      loggerErrors.push({ message, meta });
    },
  } as unknown as JsonLogger;

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
    serviceLogger,
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
    loggerErrors,
    // Exposed so tests exercising a SECOND principal (e.g. "cancellation
    // does not require the original approver") can seed that principal's
    // membership — ODR-3 requires an actual membership row for every
    // request-context caller, same as the fixed ACTOR above.
    seedMembership: (userId: string) =>
      stores.raw.memberships.seed(userId, organizationId),
    // Exposed so a test can exercise a non-1 entered→base conversion
    // through invocation (§8 of the C-50 audit) without reaching into the
    // store bundle directly — a GLOBAL conversion, open-ended from
    // `validFrom`, matching `resolveEnteredToBase`'s own lookup shape.
    seedGlobalUnitConversion: (input: {
      fromUnitId: string;
      toUnitId: string;
      factor: string;
      validFrom: Date;
    }) =>
      stores.raw.unitConversions.globals.seed({
        id: generateId(),
        organizationId,
        itemId: null,
        fromUnitId: input.fromUnitId,
        toUnitId: input.toUnitId,
        factor: input.factor,
        validFrom: input.validFrom,
        validTo: null,
        createdAt: input.validFrom,
        updatedAt: input.validFrom,
      }),
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

  it(
    'a Document Relation success survives a failed audit-event write: the ' +
      'invocation still reports success, capacity/relation stay committed, ' +
      'nothing is compensated, and the failure is logged (§4 accepted trade-off)',
    async () => {
      const fixture = await buildFixture();
      fixture.repository.failRecordInvocationEvent = true;
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
      // The relation write itself (the real business effect) succeeds —
      // only the append-only audit event write fails afterwards. This must
      // NOT be surfaced as a failed invocation: doing so would both lie
      // about what is actually committed and invite a caller retry that
      // would double-consume capacity for an invocation that already
      // succeeded.
      const result = await asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '4',
        }),
      );
      expect(result.invokedBaseQuantity).toBe('4');
      expect(result.invocationCount).toBe(1);

      const lines = await fixture.repository.listLines(materialRequestId);
      expect(lines[0]?.invokedBaseQuantity).toBe('4');
      expect(lines[0]?.invocationCount).toBe(1);
      expect(fixture.relationCalls).toContain('linkDocuments');

      // The audit event itself is indeed missing — this is the accepted,
      // OBSERVABLE gap (there is no outbox/durable-retry mechanism in this
      // codebase to hand it off to), not a silent one: it must be logged.
      const events = await fixture.repository.listEvents(materialRequestId);
      expect(
        events.filter((event) => event.eventType === 'line_invoked'),
      ).toHaveLength(0);
      expect(fixture.loggerErrors).toHaveLength(1);
      expect(fixture.loggerErrors[0]?.message).toContain(
        'Failed to record a Material Request invocation audit event',
      );
    },
  );
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

  it('retrying the same quantity after a compensated failure succeeds exactly once — no duplication', async () => {
    // `failLinkDocumentsWhen` lets the FIRST call for this quantity fail
    // and every subsequent one succeed — modelling an operator (or a
    // caller with no idempotency key) retrying after seeing the first
    // attempt's error, which `invokeLine` has already fully compensated.
    let attempts = 0;
    const fixture = await buildFixture({
      failLinkDocumentsWhen: (quantity) => {
        if (quantity !== '4') return false;
        attempts += 1;
        return attempts === 1;
      },
    });
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
    const invoke = () =>
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '4',
        }),
      );
    await expect(invoke()).rejects.toThrow();
    const afterFailure = await fixture.repository.listLines(materialRequestId);
    expect(afterFailure[0]?.invokedBaseQuantity).toBe('0');
    expect(afterFailure[0]?.invocationCount).toBe(0);

    // The retry is a brand new, independent attempt — it must succeed
    // exactly once, counted exactly once, never stacking on top of the
    // compensated-away first attempt.
    await invoke();
    const afterRetry = await fixture.repository.listLines(materialRequestId);
    expect(afterRetry[0]?.invokedBaseQuantity).toBe('4');
    expect(afterRetry[0]?.invocationCount).toBe(1);
    const events = await fixture.repository.listEvents(materialRequestId);
    expect(
      events.filter((event) => event.eventType === 'line_invoked'),
    ).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// C-50 final audit — invocation is gated strictly by status (§22 test
// matrix items 1-5): only an APPROVED request may be invoked, in every
// OTHER status, every single time — no exceptions.
// ---------------------------------------------------------------------------

describe('C-50 audit — invocation requires an approved request, in every other status', () => {
  async function attemptInvoke(
    fixture: Fixture,
    materialRequestId: string,
    lineId: string,
  ) {
    // The status gate is checked BEFORE destination validation, so a
    // deliberately nonexistent destination still proves the status refusal
    // specifically — not a side effect of destination validation.
    return fixture.service.invokeLine(
      materialRequestId,
      fixture.organizationId,
      {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: 'does-not-exist',
        quantity: '1',
      },
    );
  }

  it('a DRAFT request cannot be invoked', async () => {
    const fixture = await buildFixture();
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '10',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await expect(
      asActor(() => attemptInvoke(fixture, created.id, created.lines[0]!.id)),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(created.id);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('a SUBMITTED request cannot be invoked', async () => {
    const fixture = await buildFixture();
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '10',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    await expect(
      asActor(() => attemptInvoke(fixture, created.id, created.lines[0]!.id)),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(created.id);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('a RETURNED-for-correction request cannot be invoked', async () => {
    const fixture = await buildFixture();
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '10',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    await asActor(() =>
      fixture.service.returnForCorrection(created.id, fixture.organizationId, {
        reason: 'Needs another look',
      }),
    );
    await expect(
      asActor(() => attemptInvoke(fixture, created.id, created.lines[0]!.id)),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(created.id);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('a REJECTED request cannot be invoked', async () => {
    const fixture = await buildFixture();
    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '10',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    await asActor(() =>
      fixture.service.reject(created.id, fixture.organizationId, {
        reason: 'Not needed anymore',
      }),
    );
    await expect(
      asActor(() => attemptInvoke(fixture, created.id, created.lines[0]!.id)),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(created.id);
    expect(lines[0]?.invocationCount).toBe(0);
  });

  it('a CANCELLED request cannot be invoked', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture);
    await asActor(() =>
      fixture.service.cancel(materialRequestId, fixture.organizationId, {}),
    );
    await expect(
      asActor(() => attemptInvoke(fixture, materialRequestId, lineId)),
    ).rejects.toMatchObject({ status: 422 });
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invocationCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Owner-confirmed decisions: reservation shape, lifecycle, approval
// authority, return-for-correction, cancellation (see
// docs/tasks/c-50-material-request-investigation.md §19 and OQ-66).
// ---------------------------------------------------------------------------

describe('Owner decision — approval authority has no requester/approver separation', () => {
  it('lets the SAME principal create, submit, AND approve its own request', async () => {
    const fixture = await buildFixture();
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
    expect(created.requestedBy).toBe(ACTOR.userId);
    await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    // Self-approval must succeed — no requester/approver separation is
    // enforced anywhere in this service (Owner decision).
    const approved = await asActor(() =>
      fixture.service.approve(created.id, fixture.organizationId),
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(ACTOR.userId);
    expect(approved.requestedBy).toBe(approved.approvedBy);
  });
});

describe('Owner decision — return for correction and resubmission', () => {
  it('returns a submitted request for correction with a required reason, then allows edit and resubmission', async () => {
    const fixture = await buildFixture();
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
    const submitted = await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    const originalNumber = submitted.number;
    expect(originalNumber).not.toBeNull();

    const returned = await asActor(() =>
      fixture.service.returnForCorrection(created.id, fixture.organizationId, {
        reason: 'Wrong warehouse on line 1',
      }),
    );
    expect(returned.status).toBe('returned');
    expect(returned.returnedBy).toBe(ACTOR.userId);
    expect(returned.returnReason).toBe('Wrong warehouse on line 1');

    // The requester may edit a returned request (same editable state as draft).
    const edited = await asActor(() =>
      fixture.service.updateDraft(created.id, fixture.organizationId, {
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '7',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    expect(edited.lines[0]?.quantity).toBe('7');

    // Resubmission replays the SAME allocated number (never a new one).
    const resubmitted = await asActor(() =>
      fixture.service.submit(created.id, fixture.organizationId),
    );
    expect(resubmitted.status).toBe('submitted');
    expect(resubmitted.number).toBe(originalNumber);

    const events = await fixture.repository.listEvents(created.id);
    const returnEvent = events.find(
      (e) => e.eventType === 'returned_for_correction',
    );
    expect(returnEvent?.fromStatus).toBe('submitted');
    expect(returnEvent?.toStatus).toBe('returned');
    // The resubmission event is a plain 'submitted' event, distinguished by
    // fromStatus (never a new event type) — preserving the full cycle
    // history without inventing a parallel narrative.
    const resubmitEvent = [...events]
      .reverse()
      .find((e) => e.eventType === 'submitted');
    expect(resubmitEvent?.fromStatus).toBe('returned');
  });

  it('rejects an empty return reason', async () => {
    const fixture = await buildFixture();
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
    await expect(
      asActor(() =>
        fixture.service.returnForCorrection(
          created.id,
          fixture.organizationId,
          {
            reason: '   ',
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to return a request that is not submitted', async () => {
    const fixture = await buildFixture();
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
    await expect(
      asActor(() =>
        fixture.service.returnForCorrection(
          created.id,
          fixture.organizationId,
          {
            reason: 'Too early',
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('Owner decision — cancellation is distinct from approval reversal', () => {
  it('cancels an approved request with no reservation, releasing nothing', async () => {
    const fixture = await buildFixture();
    const { materialRequestId } = await createAndApprove(fixture, {
      reservationRequested: false,
    });
    const cancelled = await asActor(() =>
      fixture.service.cancel(materialRequestId, fixture.organizationId, {
        reason: 'No longer needed',
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledBy).toBe(ACTOR.userId);
    expect(cancelled.cancellationReason).toBe('No longer needed');
    // Cancellation must NEVER touch the separate approval-reversal columns.
    expect(cancelled.approvalReversedAt).toBeNull();
    expect(cancelled.approvalReversedBy).toBeNull();
  });

  it("releases a flagged line's reservation on cancellation (never leaves a dangling claim)", async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      reservationRequested: true,
    });
    const beforeCancel = await fixture.repository.listLines(materialRequestId);
    const reservationId = beforeCancel.find(
      (l) => l.id === lineId,
    )?.reservationId;
    expect(reservationId).not.toBeNull();

    // Exercise the repository contract directly: `cancel` must report every
    // reservation id it released so the caller (and, in the real
    // repository, `InventoryReservationsRepository`, under the same
    // Material Request row lock `approve` used to create the reservation)
    // can restore `inventory_balances.reserved` — exercised end-to-end
    // against real Postgres by the live E2E suite.
    const result = await fixture.repository.cancel({
      id: materialRequestId,
      organizationId: fixture.organizationId,
      cancelledAt: new Date(),
      cancelledBy: ACTOR.userId,
      reason: null,
    });
    expect(result.header.status).toBe('cancelled');
    expect(result.releasedReservationIds).toContain(reservationId);
  });

  it('cancellation does NOT reverse approval and does not require the original approver', async () => {
    const fixture = await buildFixture();
    const { materialRequestId } = await createAndApprove(fixture);
    // A different actor than the approver still succeeds — unlike
    // reverseApproval, cancel carries no original-approver restriction
    // (Owner decision: no actor restriction is named for cancellation).
    const otherActor: AuthenticatedPrincipal = {
      userId: 'user-2',
      sessionId: 'session-2',
    };
    fixture.seedMembership(otherActor.userId);
    const cancelled = await runWithRequestContext(
      { correlationId: 'test-correlation-2', principal: otherActor },
      () =>
        fixture.service.cancel(materialRequestId, fixture.organizationId, {
          reason: 'Cancelled by someone else entirely',
        }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledBy).toBe('user-2');
  });

  it('refuses to cancel a request that is not approved', async () => {
    const fixture = await buildFixture();
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
    await expect(
      asActor(() =>
        fixture.service.cancel(created.id, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses to cancel once ANY line has been invoked, even partially', async () => {
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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        // Partial invocation only — must still block cancellation entirely.
        quantity: '3',
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.cancel(materialRequestId, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({ status: 422 });
    // The request must still be approved, not silently cancelled.
    const current = await fixture.repository.findById(materialRequestId);
    expect(current?.status).toBe('approved');
  });

  it('reverseApproval is likewise refused once any line has been invoked, even partially', async () => {
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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '3',
      }),
    );
    await expect(
      asActor(() =>
        fixture.service.reverseApproval(
          materialRequestId,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// ---------------------------------------------------------------------------
// Owner decision — invocation consumes the line's active reservation
// proportionally (C-50 §3.8 follow-up: "every successful invocation
// consumes the corresponding amount from that active reservation").
// ---------------------------------------------------------------------------

describe('Owner decision — invocation consumes the active reservation', () => {
  it('partial invocation reduces the reservation by exactly the invoked amount, leaving it ACTIVE', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
    expect(reservationId).not.toBeNull();
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '100',
      baseQuantity: '100',
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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '60',
      }),
    );

    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('60');
    expect(
      subtractDecimalStrings(
        lines[0]!.baseQuantity,
        lines[0]!.invokedBaseQuantity,
      ),
    ).toBe('40');
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '40',
      baseQuantity: '40',
    });
  });

  it('multiple invocations (100 -> 60 -> 25 -> 15) draw the reservation down to zero and close it', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
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

    await invoke('60');
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '40',
      baseQuantity: '40',
    });

    // The reservation remains active and usable by a LATER invocation — it
    // is not a one-shot claim.
    const second = await invoke('25');
    expect(second.invokedBaseQuantity).toBe('85');
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '15',
      baseQuantity: '15',
    });

    await invoke('15');
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('100');
    expect(
      subtractDecimalStrings(
        lines[0]!.baseQuantity,
        lines[0]!.invokedBaseQuantity,
      ),
    ).toBe('0');
    expect(lines[0]?.invocationCount).toBe(3);
    // Fully consumed: closed, and — critically — never left ACTIVE at zero.
    const finalReservation = fixture.repository.reservations.get(reservationId);
    expect(finalReservation?.status).toBe('released');
    expect(finalReservation?.quantity).toBe('0');
    expect(finalReservation?.baseQuantity).toBe('0');
  });

  it('a single invocation for the full reserved amount closes the reservation directly', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '50',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '50',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '50',
      }),
    );
    const reservation = fixture.repository.reservations.get(reservationId);
    expect(reservation?.status).toBe('released');
    expect(reservation?.quantity).toBe('0');
    expect(reservation?.baseQuantity).toBe('0');
  });

  it('a reserved line supports many invocations with no fixed count limit — only the total quantity caps it', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '200',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '200',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    // 100 invocations of 2 units each — far past any plausible artificial
    // limit (1, 10, 100...) — consuming the reservation in lockstep every
    // single time, never rejected merely because the invocation COUNT is
    // high; only the cumulative quantity (200) is ever the cap.
    const total = 100;
    for (let i = 0; i < total; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '2',
        }),
      );
    }
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invocationCount).toBe(total);
    expect(lines[0]?.invokedBaseQuantity).toBe('200');
    const finalReservation = fixture.repository.reservations.get(reservationId);
    // Fully consumed by the 100th invocation: closed, never left ACTIVE at
    // zero, regardless of how many invocations it took to get there.
    expect(finalReservation?.status).toBe('released');
    expect(finalReservation?.quantity).toBe('0');
    expect(finalReservation?.baseQuantity).toBe('0');
  });

  it('a non-1 unit conversion consumes the reservation using the exact base-unit amount, with no drift', async () => {
    // §8 of the C-50 audit: the line is REQUESTED and INVOKED in a "Box"
    // unit (1 Box = 12 Each, the item's base unit) — the reservation must be
    // consumed by the exact converted base amount every time, never the
    // entered-unit magnitude, and the entered/base pair must stay in exact
    // lockstep (no rounding/truncation drift) across repeated invocations.
    const fixture = await buildFixture();
    const boxUnitId = (
      await fixture.units.createUnit({
        organizationId: fixture.organizationId,
        code: 'BOX',
        name: 'Box of 12',
      })
    ).id;
    fixture.seedGlobalUnitConversion({
      fromUnitId: boxUnitId,
      toUnitId: fixture.unitId,
      factor: '12',
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
    });

    const created = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '10', // 10 Box
            unitId: boxUnitId,
            reservationRequested: true,
          },
        ],
      }),
    );
    // Resolved to the item's base unit at draft time: 10 Box * 12 = 120.
    expect(created.lines[0]?.baseQuantity).toBe('120');
    expect(created.lines[0]?.conversionFactor).toBe('12');

    const materialRequestId = created.id;
    const lineId = created.lines[0]!.id;
    await asActor(() =>
      fixture.service.submit(materialRequestId, fixture.organizationId),
    );
    const approved = await asActor(() =>
      fixture.service.approve(materialRequestId, fixture.organizationId),
    );
    const reservationId = approved.lines[0]!.reservationId!;
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      quantity: '10',
      baseQuantity: '120',
      status: 'active',
    });

    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '120',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    const invoke = (quantityInBoxes: string) =>
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: quantityInBoxes,
        }),
      );

    // Invoke 3 Box -> 36 Each consumed, 84 Each (7 Box) remain.
    const first = await invoke('3');
    expect(first.invokedBaseQuantity).toBe('36');
    expect(first.remainingBaseQuantity).toBe('84');
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '7',
      baseQuantity: '84',
    });

    // Invoke the remaining 7 Box -> 84 Each: closes the reservation exactly,
    // with no leftover drift from the repeated multiplication.
    const second = await invoke('7');
    expect(second.invokedBaseQuantity).toBe('120');
    expect(second.remainingBaseQuantity).toBe('0');
    const finalReservation = fixture.repository.reservations.get(reservationId);
    expect(finalReservation?.status).toBe('released');
    expect(finalReservation?.quantity).toBe('0');
    expect(finalReservation?.baseQuantity).toBe('0');
  });

  it('refuses an invocation whose cumulative total would exceed the line quantity, leaving the reservation untouched', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '60',
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
          quantity: '41',
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });

    // Refused BEFORE touching the reservation — still exactly 40, active.
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '40',
      baseQuantity: '40',
    });
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('60');
  });

  it('a line with NO reservation invokes normally without creating or touching any reservation', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: false,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    expect(lineBefore?.reservationId).toBeNull();
    const reservationCountBefore = fixture.repository.reservations.size;

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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '60',
      }),
    );

    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('60');
    expect(
      subtractDecimalStrings(
        lines[0]!.baseQuantity,
        lines[0]!.invokedBaseQuantity,
      ),
    ).toBe('40');
    expect(lines[0]?.reservationId).toBeNull();
    // No reservation was created or mutated as a side effect.
    expect(fixture.repository.reservations.size).toBe(reservationCountBefore);
  });

  it('a failed downstream relation restores the reservation to its exact pre-attempt state (partial consumption)', async () => {
    const fixture = await buildFixture({ failLinkDocuments: true });
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
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
          quantity: '40',
        }),
      ),
    ).rejects.toThrow();

    // The invocation never truly happened: counters AND the reservation are
    // back to exactly their pre-attempt state — still fully active and, in
    // a fixture where `linkDocuments` actually succeeded, still usable by a
    // later invocation (proven separately by the multi-invocation test
    // above, which uses the SAME repository-level consumption logic).
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('0');
    expect(lines[0]?.invocationCount).toBe(0);
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '100',
      baseQuantity: '100',
    });
  });

  it('a failed downstream relation reopens a reservation that the failed attempt had fully closed', async () => {
    const fixture = await buildFixture({ failLinkDocuments: true });
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '30',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
    const destination = await asActor(() =>
      fixture.service.createDraft({
        organizationId: fixture.organizationId,
        lines: [
          {
            itemId: fixture.itemId,
            warehouseId: fixture.warehouseId,
            quantity: '30',
            unitId: fixture.unitId,
          },
        ],
      }),
    );
    // A full-amount attempt that would have closed the reservation.
    await expect(
      asActor(() =>
        fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
          lineId,
          destinationModule: 'inventory',
          destinationDocumentType:
            MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
          destinationDocumentId: destination.id,
          quantity: '30',
        }),
      ),
    ).rejects.toThrow();

    // Reopened, not left `released` — the failed attempt never truly
    // happened, so the reservation must be exactly as it was before.
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '30',
      baseQuantity: '30',
    });
    const lines = await fixture.repository.listLines(materialRequestId);
    expect(lines[0]?.invokedBaseQuantity).toBe('0');
    expect(lines[0]?.invocationCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Concurrency/compensation audit round — the bug: a failed attempt's
  // compensation used to key off ITS OWN `closed` snapshot (did *I* close
  // the reservation?) to decide whether the current reservation status
  // "ought" to be `released` (reopen) or `active` (top up) — an invariant
  // a DIFFERENT, later, legitimate concurrent invocation can break simply
  // by doing its own, perfectly valid consumption in between. The fix:
  // compensation now always adds its own captured amount back to whatever
  // the CURRENT state is (never branching on the stale snapshot) and never
  // floors counters at zero, so unexpected negative results fail closed
  // instead of masking real corruption.
  // -------------------------------------------------------------------------
  it(
    'a failed attempt is compensated correctly even though a DIFFERENT, ' +
      'concurrent invocation legitimately closed the reservation in ' +
      'between (A consumes 60, B consumes the remaining 40 and closes it, ' +
      "THEN A's relation fails) — reproduces the compensation race",
    async () => {
      let resolveAReserved!: () => void;
      const aReserved = new Promise<void>((resolve) => {
        resolveAReserved = resolve;
      });
      let resolveBGate!: () => void;
      const bGate = new Promise<void>((resolve) => {
        resolveBGate = resolve;
      });

      const fixture = await buildFixture({
        // A's `reserveInvocationCapacity` has ALREADY committed (60 taken,
        // reservation down to 40) by the time `linkDocuments` runs — this
        // is exactly where the real failure window sits. Signal that, then
        // hold A open (genuinely in-flight, not yet failed) until the test
        // has driven B's entirely separate, independent invocation to full
        // completion — including closing the reservation — before A's
        // relation write is even attempted.
        beforeLinkDocuments: async (quantity) => {
          if (quantity === '60') {
            resolveAReserved();
            await bGate;
          }
        },
        failLinkDocumentsWhen: (quantity) => quantity === '60',
      });
      const { materialRequestId, lineId } = await createAndApprove(fixture, {
        quantity: '100',
        reservationRequested: true,
      });
      const [lineBefore] =
        await fixture.repository.listLines(materialRequestId);
      const reservationId = lineBefore!.reservationId!;
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
          fixture.service.invokeLine(
            materialRequestId,
            fixture.organizationId,
            {
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType:
                MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
              destinationDocumentId: destination.id,
              quantity,
            },
          ),
        );

      const aPromise = invoke('60');
      // Genuinely wait for A's OWN capacity reservation to have committed
      // (not merely for A to have "started") before B is even issued.
      await aReserved;
      // B is a completely independent, fully successful invocation that
      // races ahead of A and finishes entirely — including recording its
      // own audit event — while A is still sitting inside its (about to
      // fail) Document Relation call.
      await invoke('40');
      // Only now does A's relation attempt proceed, and fail.
      resolveBGate();

      await expect(aPromise).rejects.toThrow(
        'TEST DOUBLE: linkDocuments forced failure.',
      );

      const lines = await fixture.repository.listLines(materialRequestId);
      // B's successful 40 remains; A's 60 was fully compensated — never
      // simply "whatever didn't error", computed from CURRENT state.
      expect(lines[0]?.invokedBaseQuantity).toBe('40');
      expect(lines[0]?.invocationCount).toBe(1);
      // The reservation must be reopened (B's close undone by A's
      // restoration), holding exactly the still-uninvoked remainder — not
      // rejected as "drift" just because B legitimately changed it after
      // A's own forward commit.
      expect(fixture.repository.reservations.get(reservationId)).toEqual({
        id: reservationId,
        status: 'active',
        quantity: '60',
        baseQuantity: '60',
      });
      // Exactly one invocation event was ever recorded — B's. A's failed,
      // compensated attempt left no audit trace of a success that never
      // happened.
      const events = await fixture.repository.listEvents(materialRequestId);
      expect(
        events.filter((event) => event.eventType === 'line_invoked'),
      ).toHaveLength(1);
      // Both attempts reached the destination exactly once each — no
      // silent retry, no duplicate relation for either.
      expect(
        fixture.relationCalls.filter((call) => call === 'linkDocuments'),
      ).toHaveLength(2);
    },
  );

  it('cancellation and approval reversal remain blocked after a PARTIAL invocation, and the reservation still shows only the uninvoked remainder', async () => {
    const fixture = await buildFixture();
    const { materialRequestId, lineId } = await createAndApprove(fixture, {
      quantity: '100',
      reservationRequested: true,
    });
    const [lineBefore] = await fixture.repository.listLines(materialRequestId);
    const reservationId = lineBefore!.reservationId!;
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
    await asActor(() =>
      fixture.service.invokeLine(materialRequestId, fixture.organizationId, {
        lineId,
        destinationModule: 'inventory',
        destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION.code,
        destinationDocumentId: destination.id,
        quantity: '60',
      }),
    );

    // Owner decision (unchanged by this round): once ANY line has been
    // invoked, even partially, BOTH cancellation and approval reversal are
    // blocked for the whole request.
    await expect(
      asActor(() =>
        fixture.service.cancel(materialRequestId, fixture.organizationId, {}),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      asActor(() =>
        fixture.service.reverseApproval(
          materialRequestId,
          fixture.organizationId,
          {},
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });

    // The still-approved request's reservation reflects only the uninvoked
    // remainder (40), never the original 100 — it remains reserved and
    // invokable for whatever has not yet been carried downstream.
    expect(fixture.repository.reservations.get(reservationId)).toMatchObject({
      status: 'active',
      quantity: '40',
      baseQuantity: '40',
    });
    const current = await fixture.repository.findById(materialRequestId);
    expect(current?.status).toBe('approved');
  });
});
