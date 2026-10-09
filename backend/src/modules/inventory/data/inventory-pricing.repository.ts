import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  isPricingKeyOutcome,
  isPricingRunKind,
  type InventoryPricingRun,
  type InventoryPricingRunKeyOutcome,
  type PricingKeyOutcome,
  type PricingRunKind,
} from '../domain/inventory-valuation.js';
import type {
  CoreClient,
  CoreTransactionalClient,
  CoreTxClient,
  PricingRunCreate,
  PricingRunKeyOutcomeCreate,
  PricingRunRow,
  PricingRunKeyOutcomeRow,
} from './inventory-core-rows.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for the C-59E Pricing Run batch records
 * (`inventory_pricing_runs` + `inventory_pricing_run_key_outcomes`).
 *
 * These tables are AUDIT/REPORTING records, never a second truth (OD-VH-01,
 * OD-DOC-01): the per-key arithmetic is and stays the
 * `inventory_valuation_runs` replay executed by
 * `InventoryValuationRepository.recalculateKeyWithin`, and current value
 * truth stays `inventory_valuation_states` + `inventory_movements`. This
 * repository owns the batch header/outcome rows and the raw document-row
 * lock that serializes a Pricing Run / Reverse Pricing against other
 * multi-key writers.
 *
 * There is deliberately no delete: a reversed run is MARKED
 * (`reversed_by_run_id`), never erased (OD-RVP-05).
 */

@Injectable()
export class InventoryPricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  private transacting(): Promise<CoreTransactionalClient> {
    return this.prisma.getClient<CoreTransactionalClient>();
  }

  /** The C-59E composition boundary: one transaction for a whole batch. */
  async withTransaction<T>(work: (tx: CoreTxClient) => Promise<T>): Promise<T> {
    const client = await this.transacting();
    return client.$transaction(work);
  }

  // ---- reads ---------------------------------------------------------------

  /** One pricing run with its per-key outcomes, organization-scoped. */
  async findRun(
    organizationId: string,
    id: string,
  ): Promise<InventoryPricingRun | null> {
    const { inventoryPricingRun, inventoryPricingRunKeyOutcome } =
      await this.client();
    const row = await inventoryPricingRun.findUnique({ where: { id } });
    if (row === null || row.organizationId !== organizationId) return null;
    const outcomes = await inventoryPricingRunKeyOutcome.findMany({
      where: { pricingRunId: id },
      orderBy: [{ createdAt: 'asc' }],
      skip: 0,
      take: MAX_KEY_OUTCOMES,
    });
    return toDomain(row, outcomes);
  }

  async listRuns(params: {
    where: {
      organizationId: string;
      warehouseId?: string | undefined;
      kind?: PricingRunKind | undefined;
    };
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryPricingRun[]; total: number }> {
    const { inventoryPricingRun, inventoryPricingRunKeyOutcome } =
      await this.client();
    const where = {
      organizationId: params.where.organizationId,
      ...(params.where.warehouseId === undefined
        ? {}
        : { warehouseId: params.where.warehouseId }),
      ...(params.where.kind === undefined ? {} : { kind: params.where.kind }),
    };
    const [rows, total] = await Promise.all([
      inventoryPricingRun.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      inventoryPricingRun.count({ where }),
    ]);
    if (rows.length === 0) return { items: [], total };
    const outcomes = await inventoryPricingRunKeyOutcome.findMany({
      where: { pricingRunId: { in: rows.map((row) => row.id) } },
      orderBy: [{ createdAt: 'asc' }],
      skip: 0,
      take: MAX_KEY_OUTCOMES * rows.length,
    });
    const byRun = new Map<string, PricingRunKeyOutcomeRow[]>();
    for (const outcome of outcomes) {
      const bucket = byRun.get(outcome.pricingRunId);
      if (bucket === undefined) byRun.set(outcome.pricingRunId, [outcome]);
      else bucket.push(outcome);
    }
    return {
      items: rows.map((row) => toDomain(row, byRun.get(row.id) ?? [])),
      total,
    };
  }

  /**
   * The last COMPLETED run for one exact scope (OD-PDP-01): the run whose
   * `to_date` the next run's automatic from-date follows. Scope identity is
   * (organization, warehouse — including the all-warehouses NULL —, exact
   * kind set); different kind sets are different scopes.
   *
   * WHAT "COMPLETED" MEANS (C-59 correction sprint, failed-key progression):
   * a run advances the scope's from-date ONLY when it priced EVERY key it
   * examined (`keysFailed = 0`), examined at least one key
   * (`keysExamined > 0`), AND has not been reversed since. A run with
   * failed keys is not a completed run — if it advanced the from-date, the
   * failed key's in-window movements would fall out of every future scope
   * and stay unpriced forever, silently. A reversed run likewise does not
   * advance it: its keys were set back to unvalued/stale and REQUIRE
   * repricing by a later run that re-covers the range. And an EMPTY run (no
   * movements in its window, nothing examined) advances nothing either —
   * this matters exactly under concurrency: a Reverse Pricing can commit
   * between a concurrent run's boundary read and its key discovery, leaving
   * that run legitimately empty while the key it would have re-priced sits
   * STALE; if the empty run advanced the boundary past the stale key's
   * movements, the required repricing would become unreachable. The next
   * run therefore re-covers from the last boundary that actually did work;
   * keys that already priced re-price idempotently (the whole-key replay is
   * deterministic), and the failed/stale key is retried as soon as its
   * blocker is resolved. Nothing is ever skipped past.
   */
  async findLastRunForScope(params: {
    organizationId: string;
    warehouseId: string | null;
    documentKinds: readonly string[];
  }): Promise<{ id: string; toDate: BusinessDate } | null> {
    const { inventoryPricingRun } = await this.client();
    // Bounded recent-window scan: the latest COMPLETED runs for the
    // warehouse, then the most recent one whose EXACT kind set matches —
    // kind sets are part of the scope identity (OD-PDP-01), so a run over
    // different kinds does not advance this scope's from-date either. The
    // window is over-covering by design: if it is exhausted, the fallback
    // is from the beginning of history, which can only re-price, never
    // skip.
    const rows = await inventoryPricingRun.findMany({
      where: {
        organizationId: params.organizationId,
        warehouseId: params.warehouseId,
        kind: 'pricing_operation',
        keysFailed: 0,
        keysExamined: { gt: 0 },
        reversedByRunId: null,
      },
      orderBy: [{ executedAt: 'desc' }],
      skip: 0,
      take: SCOPE_HISTORY_WINDOW,
    });
    const requested = [...params.documentKinds].sort().join(',');
    for (const row of rows) {
      if ([...row.documentKinds].sort().join(',') === requested) {
        return { id: row.id, toDate: businessDateFromDbDate(row.toDate) };
      }
    }
    return null;
  }

  // ---- writes (tx-scoped) ----------------------------------------------------

  /** Insert the batch header; counts are final when this runs (end of batch). */
  async insertRun(
    tx: CoreTxClient,
    create: PricingRunCreate,
  ): Promise<InventoryPricingRun> {
    const row = await tx.inventoryPricingRun.create({
      data: toCreateData(create),
    });
    return toDomain(row, []);
  }

  async insertKeyOutcome(
    tx: CoreTxClient,
    create: PricingRunKeyOutcomeCreate,
  ): Promise<void> {
    await tx.inventoryPricingRunKeyOutcome.create({ data: create });
  }

  /** OD-RVP-05: mark the original run reversed; it is retained forever. */
  async markRunReversed(
    tx: CoreTxClient,
    runId: string,
    audit: { byRunId: string; at: Date; by: string | null },
  ): Promise<void> {
    await tx.inventoryPricingRun.update({
      where: { id: runId },
      data: {
        reversedByRunId: audit.byRunId,
        reversedAt: audit.at,
        updatedAt: audit.at,
        updatedBy: audit.by,
      },
    });
  }

  /**
   * Lock ONE pricing-run header row `FOR UPDATE` — the serialization point
   * for two concurrent reversals of the same run. Returns the locked row
   * (organization-scoped by the WHERE clause, so another organization's id
   * simply does not exist here).
   */
  async lockRunRow(
    tx: CoreTxClient,
    organizationId: string,
    runId: string,
  ): Promise<PricingRunRow | null> {
    const rows = await tx.$queryRaw<PricingRunRow>`
      SELECT "id",
             "organization_id" AS "organizationId",
             "warehouse_id" AS "warehouseId",
             "document_kinds" AS "documentKinds",
             "from_date" AS "fromDate",
             "to_date" AS "toDate",
             "kind",
             "reverses_run_id" AS "reversesRunId",
             "reversed_by_run_id" AS "reversedByRunId",
             "reversed_at" AS "reversedAt",
             "keys_examined" AS "keysExamined",
             "keys_priced" AS "keysPriced",
             "keys_failed" AS "keysFailed",
             "movements_examined" AS "movementsExamined",
             "movements_revalued" AS "movementsRevalued",
             "reason",
             "operation_key" AS "operationKey",
             "executed_by" AS "executedBy",
             "executed_at" AS "executedAt",
             "created_at" AS "createdAt",
             "updated_at" AS "updatedAt",
             "created_by" AS "createdBy",
             "updated_by" AS "updatedBy"
        FROM "inventory"."inventory_pricing_runs"
       WHERE "id" = ${runId}
         AND "organization_id" = ${organizationId}
       FOR UPDATE`;
    return rows[0] ?? null;
  }
}

const MAX_KEY_OUTCOMES = 5_000;

/** How many recent runs `findLastRunForScope` inspects for the exact kind set. */
const SCOPE_HISTORY_WINDOW = 50;

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Inventory BusinessDate "${value}".`);
  }
  return carrier;
}

function toCreateData(
  input: PricingRunCreate,
): import('./inventory-core-rows.js').PricingRunCreateData {
  return {
    ...input,
    fromDate: input.fromDate === null ? null : dbBusinessDate(input.fromDate),
    toDate: dbBusinessDate(input.toDate),
  };
}

function toOutcomeDomain(
  row: PricingRunKeyOutcomeRow,
): InventoryPricingRunKeyOutcome {
  if (!isPricingKeyOutcome(row.outcome)) {
    throw new Error(
      `Stored pricing-run key outcome "${row.id}" has an unknown outcome "${row.outcome}".`,
    );
  }
  return {
    id: row.id,
    pricingRunId: row.pricingRunId,
    organizationId: row.organizationId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    outcome: row.outcome as PricingKeyOutcome,
    reason: row.reason,
    failedMovementIds: row.failedMovementIds,
    valuationRunId: row.valuationRunId,
    movementsExamined: row.movementsExamined,
    movementsRevalued: row.movementsRevalued,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDomain(
  row: PricingRunRow,
  outcomeRows: readonly PricingRunKeyOutcomeRow[],
): InventoryPricingRun {
  if (!isPricingRunKind(row.kind)) {
    throw new Error(
      `Stored pricing run "${row.id}" has an unknown kind "${row.kind}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    warehouseId: row.warehouseId,
    documentKinds: row.documentKinds,
    fromDate:
      row.fromDate === null ? null : businessDateFromDbDate(row.fromDate),
    toDate: businessDateFromDbDate(row.toDate),
    kind: row.kind as PricingRunKind,
    reversesRunId: row.reversesRunId,
    reversedByRunId: row.reversedByRunId,
    reversedAt: row.reversedAt,
    keysExamined: row.keysExamined,
    keysPriced: row.keysPriced,
    keysFailed: row.keysFailed,
    movementsExamined: row.movementsExamined,
    movementsRevalued: row.movementsRevalued,
    reason: row.reason,
    operationKey: row.operationKey,
    executedBy: row.executedBy,
    executedAt: row.executedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    keyOutcomes: outcomeRows.map(toOutcomeDomain),
  };
}
