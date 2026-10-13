import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { resolveBusinessDateFilter } from './inventory-posting-support.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { InventoryKardexRepository } from '../data/inventory-kardex.repository.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  resolveVersionAt,
  type UnitConversion,
} from '../domain/unit-conversion.js';
import {
  baseToDisplayExact,
  formatQuantity,
} from '../domain/kardex-quantity.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { UnitsService } from './units.service.js';

export interface KardexQuery {
  organizationId: string;
  itemId: string;
  warehouseId: string;
  /**
   * INCLUSIVE movement BUSINESS DAY bounds, canonical Gregorian
   * `YYYY-MM-DD` (OQ-73: `movement_date` is PostgreSQL `date`; the Kardex
   * filters it with true date comparisons).
   */
  dateFrom?: string;
  dateTo?: string;
  displayUnitId?: string;
  snapshot?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class InventoryKardexService {
  constructor(
    private readonly repository: InventoryKardexRepository,
    private readonly conversions: UnitConversionsRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly units: UnitsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async read(query: KardexQuery) {
    await this.authorization.requireAllPermissions([MOVEMENT_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    // Canonical YYYY-MM-DD days compare lexically in chronological order.
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw AppException.badRequest('dateFrom must not be later than dateTo.');
    }
    // Day strings become the PostgreSQL `date` carriers the ledger query
    // compares against (validation included — same codes as every filter).
    const dateFrom = resolveBusinessDateFilter('dateFrom', query.dateFrom);
    const dateTo = resolveBusinessDateFilter('dateTo', query.dateTo);
    if (query.page > 1 && query.snapshot === undefined) {
      throw AppException.badRequest('snapshot is required after page 1.');
    }
    const [item] = await Promise.all([
      this.items.requireUsableItemInOrganization(
        query.itemId,
        query.organizationId,
      ),
      this.warehouses.requireUsableWarehouseInOrganization(
        query.warehouseId,
        query.organizationId,
      ),
    ]);
    const displayUnitId = query.displayUnitId ?? item.baseUnitId;
    await this.units.requireUsableUnitInOrganization(
      displayUnitId,
      query.organizationId,
    );

    const page = await this.repository.read({ ...query, dateFrom, dateTo });
    const factorAt = await this.factorResolver(
      query.organizationId,
      query.itemId,
      displayUnitId,
      item.baseUnitId,
    );
    const convert = (value: string, asOf: BusinessDate | undefined): string => {
      const formattedBase = formatQuantity(value);
      if (formattedBase === '0.0000' || formattedBase === '-0.0000')
        return '0.0000';
      if (asOf === undefined) {
        throw AppException.businessRule(
          'A non-zero Kardex quantity has no movement date to resolve its display unit.',
        );
      }
      const converted = baseToDisplayExact(value, factorAt(asOf));
      if (converted === null) {
        throw AppException.businessRule(
          'The Kardex quantity cannot be represented exactly in the selected display unit at four-decimal precision. No rounding or truncation was applied.',
        );
      }
      return formatQuantity(converted);
    };
    // A non-zero ledger quantity implies at least one movement date; zero
    // values short-circuit before a conversion lookup. Use a bound when one
    // was supplied, otherwise the latest ledger day for the snapshot.
    const closingAt = dateTo ?? page.closingMovementDate ?? dateFrom;
    const openingAt = dateFrom ?? closingAt;

    return {
      items: page.items.map((movement) => ({
        movementId: movement.movementId,
        movementDate: movement.movementDate,
        createdAt: movement.createdAt.toISOString(),
        movementType: movement.movementType,
        signedQuantity: convert(
          movement.signedBaseQuantity,
          movement.movementDate,
        ),
        displayUnitId,
        runningQuantity: convert(
          movement.runningBaseQuantity,
          movement.movementDate,
        ),
        transferId: movement.transferId,
        reversalOfMovementId: movement.reversalOfMovementId,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
      })),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
      scope: {
        organizationId: query.organizationId,
        itemId: query.itemId,
        warehouseId: query.warehouseId,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        baseUnitId: item.baseUnitId,
        displayUnitId,
      },
      opening: convert(page.openingBaseQuantity, openingAt),
      closing: convert(page.closingBaseQuantity, closingAt),
      openingBasis: dateFrom
        ? 'ledger_movements_before_date_from'
        : 'zero_before_all_recorded_movements',
      snapshot: page.snapshot,
    };
  }

  private async factorResolver(
    organizationId: string,
    itemId: string,
    displayUnitId: string,
    baseUnitId: string,
  ): Promise<(asOf: BusinessDate) => string> {
    if (displayUnitId === baseUnitId) return () => '1';
    const [itemVersions, globalVersions] = await Promise.all([
      this.conversions.findItemVersions(itemId, displayUnitId, baseUnitId),
      this.conversions.findGlobalVersions(
        organizationId,
        displayUnitId,
        baseUnitId,
      ),
    ]);
    return (asOf: BusinessDate): string => {
      const match =
        resolveVersionAt<UnitConversion>(itemVersions, asOf) ??
        resolveVersionAt<UnitConversion>(globalVersions, asOf);
      if (match === null) {
        throw AppException.businessRule(
          'No display-unit to base-unit conversion is effective on the quantity business date.',
        );
      }
      return match.factor;
    };
  }
}
