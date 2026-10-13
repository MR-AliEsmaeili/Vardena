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
  resolveAvailableQuantity,
  toInventoryBalanceDto,
  type InventoryBalanceDto,
} from '../domain/inventory-balance.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import { BALANCE_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { RECONCILIATION_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { resolveSort } from './master-data-support.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { WarehousesRepository } from '../data/warehouses.repository.js';

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
  /**
   * `onHand − reserved` when `reservationsReduceAvailable` is true for this
   * warehouse (the default, and every consumer's existing reading); `onHand`
   * unchanged when false (C-50 §3.7). Either way `onHand` is reported
   * separately above and is never itself affected by this setting.
   */
  available: string;
  /** Effective negative-stock policy for this key. */
  allowNegativeStock: boolean;
  /** This warehouse's C-50 §3.7 setting, echoed for transparency. */
  reservationsReduceAvailable: boolean;
}

/** One warehouse's stock picture for a single item (C-50 §3.2). */
export interface ItemWarehouseAvailabilityDto extends AvailabilityDto {
  warehouseCode: string;
  warehouseName: string;
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
    private readonly warehouseRows: WarehousesRepository,
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
    // `available` must honor each row's own warehouse's C-50 §3.7 setting —
    // the same rule `getAvailability` already applies for a single key —
    // so this list can never disagree with it for the same (warehouse,
    // item). Rows on one page span a bounded number of distinct warehouses;
    // resolve each one once (same N+1-by-warehouse shape already accepted in
    // `listItemAvailabilityAcrossWarehouses`), never per balance row.
    const settingByWarehouse = new Map<string, boolean>();
    for (const item of items) {
      if (settingByWarehouse.has(item.warehouseId)) continue;
      const warehouse = await this.warehouseRows.findById(item.warehouseId);
      // A balance row's warehouse must exist (FK-backed); default to the
      // conservative/default setting only if that invariant is ever broken.
      settingByWarehouse.set(
        item.warehouseId,
        warehouse?.reservationsReduceAvailable ?? true,
      );
    }
    return toPaginatedResult(
      items.map((item) =>
        toInventoryBalanceDto(
          item,
          settingByWarehouse.get(item.warehouseId) ?? true,
        ),
      ),
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
      available: resolveAvailableQuantity(
        { onHand, reserved },
        warehouse.reservationsReduceAvailable,
      ),
      allowNegativeStock: resolveEffectivePolicy({
        itemAllow: item.allowNegativeStock,
        warehouseAllow: warehouse.allowNegativeStock,
      }),
      reservationsReduceAvailable: warehouse.reservationsReduceAvailable,
    };
  }

  /**
   * Stock visibility across every authorized warehouse for one item (C-50
   * §3.2): "the user must be able to inspect stock across authorized
   * warehouses when selecting a product". Scope is REPOSITORY-DEFINED (no
   * per-warehouse ACL exists in this codebase): every ACTIVE warehouse in an
   * organization the caller is authorized to view balances in, same
   * granularity as every other Inventory read. A warehouse with no balance
   * row yet reads as zero, same rule as `getAvailability`.
   */
  async listItemAvailabilityAcrossWarehouses(
    organizationId: string,
    itemId: string,
  ): Promise<ItemWarehouseAvailabilityDto[]> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.requireUsableOrganization(organizationId);
    const item = await this.items.requireUsableItemInOrganization(
      itemId,
      organizationId,
    );
    // Repository-level composition (same convention `WarehousesService`
    // itself uses for `InventoryBalancesRepository`/
    // `InventoryMovementsRepository`): this read is gated by
    // `BALANCE_PERMISSIONS.VIEW` alone, not an additional
    // `WAREHOUSE_PERMISSIONS.VIEW` requirement — going through
    // `WarehousesService.listWarehouses` would silently add that second
    // permission to every caller of this stock-visibility read.
    const { items: warehouses } = await this.warehouseRows.list({
      where: { organizationId, isActive: true },
      orderBy: [{ code: 'asc' }],
      skip: 0,
      take: 1000,
    });
    const results: ItemWarehouseAvailabilityDto[] = [];
    for (const warehouse of warehouses) {
      const stored = await this.balances.findByKey(
        organizationId,
        warehouse.id,
        itemId,
      );
      const onHand = stored?.onHand ?? '0';
      const reserved = stored?.reserved ?? '0';
      results.push({
        organizationId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        itemId,
        onHand,
        reserved,
        available: resolveAvailableQuantity(
          { onHand, reserved },
          warehouse.reservationsReduceAvailable,
        ),
        allowNegativeStock: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
        reservationsReduceAvailable: warehouse.reservationsReduceAvailable,
      });
    }
    return results;
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
   *
   * Each key remains its own short Inventory transaction and is re-read under
   * its balance row lock, so concurrent postings are either included before
   * the recomputation or applied after it. Earlier per-key commits remain
   * valid if a later key fails; rerunning the same scope is safe.
   */
  async rebuild(scope: ReconciliationScope): Promise<RebuildReport> {
    await this.authorization.requireAllPermissions([
      RECONCILIATION_PERMISSIONS.EXECUTE,
    ]);
    await this.resolveScope(scope);
    const keys = await this.balances.listStockingKeys(scope);
    const branches = new Map<string, string>();
    const corrections: KeyRebuild[] = [];
    let completedKeys = 0;
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

      try {
        const rebuild = await this.balances.rebuildKey(
          scope.organizationId,
          branchId,
          key,
          getPrincipal()?.userId ?? null,
        );
        completedKeys += 1;
        if (rebuild.action !== 'noop') corrections.push(rebuild);
      } catch (error) {
        this.logger.warn(
          'Inventory balance rebuild encountered an error during a per-key transaction',
          {
            organizationId: scope.organizationId,
            warehouseId: key.warehouseId,
            itemId: key.itemId,
            completedKeys,
            totalKeys: keys.length,
            currentKeyCommitOutcome: 'unknown',
            corrections,
            errorName: error instanceof Error ? error.name : typeof error,
          },
          InventoryBalancesService.name,
        );
        throw error;
      }
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
