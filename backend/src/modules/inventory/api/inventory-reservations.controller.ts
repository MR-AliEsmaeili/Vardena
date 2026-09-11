import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { InventoryReservationsService } from '../application/inventory-reservations.service.js';
import { RESERVATION_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  CreateInventoryReservationDto,
  InventoryReservationResponseDto,
  ListInventoryReservationsQueryDto,
  ReleaseInventoryReservationDto,
} from './dto/inventory-core.dto.js';

const PaginatedReservationDto = paginatedResponseOf(
  InventoryReservationResponseDto,
);

/**
 * Inventory reservations — soft claims on availability (D-07, ADR-0022).
 *
 * Transport-only (AR-03). A reservation promises stock without moving it;
 * the lifecycle is ACTIVE → RELEASED, terminal. A release is refused with
 * 422 (never silently double-applied) when the reservation already
 * released.
 */
@ApiTags('inventory-reservations')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/reservations', version: '1' })
export class InventoryReservationsController {
  constructor(private readonly reservations: InventoryReservationsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RESERVATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the reservations of one organization.' })
  @ApiExtraModels(PaginatedReservationDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedReservationDto) }] },
  })
  async list(@Query() query: ListInventoryReservationsQueryDto): Promise<{
    items: InventoryReservationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.reservations.listReservations(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RESERVATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one reservation.' })
  @ApiOkResponse({ type: InventoryReservationResponseDto })
  @ApiNotFoundResponse({ description: 'Reservation does not exist.' })
  async get(@Param('id') id: string): Promise<InventoryReservationResponseDto> {
    return this.reservations.getReservation(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RESERVATION_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a reservation against availability. Replaying an operationKey returns the original reservation.',
  })
  @ApiCreatedResponse({ type: InventoryReservationResponseDto })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with different intent (never applied).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Insufficient availability under the effective negative-stock policy, a non-stockable or disabled item/warehouse, or no unit conversion covering now.',
  })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse, item or unit does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateInventoryReservationDto,
  ): Promise<InventoryReservationResponseDto> {
    return this.reservations.createReservation({
      organizationId: body.organizationId,
      operationKey: body.operationKey,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
      quantity: body.quantity,
      unitId: body.unitId,
      reason: body.reason,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
    });
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RESERVATION_PERMISSIONS.RELEASE)
  @ApiOperation({
    summary: 'Release a reservation, freeing its claim on availability.',
  })
  @ApiOkResponse({ type: InventoryReservationResponseDto })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with different intent (never applied).',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The reservation is already released.',
  })
  @ApiNotFoundResponse({ description: 'Reservation does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async release(
    @Param('id') id: string,
    @Body() body: ReleaseInventoryReservationDto,
  ): Promise<InventoryReservationResponseDto> {
    return this.reservations.releaseReservation(id, {
      operationKey: body.operationKey,
    });
  }
}
