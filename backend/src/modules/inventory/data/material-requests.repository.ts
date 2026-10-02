import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from '../domain/quantities.js';
import { violatesNegativePolicy } from '../domain/negative-stock-policy.js';
import type {
  MaterialRequest,
  MaterialRequestStatus,
} from '../domain/material-request.js';
import { isMaterialRequestStatus } from '../domain/material-request.js';
import type { MaterialRequestLine } from '../domain/material-request-line.js';
import type { MaterialRequestEvent } from '../domain/material-request-event.js';
import { isMaterialRequestEventType } from '../domain/material-request-event.js';
import {
  BalanceDriftError,
  ReservationAvailabilityError,
} from './inventory-posting-errors.js';
import {
  adjustBalanceCounters,
  lockBalanceRow,
  lockReservationRow,
} from './inventory-locks.js';
import { decimalToString, type DecimalLike } from './inventory-core-rows.js';
import type {
  MaterialRequestLineCreate,
  MrClient,
  MrTransactionalClient,
  MrTxClient,
} from './material-request-rows.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for Material Request (C-50).
 *
 * Mirrors the Inventory core's own transactional discipline
 * (`InventoryReservationsRepository`): every write that must be atomic owns
 * ONE `$transaction`, and the Material Request row (or, for lines, the lines
 * of one request) is locked for its lifetime via `SELECT … FOR UPDATE` —
 * Prisma cannot express that lock, hence the raw statement, same rule as
 * `inventory-locks.ts`.
 *
 * `approve` is the one method that also touches the inventory core's own
 * tables (`inventory_balances`, `inventory_reservations`,
 * `inventory_operations`): it reuses the SAME low-level primitives
 * (`lockBalanceRow`, `adjustBalanceCounters`, `ReservationAvailabilityError`)
 * `InventoryReservationsRepository.createReservation` uses, inlined into this
 * transaction instead of calling that repository (which opens its own,
 * non-composable transaction) — this is what makes "approve the header AND
 * reserve every flagged line" one atomic unit (C-50 blocker #1): any line's
 * insufficient stock rolls back the WHOLE approval, never a partial one.
 */

export interface MaterialRequestListFilter {
  organizationId: string;
  status?: string | undefined;
  requestedBy?: string | undefined;
}

export interface CreateDraftHeaderInput {
  id: string;
  organizationId: string;
  description: string | null;
  requestedBy: string;
  createdAt: Date;
  createdBy: string | null;
}

export interface DraftLineInput {
  id: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  branchId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  reservationRequested: boolean;
}

export interface UpdateDraftHeaderInput {
  description?: string | null | undefined;
}

export interface SubmitInput {
  id: string;
  organizationId: string;
  number: string;
  submittedAt: Date;
  submittedBy: string | null;
}

export interface ApproveLineInput {
  lineId: string;
  itemId: string;
  warehouseId: string;
  branchId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  allowNegative: boolean;
}

export interface ApproveInput {
  id: string;
  organizationId: string;
  approvedAt: Date;
  approvedBy: string | null;
  /** Only the lines with `reservationRequested = true`, already sorted by
   *  the caller in a deterministic (warehouseId, itemId) order so concurrent
   *  approvals of overlapping keys acquire their balance locks in the same
   *  order and can never deadlock. */
  reservationLines: ApproveLineInput[];
}

export interface RejectInput {
  id: string;
  organizationId: string;
  rejectedAt: Date;
  rejectedBy: string | null;
  reason: string;
}

export interface ReverseApprovalInput {
  id: string;
  organizationId: string;
  /** The approver this reversal must match (C-50 §3.4); checked again under
   *  the row lock so a race against a fresh approval can never slip through. */
  expectedApprovedBy: string | null;
  reversedAt: Date;
  reversedBy: string | null;
  reason: string | null;
}

export class MaterialRequestStatusError extends Error {
  readonly current: string;
  readonly expected: MaterialRequestStatus;

  constructor(current: string, expected: MaterialRequestStatus) {
    super(
      `Material Request is "${current}", but this action requires "${expected}".`,
    );
    this.name = 'MaterialRequestStatusError';
    this.current = current;
    this.expected = expected;
  }
}

export class MaterialRequestApproverMismatchError extends Error {
  constructor() {
    super('Only the original approver may reverse this approval.');
    this.name = 'MaterialRequestApproverMismatchError';
  }
}

export class MaterialRequestLineNotFoundError extends Error {
  readonly lineId: string;

  constructor(lineId: string) {
    super(`Material Request line "${lineId}" does not exist on this request.`);
    this.name = 'MaterialRequestLineNotFoundError';
    this.lineId = lineId;
  }
}

/** Thrown by `reserveInvocationCapacity` when the requested amount exceeds
 *  what remains on the line — read under the SAME lock as the increment, so
 *  this is never racing a concurrent invocation of the same line. */
export class MaterialRequestInvocationCapacityError extends Error {
  readonly remaining: string;
  readonly requested: string;

  constructor(input: { remaining: string; requested: string }) {
    super(
      `The invoked quantity ${input.requested} exceeds the ${input.remaining} still remaining on this line.`,
    );
    this.name = 'MaterialRequestInvocationCapacityError';
    this.remaining = input.remaining;
    this.requested = input.requested;
  }
}

export interface ReserveInvocationCapacityInput {
  id: string;
  organizationId: string;
  lineId: string;
  /** Base-unit magnitude being invoked now. Decimal string, always > 0 —
   *  validated by the caller before this is reached. */
  invokedBase: string;
  now: Date;
  actorId: string | null;
}

export interface InvocationCapacityResult {
  invokedBaseQuantity: string;
  remainingBaseQuantity: string;
  invocationCount: number;
}

@Injectable()
export class MaterialRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<MrClient> {
    return this.prisma.getClient<MrClient>();
  }

  private transacting(): Promise<MrTransactionalClient> {
    return this.prisma.getClient<MrTransactionalClient>();
  }

  // ---- reads ----------------------------------------------------------------

  async findById(id: string): Promise<MaterialRequest | null> {
    const { materialRequest } = await this.client();
    const row = await materialRequest.findUnique({ where: { id } });
    return row === null ? null : toHeaderDomain(row);
  }

  async list(params: {
    where: MaterialRequestListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: MaterialRequest[]; total: number }> {
    const { materialRequest } = await this.client();
    const where = {
      organizationId: params.where.organizationId,
      ...(params.where.status === undefined
        ? {}
        : { status: params.where.status }),
      ...(params.where.requestedBy === undefined
        ? {}
        : { requestedBy: params.where.requestedBy }),
    };
    const [rows, total] = await Promise.all([
      materialRequest.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      materialRequest.count({ where }),
    ]);
    return { items: rows.map(toHeaderDomain), total };
  }

  async listLines(materialRequestId: string): Promise<MaterialRequestLine[]> {
    const { materialRequestLine } = await this.client();
    const rows = await materialRequestLine.findMany({
      where: { materialRequestId },
      orderBy: [{ lineNumber: 'asc' }],
    });
    return rows.map(toLineDomain);
  }

  async listEvents(materialRequestId: string): Promise<MaterialRequestEvent[]> {
    const { materialRequestEvent } = await this.client();
    const rows = await materialRequestEvent.findMany({
      where: { materialRequestId },
      orderBy: [{ occurredAt: 'asc' }],
    });
    return rows.map(toEventDomain);
  }

  // ---- draft authoring --------------------------------------------------

  /** Create the header, its lines, and the `created` event in one transaction. */
  async createDraft(
    header: CreateDraftHeaderInput,
    lines: DraftLineInput[],
  ): Promise<{ header: MaterialRequest; lines: MaterialRequestLine[] }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const createdHeader = await tx.materialRequest.create({
        data: {
          id: header.id,
          organizationId: header.organizationId,
          number: null,
          status: 'draft',
          description: header.description,
          requestedBy: header.requestedBy,
          createdAt: header.createdAt,
          updatedAt: header.createdAt,
          createdBy: header.createdBy,
        },
      });
      const createdLines: MaterialRequestLine[] = [];
      for (const line of lines) {
        createdLines.push(
          toLineDomain(
            await tx.materialRequestLine.create({
              data: lineCreateData(header, line),
            }),
          ),
        );
      }
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: header.id,
          organizationId: header.organizationId,
          eventType: 'created',
          fromStatus: null,
          toStatus: 'draft',
          actorId: header.createdBy,
          reason: null,
          referenceId: null,
          occurredAt: header.createdAt,
          createdAt: header.createdAt,
        },
      });
      return { header: toHeaderDomain(createdHeader), lines: createdLines };
    });
  }

  /**
   * Replace a draft's header fields and/or its full line set. Lines are
   * replaced wholesale (delete-then-recreate) rather than diffed — a draft
   * has no history to preserve yet, and this keeps the write shape simple
   * and race-free under the request's own row lock.
   *
   * @throws MaterialRequestStatusError when the request is not a draft.
   */
  async updateDraft(input: {
    id: string;
    organizationId: string;
    header: UpdateDraftHeaderInput;
    lines: DraftLineInput[] | undefined;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<{ header: MaterialRequest; lines: MaterialRequestLine[] }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'draft');

      if (input.header.description !== undefined) {
        await tx.materialRequest.update({
          where: { id: input.id },
          data: {
            description: input.header.description,
            updatedAt: input.updatedAt,
            updatedBy: input.updatedBy,
          },
        });
      }

      let lines: MaterialRequestLine[];
      if (input.lines === undefined) {
        lines = (
          await tx.materialRequestLine.findMany({
            where: { materialRequestId: input.id },
            orderBy: [{ lineNumber: 'asc' }],
          })
        ).map(toLineDomain);
      } else {
        await tx.materialRequestLine.deleteMany({
          where: { materialRequestId: input.id },
        });
        lines = [];
        for (const line of input.lines) {
          lines.push(
            toLineDomain(
              await tx.materialRequestLine.create({
                data: lineCreateData(
                  {
                    id: input.id,
                    organizationId: input.organizationId,
                    createdAt: input.updatedAt,
                    createdBy: input.updatedBy,
                  },
                  line,
                ),
              }),
            ),
          );
        }
      }

      const header = await tx.materialRequest.findUnique({
        where: { id: input.id },
      });
      if (header === null) {
        throw new Error(`Material Request "${input.id}" vanished mid-update.`);
      }
      return { header: toHeaderDomain(header), lines };
    });
  }

  /** @throws MaterialRequestStatusError when the request is not a draft. */
  async deleteDraft(id: string): Promise<void> {
    const client = await this.transacting();
    await client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, id);
      assertStatus(locked, 'draft');
      await tx.materialRequestLine.deleteMany({
        where: { materialRequestId: id },
      });
      await tx.materialRequestEvent.deleteMany({
        where: { materialRequestId: id },
      });
      await tx.materialRequest.delete({ where: { id } });
    });
  }

  // ---- lifecycle ----------------------------------------------------------

  /** @throws MaterialRequestStatusError when the request is not a draft. */
  async submit(input: SubmitInput): Promise<MaterialRequest> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'draft');
      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          number: input.number,
          status: 'submitted',
          submittedAt: input.submittedAt,
          submittedBy: input.submittedBy,
          updatedAt: input.submittedAt,
          updatedBy: input.submittedBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'submitted',
          fromStatus: 'draft',
          toStatus: 'submitted',
          actorId: input.submittedBy,
          reason: null,
          referenceId: null,
          occurredAt: input.submittedAt,
          createdAt: input.submittedAt,
        },
      });
      return toHeaderDomain(updated);
    });
  }

  /**
   * Approve the request AND reserve every flagged line, atomically (C-50
   * blocker #1): any line's insufficient stock throws and rolls back the
   * header transition and every reservation already staged in this call.
   *
   * @throws MaterialRequestStatusError when the request is not submitted.
   * @throws ReservationAvailabilityError when a flagged line cannot be
   *   reserved under its effective negative-stock policy.
   */
  async approve(
    input: ApproveInput,
  ): Promise<{ header: MaterialRequest; reservationIds: Map<string, string> }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'submitted');

      const reservationIds = new Map<string, string>();
      for (const line of input.reservationLines) {
        const { balance } = await lockBalanceRow(
          tx,
          {
            organizationId: input.organizationId,
            branchId: line.branchId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
          },
          input.approvedBy,
        );
        const resultingReserved = addDecimalStrings(
          balance.reserved,
          line.baseQuantity,
        );
        const resultingAvailable = subtractDecimalStrings(
          balance.onHand,
          resultingReserved,
        );
        if (violatesNegativePolicy(resultingAvailable, line.allowNegative)) {
          throw new ReservationAvailabilityError({
            available: subtractDecimalStrings(balance.onHand, balance.reserved),
            requested: line.baseQuantity,
          });
        }
        const reservationId = generateId();
        const operationKey = `material-request-approve:${input.id}:${line.lineId}`;
        await tx.inventoryReservation.create({
          data: {
            id: reservationId,
            organizationId: input.organizationId,
            branchId: line.branchId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            quantity: line.quantity,
            unitId: line.unitId,
            baseQuantity: line.baseQuantity,
            baseUnitId: line.baseUnitId,
            conversionFactor: line.conversionFactor,
            status: 'active',
            referenceType: 'material_request_line',
            referenceId: line.lineId,
            reason: null,
            operationKey,
            releasedAt: null,
            releasedBy: null,
            releaseOperationKey: null,
            createdAt: input.approvedAt,
            updatedAt: input.approvedAt,
            createdBy: input.approvedBy,
          },
        });
        await adjustBalanceCounters(tx, {
          balanceId: balance.id,
          onHandDelta: '0',
          reservedDelta: line.baseQuantity,
          lastMovementAt: balance.lastMovementAt,
          updatedAt: input.approvedAt,
          updatedBy: input.approvedBy,
        });
        await tx.inventoryOperation.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            operationKey,
            operation: 'reservation_create',
            requestHash: sha256Hex(operationKey),
            result: { kind: 'reservation', reservationId },
            createdAt: input.approvedAt,
            updatedAt: input.approvedAt,
            createdBy: input.approvedBy,
          },
        });
        await tx.materialRequestLine.update({
          where: { id: line.lineId },
          data: {
            reservationId,
            updatedAt: input.approvedAt,
            updatedBy: input.approvedBy,
          },
        });
        reservationIds.set(line.lineId, reservationId);
      }

      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          status: 'approved',
          approvedAt: input.approvedAt,
          approvedBy: input.approvedBy,
          updatedAt: input.approvedAt,
          updatedBy: input.approvedBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'approved',
          fromStatus: 'submitted',
          toStatus: 'approved',
          actorId: input.approvedBy,
          reason: null,
          referenceId: null,
          occurredAt: input.approvedAt,
          createdAt: input.approvedAt,
        },
      });
      return { header: toHeaderDomain(updated), reservationIds };
    });
  }

  /** @throws MaterialRequestStatusError when the request is not submitted. */
  async reject(input: RejectInput): Promise<MaterialRequest> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'submitted');
      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          status: 'rejected',
          rejectedAt: input.rejectedAt,
          rejectedBy: input.rejectedBy,
          rejectionReason: input.reason,
          updatedAt: input.rejectedAt,
          updatedBy: input.rejectedBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'rejected',
          fromStatus: 'submitted',
          toStatus: 'rejected',
          actorId: input.rejectedBy,
          reason: input.reason,
          referenceId: null,
          occurredAt: input.rejectedAt,
          createdAt: input.rejectedAt,
        },
      });
      return toHeaderDomain(updated);
    });
  }

  /**
   * Reverse an approval: releases every ACTIVE reservation this approval
   * created, then moves the request back to `submitted`.
   *
   * The caller (`MaterialRequestsService`) has already verified, outside this
   * transaction, that NO line has been invoked yet (C-50 §3.4's "must not
   * silently permit reversal if it would invalidate a downstream
   * invocation") — that check reads `documents.document_relations` through
   * `DocumentRelationsService`, a different module's own transaction, so it
   * cannot be composed into this one. A reversal racing a concurrent
   * first-invocation of a line is an accepted, documented gap (the same
   * category as the already-accepted non-atomicity of numbering allocation
   * and invocation-cap checking) — not a silent one: it is reported in the
   * final report, not hidden.
   *
   * @throws MaterialRequestStatusError when the request is not approved.
   * @throws MaterialRequestApproverMismatchError when `expectedApprovedBy`
   *   does not match the row's `approvedBy` under the lock.
   */
  async reverseApproval(
    input: ReverseApprovalInput,
  ): Promise<{ header: MaterialRequest; releasedReservationIds: string[] }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'approved');
      if (locked.approvedBy !== input.expectedApprovedBy) {
        throw new MaterialRequestApproverMismatchError();
      }

      const lines = await tx.materialRequestLine.findMany({
        where: { materialRequestId: input.id },
        orderBy: [{ lineNumber: 'asc' }],
      });
      const releasedReservationIds: string[] = [];
      for (const line of lines) {
        if (line.reservationId === null) continue;
        const reservationLock = await lockReservationRow(
          tx,
          line.reservationId,
        );
        if (reservationLock === null || reservationLock.status !== 'active') {
          // Already released (or, defensively, missing) — nothing to undo.
          continue;
        }
        const { balance } = await lockBalanceRow(
          tx,
          {
            organizationId: reservationLock.organizationId,
            branchId: reservationLock.branchId,
            warehouseId: reservationLock.warehouseId,
            itemId: reservationLock.itemId,
          },
          input.reversedBy,
        );
        const resultingReserved = subtractDecimalStrings(
          balance.reserved,
          reservationLock.baseQuantity,
        );
        if (compareDecimalStrings(resultingReserved, '0') < 0) {
          throw new BalanceDriftError();
        }
        const releaseOperationKey = `material-request-reverse:${input.id}:${line.id}`;
        await tx.inventoryReservation.update({
          where: { id: line.reservationId },
          data: {
            status: 'released',
            releasedAt: input.reversedAt,
            releasedBy: input.reversedBy,
            releaseOperationKey,
            updatedAt: input.reversedAt,
            updatedBy: input.reversedBy,
          },
        });
        await adjustBalanceCounters(tx, {
          balanceId: balance.id,
          onHandDelta: '0',
          reservedDelta: `-${reservationLock.baseQuantity}`,
          lastMovementAt: balance.lastMovementAt,
          updatedAt: input.reversedAt,
          updatedBy: input.reversedBy,
        });
        await tx.inventoryOperation.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            operationKey: releaseOperationKey,
            operation: 'reservation_release',
            requestHash: sha256Hex(releaseOperationKey),
            result: { kind: 'reservation', reservationId: line.reservationId },
            createdAt: input.reversedAt,
            updatedAt: input.reversedAt,
            createdBy: input.reversedBy,
          },
        });
        releasedReservationIds.push(line.reservationId);
      }

      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          status: 'submitted',
          approvalReversedAt: input.reversedAt,
          approvalReversedBy: input.reversedBy,
          approvalReversalReason: input.reason,
          updatedAt: input.reversedAt,
          updatedBy: input.reversedBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'approval_reversed',
          fromStatus: 'approved',
          toStatus: 'submitted',
          actorId: input.reversedBy,
          reason: input.reason,
          referenceId: null,
          occurredAt: input.reversedAt,
          createdAt: input.reversedAt,
        },
      });
      return {
        header: toHeaderDomain(updated),
        releasedReservationIds,
      };
    });
  }

  /**
   * Atomically reserve `invokedBase` units of one line's remaining
   * invocation capacity (C-50 §3.8, review finding #4 — concurrency and the
   * 1000-relation pagination cap).
   *
   * Locks the Material Request HEADER row for the lifetime of this
   * transaction — the same row every other mutating method here locks — so
   * two concurrent `invokeLine` calls (same line or not) always serialize:
   * the second one's read of `invoked_base_quantity` is guaranteed to see
   * the first's committed increment before it checks the cap. This is what
   * makes the cap race-free WITHOUT needing a lock on
   * `documents.document_relations` (a different module's table this
   * repository must never touch directly, AR-07) and without depending on
   * that table's page size at all: the authoritative total lives on this
   * line, not in a query over an unbounded number of relation rows.
   *
   * The caller (`MaterialRequestsService.invokeLine`) must call this BEFORE
   * writing the Document Relation, and `releaseInvocationCapacity` to
   * compensate if that write then fails — a failed invocation must never
   * have consumed capacity.
   *
   * @throws MaterialRequestStatusError when the request is not approved.
   * @throws MaterialRequestLineNotFoundError when the line does not belong
   *   to this request (defense in depth — the caller already resolved it).
   * @throws MaterialRequestInvocationCapacityError when `invokedBase`
   *   exceeds what remains on the line.
   */
  async reserveInvocationCapacity(
    input: ReserveInvocationCapacityInput,
  ): Promise<InvocationCapacityResult> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'approved');
      const line = await tx.materialRequestLine.findUnique({
        where: { id: input.lineId },
      });
      if (line === null || line.materialRequestId !== input.id) {
        throw new MaterialRequestLineNotFoundError(input.lineId);
      }
      const invokedSoFar = decimalToString(line.invokedBaseQuantity);
      const remaining = subtractDecimalStrings(
        decimalToString(line.baseQuantity),
        invokedSoFar,
      );
      if (compareDecimalStrings(input.invokedBase, remaining) > 0) {
        throw new MaterialRequestInvocationCapacityError({
          remaining,
          requested: input.invokedBase,
        });
      }
      const nextInvoked = addDecimalStrings(invokedSoFar, input.invokedBase);
      const nextCount = line.invocationCount + 1;
      await tx.materialRequestLine.update({
        where: { id: input.lineId },
        data: {
          invokedBaseQuantity: nextInvoked,
          invocationCount: nextCount,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
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

  /**
   * Compensate a reservation made by `reserveInvocationCapacity` whose
   * Document Relation write then failed — the invocation never actually
   * happened, so it must not have consumed capacity. No status assertion on
   * purpose: a release must always be allowed to run, even if the request's
   * status moved on around the failed attempt; the only invariant that
   * matters is that capacity this attempt never truly used is given back.
   * Floors at zero as defense in depth against a double-release.
   */
  async releaseInvocationCapacity(input: {
    id: string;
    lineId: string;
    invokedBase: string;
    now: Date;
    actorId: string | null;
  }): Promise<void> {
    const client = await this.transacting();
    await client.$transaction(async (tx) => {
      await lockMaterialRequestRow(tx, input.id);
      const line = await tx.materialRequestLine.findUnique({
        where: { id: input.lineId },
      });
      if (line === null || line.materialRequestId !== input.id) {
        // The reservation could not have been made against a line that
        // does not exist — nothing to release.
        return;
      }
      const invokedSoFar = decimalToString(line.invokedBaseQuantity);
      const restored = subtractDecimalStrings(invokedSoFar, input.invokedBase);
      const flooredRestored =
        compareDecimalStrings(restored, '0') < 0 ? '0' : restored;
      await tx.materialRequestLine.update({
        where: { id: input.lineId },
        data: {
          invokedBaseQuantity: flooredRestored,
          invocationCount: Math.max(line.invocationCount - 1, 0),
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
    });
  }

  /** Record an invocation event (C-50 §3.8) — the relation itself is created
   *  by `DocumentRelationsService`; this only appends the audit row. */
  async recordInvocationEvent(input: {
    materialRequestId: string;
    organizationId: string;
    actorId: string | null;
    occurredAt: Date;
    relationId: string;
  }): Promise<void> {
    const { materialRequestEvent } = await this.client();
    await materialRequestEvent.create({
      data: {
        id: generateId(),
        materialRequestId: input.materialRequestId,
        organizationId: input.organizationId,
        eventType: 'line_invoked',
        fromStatus: null,
        toStatus: null,
        actorId: input.actorId,
        reason: null,
        referenceId: input.relationId,
        occurredAt: input.occurredAt,
        createdAt: input.occurredAt,
      },
    });
  }
}

// ---- Internal helpers ------------------------------------------------------

/**
 * `inventory_operations.request_hash` is `CHAR(64)` (a sha256 hex digest)
 * everywhere else in this module. These two operations are never retried
 * under a reused key (approval/reversal are one-shot, gated by the Material
 * Request's own status, not by idempotency replay) — the exact deterministic
 * `operationKey` itself is what is hashed, purely to fill the column with a
 * value of the expected shape for any reconciliation tooling that reads it.
 */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface LockedMaterialRequestRow {
  id: string;
  status: string;
  approvedBy: string | null;
}

/**
 * Lock the Material Request row for the lifetime of the caller's
 * transaction. Prisma cannot express `SELECT … FOR UPDATE`, same rule as
 * `inventory-locks.ts`.
 */
async function lockMaterialRequestRow(
  tx: MrTxClient,
  id: string,
): Promise<LockedMaterialRequestRow> {
  const rows = await tx.$queryRaw<LockedMaterialRequestRow>`
    SELECT "id", "status", "approved_by" AS "approvedBy"
      FROM "inventory"."material_requests"
     WHERE "id" = ${id}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Material Request "${id}" does not exist.`);
  }
  return row;
}

function assertStatus(
  locked: LockedMaterialRequestRow,
  expected: MaterialRequestStatus,
): void {
  if (locked.status !== expected) {
    throw new MaterialRequestStatusError(locked.status, expected);
  }
}

function lineCreateData(
  header: {
    id: string;
    organizationId: string;
    createdAt: Date;
    createdBy: string | null;
  },
  line: DraftLineInput,
): MaterialRequestLineCreate {
  return {
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
    createdBy: header.createdBy,
  };
}

function toHeaderDomain(row: {
  id: string;
  organizationId: string;
  number: string | null;
  status: string;
  description: string | null;
  requestedBy: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: Date | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MaterialRequest {
  if (!isMaterialRequestStatus(row.status)) {
    throw new Error(
      `Stored Material Request "${row.id}" has an unknown status "${row.status}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    number: row.number,
    status: row.status,
    description: row.description,
    requestedBy: row.requestedBy,
    submittedAt: row.submittedAt,
    submittedBy: row.submittedBy,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    rejectedAt: row.rejectedAt,
    rejectedBy: row.rejectedBy,
    rejectionReason: row.rejectionReason,
    approvalReversedAt: row.approvalReversedAt,
    approvalReversedBy: row.approvalReversedBy,
    approvalReversalReason: row.approvalReversalReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLineDomain(row: {
  id: string;
  materialRequestId: string;
  organizationId: string;
  branchId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  quantity: DecimalLike;
  unitId: string;
  baseQuantity: DecimalLike;
  baseUnitId: string;
  conversionFactor: DecimalLike;
  reservationRequested: boolean;
  reservationId: string | null;
  invokedBaseQuantity: DecimalLike;
  invocationCount: number;
  createdAt: Date;
  updatedAt: Date;
}): MaterialRequestLine {
  return {
    id: row.id,
    materialRequestId: row.materialRequestId,
    organizationId: row.organizationId,
    branchId: row.branchId,
    lineNumber: row.lineNumber,
    itemId: row.itemId,
    warehouseId: row.warehouseId,
    quantity: decimalToString(row.quantity),
    unitId: row.unitId,
    baseQuantity: decimalToString(row.baseQuantity),
    baseUnitId: row.baseUnitId,
    conversionFactor: decimalToString(row.conversionFactor),
    reservationRequested: row.reservationRequested,
    reservationId: row.reservationId,
    invokedBaseQuantity: decimalToString(row.invokedBaseQuantity),
    invocationCount: row.invocationCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEventDomain(row: {
  id: string;
  materialRequestId: string;
  organizationId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdAt: Date;
}): MaterialRequestEvent {
  if (!isMaterialRequestEventType(row.eventType)) {
    throw new Error(
      `Stored Material Request event "${row.id}" has an unknown type "${row.eventType}".`,
    );
  }
  return {
    id: row.id,
    materialRequestId: row.materialRequestId,
    organizationId: row.organizationId,
    eventType: row.eventType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorId: row.actorId,
    reason: row.reason,
    referenceId: row.referenceId,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}
