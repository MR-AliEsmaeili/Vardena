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
 *
 * `reverseApproval` and `cancel` are the two operations that RELEASE a
 * reservation `approve` created (Owner decision: these are distinct,
 * separately-permissioned, separately-audited transitions — reversal goes
 * back to `submitted`, cancellation goes to the terminal `cancelled`); both
 * share `releaseActiveReservationsForLines` below and both refuse to run at
 * all if any line has already been invoked, checked under the SAME Material
 * Request row lock `reserveInvocationCapacity` takes — so neither can race a
 * concurrent first invocation.
 *
 * `reserveInvocationCapacity` is the THIRD, distinct way a reservation's
 * quantity moves (Owner decision, C-50 §3.8): every successful invocation of
 * a line that carries an ACTIVE reservation CONSUMES the invoked amount from
 * it — proportionally reducing `quantity`/`baseQuantity` while it stays
 * ACTIVE, or closing it (`status` → `released`) the moment it reaches
 * exactly zero. Unlike `reverseApproval`/`cancel` (which release an
 * UNCONSUMED claim back to available stock), consumption never happens more
 * than once per invocation and never returns anything to the pool — the
 * stock was carried into a downstream process, not given back. Invocation
 * itself remains partial and repeatable with no fixed count limit, and never
 * requires or implies a Warehouse Issue (C-52 remains a separate, later
 * task) — this module only ever draws down its OWN reservation claim.
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

export interface ReturnForCorrectionInput {
  id: string;
  organizationId: string;
  returnedAt: Date;
  returnedBy: string | null;
  reason: string;
}

export interface CancelInput {
  id: string;
  organizationId: string;
  cancelledAt: Date;
  cancelledBy: string | null;
  reason: string | null;
}

export class MaterialRequestStatusError extends Error {
  readonly current: string;
  readonly expected: readonly MaterialRequestStatus[];

  constructor(
    current: string,
    expected: MaterialRequestStatus | readonly MaterialRequestStatus[],
  ) {
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const expectedText =
      expectedList.length === 1
        ? `"${expectedList[0]}"`
        : expectedList.map((status) => `"${status}"`).join(' or ');
    super(
      `Material Request is "${current}", but this action requires ${expectedText}.`,
    );
    this.name = 'MaterialRequestStatusError';
    this.current = current;
    this.expected = expectedList;
  }
}

/** Thrown by `reverseApproval`/`cancel` when at least one line has already
 *  been invoked into a subsequent process — checked under the SAME
 *  Material Request row lock the invocation path itself takes
 *  (`reserveInvocationCapacity`), so this is race-free: a concurrent
 *  `invokeLine` call for this request can never slip in between the check
 *  and the release/cancel it guards. */
export class MaterialRequestLinesInvokedError extends Error {
  constructor() {
    super(
      'This action cannot be completed: at least one line has already ' +
        'been invoked into a subsequent process.',
    );
    this.name = 'MaterialRequestLinesInvokedError';
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
  /** The SAME magnitude, in the line's own entered unit (`line.unitId`) —
   *  the exact value the caller validated and converted via
   *  `multiplyDecimalStrings(invokedEntered, line.conversionFactor)` to
   *  produce `invokedBase`. Passed through, never re-derived here (C-50
   *  Owner decision: invocation uses the line's already-recorded
   *  conversion, it never re-resolves unit conversions from current master
   *  data), so the reservation's own entered-unit `quantity` column can be
   *  decremented by exactly this amount, in lockstep with `invokedBase`. */
  invokedEntered: string;
  now: Date;
  actorId: string | null;
}

/**
 * Exactly what one invocation attempt took from a line's ACTIVE reservation
 * (C-50 §3.8/Owner decision: every successful invocation consumes the
 * corresponding amount from the active reservation). `null` when the line
 * had no reservation at all — invocation then touches only the line's own
 * counters, never `inventory_reservations`/`inventory_balances`.
 *
 * Carried verbatim into `releaseInvocationCapacity` so a failed downstream
 * Document Relation write can compensate EXACTLY this amount (and reopen the
 * reservation if this attempt had closed it) without re-deriving anything
 * from the (by then mutated) stored state.
 */
export interface ReservationConsumptionResult {
  reservationId: string;
  /** Base-unit amount this attempt removed from the reservation. */
  consumedBase: string;
  /** Entered-unit amount this attempt removed from the reservation. */
  consumedEntered: string;
  /** `true` when this attempt reduced the reservation to exactly zero and
   *  therefore closed it (`status` → `released`); `false` for a partial
   *  consumption that left it ACTIVE with a smaller remaining quantity. */
  closed: boolean;
}

export interface InvocationCapacityResult {
  invokedBaseQuantity: string;
  remainingBaseQuantity: string;
  invocationCount: number;
  reservationConsumption: ReservationConsumptionResult | null;
}

export interface ReleaseInvocationCapacityInput {
  id: string;
  lineId: string;
  invokedBase: string;
  now: Date;
  actorId: string | null;
  /** The exact result `reserveInvocationCapacity` returned for the attempt
   *  being compensated — `null` when that attempt touched no reservation.
   *  Required to restore the reservation (and reopen it if this attempt had
   *  closed it) to precisely its pre-attempt state. */
  reservationConsumption: ReservationConsumptionResult | null;
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
   * Replace a draft's (or a returned-for-correction request's) header
   * fields and/or its full line set. Lines are replaced wholesale
   * (delete-then-recreate) rather than diffed — neither state has history
   * worth preserving at the line level yet, and this keeps the write shape
   * simple and race-free under the request's own row lock.
   *
   * @throws MaterialRequestStatusError when the request is neither a draft
   *   nor returned for correction.
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
      assertStatusIn(locked, ['draft', 'returned']);

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

  /**
   * Submit a draft for the first time, OR resubmit a request returned for
   * correction — the SAME action and the SAME allocated/replayed number
   * either way (Owner decision: "the requester must resubmit the corrected
   * request"; `fromStatus` on the recorded event is what tells the two
   * apart — see `material-request-event.ts`).
   *
   * @throws MaterialRequestStatusError when the request is neither a draft
   *   nor returned for correction.
   */
  async submit(input: SubmitInput): Promise<MaterialRequest> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatusIn(locked, ['draft', 'returned']);
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
          fromStatus: locked.status,
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
   * Return a submitted request to its requester for correction (Owner
   * decision: "the approver can return it to the requester for
   * correction"). The requester must edit and resubmit (`submit`, from
   * `returned`) before it can be approved, rejected, or returned again.
   *
   * @throws MaterialRequestStatusError when the request is not submitted.
   */
  async returnForCorrection(
    input: ReturnForCorrectionInput,
  ): Promise<MaterialRequest> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'submitted');
      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          status: 'returned',
          returnedAt: input.returnedAt,
          returnedBy: input.returnedBy,
          returnReason: input.reason,
          updatedAt: input.returnedAt,
          updatedBy: input.returnedBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'returned_for_correction',
          fromStatus: 'submitted',
          toStatus: 'returned',
          actorId: input.returnedBy,
          reason: input.reason,
          referenceId: null,
          occurredAt: input.returnedAt,
          createdAt: input.returnedAt,
        },
      });
      return toHeaderDomain(updated);
    });
  }

  /**
   * Reverse an approval: releases every ACTIVE reservation this approval
   * created, then moves the request back to `submitted` (NOT a terminal
   * state — it can be approved again, or rejected/returned).
   *
   * Refused outright (`MaterialRequestLinesInvokedError`) if any line has
   * already been invoked into a subsequent process — checked HERE, under
   * the same Material Request row lock `reserveInvocationCapacity` itself
   * takes, so this is fully race-free: a concurrent first-invocation of a
   * line cannot slip in between the check and the release (earlier versions
   * of this method checked outside the transaction, via
   * `documents.document_relations`, and accepted a race window; that
   * compromise is no longer necessary now that invocation state lives on
   * this module's own, lockable rows — see `material-request-line.ts`).
   *
   * @throws MaterialRequestStatusError when the request is not approved.
   * @throws MaterialRequestApproverMismatchError when `expectedApprovedBy`
   *   does not match the row's `approvedBy` under the lock.
   * @throws MaterialRequestLinesInvokedError when at least one line has
   *   already been invoked.
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
      if (lines.some((line) => line.invocationCount > 0)) {
        throw new MaterialRequestLinesInvokedError();
      }
      const releasedReservationIds = await releaseActiveReservationsForLines(
        tx,
        {
          lines,
          organizationId: input.organizationId,
          releasedAt: input.reversedAt,
          releasedBy: input.reversedBy,
          operationPrefix: `material-request-reverse:${input.id}`,
        },
      );

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
   * Cancel an APPROVED request outright — a DISTINCT, TERMINAL transition
   * from `reverseApproval` (Owner decision: "cancellation and reversal of
   * approval are distinct operations... with explicit, auditable state
   * transitions"). Releases every ACTIVE reservation the same way
   * `reverseApproval` does (reservations never represent anything
   * "consumed", only a soft claim — releasing one on cancellation never
   * undoes a real movement). Refused outright if any line has already been
   * invoked, even partially — checked under the SAME row lock as
   * `reverseApproval`/`reserveInvocationCapacity`, so this is race-free for
   * the same reason. Unlike `reverseApproval`, there is no
   * original-approver restriction: any caller holding
   * `Inventory.MaterialRequest.Cancel` may cancel (Owner decisions name no
   * actor restriction for cancellation, unlike reversal's explicit one).
   *
   * @throws MaterialRequestStatusError when the request is not approved.
   * @throws MaterialRequestLinesInvokedError when at least one line has
   *   already been invoked.
   */
  async cancel(
    input: CancelInput,
  ): Promise<{ header: MaterialRequest; releasedReservationIds: string[] }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockMaterialRequestRow(tx, input.id);
      assertStatus(locked, 'approved');

      const lines = await tx.materialRequestLine.findMany({
        where: { materialRequestId: input.id },
        orderBy: [{ lineNumber: 'asc' }],
      });
      if (lines.some((line) => line.invocationCount > 0)) {
        throw new MaterialRequestLinesInvokedError();
      }
      const releasedReservationIds = await releaseActiveReservationsForLines(
        tx,
        {
          lines,
          organizationId: input.organizationId,
          releasedAt: input.cancelledAt,
          releasedBy: input.cancelledBy,
          operationPrefix: `material-request-cancel:${input.id}`,
        },
      );

      const updated = await tx.materialRequest.update({
        where: { id: input.id },
        data: {
          status: 'cancelled',
          cancelledAt: input.cancelledAt,
          cancelledBy: input.cancelledBy,
          cancellationReason: input.reason,
          updatedAt: input.cancelledAt,
          updatedBy: input.cancelledBy,
        },
      });
      await tx.materialRequestEvent.create({
        data: {
          id: generateId(),
          materialRequestId: input.id,
          organizationId: input.organizationId,
          eventType: 'cancelled',
          fromStatus: 'approved',
          toStatus: 'cancelled',
          actorId: input.cancelledBy,
          reason: input.reason,
          referenceId: null,
          occurredAt: input.cancelledAt,
          createdAt: input.cancelledAt,
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
   * 1000-relation pagination cap) AND, when the line carries an ACTIVE
   * reservation, consume the identical amount from it in the SAME
   * transaction (Owner decision: "every successful invocation consumes the
   * corresponding amount from that active reservation"). A line with no
   * reservation is invoked exactly as before — only its own counters move.
   *
   * Locks the Material Request HEADER row for the lifetime of this
   * transaction — the same row every other mutating method here locks — so
   * two concurrent `invokeLine` calls (same line or not) always serialize:
   * the second one's read of `invoked_base_quantity` (and, when a
   * reservation exists, of the reservation row itself) is guaranteed to see
   * the first's committed state before it checks capacity. This is what
   * makes the cap race-free WITHOUT needing a lock on
   * `documents.document_relations` (a different module's table this
   * repository must never touch directly, AR-07) and without depending on
   * that table's page size at all: the authoritative total lives on this
   * line (and, when flagged, its reservation), not in a query over an
   * unbounded number of relation rows.
   *
   * Invocation is partial and repeatable with NO fixed count limit — a line
   * may be invoked any number of times as long as the cumulative total
   * never exceeds `baseQuantity`; the reservation (if any) is drawn down in
   * lockstep, one invocation at a time, and closed — never left ACTIVE with
   * a zero remaining quantity — the moment it reaches exactly zero.
   *
   * Reservation consumption, once the line's own capacity check passes:
   *   1. lock the reservation row (`FOR UPDATE`, the same primitive
   *      `approve`/`releaseActiveReservationsForLines` already use);
   *   2. defensively verify it is ACTIVE, strictly positive, and actually
   *      describes this line's own organization/branch/warehouse/item, and
   *      that it can cover the invoked amount — any mismatch is stored-data
   *      drift (ADR-0017), never a legitimate business outcome under this
   *      module's own arithmetic, so it fails closed with
   *      `BalanceDriftError` rather than silently tolerating or "fixing"
   *      the inconsistency;
   *   3. lock the corresponding balance row and decrement `reserved` by the
   *      consumed base quantity — `onHand` is NEVER touched here, because a
   *      reservation is a soft claim, not a movement, and invocation itself
   *      is traceability, not a Warehouse Issue (C-52 remains separate);
   *   4. reduce the reservation's own `quantity`/`baseQuantity` by the
   *      consumed entered/base amounts (the entered-unit amount is the
   *      caller's `invokedEntered`, NOT re-derived from current master
   *      data — the line's already-recorded `conversionFactor` is
   *      authoritative); if that reaches exactly zero, close it
   *      (`status` → `released`, with zeroed quantities — nothing is
   *      "released back" to available stock, it was consumed) instead of
   *      leaving an ACTIVE reservation with nothing left.
   *
   * The caller (`MaterialRequestsService.invokeLine`) must call this BEFORE
   * writing the Document Relation, and `releaseInvocationCapacity` to
   * compensate — restoring the line counters, the reservation's quantity,
   * and the balance's `reserved` counter, and reopening the reservation if
   * this attempt had closed it — if that write then fails: a failed
   * invocation must never have consumed capacity or reservation quantity.
   *
   * @throws MaterialRequestStatusError when the request is not approved.
   * @throws MaterialRequestLineNotFoundError when the line does not belong
   *   to this request (defense in depth — the caller already resolved it).
   * @throws MaterialRequestInvocationCapacityError when `invokedBase`
   *   exceeds what remains on the line.
   * @throws BalanceDriftError when the line's reservation (if any) does not
   *   describe this exact line, is not ACTIVE, has a non-positive or
   *   internally inconsistent quantity, cannot cover the invoked amount, or
   *   would drive `reserved` negative — every case is stored-data
   *   corruption, never a legitimate business outcome.
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

      let reservationConsumption: ReservationConsumptionResult | null = null;
      if (line.reservationId !== null) {
        const reservationLock = await lockReservationRow(
          tx,
          line.reservationId,
        );
        if (
          reservationLock === null ||
          reservationLock.status !== 'active' ||
          reservationLock.organizationId !== input.organizationId ||
          reservationLock.branchId !== line.branchId ||
          reservationLock.warehouseId !== line.warehouseId ||
          reservationLock.itemId !== line.itemId ||
          compareDecimalStrings(reservationLock.quantity, '0') <= 0 ||
          compareDecimalStrings(reservationLock.baseQuantity, '0') <= 0
        ) {
          throw new BalanceDriftError();
        }
        if (
          compareDecimalStrings(
            input.invokedBase,
            reservationLock.baseQuantity,
          ) > 0 ||
          compareDecimalStrings(
            input.invokedEntered,
            reservationLock.quantity,
          ) > 0
        ) {
          throw new BalanceDriftError();
        }

        const nextReservationBase = subtractDecimalStrings(
          reservationLock.baseQuantity,
          input.invokedBase,
        );
        const nextReservationQuantity = subtractDecimalStrings(
          reservationLock.quantity,
          input.invokedEntered,
        );
        const baseClosed =
          compareDecimalStrings(nextReservationBase, '0') === 0;
        const enteredClosed =
          compareDecimalStrings(nextReservationQuantity, '0') === 0;
        if (
          baseClosed !== enteredClosed ||
          compareDecimalStrings(nextReservationBase, '0') < 0 ||
          compareDecimalStrings(nextReservationQuantity, '0') < 0
        ) {
          // The entered/base pair drifted out of the proportional lockstep
          // this module's own arithmetic always maintains — a defect, not a
          // business outcome.
          throw new BalanceDriftError();
        }

        const { balance } = await lockBalanceRow(
          tx,
          {
            organizationId: reservationLock.organizationId,
            branchId: reservationLock.branchId,
            warehouseId: reservationLock.warehouseId,
            itemId: reservationLock.itemId,
          },
          input.actorId,
        );
        const resultingReserved = subtractDecimalStrings(
          balance.reserved,
          input.invokedBase,
        );
        if (compareDecimalStrings(resultingReserved, '0') < 0) {
          throw new BalanceDriftError();
        }

        // Globally unique (never reused, even across a compensated-and-
        // retried attempt on the same line) — this operation row is a pure
        // audit entry, never replayed by idempotency key, exactly like
        // `reservation_create`/`reservation_release` above.
        const consumeOperationKey = `material-request-invoke:${generateId()}`;
        if (baseClosed) {
          await tx.inventoryReservation.update({
            where: { id: line.reservationId },
            data: {
              status: 'released',
              quantity: '0',
              baseQuantity: '0',
              releasedAt: input.now,
              releasedBy: input.actorId,
              releaseOperationKey: consumeOperationKey,
              updatedAt: input.now,
              updatedBy: input.actorId,
            },
          });
        } else {
          await tx.inventoryReservation.update({
            where: { id: line.reservationId },
            data: {
              quantity: nextReservationQuantity,
              baseQuantity: nextReservationBase,
              updatedAt: input.now,
              updatedBy: input.actorId,
            },
          });
        }
        await adjustBalanceCounters(tx, {
          balanceId: balance.id,
          onHandDelta: '0',
          reservedDelta: `-${input.invokedBase}`,
          lastMovementAt: balance.lastMovementAt,
          updatedAt: input.now,
          updatedBy: input.actorId,
        });
        await tx.inventoryOperation.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            operationKey: consumeOperationKey,
            operation: 'reservation_consume',
            requestHash: sha256Hex(consumeOperationKey),
            result: {
              kind: 'reservation',
              reservationId: line.reservationId,
            },
            createdAt: input.now,
            updatedAt: input.now,
            createdBy: input.actorId,
          },
        });

        reservationConsumption = {
          reservationId: line.reservationId,
          consumedBase: input.invokedBase,
          consumedEntered: input.invokedEntered,
          closed: baseClosed,
        };
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
        reservationConsumption,
      };
    });
  }

  /**
   * Compensate an attempt made by `reserveInvocationCapacity` whose
   * Document Relation write then failed — the invocation never actually
   * happened, so it must not have consumed capacity, reservation quantity,
   * or balance `reserved`. No status assertion on purpose: a release must
   * always be allowed to run, even if the request's status moved on around
   * the failed attempt; the only invariant that matters is that nothing
   * this attempt never truly used stays consumed.
   *
   * Line counters are floored at zero as defense in depth against a
   * double-release. The reservation (when `reservationConsumption` is not
   * `null`) is restored EXACTLY — `consumedEntered`/`consumedBase` added
   * back, and, if this attempt had closed it, reopened (`status` → `active`,
   * `releasedAt`/`releasedBy`/`releaseOperationKey` cleared) — using the
   * caller-supplied amounts from the attempt being undone, never re-derived
   * from the (by now already-mutated) stored state. If the reservation's
   * observed state contradicts what this exact attempt should have left it
   * in, that is stored-data corruption, never something to paper over: it
   * fails closed with `BalanceDriftError` instead of forcing a value.
   */
  async releaseInvocationCapacity(
    input: ReleaseInvocationCapacityInput,
  ): Promise<void> {
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

      const consumption = input.reservationConsumption;
      if (consumption !== null) {
        const reservationLock = await lockReservationRow(
          tx,
          consumption.reservationId,
        );
        if (reservationLock === null) {
          // The reservation row itself is gone (FK prevents deletion in
          // practice) — nothing left to restore.
          return;
        }
        if (consumption.closed) {
          if (
            reservationLock.status !== 'released' ||
            compareDecimalStrings(reservationLock.quantity, '0') !== 0 ||
            compareDecimalStrings(reservationLock.baseQuantity, '0') !== 0
          ) {
            // This attempt is supposed to have been the one that closed the
            // reservation to zero; if it is not sitting exactly there now,
            // something else already changed it — do not force a value.
            throw new BalanceDriftError();
          }
          await tx.inventoryReservation.update({
            where: { id: consumption.reservationId },
            data: {
              status: 'active',
              quantity: consumption.consumedEntered,
              baseQuantity: consumption.consumedBase,
              releasedAt: null,
              releasedBy: null,
              releaseOperationKey: null,
              updatedAt: input.now,
              updatedBy: input.actorId,
            },
          });
        } else {
          if (reservationLock.status !== 'active') {
            throw new BalanceDriftError();
          }
          await tx.inventoryReservation.update({
            where: { id: consumption.reservationId },
            data: {
              quantity: addDecimalStrings(
                reservationLock.quantity,
                consumption.consumedEntered,
              ),
              baseQuantity: addDecimalStrings(
                reservationLock.baseQuantity,
                consumption.consumedBase,
              ),
              updatedAt: input.now,
              updatedBy: input.actorId,
            },
          });
        }
        const { balance } = await lockBalanceRow(
          tx,
          {
            organizationId: reservationLock.organizationId,
            branchId: reservationLock.branchId,
            warehouseId: reservationLock.warehouseId,
            itemId: reservationLock.itemId,
          },
          input.actorId,
        );
        await adjustBalanceCounters(tx, {
          balanceId: balance.id,
          onHandDelta: '0',
          reservedDelta: consumption.consumedBase,
          lastMovementAt: balance.lastMovementAt,
          updatedAt: input.now,
          updatedBy: input.actorId,
        });
      }
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

/**
 * Shared by `reverseApproval` and `cancel`: release every ACTIVE reservation
 * among `lines`, under the caller's own transaction/row lock. A reservation
 * never represents anything physically consumed (it never touches
 * `on_hand`), so releasing it here — for either operation — is always safe
 * once the caller has already established no line has been invoked.
 *
 * Idempotent against an already-released (or, defensively, missing)
 * reservation: both are silently skipped, never an error — the same
 * tolerance the original `reverseApproval` implementation had.
 *
 * @throws BalanceDriftError if releasing a reservation would drive
 *   `reserved` negative (defense in depth; should never happen under this
 *   module's own locked arithmetic).
 */
async function releaseActiveReservationsForLines(
  tx: MrTxClient,
  input: {
    lines: readonly { id: string; reservationId: string | null }[];
    organizationId: string;
    releasedAt: Date;
    releasedBy: string | null;
    /** Unique per call (embeds the request id and which operation this is,
     *  e.g. `material-request-reverse:<id>` or `material-request-cancel:<id>`);
     *  combined with each line's id for `inventory_operations.operation_key`. */
    operationPrefix: string;
  },
): Promise<string[]> {
  const releasedReservationIds: string[] = [];
  for (const line of input.lines) {
    if (line.reservationId === null) continue;
    const reservationLock = await lockReservationRow(tx, line.reservationId);
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
      input.releasedBy,
    );
    const resultingReserved = subtractDecimalStrings(
      balance.reserved,
      reservationLock.baseQuantity,
    );
    if (compareDecimalStrings(resultingReserved, '0') < 0) {
      throw new BalanceDriftError();
    }
    const releaseOperationKey = `${input.operationPrefix}:${line.id}`;
    await tx.inventoryReservation.update({
      where: { id: line.reservationId },
      data: {
        status: 'released',
        releasedAt: input.releasedAt,
        releasedBy: input.releasedBy,
        releaseOperationKey,
        updatedAt: input.releasedAt,
        updatedBy: input.releasedBy,
      },
    });
    await adjustBalanceCounters(tx, {
      balanceId: balance.id,
      onHandDelta: '0',
      reservedDelta: `-${reservationLock.baseQuantity}`,
      lastMovementAt: balance.lastMovementAt,
      updatedAt: input.releasedAt,
      updatedBy: input.releasedBy,
    });
    await tx.inventoryOperation.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        operationKey: releaseOperationKey,
        operation: 'reservation_release',
        requestHash: sha256Hex(releaseOperationKey),
        result: { kind: 'reservation', reservationId: line.reservationId },
        createdAt: input.releasedAt,
        updatedAt: input.releasedAt,
        createdBy: input.releasedBy,
      },
    });
    releasedReservationIds.push(line.reservationId);
  }
  return releasedReservationIds;
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
  assertStatusIn(locked, [expected]);
}

/** Same as `assertStatus`, but accepts more than one acceptable current
 *  status — used by `submit` (first submission from `draft`, or
 *  resubmission from `returned`) and `updateDraft` (editable while `draft`
 *  OR `returned`). */
function assertStatusIn(
  locked: LockedMaterialRequestRow,
  expected: readonly MaterialRequestStatus[],
): void {
  if (!(expected as readonly string[]).includes(locked.status)) {
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
  returnedAt: Date | null;
  returnedBy: string | null;
  returnReason: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: Date | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
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
    returnedAt: row.returnedAt,
    returnedBy: row.returnedBy,
    returnReason: row.returnReason,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    rejectedAt: row.rejectedAt,
    rejectedBy: row.rejectedBy,
    rejectionReason: row.rejectionReason,
    approvalReversedAt: row.approvalReversedAt,
    approvalReversedBy: row.approvalReversedBy,
    approvalReversalReason: row.approvalReversalReason,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    cancellationReason: row.cancellationReason,
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
