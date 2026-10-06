import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { InventoryPricingRepository } from '../data/inventory-pricing.repository.js';
import { InventoryValuationRepository } from '../data/inventory-valuation.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import { insertOperationRow } from '../data/inventory-operations.repository.js';
import { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import { lockValuationStateRowsInOrder } from '../data/inventory-locks.js';
import { RecalculationTooLargeError } from '../data/inventory-posting-errors.js';
import {
  AmbiguousValuationMethodError,
  UnvaluedTransferReplayError,
  UnsupportedValuationMethodError,
} from '../domain/valuation-replay.js';
import {
  hasLedgerEffect,
  INVENTORY_DOCUMENT_KINDS,
  INVENTORY_DOCUMENT_REFERENCE_TYPE,
  isInventoryDocumentKind,
} from '../domain/inventory-business-document.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import {
  toInventoryPricingRunDto,
  type InventoryPricingRun,
  type InventoryPricingRunDto,
} from '../domain/inventory-valuation.js';
import type { BalanceKey } from '../data/inventory-core-rows.js';
import {
  INVENTORY_PRICING_RUN_COMPLETED_EVENT,
  INVENTORY_PRICING_RUN_REVERSED_EVENT,
  type InventoryPricingRunPayload,
} from '../domain/inventory-pricing.events.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import { publishEvent } from './master-data-support.js';
import {
  buildRequestHash,
  requireOperationKey,
} from './inventory-posting-support.js';

/**
 * The Periodic Pricing Operation and its reverse (C-59E / C-59E+,
 * OD-PRC-05…07, OD-PDP-01…05, OD-RVP-01…08).
 *
 * WHAT THIS SERVICE IS
 *
 * An explicit, operator-initiated BATCH repricing over a SCOPE — one
 * warehouse or all warehouses (OD-PRC-06), a set of inventory document
 * kinds, and a date range — executed as ONE transaction with ONE
 * idempotency unit and ONE report. It is deliberately NOT Finalize and NOT
 * Accounting Post: it changes no quantity, posts no accounting document and
 * blocks no stock movement (OD-PDP-05).
 *
 * WHAT IT IS NOT
 *
 * It is not a second ledger. The per-key arithmetic is the EXISTING
 * whole-key replay (`recalculateKeyWithinBatch`), current truth stays in
 * `inventory_valuation_states` + `inventory_movements`, and the run header
 * plus its key outcomes are the AUDIT/REPORTING record (OD-PRC-07). A run
 * never overwrites a Manual or Derived price: the replay preserves every
 * value a movement carries on its own authority (OD-PRC-04); it only
 * recomputes what the average produced.
 *
 * THE DATE RANGE (OD-PDP-01)
 *
 * The operator chooses ONLY the end. The start is automatic: immediately
 * after the last completed run for the exact same scope (same warehouse —
 * including the all-warehouses NULL — and same kind set), or the beginning
 * of history when there is none. Runs are therefore contiguous and
 * non-overlapping by construction: a run whose end does not extend the last
 * run's end is refused with a named error, never silently emptied.
 *
 * THE ORDER (OD-PDP-04)
 *
 * A transfer moves value from the source key to the destination key, so the
 * source is repriced BEFORE the destination. Keys are ordered by a
 * topological sort over the in-scope transfer edges, with the module's
 * ascending `(warehouse, item)` order as the stable base. A cycle (A→B and
 * B→A transfers in one window) cannot be topologically ordered; it is broken
 * deterministically at the ascending order and the run continues — the
 * replay itself is order-independent for non-transfer facts, and the single
 * recalculation command has the same behavior on a cycled key.
 *
 * FAILURE ISOLATION (OD-PDP-03)
 *
 * A key whose in-range movements contain an inbound the replay cannot value
 * (a receipt or adjustment posted without a cost) fails THAT KEY ONLY, with
 * the offending movement ids named in the outcome; the rest of the batch
 * proceeds and commits. Unknown errors are NOT isolated: they abort the
 * whole transaction, because a partial batch with an unexplained failure is
 * not an auditable result.
 *
 * REVERSE PRICING (OD-RVP-01…08)
 *
 * `reversePricing` compensates ONE run — never "the latest of everything":
 * the operator names the run. Three guards refuse it fail-closed BEFORE any
 * write:
 *
 *   - OD-RVP-02: any NEWER valuation run on an affected key (the chain
 *     would be reversed out of order),
 *   - OD-RVP-03: any affected document has crossed the Accounting Post
 *     boundary (the blockers are named; nothing cascades into Accounting),
 *   - OD-RVP-07: a valued transfer SOURCE leg whose paired destination key
 *     has been valued since (the destination's value depends on the source
 *     leg this reverse would void).
 *
 * The compensation itself is value-preserving arithmetic
 * (`valuation-compensation.ts`): the run's movements become `unvalued`, the
 * surviving facts fold into the pre-run position, quantities are never
 * touched (OD-RVP-04 quantity invariance), the key is left explicitly
 * STALE — it requires repricing (OD-RVP-06) — and BOTH the original and the
 * compensating run rows are retained forever (OD-RVP-05).
 */

/** The bounded batch envelope (OD-VAL-12's bounded-command doctrine). */
const MAX_KEYS_PER_PRICING_RUN = 500;

export interface RunPricingInput {
  organizationId: string;
  operationKey: string;
  /** `null`/omitted = all warehouses (OD-PRC-06). */
  warehouseId?: string | null | undefined;
  /** One or more inventory document kinds; sorted + de-duplicated. */
  documentKinds: string[];
  /** Inclusive range end — the operator's ONLY range choice (OD-PDP-01). */
  toDate: Date;
  reason?: string | null | undefined;
}

export interface ReversePricingInput {
  organizationId: string;
  /** The run being reversed — named, never "latest" (OD-RVP-01). */
  pricingRunId: string;
  operationKey: string;
  reason?: string | null | undefined;
}

export interface ListPricingRunsQuery {
  organizationId: string;
  warehouseId?: string | undefined;
  kind?: string | undefined;
  page: number;
  pageSize: number;
}

@Injectable()
export class InventoryPricingService {
  constructor(
    private readonly pricing: InventoryPricingRepository,
    private readonly valuation: InventoryValuationRepository,
    private readonly movements: InventoryMovementsRepository,
    private readonly documents: InventoryBusinessDocumentsRepository,
    private readonly operations: InventoryOperationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly warehouses: WarehousesService,
    private readonly items: ItemsService,
    private readonly valuationService: InventoryValuationService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---- the Periodic Pricing Operation (OD-PDP-01…05) ------------------------

  async runPricing(input: RunPricingInput): Promise<InventoryPricingRunDto> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.RUN_PRICING,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    const documentKinds = normalizeDocumentKinds(input.documentKinds);
    const warehouseId = emptyToNull(input.warehouseId);
    if (warehouseId !== null) {
      // allowInactive: a disabled warehouse's history keeps its meaning and
      // may still be priced (same stance as the recalculation command).
      await this.warehouses.requireUsableWarehouseInOrganization(
        warehouseId,
        input.organizationId,
        { allowInactive: true },
      );
    }
    const reason = normalizeNote(input.reason);
    const requestHash = buildRequestHash('pricing_run', {
      warehouseId,
      documentKinds,
      toDate: input.toDate.toISOString(),
    });
    const replayed = await this.replayPricingRun(
      input.organizationId,
      operationKey,
      requestHash,
      'pricing_run',
    );
    if (replayed !== null) return replayed;

    // OD-PDP-01: the from-date is automatic — immediately after the last
    // completed run for the EXACT same scope, never chosen.
    const lastRun = await this.pricing.findLastRunForScope({
      organizationId: input.organizationId,
      warehouseId,
      documentKinds,
    });
    const fromDate = lastRun?.toDate ?? null;
    if (fromDate !== null && input.toDate.getTime() <= fromDate.getTime()) {
      throw AppException.businessRule(
        `This scope\\u2019s last pricing run already covers up to ${fromDate.toISOString()}. A new run must extend it: choose a later end date.`,
        {
          code: 'inventory.pricing.range_not_extending',
          lastRunId: lastRun?.id ?? null,
          lastToDate: fromDate.toISOString(),
        },
      );
    }

    // Scope resolution: document-referenced movements in the window, then
    // the documents' kinds and ledger-standing decide what is in scope.
    const scopedMovements = await this.movements.listScopedToDocuments(
      input.organizationId,
      { fromDateExclusive: fromDate, toDateInclusive: input.toDate },
    );
    const documentIds = [
      ...new Set(
        scopedMovements
          .map((movement) => movement.referenceId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const headers = await this.documents.listHeadersByIds(
      input.organizationId,
      documentIds,
    );
    const headerById = new Map(headers.map((header) => [header.id, header]));
    const inScope = scopedMovements.filter((movement) => {
      const header =
        movement.referenceId === null
          ? undefined
          : headerById.get(movement.referenceId);
      if (header === undefined) return false;
      if (!hasLedgerEffect(header.status)) return false;
      if (!documentKinds.includes(header.kind)) return false;
      if (warehouseId !== null && movement.warehouseId !== warehouseId) {
        return false;
      }
      return true;
    });

    // A document-referenced movement whose document is not readable in this
    // organization is an integrity anomaly, not a silently-skipped fact.
    for (const movement of scopedMovements) {
      if (movement.referenceId === null) continue;
      if (!headerById.has(movement.referenceId)) {
        throw AppException.businessRule(
          `Movement "${movement.id}" references document "${movement.referenceId}", which does not exist in this organization. The pricing run refuses to price around a broken reference.`,
          {
            code: 'inventory.pricing.broken_document_reference',
            movementId: movement.id,
            documentId: movement.referenceId,
          },
        );
      }
    }

    // The distinct keys the run covers, with their in-scope movements.
    const keys = collectKeys(inScope);
    if (keys.length > MAX_KEYS_PER_PRICING_RUN) {
      throw AppException.businessRule(
        `This pricing run would cover ${keys.length} stocking keys, more than the supported ${MAX_KEYS_PER_PRICING_RUN}. Narrow the scope (warehouse, kinds or date range).`,
        { code: 'inventory.pricing.scope_too_large', keys: keys.length },
      );
    }

    // OD-PDP-03 pre-check inputs: the in-range inbounds the replay cannot
    // value (a receipt/adjustment posted without a cost). Grouped per key.
    const unvaluedInbounds = new Map<string, string[]>();
    for (const movement of inScope) {
      if (
        (movement.movementType === 'inbound' ||
          movement.movementType === 'adjustment_in') &&
        movement.valuationStatus === 'unvalued'
      ) {
        const keyId = `${movement.warehouseId}:${movement.itemId}`;
        const bucket = unvaluedInbounds.get(keyId);
        if (bucket === undefined) unvaluedInbounds.set(keyId, [movement.id]);
        else bucket.push(movement.id);
      }
    }

    // Everything decidable without writing: master data and the method each
    // key is valued under from now on.
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const prepared = await Promise.all(
      keys.map(async (key) => {
        const warehouse =
          await this.warehouses.requireUsableWarehouseInOrganization(
            key.warehouseId,
            input.organizationId,
            { allowInactive: true },
          );
        const item = await this.items.requireUsableItemInOrganization(
          key.itemId,
          input.organizationId,
          { allowInactive: true },
        );
        const resolved = await this.valuationService.resolveMethodForPosting({
          organizationId: input.organizationId,
          itemId: item.id,
          asOf: now,
        });
        const balanceKey: BalanceKey = {
          organizationId: input.organizationId,
          branchId: warehouse.branchId,
          warehouseId: key.warehouseId,
          itemId: key.itemId,
        };
        return {
          keyId: `${key.warehouseId}:${key.itemId}`,
          key: balanceKey,
          method: resolved.method,
          runId: generateId(),
        };
      }),
    );

    // OD-PDP-04: source warehouse keys before destination warehouse keys.
    const orderedKeys = orderKeysForPricing(prepared, inScope);

    const pricingRunId = generateId();
    const outcomes: PricingOutcomeRow[] = [];

    try {
      await this.pricing.withTransaction(async (tx) => {
        // The multi-key lock discipline: every key's valuation-state row is
        // locked in the fixed ascending order BEFORE any key is replayed, so
        // this batch serializes against every other multi-key writer (and
        // against itself on retry) instead of deadlocking.
        await lockValuationStateRowsInOrder(
          tx,
          prepared.map((p) => ({ key: p.key, method: p.method })),
          actorId,
        );

        for (const entry of orderedKeys) {
          const failing = unvaluedInbounds.get(entry.keyId) ?? [];
          if (failing.length > 0) {
            // OD-PDP-03: THIS key fails, the batch continues. Nothing is
            // written on the key; the outcome names the movements.
            outcomes.push({
              organizationId: input.organizationId,
              warehouseId: entry.key.warehouseId,
              itemId: entry.key.itemId,
              outcome: 'failed',
              reason: 'inventory.pricing.unvalued_inbound_in_range',
              failedMovementIds: failing,
              valuationRunId: null,
              movementsExamined: 0,
              movementsRevalued: 0,
            });
            continue;
          }
          try {
            const result = await this.valuation.recalculateKeyWithinBatch(tx, {
              key: entry.key,
              method: entry.method,
              runId: entry.runId,
              trigger: 'pricing_operation',
              fromDate,
              reason,
              operationKey,
              actorId,
              at: now,
            });
            outcomes.push({
              organizationId: input.organizationId,
              warehouseId: entry.key.warehouseId,
              itemId: entry.key.itemId,
              outcome: 'priced',
              reason: null,
              failedMovementIds: [],
              valuationRunId: result.run.id,
              movementsExamined: result.run.movementsExamined,
              movementsRevalued: result.run.movementsRevalued,
            });
          } catch (error) {
            const translated = translateKeyFailure(error);
            if (translated === null) throw error;
            outcomes.push({
              organizationId: input.organizationId,
              warehouseId: entry.key.warehouseId,
              itemId: entry.key.itemId,
              outcome: 'failed',
              reason: translated,
              failedMovementIds: [],
              valuationRunId: null,
              movementsExamined: 0,
              movementsRevalued: 0,
            });
          }
        }

        const keysPriced = outcomes.filter(
          (o) => o.outcome === 'priced',
        ).length;
        const keysFailed = outcomes.length - keysPriced;
        const movementsExamined = outcomes.reduce(
          (sum, o) => sum + o.movementsExamined,
          0,
        );
        const movementsRevalued = outcomes.reduce(
          (sum, o) => sum + o.movementsRevalued,
          0,
        );
        await this.pricing.insertRun(tx, {
          id: pricingRunId,
          organizationId: input.organizationId,
          warehouseId,
          documentKinds,
          fromDate,
          toDate: input.toDate,
          kind: 'pricing_operation',
          reversesRunId: null,
          keysExamined: outcomes.length,
          keysPriced,
          keysFailed,
          movementsExamined,
          movementsRevalued,
          reason,
          operationKey,
          executedBy: actorId,
          executedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        for (const outcome of outcomes) {
          await this.pricing.insertKeyOutcome(tx, {
            id: generateId(),
            pricingRunId,
            ...outcome,
            createdAt: now,
            updatedAt: now,
          });
        }
        // ONE idempotency row for the WHOLE batch, LAST (a lost key race
        // aborts everything; the winner's row is what a retry replays).
        await insertOperationRow(tx, {
          id: generateId(),
          organizationId: input.organizationId,
          operationKey,
          operation: 'pricing_run',
          requestHash,
          result: { kind: 'pricing', pricingRunId },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.replayPricingRun(
          input.organizationId,
          operationKey,
          requestHash,
          'pricing_run',
        );
        if (raced !== null) return raced;
      }
      throw error;
    }

    const run = await this.mustFindRun(input.organizationId, pricingRunId);
    await this.publishRunEvent(INVENTORY_PRICING_RUN_COMPLETED_EVENT, run);
    this.logger.log(
      'Inventory pricing run completed',
      {
        pricingRunId: run.id,
        organizationId: run.organizationId,
        warehouseId: run.warehouseId,
        keysExamined: run.keysExamined,
        keysPriced: run.keysPriced,
        keysFailed: run.keysFailed,
      },
      InventoryPricingService.name,
    );
    return toInventoryPricingRunDto(run);
  }

  // ---- Reverse Pricing (OD-RVP-01…08) ---------------------------------------

  async reversePricing(
    input: ReversePricingInput,
  ): Promise<InventoryPricingRunDto> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.REVERSE_PRICING,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    const reason = normalizeNote(input.reason);
    const requestHash = buildRequestHash('reverse_pricing', {
      pricingRunId: input.pricingRunId,
    });
    const replayed = await this.replayPricingRun(
      input.organizationId,
      operationKey,
      requestHash,
      'reverse_pricing',
    );
    if (replayed !== null) return replayed;

    // Fail fast on the run itself (the real checks re-run under locks).
    const original = await this.mustFindRun(
      input.organizationId,
      input.pricingRunId,
    );
    assertReversible(original);

    const pricedOutcomes = original.keyOutcomes.filter(
      (outcome) =>
        outcome.outcome === 'priced' && outcome.valuationRunId !== null,
    );

    // Everything decidable without writing: the keys, their branch and the
    // method in force (only used if a state row is missing).
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const prepared = await Promise.all(
      pricedOutcomes.map(async (outcome) => {
        const warehouse =
          await this.warehouses.requireUsableWarehouseInOrganization(
            outcome.warehouseId,
            input.organizationId,
            { allowInactive: true },
          );
        const item = await this.items.requireUsableItemInOrganization(
          outcome.itemId,
          input.organizationId,
          { allowInactive: true },
        );
        const resolved = await this.valuationService.resolveMethodForPosting({
          organizationId: input.organizationId,
          itemId: item.id,
          asOf: now,
        });
        return {
          key: {
            organizationId: input.organizationId,
            branchId: warehouse.branchId,
            warehouseId: outcome.warehouseId,
            itemId: outcome.itemId,
          } satisfies BalanceKey,
          method: resolved.method,
          originalRunId: outcome.valuationRunId as string,
          compensatingRunId: generateId(),
          movementsUnvalued: 0,
          movementsExamined: 0,
        };
      }),
    );

    const compensatingRunId = generateId();

    await this.pricing.withTransaction(async (tx) => {
      // Serialize concurrent reversals of the same run on its header row.
      const locked = await this.pricing.lockRunRow(
        tx,
        input.organizationId,
        input.pricingRunId,
      );
      if (locked === null) {
        throw AppException.notFound(
          'Inventory pricing run',
          input.pricingRunId,
        );
      }
      if (locked.reversedByRunId !== null) {
        throw AppException.conflict(
          `Pricing run "${input.pricingRunId}" was already reversed by run "${locked.reversedByRunId}".`,
        );
      }
      if (locked.kind !== 'pricing_operation') {
        throw AppException.businessRule(
          'Only a Periodic Pricing Operation run can be reversed, not a compensating run.',
          { code: 'inventory.pricing.reverse_of_reverse' },
        );
      }

      // The multi-key lock tier, in the fixed order, BEFORE the guards read.
      await lockValuationStateRowsInOrder(
        tx,
        prepared.map((p) => ({ key: p.key, method: p.method })),
        actorId,
      );

      // OD-RVP-02/03/07 guards, each naming its blockers.
      for (const entry of prepared) {
        const originalKeyRun = await this.valuation.findRunById(
          entry.originalRunId,
        );
        if (
          originalKeyRun === null ||
          originalKeyRun.organizationId !== input.organizationId
        ) {
          throw new Error(
            `Pricing run "${original.id}" records per-key run "${entry.originalRunId}", which does not exist in this organization.`,
          );
        }

        // OD-RVP-02: this run must still be the latest on every key.
        const newer = await this.valuation.listRunsForKeyAfter({
          organizationId: entry.key.organizationId,
          warehouseId: entry.key.warehouseId,
          itemId: entry.key.itemId,
          executedAfter: originalKeyRun.executedAt,
        });
        if (newer.length > 0) {
          throw AppException.businessRule(
            `This pricing run is no longer the latest valuation on key "${entry.key.warehouseId}/${entry.key.itemId}": run "${newer[0]!.id}" was executed after it. Reverse the newer runs first.`,
            {
              code: 'inventory.pricing.reverse_not_latest_run',
              warehouseId: entry.key.warehouseId,
              itemId: entry.key.itemId,
              newerRunIds: newer.map((run) => run.id),
            },
          );
        }

        // OD-RVP-03: no affected document may have crossed Accounting Post.
        const affected = await this.movements.findByValuationRun(
          entry.originalRunId,
        );
        const affectedDocumentIds = [
          ...new Set(
            affected
              .filter(
                (movement) =>
                  movement.referenceType ===
                    INVENTORY_DOCUMENT_REFERENCE_TYPE &&
                  movement.referenceId !== null,
              )
              .map((movement) => movement.referenceId as string),
          ),
        ];
        const affectedHeaders = await this.documents.listHeadersByIds(
          input.organizationId,
          affectedDocumentIds,
        );
        const blockers = affectedHeaders.filter(
          (header) =>
            header.status === 'accounting_posted' ||
            header.status === 'immutable',
        );
        if (blockers.length > 0) {
          throw AppException.businessRule(
            `This pricing run valued movements of ${blockers.length} accounting-posted document(s): ${blockers.map((header) => header.id).join(', ')}. Reverse pricing is blocked until those documents are handled by an explicit accounting correction (OQ-27).`,
            {
              code: 'inventory.pricing.reverse_accounting_posted',
              blockedDocumentIds: blockers.map((header) => header.id),
            },
          );
        }

        // OD-RVP-07: a valued transfer SOURCE leg whose paired DESTINATION
        // key has been valued since — the destination's value may depend on
        // the source leg this reverse would void.
        for (const movement of affected) {
          if (movement.movementType !== 'transfer_out') continue;
          if (movement.transferId === null) continue;
          const pair = await this.movements.findByTransferId(
            movement.transferId,
          );
          const destination = pair.find(
            (leg) => leg.movementType === 'transfer_in',
          );
          if (destination === undefined) continue;
          const destinationRuns = await this.valuation.listRunsForKeyAfter({
            organizationId: destination.organizationId,
            warehouseId: destination.warehouseId,
            itemId: destination.itemId,
            executedAfter: originalKeyRun.executedAt,
          });
          if (destinationRuns.length > 0) {
            throw AppException.businessRule(
              `This pricing run valued the source leg of transfer "${movement.transferId}", and the destination key "${destination.warehouseId}/${destination.itemId}" has been valued since (run "${destinationRuns[0]!.id}"). Reversing the source now would strand the destination\\u2019s value.`,
              {
                code: 'inventory.pricing.reverse_transfer_destination_valued',
                transferId: movement.transferId,
                sourceMovementId: movement.id,
                destinationWarehouseId: destination.warehouseId,
                destinationItemId: destination.itemId,
                newerRunIds: destinationRuns.map((run) => run.id),
              },
            );
          }
        }
      }

      // All guards passed: compensate every key. Quantities are never
      // touched (OD-RVP-04); the key is left stale (OD-RVP-06).
      const outcomes: PricingOutcomeRow[] = [];
      for (const entry of prepared) {
        const result = await this.valuation.reverseRunWithin(tx, {
          key: entry.key,
          method: entry.method,
          originalRunId: entry.originalRunId,
          compensatingRunId: entry.compensatingRunId,
          reason,
          at: now,
          actorId,
        });
        outcomes.push({
          organizationId: input.organizationId,
          warehouseId: entry.key.warehouseId,
          itemId: entry.key.itemId,
          outcome: 'reversed' as const,
          reason: null,
          failedMovementIds: [],
          valuationRunId: entry.compensatingRunId,
          movementsExamined: result.run.movementsExamined,
          movementsRevalued: result.movementsUnvalued,
        });
      }

      const movementsExamined = outcomes.reduce(
        (sum, o) => sum + o.movementsExamined,
        0,
      );
      const movementsRevalued = outcomes.reduce(
        (sum, o) => sum + o.movementsRevalued,
        0,
      );
      await this.pricing.insertRun(tx, {
        id: compensatingRunId,
        organizationId: input.organizationId,
        warehouseId: original.warehouseId,
        documentKinds: [...original.documentKinds],
        fromDate: original.fromDate,
        toDate: original.toDate,
        kind: 'reverse_pricing',
        reversesRunId: original.id,
        keysExamined: outcomes.length,
        keysPriced: 0,
        keysFailed: 0,
        movementsExamined,
        movementsRevalued,
        reason,
        operationKey,
        executedBy: actorId,
        executedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      for (const outcome of outcomes) {
        await this.pricing.insertKeyOutcome(tx, {
          id: generateId(),
          pricingRunId: compensatingRunId,
          ...outcome,
          createdAt: now,
          updatedAt: now,
        });
      }
      // OD-RVP-05: the original is MARKED, never deleted.
      await this.pricing.markRunReversed(tx, original.id, {
        byRunId: compensatingRunId,
        at: now,
      });
      await insertOperationRow(tx, {
        id: generateId(),
        organizationId: input.organizationId,
        operationKey,
        operation: 'reverse_pricing',
        requestHash,
        result: { kind: 'pricing', pricingRunId: compensatingRunId },
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    });

    const run = await this.mustFindRun(input.organizationId, compensatingRunId);
    await this.publishRunEvent(INVENTORY_PRICING_RUN_REVERSED_EVENT, run);
    this.logger.log(
      'Inventory pricing run reversed',
      {
        pricingRunId: run.id,
        reversesRunId: run.reversesRunId,
        organizationId: run.organizationId,
        keysExamined: run.keysExamined,
      },
      InventoryPricingService.name,
    );
    return toInventoryPricingRunDto(run);
  }

  // ---- reads ----------------------------------------------------------------

  async getRun(
    organizationId: string,
    id: string,
  ): Promise<InventoryPricingRunDto> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const run = await this.mustFindRun(organizationId, id);
    return toInventoryPricingRunDto(run);
  }

  async listRuns(
    query: ListPricingRunsQuery,
  ): Promise<PaginatedResult<InventoryPricingRunDto>> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    if (query.kind !== undefined && query.kind !== '') {
      if (
        query.kind !== 'pricing_operation' &&
        query.kind !== 'reverse_pricing'
      ) {
        throw AppException.badRequest(
          'Pricing run kind must be "pricing_operation" or "reverse_pricing".',
        );
      }
    }
    const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
    const page = Math.max(query.page, 1);
    const { items, total } = await this.pricing.listRuns({
      where: {
        organizationId: query.organizationId,
        ...(query.warehouseId === undefined || query.warehouseId === ''
          ? {}
          : { warehouseId: query.warehouseId }),
        ...(query.kind === undefined || query.kind === ''
          ? {}
          : { kind: query.kind as 'pricing_operation' | 'reverse_pricing' }),
      },
      orderBy: [{ executedAt: 'desc' }],
      skip: toOffset(page, pageSize).skip,
      take: toOffset(page, pageSize).take,
    });
    return toPaginatedResult(
      items.map(toInventoryPricingRunDto),
      total,
      page,
      pageSize,
    );
  }

  // ---- internals --------------------------------------------------------------

  private async mustFindRun(
    organizationId: string,
    id: string,
  ): Promise<InventoryPricingRun> {
    const run = await this.pricing.findRun(organizationId, id);
    if (run === null) {
      throw AppException.notFound('Inventory pricing run', id);
    }
    return run;
  }

  /**
   * Idempotent replay for both pricing commands: same key + same request
   * hash re-reads the stored run; same key + different hash is a 409.
   */
  private async replayPricingRun(
    organizationId: string,
    operationKey: string,
    requestHash: string,
    operation: 'pricing_run' | 'reverse_pricing',
  ): Promise<InventoryPricingRunDto | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    if (existing.requestHash !== requestHash) {
      throw AppException.conflict(
        `Operation key "${operationKey}" was already used for a different ${operation} request.`,
      );
    }
    if (existing.result.kind !== 'pricing') {
      throw AppException.conflict(
        `Operation key "${operationKey}" was already used for a different operation.`,
      );
    }
    const run = await this.pricing.findRun(
      organizationId,
      existing.result.pricingRunId,
    );
    if (run === null) {
      throw new Error(
        `Replay of operation "${existing.id}" points at a missing pricing run.`,
      );
    }
    return toInventoryPricingRunDto(run);
  }

  private async publishRunEvent(
    type: string,
    run: InventoryPricingRun,
  ): Promise<void> {
    const payload: InventoryPricingRunPayload = {
      id: run.id,
      organizationId: run.organizationId,
      warehouseId: run.warehouseId,
      documentKinds: [...run.documentKinds],
      fromDate: run.fromDate?.toISOString() ?? null,
      toDate: run.toDate.toISOString(),
      kind: run.kind,
      reversesRunId: run.reversesRunId,
      keysExamined: run.keysExamined,
      keysPriced: run.keysPriced,
      keysFailed: run.keysFailed,
      movementsExamined: run.movementsExamined,
      movementsRevalued: run.movementsRevalued,
      operationKey: run.operationKey,
    };
    return publishEvent(this.events, {
      type,
      aggregateType: 'InventoryPricingRun',
      aggregateId: run.id,
      payload,
    });
  }
}

// ---- module-level helpers ----------------------------------------------------

/** One per-key outcome row, before ids/timestamps are assigned. */
interface PricingOutcomeRow {
  organizationId: string;
  warehouseId: string;
  itemId: string;
  outcome: 'priced' | 'failed' | 'reversed';
  reason: string | null;
  failedMovementIds: string[];
  valuationRunId: string | null;
  movementsExamined: number;
  movementsRevalued: number;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function normalizeNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

function normalizeDocumentKinds(kinds: readonly string[]): string[] {
  if (kinds.length === 0) {
    throw AppException.badRequest(
      'A pricing run requires at least one document kind.',
    );
  }
  const normalized = [...new Set(kinds.map((kind) => kind.trim()))].sort();
  for (const kind of normalized) {
    if (!isInventoryDocumentKind(kind)) {
      throw AppException.badRequest(
        `Document kind "${kind}" is not an inventory document kind. Valid kinds: ${INVENTORY_DOCUMENT_KINDS.join(', ')}.`,
      );
    }
  }
  return normalized;
}

function collectKeys(
  movements: readonly {
    warehouseId: string;
    itemId: string;
  }[],
): Array<{ warehouseId: string; itemId: string }> {
  const byId = new Map<string, { warehouseId: string; itemId: string }>();
  for (const movement of movements) {
    byId.set(`${movement.warehouseId}:${movement.itemId}`, {
      warehouseId: movement.warehouseId,
      itemId: movement.itemId,
    });
  }
  return [...byId.values()];
}

/**
 * OD-PDP-04 ordering: topological over the in-scope transfer edges (the
 * source key before the destination key), with ascending `(warehouse, item)`
 * as the stable base and the deterministic cycle breaker.
 */
function orderKeysForPricing<
  T extends { keyId: string; key: { warehouseId: string; itemId: string } },
>(
  prepared: readonly T[],
  movements: readonly {
    movementType: string;
    warehouseId: string;
    itemId: string;
    transferId: string | null;
  }[],
): T[] {
  const keyIdOf = (warehouseId: string, itemId: string) =>
    `${warehouseId}:${itemId}`;
  const known = new Set(prepared.map((p) => p.keyId));
  // Edges: source key → destination key, per in-scope transfer pair.
  const edges = new Map<string, Set<string>>();
  const transferSources = new Map<string, string>();
  for (const movement of movements) {
    if (
      movement.movementType !== 'transfer_out' ||
      movement.transferId === null
    ) {
      continue;
    }
    transferSources.set(
      movement.transferId,
      keyIdOf(movement.warehouseId, movement.itemId),
    );
  }
  for (const movement of movements) {
    if (
      movement.movementType !== 'transfer_in' ||
      movement.transferId === null
    ) {
      continue;
    }
    const sourceKey = transferSources.get(movement.transferId);
    if (sourceKey === undefined) continue;
    const destinationKey = keyIdOf(movement.warehouseId, movement.itemId);
    if (sourceKey === destinationKey) continue;
    if (!known.has(sourceKey) || !known.has(destinationKey)) continue;
    const bucket = edges.get(sourceKey) ?? new Set<string>();
    bucket.add(destinationKey);
    edges.set(sourceKey, bucket);
  }
  // Kahn's algorithm over the ascending base order; leftover nodes (cycles)
  // are appended in the base order — deterministic, documented.
  const base = [...prepared].sort((left, right) =>
    left.keyId.localeCompare(right.keyId),
  );
  const indegree = new Map<string, number>();
  for (const entry of base) indegree.set(entry.keyId, 0);
  for (const destinations of edges.values()) {
    for (const destination of destinations) {
      indegree.set(destination, (indegree.get(destination) ?? 0) + 1);
    }
  }
  const ordered: T[] = [];
  const emitted = new Set<string>();
  let progress = true;
  while (ordered.length < base.length && progress) {
    progress = false;
    for (const entry of base) {
      if (emitted.has(entry.keyId)) continue;
      if ((indegree.get(entry.keyId) ?? 0) > 0) continue;
      emitted.add(entry.keyId);
      ordered.push(entry);
      progress = true;
      for (const destination of edges.get(entry.keyId) ?? []) {
        const degree = (indegree.get(destination) ?? 0) - 1;
        indegree.set(destination, degree);
      }
    }
  }
  for (const entry of base) {
    if (!emitted.has(entry.keyId)) ordered.push(entry);
  }
  return ordered;
}

/**
 * The per-key replay failures that are BUSINESS ANSWERS (the key's outcome is
 * `failed`, the batch continues). Everything else aborts the batch.
 */
function translateKeyFailure(error: unknown): string | null {
  if (error instanceof RecalculationTooLargeError) {
    return 'inventory.pricing.recalculation_too_large';
  }
  if (error instanceof UnsupportedValuationMethodError) {
    return 'inventory.pricing.valuation_method_not_implemented';
  }
  if (error instanceof AmbiguousValuationMethodError) {
    return 'inventory.pricing.ambiguous_valuation_method';
  }
  if (error instanceof UnvaluedTransferReplayError) {
    return 'inventory.pricing.unvalued_transfer_replay';
  }
  return null;
}

function assertReversible(run: InventoryPricingRun): void {
  if (run.reversedByRunId !== null) {
    throw AppException.conflict(
      `Pricing run "${run.id}" was already reversed by run "${run.reversedByRunId}".`,
    );
  }
  if (run.kind !== 'pricing_operation') {
    throw AppException.businessRule(
      'Only a Periodic Pricing Operation run can be reversed, not a compensating run.',
      { code: 'inventory.pricing.reverse_of_reverse' },
    );
  }
}
