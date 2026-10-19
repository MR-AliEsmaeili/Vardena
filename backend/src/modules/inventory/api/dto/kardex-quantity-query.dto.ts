import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsBusinessDay } from '../../../../kernel/http/is-business-day.decorator.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { MOVEMENT_TYPES } from '../../domain/movement-type.js';

/**
 * Query for the quantity-specific Kardex route. Organization remains an
 * explicit scope parameter, matching the existing Inventory API contract;
 * authorization is still bound to the principal by ODR-3 in the service.
 */
export class KardexQuantityQueryDto extends PageQueryDto {
  /** The historical order is fixed; client-selected sorting is rejected. */
  @ApiPropertyOptional({
    description:
      'Not supported for the quantity Kardex. Rows are always ordered by movement day, creation time, and ledger id; providing sort returns 400.',
  })
  declare sort?: string;

  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  warehouseId!: string;

  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  itemId!: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive lower bound on the movement business day, canonical Gregorian YYYY-MM-DD.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive upper bound on the movement business day, canonical Gregorian YYYY-MM-DD.',
  })
  @IsOptional()
  @IsBusinessDay()
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'Opaque PostgreSQL ledger snapshot returned by page 1. Required for pages after page 1.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/)
  snapshot?: string;
}

export class KardexQuantityMovementLineDto {
  @ApiProperty({ format: 'ulid' }) movementId!: string;
  @ApiProperty({ format: 'date', example: '2026-10-08' }) date!: string;
  @ApiProperty({
    format: 'date-time',
    description: 'Ledger entry instant; the second chronological ordering key.',
  })
  createdAt!: string;
  @ApiProperty({ enum: MOVEMENT_TYPES }) movementType!: string;
  @ApiProperty({
    example: '-20.0000',
    description:
      'Signed change in the item base unit; positive increases quantity and negative decreases it.',
  })
  quantityChange!: string;
  @ApiProperty({
    example: '80.0000',
    description:
      'Ledger-derived cumulative quantity after this movement, in the base unit.',
  })
  quantityAfter!: string;
  @ApiPropertyOptional({ description: 'Opaque source reference id.' })
  referenceId?: string;
  @ApiPropertyOptional({ description: 'Opaque source reference kind.' })
  referenceType?: string;
  @ApiPropertyOptional({ format: 'ulid', description: 'Transfer identity.' })
  transferId?: string;
  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Original ledger movement identity for a reversal.',
  })
  reversalOfMovementId?: string;
}

export class QuantityKardexResponseDto {
  @ApiProperty({ type: [KardexQuantityMovementLineDto] })
  items!: KardexQuantityMovementLineDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({
    example: '100.0000',
    description:
      'Ledger-derived quantity before the requested range, in the base unit.',
  })
  opening!: string;
  @ApiProperty({
    example: '130.0000',
    description:
      'Ledger-derived quantity after the full requested range, in the base unit.',
  })
  closing!: string;
  @ApiProperty({
    enum: [
      'ledger_movements_before_date_from',
      'zero_before_all_recorded_movements',
    ],
    description: 'Explains how the opening quantity was derived.',
  })
  openingBasis!: string;
  @ApiProperty({
    format: 'ulid',
    description: 'Base unit for every quantity in the response.',
  })
  unitId!: string;
  @ApiProperty({ description: 'Pass unchanged for every subsequent page.' })
  snapshot!: string;
}
