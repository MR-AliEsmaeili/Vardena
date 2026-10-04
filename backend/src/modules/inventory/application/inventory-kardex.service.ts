import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
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
  dateFrom?: Date;
  dateTo?: Date;
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
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw AppException.badRequest('dateFrom must not be later than dateTo.');
    }
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

    const page = await this.repository.read(query);
    const factorAt = await this.factorResolver(
      query.organizationId,
      query.itemId,
      displayUnitId,
      item.baseUnitId,
    );
    const convert = (value: string, asOf: Date): string => {
      const formattedBase = formatQuantity(value);
      if (formattedBase === '0.0000' || formattedBase === '-0.0000')
        return '0.0000';
      const converted = baseToDisplayExact(value, factorAt(asOf));
      if (converted === null) {
        throw AppException.businessRule(
          'The Kardex quantity cannot be represented exactly in the selected display unit at four-decimal precision. No rounding or truncation was applied.',
        );
      }
      return formatQuantity(converted);
    };
    const openingAt = query.dateFrom ?? new Date(0);
    const closingAt =
      query.dateTo ?? page.closingMovementDate ?? query.dateFrom ?? new Date(0);

    return {
      items: page.items.map((movement) => ({
        movementId: movement.movementId,
        movementDate: movement.movementDate.toISOString(),
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
        dateFrom: query.dateFrom?.toISOString() ?? null,
        dateTo: query.dateTo?.toISOString() ?? null,
        baseUnitId: item.baseUnitId,
        displayUnitId,
      },
      opening: convert(page.openingBaseQuantity, openingAt),
      closing: convert(page.closingBaseQuantity, closingAt),
      openingBasis: query.dateFrom
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
  ): Promise<(asOf: Date) => string> {
    if (displayUnitId === baseUnitId) return () => '1';
    const [itemVersions, globalVersions] = await Promise.all([
      this.conversions.findItemVersions(itemId, displayUnitId, baseUnitId),
      this.conversions.findGlobalVersions(
        organizationId,
        displayUnitId,
        baseUnitId,
      ),
    ]);
    return (asOf: Date): string => {
      const match =
        resolveVersionAt<UnitConversion>(itemVersions, asOf) ??
        resolveVersionAt<UnitConversion>(globalVersions, asOf);
      if (match === null) {
        throw AppException.businessRule(
          'No display-unit to base-unit conversion is effective at the quantity business instant.',
        );
      }
      return match.factor;
    };
  }
}
