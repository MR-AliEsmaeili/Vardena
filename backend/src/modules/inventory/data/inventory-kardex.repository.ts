import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';

export interface KardexReadInput {
  organizationId: string;
  itemId: string;
  warehouseId: string;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  page: number;
  pageSize: number;
  snapshot?: string | undefined;
}

export interface KardexLedgerRow {
  movementId: string;
  movementDate: Date;
  createdAt: Date;
  movementType: string;
  signedBaseQuantity: string;
  baseUnitId: string;
  runningBaseQuantity: string;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

export interface KardexLedgerPage {
  items: KardexLedgerRow[];
  total: number;
  openingBaseQuantity: string;
  closingBaseQuantity: string;
  baseUnitId: string | null;
  closingMovementDate: Date | null;
  snapshot: string;
}

type RawClient = {
  $transaction<T>(
    callback: (tx: RawTransaction) => Promise<T>,
    options?: { isolationLevel?: 'RepeatableRead' },
  ): Promise<T>;
};
type RawTransaction = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

type RawKardexRow = {
  movementId: string | null;
  movementDate: Date | null;
  createdAt: Date | null;
  movementType: string | null;
  signedBaseQuantity: unknown;
  baseUnitId: string | null;
  runningBaseQuantity: unknown;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  total: bigint | number | string;
  openingBaseQuantity: unknown;
  closingBaseQuantity: unknown;
  closingMovementDate: Date | null;
};

/** Inventory-owned quantity-ledger read model. No balance projection is read. */
@Injectable()
export class InventoryKardexRepository {
  constructor(private readonly prisma: PrismaService) {}

  async read(input: KardexReadInput): Promise<KardexLedgerPage> {
    const client = await this.prisma.getClient<RawClient>();
    return client.$transaction(
      async (tx) => {
        const snapshot =
          input.snapshot ??
          (
            await tx.$queryRawUnsafe<Array<{ snapshot: string }>>(
              'SELECT txid_current_snapshot()::text AS snapshot',
            )
          )[0]!.snapshot;
        const rows = await tx.$queryRawUnsafe<RawKardexRow[]>(
          KARDEx_SQL,
          input.organizationId,
          input.itemId,
          input.warehouseId,
          input.dateFrom ?? null,
          input.dateTo ?? null,
          snapshot,
          (input.page - 1) * input.pageSize,
          input.pageSize,
        );
        const meta = rows[0];
        if (meta === undefined) {
          return {
            items: [],
            total: 0,
            openingBaseQuantity: '0.0000',
            closingBaseQuantity: '0.0000',
            baseUnitId: null,
            closingMovementDate: null,
            snapshot,
          };
        }
        return {
          items: rows
            .filter((row) => row.movementId !== null)
            .map((row) => ({
              movementId: row.movementId!,
              movementDate: row.movementDate!,
              createdAt: row.createdAt!,
              movementType: row.movementType!,
              signedBaseQuantity: String(row.signedBaseQuantity),
              baseUnitId: row.baseUnitId!,
              runningBaseQuantity: String(row.runningBaseQuantity),
              transferId: row.transferId,
              reversalOfMovementId: row.reversalOfMovementId,
              referenceType: row.referenceType,
              referenceId: row.referenceId,
            })),
          total: Number(meta.total),
          openingBaseQuantity: String(meta.openingBaseQuantity),
          closingBaseQuantity: String(meta.closingBaseQuantity),
          baseUnitId: meta.baseUnitId,
          closingMovementDate: meta.closingMovementDate,
          snapshot,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}

// txid_visible_in_snapshot makes the token reusable across HTTP page requests:
// later commits are excluded even when their movementDate is backdated.
const KARDEx_SQL = `
WITH visible AS (
  SELECT m.*
  FROM inventory.inventory_movements m
  WHERE m.organization_id = $1
    AND m.item_id = $2
    AND m.warehouse_id = $3
    AND txid_visible_in_snapshot((m.xmin::text)::bigint, $6::txid_snapshot)
), opening AS (
  SELECT COALESCE(SUM(base_quantity), 0)::numeric(18,4) AS quantity
  FROM visible
  WHERE $4::timestamptz IS NOT NULL AND movement_date < $4
), ranged AS (
  SELECT v.*,
    ((SELECT quantity FROM opening) + SUM(v.base_quantity) OVER (
      ORDER BY v.movement_date ASC, v.created_at ASC, v.id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ))::numeric(18,4) AS running_quantity
  FROM visible v
  WHERE ($4::timestamptz IS NULL OR v.movement_date >= $4)
    AND ($5::timestamptz IS NULL OR v.movement_date <= $5)
), summary AS (
  SELECT COUNT(*)::bigint AS total,
    (SELECT quantity FROM opening)::numeric(18,4) AS opening_quantity,
    ((SELECT quantity FROM opening) + COALESCE(SUM(base_quantity), 0))::numeric(18,4) AS closing_quantity,
    (SELECT base_unit_id FROM visible ORDER BY movement_date, created_at, id LIMIT 1) AS base_unit_id,
    MAX(movement_date) AS closing_movement_date
  FROM ranged
), page AS (
  SELECT * FROM ranged
  ORDER BY movement_date ASC, created_at ASC, id ASC
  OFFSET $7 LIMIT $8
)
SELECT p.id AS "movementId", p.movement_date AS "movementDate",
  p.created_at AS "createdAt", p.movement_type AS "movementType",
  p.base_quantity::numeric(18,4)::text AS "signedBaseQuantity",
  COALESCE(p.base_unit_id, s.base_unit_id) AS "baseUnitId",
  p.running_quantity::numeric(18,4)::text AS "runningBaseQuantity",
  p.transfer_id AS "transferId",
  p.reversal_of_movement_id AS "reversalOfMovementId",
  p.reference_type AS "referenceType", p.reference_id AS "referenceId",
  s.total, s.opening_quantity::text AS "openingBaseQuantity",
  s.closing_quantity::text AS "closingBaseQuantity",
  s.closing_movement_date AS "closingMovementDate"
FROM summary s LEFT JOIN page p ON TRUE
ORDER BY p.movement_date ASC, p.created_at ASC, p.id ASC`;
