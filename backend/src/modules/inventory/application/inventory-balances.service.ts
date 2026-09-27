import { Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  InventoryBalancesRepository,
  type KeyComparison,
  type KeyRebuild,
} from '../data/inventory-balances.repository.js';
import {
  availableQuantity,
  toInventoryBalanceDto,
  type InventoryBalanceDto,
} from '../domain/inventory-balance.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import { BALANCE_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { RECONCILIATION_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { resolveSort } from './master-data-support.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  onHand: 'onHand',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
};

export interface ListBalancesQuery {
  organizationId: string;
  branchId?: string | undefined;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface AvailabilityQuery {
  organizationId: string;
  warehouseId: string;
  itemId: string;
}

export interface AvailabilityDto {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  onHand: string;
  reserved: string;
  available: string;
  /** Effective negative-stock policy for this key. */
  allowNegativeStock: boolean;
}

export interface ReconciliationScope {
  organizationId: string;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
}

export interface ReconciliationReport {
  checked: number;
  matched: number;
  mismatched: number;
  mismatches: KeyComparison[];
}

export interface RebuildReport {
  checked: number;
  rebuilt: number;
  corrections: KeyRebuild[];
}

/**
 * Stock balances, availability, and ledger reconciliation (D-04, ADR-0022).
 *
 * Reads serve the materialized projection; `available` is always derived
 * (`onHand − reserved`), never stored. A key with no stored row reads as
 * zero — absence of facts is absence of stock, not an error.
 *
 * Reconciliation compares the projection against the ledger-derived truth key
 * by key, each key under its row lock inside its own short transaction (see
 * the repository docs for why that ordering is race-safe). Drift is a defect,
 * never a business event: the read-only report only REPORTS, and the rebuild
 * only runs under its own maintenance permission, returning every correction
 * it applied so the run is auditable end to end.
 */
@Injectable()
export class InventoryBalancesService {
  constructor(
    private readonly balances: InventoryBalancesRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listBalances(
    query: ListBalancesQuery,
  ): Promise<PaginatedResult<InventoryBalanceDto>> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.balances.list({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { updatedAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toInventoryBalanceDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Availability for one stocking key. References resolve with
   * `allowInactive` — this is a read, and history stays readable after a
   * disable — but organization consistency is still enforced (a warehouse of
   * another organization is 404, never mixed into this one's answer).
   */
  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityDto> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.requireUsableOrganization(query.organizationId);
    const warehouse =
      await this.warehouses.requireUsableWarehouseInOrganization(
        query.warehouseId,
        query.organizationId,
        { allowInactive: true },
      );
    const item = await this.items.requireUsableItemInOrganization(
      query.itemId,
      query.organizationId,
      { allowInactive: true },
    );
    const stored = await this.balances.findByKey(
      query.organizationId,
      query.warehouseId,
      query.itemId,
    );
    const onHand = stored?.onHand ?? '0';
    const reserved = stored?.reserved ?? '0';
    return {
      organizationId: query.organizationId,
      branchId: warehouse.branchId,
      warehouseId: query.warehouseId,
      itemId: query.itemId,
      onHand,
      reserved,
      available: availableQuantity({ onHand, reserved }),
      allowNegativeStock: resolveEffectivePolicy({
        itemAllow: item.allowNegativeStock,
        warehouseAllow: warehouse.allowNegativeStock,
      }),
    };
  }

  /**
   * Read-only reconciliation: ledger-derived truth vs stored projection for
   * every stocking key in the scope. Concurrent postings cannot produce false
   * mismatches (each key compares under its row lock); the report is a point-
   * in-time per key, not one snapshot across keys — document that honestly
   * rather than holding a long transaction.
   */
  async reconcile(scope: ReconciliationScope): Promise<ReconciliationReport> {
    await this.authorization.requireAllPermissions([
      RECONCILIATION_PERMISSIONS.VIEW,
    ]);
    await this.resolveScope(scope);
    const keys = await this.balances.listStockingKeys(scope);
    const mismatches: KeyComparison[] = [];
    for (const key of keys) {
      // Sequential per-key transactions on purpose: short, lock-friendly, and
      // the report stays reproducible key by key.
      const comparison = await this.balances.compareKey(
        scope.organizationId,
        key,
      );
      if (!comparison.matches) mismatches.push(comparison);
    }
    return {
      checked: keys.length,
      matched: keys.length - mismatches.length,
      mismatched: mismatches.length,
      mismatches,
    };
  }

  /**
   * Rebuild stored balances from the ledger for every key in the scope.
   * Maintenance only (`Reconciliation.Execute`): every correction is returned
   * in the report AND logged, so a rebuild is never a silent repair.
   */
  async rebuild(scope: ReconciliationScope): Promise<RebuildReport> {
    await this.authorization.requireAllPermissions([
      RECONCILIATION_PERMISSIONS.EXECUTE,
    ]);
    await this.resolveScope(scope);
    const keys = await this.balances.listStockingKeys(scope);
    const branches = new Map<string, string>();
    const corrections: KeyRebuild[] = [];
    for (const key of keys) {
      // A rebuild only CREATES a row for a key the ledger knows; the branch
      // comes from the live warehouse row (warehouses cannot move branches
      // once movements exist, so it matches every movement's snapshot).
      let branchId = branches.get(key.warehouseId);
      if (branchId === undefined) {
        const warehouse =
          await this.warehouses.requireUsableWarehouseInOrganization(
            key.warehouseId,
            scope.organizationId,
            { allowInactive: true },
          );
        branchId = warehouse.branchId;
        branches.set(key.warehouseId, branchId);
      }
      const rebuild = await this.balances.rebuildKey(
        scope.organizationId,
        branchId,
        key,
        getPrincipal()?.userId ?? null,
      );
      if (rebuild.action !== 'noop') corrections.push(rebuild);
    }
    this.logger.log(
      'Inventory balances rebuilt',
      {
        organizationId: scope.organizationId,
        checked: keys.length,
        rebuilt: corrections.length,
        corrections,
      },
      InventoryBalancesService.name,
    );
    return { checked: keys.length, rebuilt: corrections.length, corrections };
  }

  // ---- internals ------------------------------------------------------------

  /**
   * Validate the maintenance scope: the organization must exist and be
   * usable; provided warehouse/item filters must belong to it (inactive ones
   * are fine — maintenance reads history).
   */
  private async resolveScope(scope: ReconciliationScope): Promise<void> {
    await this.organizations.requireUsableOrganization(scope.organizationId);
    if (scope.warehouseId !== undefined) {
      await this.warehouses.requireUsableWarehouseInOrganization(
        scope.warehouseId,
        scope.organizationId,
        { allowInactive: true },
      );
    }
    if (scope.itemId !== undefined) {
      await this.items.requireUsableItemInOrganization(
        scope.itemId,
        scope.organizationId,
        { allowInactive: true },
      );
    }
  }
}
